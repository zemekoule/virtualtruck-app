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
 * @phpstan-import-type State from TankPrices as TankState
 * @phpstan-import-type State from JobBuilder as JobState
 */
class JobComputation
{
    public function __construct(private readonly RawData $data) {}

    /**
     * @param  bool  $wait  wait for a computation running elsewhere instead of leaving the new data to it
     * @param  bool  $fresh  compute the jobs and fuel prices from all data again (e.g. after fixing events by hand); needs $wait
     */
    public function run(User $user, Game $game, bool $wait = false, bool $fresh = false): void
    {
        do {
            // Events and trace come in separate requests; a request that finds the computation running leaves the new lines to it.
            $lock = Cache::lock("job-computation:{$user->id}:{$game->value}", 600);
            if ($wait) {
                $lock->block(120);
            } elseif (! $lock->get()) {
                return;
            }
            try {
                // Under the lock, a computation running from an ingest request would otherwise save its state over the forgotten one.
                if ($fresh) {
                    $this->forget($user, $game);
                    $fresh = false;
                }
                while ($this->computeNewData($user, $game)) {
                    // Lines may have arrived during the computation.
                }
            } finally {
                $lock->release();
            }
            // Lines stored after the last check above whose request did not get the lock.
        } while ($this->newData($user, $game) !== null);
    }

    private function forget(User $user, Game $game): void
    {
        DB::transaction(function () use ($user, $game) {
            DB::table('game_jobs')->where('user_id', $user->id)->where('game', $game->value)->where('source', 'plugin')->delete();
            DB::table('refuels')->where('user_id', $user->id)->where('game', $game->value)->delete();
            DB::table('job_computations')->where('user_id', $user->id)->where('game', $game->value)->delete();
        });
    }

    /**
     * @return array{events: int, trace: int, done: \stdClass|null}|null the last seqs and the last computation when there is something new
     */
    private function newData(User $user, Game $game): ?array
    {
        $events = $this->data->lastSeq($user, $game, DataFile::Events);
        $trace = $this->data->lastSeq($user, $game, DataFile::Trace);
        $done = DB::table('job_computations')->where('user_id', $user->id)->where('game', $game->value)->first();
        if ($done === null ? $events === 0 && $trace === 0 : self::int($done->events_seq) === $events && self::int($done->trace_seq) === $trace) {
            return null;
        }

        return ['events' => $events, 'trace' => $trace, 'done' => $done];
    }

    private function computeNewData(User $user, Game $game): bool
    {
        $new = $this->newData($user, $game);
        if ($new === null) {
            return false;
        }
        ['events' => $eventsSeq, 'trace' => $traceSeq, 'done' => $done] = $new;
        /** @var TankState $tankState */
        $tankState = $done !== null && is_string($done->tank_state) ? json_decode($done->tank_state, true) : ['tanks' => [], 'prev' => null, 'refuel' => null];
        /** @var JobState $jobState */
        $jobState = $done !== null && is_string($done->job_state) ? json_decode($done->job_state, true) : JobBuilder::INITIAL_STATE;
        $jobEventsSeq = $done === null ? 0 : self::int($done->job_events_seq);

        DB::transaction(function () use ($user, $game, $tankState, $jobState, $jobEventsSeq, $done, $eventsSeq, $traceSeq) {
            $tankState = $this->computeTankPrices($user, $game, $tankState, $done === null ? 0 : self::int($done->trace_seq), $traceSeq);
            [$jobState, $jobEventsSeq] = $this->computeJobs($user, $game, $jobState, $jobEventsSeq, $eventsSeq, $traceSeq);
            DB::table('job_computations')->upsert([
                'user_id' => $user->id, 'game' => $game->value, 'events_seq' => $eventsSeq, 'trace_seq' => $traceSeq,
                'tank_state' => self::encode($tankState), 'job_events_seq' => $jobEventsSeq, 'job_state' => self::encode($jobState),
            ], ['user_id', 'game']);
        });

        return true;
    }

    /**
     * @param  TankState  $state
     * @return TankState
     */
    private function computeTankPrices(User $user, Game $game, array $state, int $fromSeq, int $toSeq): array
    {
        /** @var list<array{0: float|int, 1: float|int, 2: string, 3: bool}> $places */
        $places = $this->namesFile($game, 'fuel_places');
        $prices = $this->fuelPrices($game);
        $points = DB::table('trace_points')->where('user_id', $user->id)->where('game', $game->value)->whereBetween('seq', [$fromSeq + 1, $toSeq]);
        $firstWall = (clone $points)->orderBy('seq')->value('wall');
        if (! is_string($firstWall)) {
            return $state;
        }
        $vehicles = $this->vehicles($user, $game, $firstWall);
        $tanks = new TankPrices($state, $vehicles, $places, $prices);

        $points->orderBy('seq')->chunk(1000, function ($rows) use ($tanks) {
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
     * Vehicle changes from the last one before the wall on, in the order of the events.
     *
     * @return list<array{wall: int, key: string}>
     */
    private function vehicles(User $user, Game $game, string $wall): array
    {
        $trucks = DB::table('game_events')->where('user_id', $user->id)->where('game', $game->value)->where('type', 'truck');
        $fromSeq = (clone $trucks)->where('wall', '<=', $wall)->orderByDesc('wall')->orderByDesc('seq')->value('seq') ?? 0;
        $vehicles = [];
        foreach ($trucks->where('seq', '>=', $fromSeq)->orderBy('seq')->pluck('data') as $data) {
            $event = self::decode($data);
            $attrs = $event['attrs'] ?? null;
            if (is_array($attrs)) {
                $vehicles[] = ['wall' => self::int($event['wall']), 'key' => TankPrices::vehicleKey($attrs['id'] ?? null, $attrs['license.plate'] ?? null)];
            }
        }

        return $vehicles;
    }

    /**
     * @param  JobState  $state
     * @return array{JobState, int}
     */
    private function computeJobs(User $user, Game $game, array $state, int $fromSeq, int $toSeq, int $traceSeq): array
    {
        // Only the trace priced above, points stored meanwhile have no tank price yet.
        $trace = new Trace($user->id, $game, $traceSeq);
        $lastWall = $trace->last()['wall'] ?? 0;
        $events = [];
        $seqs = [];
        foreach (DB::table('game_events')->where('user_id', $user->id)->where('game', $game->value)->whereBetween('seq', [$fromSeq + 1, $toSeq])->orderBy('seq')->get(['seq', 'data']) as $row) {
            $events[] = self::decode($row->data);
            $seqs[] = self::int($row->seq);
        }
        // Events after the arrived trace are processed again next time, a job state depends on the trace up to its events.
        $persisted = 0;
        while ($persisted < count($events) && $events[$persisted]['wall'] <= $lastWall) {
            $persisted++;
        }
        $gameplay = fn (int $from, int $to) => array_values(array_map(self::decode(...), DB::table('game_events')->where('user_id', $user->id)->where('game', $game->value)->where('type', 'gameplay')
            ->whereBetween('wall', [gmdate('Y-m-d H:i:s', $from), gmdate('Y-m-d H:i:s', $to)])->orderBy('seq')->pluck('data')->all()));
        $result = (new JobBuilder($trace, $gameplay))->jobs($events, $persisted, $state);

        foreach ($result['jobs'] as $job) {
            $j = ($job['compute'])();
            DB::table('game_jobs')->upsert([
                'user_id' => $user->id, 'game' => $game->value, 'id' => $job['id'], 'source' => 'plugin',
                ...array_intersect_key($j, array_flip(['kind', 'status', 'game_time', 'src_company', 'src_city', 'dst_company', 'dst_city', 'cargo', 'xp', 'revenue', 'km', 'truck', 'truck_name', 'mass', 'units'])),
                'telemetry' => json_encode($j['telemetry'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION),
            ], ['user_id', 'game', 'id']);
        }

        return [$result['state'], $persisted > 0 ? $seqs[$persisted - 1] : $fromSeq];
    }

    /**
     * @return array<string, mixed>
     */
    private static function decode(mixed $data): array
    {
        /** @var array<string, mixed> */
        return json_decode(is_string($data) ? $data : '', true, flags: JSON_THROW_ON_ERROR);
    }

    private static function encode(mixed $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
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
