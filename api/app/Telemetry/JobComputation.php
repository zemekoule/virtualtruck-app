<?php

declare(strict_types=1);

namespace App\Telemetry;

use App\Enums\DataFile;
use App\Enums\Game;
use App\Ingest\RawData;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Computes jobs and refuels from the plugin data of a user and game, only from what has changed since the last run.
 *
 * @phpstan-import-type State from TankPrices
 */
class JobComputation
{
    public function __construct(private readonly RawData $data) {}

    public function run(User $user, Game $game): void
    {
        // Events and trace come in separate requests, each starts a computation; the second one waits and computes what the first one missed.
        Cache::lock("job-computation:{$user->id}:{$game->value}", 600)->block(120, function () use ($user, $game) {
            while ($this->computeNewData($user, $game)) {
                // Lines may have arrived during the computation.
            }
        });
    }

    private function computeNewData(User $user, Game $game): bool
    {
        $eventsSeq = $this->data->lastSeq($user, $game, DataFile::Events);
        $traceSeq = $this->data->lastSeq($user, $game, DataFile::Trace);
        $done = DB::table('job_computations')->where('user_id', $user->id)->where('game', $game->value)->first();
        if ($done !== null && self::int($done->events_seq) === $eventsSeq && self::int($done->trace_seq) === $traceSeq) {
            return false;
        }
        /** @var State $tankState */
        $tankState = $done !== null && is_string($done->tank_state) ? json_decode($done->tank_state, true) : ['tanks' => [], 'prev' => null, 'refuel' => null];
        $events = $this->events($user, $game, $eventsSeq);

        DB::transaction(function () use ($user, $game, $events, $tankState, $done, $eventsSeq, $traceSeq) {
            $tankState = $this->computeTankPrices($user, $game, $events, $tankState, $done === null ? 0 : self::int($done->trace_seq), $traceSeq);
            $this->computeJobs($user, $game, $events);
            DB::table('job_computations')->upsert(
                ['user_id' => $user->id, 'game' => $game->value, 'events_seq' => $eventsSeq, 'trace_seq' => $traceSeq, 'tank_state' => json_encode($tankState, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION)],
                ['user_id', 'game'],
            );
        });

        return true;
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @param  State  $state
     * @return State
     */
    private function computeTankPrices(User $user, Game $game, array $events, array $state, int $fromSeq, int $toSeq): array
    {
        $vehicles = [];
        foreach ($events as $e) {
            if ($e['type'] === 'truck' && is_array($e['attrs'])) {
                $vehicles[] = ['wall' => self::int($e['wall']), 'key' => TankPrices::vehicleKey($e['attrs']['id'] ?? null, $e['attrs']['license.plate'] ?? null)];
            }
        }
        /** @var list<array{0: float|int, 1: float|int, 2: string, 3: bool}> $places */
        $places = $this->namesFile($game, 'fuel_places');
        $tanks = new TankPrices($state, $vehicles, $places, $this->fuelPrices($game));

        DB::table('trace_points')->where('user_id', $user->id)->where('game', $game->value)->whereBetween('seq', [$fromSeq + 1, $toSeq])
            ->orderBy('seq')
            ->chunk(1000, function ($rows) use ($tanks) {
                $priced = [];
                foreach ($rows as $row) {
                    /** @var array{wall: int, game_time: int|null, fuel: float|int, odometer: float|int, x: float|int, z: float|int} $point */
                    $point = json_decode(is_string($row->data) ? $row->data : '', true, flags: JSON_THROW_ON_ERROR);
                    $priced[] = [...(array) $row, 'tank_price' => $tanks->add($point)];
                }
                DB::table('trace_points')->upsert($priced, ['user_id', 'game', 'seq'], ['tank_price']);
            });

        $rows = array_map(fn ($r) => [
            'user_id' => $user->id, 'game' => $game->value, 'wall' => gmdate('Y-m-d H:i:s', $r['wall']), 'last_wall' => gmdate('Y-m-d H:i:s', $r['last_wall']),
            'game_time' => $r['game_time'], 'truck' => $this->truck($r['vehicle']), 'litres' => $r['litres'], 'country' => $r['country'], 'garage' => $r['garage'], 'price' => $r['price'],
        ], array_values($tanks->refuels));
        if ($rows !== []) {
            DB::table('refuels')->insert($rows);
        }
        foreach ($tanks->continued as $wall => $refuel) {
            DB::table('refuels')->where('user_id', $user->id)->where('game', $game->value)->where('wall', gmdate('Y-m-d H:i:s', $wall))
                ->update(['litres' => $refuel['litres'], 'last_wall' => gmdate('Y-m-d H:i:s', $refuel['last_wall'])]);
        }

        return $tanks->state;
    }

    /**
     * @param  list<array<string, mixed>>  $events
     */
    private function computeJobs(User $user, Game $game, array $events): void
    {
        $trace = new Trace($user->id, $game);
        $lastWall = $trace->last()['wall'] ?? 0;
        $complete = DB::table('game_jobs')->where('user_id', $user->id)->where('game', $game->value)->where('complete', true)->pluck('id')->flip();
        $builder = new JobBuilder($events, $trace);
        $ids = [];
        foreach ($builder->jobs() as $job) {
            $ids[] = $job['id'];
            if ($complete->has($job['id'])) {
                continue;
            }
            $j = ($job['compute'])();
            DB::table('game_jobs')->upsert([
                'user_id' => $user->id, 'game' => $game->value, 'id' => $job['id'], 'source' => 'plugin',
                ...array_intersect_key($j, array_flip(['kind', 'status', 'game_time', 'src_company', 'src_city', 'dst_company', 'dst_city', 'cargo', 'xp', 'revenue', 'km', 'truck', 'truck_name', 'mass', 'units'])),
                'telemetry' => json_encode($j['telemetry'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION),
                // The plugin sends events and trace separately, the trace up to the job end may still be on the way.
                'complete' => in_array($job['end']['type'], ['delivered', 'cancelled'], true) && $lastWall >= $job['end']['wall'],
            ], ['user_id', 'game', 'id']);
        }
        DB::table('game_jobs')->where('user_id', $user->id)->where('game', $game->value)->where('source', 'plugin')->whereNotIn('id', $ids)->delete();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function events(User $user, Game $game, int $toSeq): array
    {
        $events = [];
        foreach (DB::table('game_events')->where('user_id', $user->id)->where('game', $game->value)->where('seq', '<=', $toSeq)->orderBy('seq')->pluck('data') as $data) {
            /** @var array<string, mixed> $event */
            $event = json_decode(is_string($data) ? $data : '', true, flags: JSON_THROW_ON_ERROR);
            $events[] = $event;
        }

        return $events;
    }

    private static function int(mixed $value): int
    {
        return is_numeric($value) ? (int) $value : 0;
    }

    private function truck(string $vehicleKey): ?string
    {
        $vehicle = json_decode($vehicleKey, true);
        $id = is_array($vehicle) && is_string($vehicle[0] ?? null) ? $vehicle[0] : null;

        return $id !== null && str_starts_with($id, 'vehicle.') ? substr($id, strlen('vehicle.')) : $id;
    }

    /**
     * @return array<string, float|int>
     */
    private function fuelPrices(Game $game): array
    {
        $prices = [];
        /** @var list<array{id: string, price: float|int}> $countries */
        $countries = $this->namesFile($game, 'fuel_prices');
        foreach ($countries as $country) {
            $prices[$country['id']] = $country['price'];
        }

        return $prices;
    }

    /**
     * Files made by the tools in tools/ from the game installation.
     *
     * @return list<mixed>
     */
    private function namesFile(Game $game, string $name): array
    {
        $path = config()->string('virtualtruck.names_dir')."/{$game->value}/{$name}.json";

        // Without them every refuel would be missed for good, the trace is priced only once.
        if (! is_file($path)) {
            throw new \RuntimeException("Missing {$path}.");
        }

        /** @var list<mixed> */
        return json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    }
}
