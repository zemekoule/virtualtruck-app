<?php

declare(strict_types=1);

namespace App\Telemetry;

/**
 * Jobs from the plugin events and trace, ported 1:1 from telemetry_jobs() in page/build.py.
 *
 * @phpstan-type Row array<string, mixed>
 */
class JobBuilder
{
    private const TRACE_POINTS_MAX = 500;

    private const SPEEDING_TOLERANCE_MS = 0.447;

    // Between two trace points (5 s apart) normally passes at most about a game minute (ATS ~0.9, ETS2 ~0.5).
    private const BREAK_MIN_GAME_MINUTES = 10;

    private const WEAR_FIELDS = ['wear_engine', 'wear_transmission', 'wear_cabin', 'wear_chassis', 'wear_wheels', 'trailer_wear_body', 'trailer_wear_chassis', 'trailer_wear_wheels'];

    private const DAMAGE_FIELDS = ['cargo_damage', ...self::WEAR_FIELDS];

    // Wear also grows slowly with distance; only a bigger jump between two trace points counts as damage (a crash in ETS2 added 1.5 %).
    private const DAMAGE_EVENT_MIN = 0.001;

    public const JOB_KINDS = ['job' => 'truck', 'car_job' => 'car', 'bus_job' => 'bus'];

    // WoT jobs have a real-time deadline, the SDK sends this instead.
    private const NO_DEADLINE = 4294967295;

    // Jobs taken before 2026-11-16 only feed the value of the fuel in the tank.
    private const FUEL_COST_SINCE = 1794783600;

    // The cancel event of a bus job is not known yet.
    private const JOB_END_EVENTS = ['job.delivered' => 'job', 'job.cancelled' => 'job', 'car_job.delivered' => 'car_job', 'car_job.cancelled' => 'car_job', 'bus_job.completed' => 'bus_job'];

    /** @var list<Row> */
    private array $incidents = [];

    /** @var list<int> */
    private array $transports = [];

    /**
     * @param  list<Row>  $events
     */
    public function __construct(private readonly array $events, private readonly Trace $trace)
    {
        foreach ($events as $e) {
            if ($e['type'] === 'gameplay' && str_starts_with(self::str($e['id'] ?? null), 'player.')) {
                $this->incidents[] = $e;
                if (in_array($e['id'], ['player.use.ferry', 'player.use.train'], true)) {
                    $this->transports[] = self::int($e['wall']);
                }
            }
        }
    }

    /**
     * Every job found in the events, without computing it.
     *
     * @return list<array{id: string, end: Row, compute: callable(): Row}>
     */
    public function jobs(): array
    {
        $started = [];
        $jobs = [];
        $truck = null;
        foreach ($this->events as $e) {
            $type = $e['type'];
            if ($type === 'truck') {
                $truck = $e['attrs'] ?? null;
                foreach ($started as $key => $state) {
                    if (! self::truthy($state['suspended'])) {
                        $started[$key]['truck'] = $e['attrs'] ?? null;
                    }
                }

                continue;
            }
            if ($type === 'trailer' && ($e['index'] ?? null) === 0) {
                $attrs = self::row($e['attrs'] ?? null);
                foreach ($started as $key => $state) {
                    if (self::truthy($state['suspended'])) {
                        continue;
                    }
                    $started[$key]['trailers'] = [$attrs];
                    if (self::truthy($attrs['cargo.accessory.id'] ?? null)) {
                        $started[$key]['trailer_cargo'] = true;
                    } elseif (self::truthy($state['trailer_cargo']) && $state['config'] === 'job' && self::truthy($state['cargo_loaded'])) {
                        // Suspending an external job with an own trailer removes the cargo from the trailer (seen once, 2026-10-25).
                        $started[$key]['unloaded_at'] = $e['wall'];
                    }
                }

                continue;
            }
            if (is_string($type) && isset(self::JOB_KINDS[$type])) {
                $attrs = self::row($e['attrs'] ?? null);
                $jobId = $e["{$type}_id"] ?? null;
                $key = self::startKey($type, $jobId, $attrs);
                // An external job is suspended by taking another job and resumed later with its own config again.
                foreach ($started as $otherKey => $other) {
                    if ($otherKey !== $key && $other['config'] === $type && ! self::truthy($other['suspended'])) {
                        $started[$otherKey]['suspended'] = ['from' => self::firstTruthy($other['unloaded_at'], $this->suspensionStart($other, self::int($e['wall'])))];
                    }
                }
                $started[$key] ??= [
                    'wall' => $e['wall'], 'game_time' => $e['game_time'], 'unloaded' => false, 'loaded' => null, 'config' => $type, 'id' => $jobId,
                    'suspended' => null, 'suspensions' => [], 'trailers' => [], 'trailer_cargo' => false, 'truck' => $truck,
                ];
                $started[$key]['attrs'] = $attrs;
                $started[$key]['cargo_loaded'] = $attrs['cargo.loaded'] ?? null;
                $started[$key]['unloaded_at'] = null;
                if (self::truthy($started[$key]['suspended'])) {
                    $started[$key]['suspensions'][] = [...self::row($started[$key]['suspended']), 'to' => $e['wall']];
                    $started[$key]['suspended'] = null;
                }
                if (($attrs['cargo.loaded'] ?? null) === false) {
                    $started[$key]['unloaded'] = true;
                } elseif (self::truthy($attrs['cargo.loaded'] ?? null) && $started[$key]['unloaded'] && ! self::truthy($started[$key]['loaded'])) {
                    $started[$key]['loaded'] = ['wall' => $e['wall'], 'game_time' => $e['game_time']];
                }

                continue;
            }
            $config = $type === 'gameplay' ? (self::JOB_END_EVENTS[self::str($e['id'] ?? null)] ?? null) : null;
            if ($config === null || ! self::truthy($e[$config] ?? null)) {
                continue;
            }
            $jobId = $e["{$config}_id"] ?? null;
            $key = self::startKey($config, $jobId, self::row($e[$config]));
            $state = $started[$key] ?? ['wall' => $e['wall'], 'game_time' => $e['game_time'], 'loaded' => null, 'suspensions' => []];
            unset($started[$key]);
            $end = ['wall' => $e['wall'], 'game_time' => $e['game_time'], 'type' => str_ends_with(self::str($e['id'] ?? null), '.cancelled') ? 'cancelled' : 'delivered'];
            $jobs[] = $this->job($config, $jobId, $state, self::row($e[$config]), self::row($e['attrs'] ?? null), $end, $e['truck'] ?? null, self::firstTruthy($e['trailers'] ?? null, []));
        }
        foreach ($started as $state) {
            if (self::truthy($state['suspended'])) {
                $from = self::int(self::row($state['suspended'])['from']);
                $last = $this->trace->lastAtOrBefore($from) ?? [];
                $end = ['wall' => $from, 'game_time' => $last['game_time'] ?? null, 'type' => 'suspended'];
            } else {
                $last = $this->trace->last();
                $last = $last !== null && $last['wall'] >= $state['wall'] ? $last : null;
                $end = ['wall' => $last['wall'] ?? $state['wall'], 'game_time' => $last !== null ? $last['game_time'] : $state['game_time'], 'type' => 'running'];
            }
            $jobs[] = $this->job(self::str($state['config']), $state['id'], $state, self::row($state['attrs']), [], $end, $state['truck'], $state['trailers']);
        }

        return $jobs;
    }

    /**
     * @param  Row  $state
     * @param  Row  $a  job config attributes
     * @param  Row  $r  attributes of the end event
     * @param  Row  $end
     * @return array{id: string, end: Row, compute: callable(): Row}
     */
    private function job(string $config, mixed $jobId, array $state, array $a, array $r, array $end, mixed $truck, mixed $trailers): array
    {
        return [
            // Plugin < 1.5.0 has no job id; the plugin's id is the wall time of the job start too.
            'id' => self::truthy($jobId) ? self::str($jobId) : (string) self::int($state['wall']),
            'end' => $end,
            'compute' => fn () => $this->computeJob($config, $jobId, $state, $a, $r, $end, $truck === null ? null : self::row($truck), $trailers),
        ];
    }

    /**
     * @param  Row  $state
     * @param  Row  $a
     * @param  Row  $r
     * @param  Row  $end
     * @param  Row|null  $truck
     * @return Row
     */
    private function computeJob(string $config, mixed $jobId, array $state, array $a, array $r, array $end, ?array $truck, mixed $trailers): array
    {
        $start = self::int($state['wall']);
        $endWall = self::int($end['wall']);
        $loaded = $state['loaded'] === null ? null : self::row($state['loaded']);
        /** @var list<Row> $suspensions */
        $suspensions = $state['suspensions'];
        $points = $this->jobPoints($start, $endWall, $suspensions);
        $incidents = array_values(array_filter($this->incidents, fn ($i) => $start <= $i['wall'] && $i['wall'] <= $endWall && ! self::suspendedAt($suspensions, self::int($i['wall']))));
        $deadline = self::get($a, 'delivery.time') !== self::NO_DEADLINE ? self::get($a, 'delivery.time') : null;
        $stages = $config === 'bus_job' ? $this->busStages($a) : [];
        $finished = in_array($end['type'], ['delivered', 'cancelled'], true);

        return [
            'id' => self::truthy($jobId) ? self::str($jobId) : (string) $start,
            'kind' => self::JOB_KINDS[$config],
            'game_time' => self::firstTruthy($end['game_time'], $state['game_time'], 0),
            'src_company' => self::get($a, 'source.company.id'),
            'src_city' => $stages !== [] ? $stages[0]['from']['id'] : self::get($a, 'source.city.id'),
            'dst_company' => self::get($a, 'destination.company.id'),
            'dst_city' => $stages !== [] ? $stages[array_key_last($stages)]['to']['id'] : self::get($a, 'destination.city.id'),
            'cargo' => self::get($a, 'cargo.id'),
            'xp' => $finished ? self::get($r, 'earned.xp', 0) : null,
            'revenue' => $finished ? self::get($r, 'revenue', -self::num(self::get($r, 'cancel.penalty', 0))) : null,
            'km' => $finished ? Numbers::roundHalfEven(self::num(self::get($r, 'distance.km', self::get($a, 'planned_distance.km', 0)))) : null,
            'truck' => $truck !== null && $truck !== [] ? self::truckId($truck) : null,
            // Truck names are only in the telemetry; kept per job, so one user's data cannot rename trucks of the others.
            'truck_name' => $truck !== null && $truck !== [] ? self::str($truck['brand'] ?? null).' '.self::str($truck['name'] ?? null) : null,
            'mass' => self::get($a, 'cargo.mass', 0),
            'units' => self::get($a, 'cargo.unit.count', 0),
            'status' => $end['type'],
            'telemetry' => [
                'start' => $start,
                'end' => $endWall,
                'market' => self::firstTruthy(self::get($a, 'job.market'), self::get($a, 'car_job.market'), self::get($a, 'bus_job.market')),
                'planned_km' => self::get($a, 'planned_distance.km'),
                'deadline' => $deadline,
                'cargo_damage' => self::get($r, 'cargo.damage'),
                'vehicle_damage' => self::get($r, 'vehicle.damage'),
                'trailers' => $trailers,
                // Plugin >= 1.8.0; litres.
                'fuel_capacity' => $truck !== null && $truck !== [] ? self::get($truck, 'fuel.capacity') : null,
                'auto_park' => self::get($r, 'auto.park.used'),
                'auto_load' => self::get($r, 'auto.load.used'),
                'incidents' => array_map(fn ($i) => ['id' => $i['id'], 'attrs' => $i['attrs']], $incidents),
                'trace' => $this->traceSummary($points, $loaded),
                'timeline' => $this->timeline($points, $state, [...$end, 'deadline' => $deadline], $loaded, $incidents, $suspensions, $stages),
                ...($config === 'bus_job' ? ['bus' => ['satisfaction' => self::get($r, 'passenger.satisfaction'), 'stages' => $stages]] : []),
            ],
        ];
    }

    /**
     * Last trace point of the job with a trailer: suspending an external job with a company trailer removes the trailer.
     *
     * @param  Row  $state
     */
    private function suspensionStart(array $state, int $until): int
    {
        /** @var list<Row> $suspensions */
        $suspensions = $state['suspensions'];
        $since = $suspensions !== [] ? self::int($suspensions[array_key_last($suspensions)]['to']) : self::int($state['wall']);
        $walls = [];
        foreach ($this->trace->between($since, $until) as $p) {
            if (($p['trailer_connected'] ?? null) !== null) {
                $walls[] = self::int($p['wall']);
            }
        }

        return $walls !== [] ? $walls[array_key_last($walls)] : $since;
    }

    /**
     * @param  list<Row>  $suspensions
     */
    private static function suspendedAt(array $suspensions, int $wall): bool
    {
        foreach ($suspensions as $s) {
            if ($s['from'] < $wall && $wall < $s['to']) {
                return true;
            }
        }

        return false;
    }

    /**
     * Trace points of a job without its suspensions, each with km driven since the job start and resumed=true right after a suspension.
     *
     * @param  list<Row>  $suspensions
     * @return list<Row>
     */
    private function jobPoints(int $start, int $end, array $suspensions): array
    {
        $points = [];
        $km = 0;
        foreach ($this->trace->between($start, $end) as $p) {
            $wall = self::int($p['wall']);
            if (self::suspendedAt($suspensions, $wall)) {
                continue;
            }
            // A loaded save rewinds game time; the drive after the saved moment never happened.
            if ($points !== [] && self::truthy($p['game_time']) && self::truthy(end($points)['game_time']) && end($points)['game_time'] > $p['game_time']) {
                while ($points !== [] && end($points)['game_time'] > $p['game_time']) {
                    array_pop($points);
                }
                $km = $points !== [] ? self::num(end($points)['km']) : 0;
            }
            $resumed = false;
            if ($points !== []) {
                $previous = self::int(end($points)['wall']);
                foreach ($suspensions as $s) {
                    if ($previous <= $s['from'] && $s['to'] <= $wall) {
                        $resumed = true;
                    }
                }
            }
            if ($points !== [] && ! $resumed) {
                $km += self::num($p['odometer']) - self::num(end($points)['odometer']);
            }
            $points[] = [...$p, 'km' => Numbers::roundHalfEven(self::num($km), 1), 'resumed' => $resumed];
        }

        return $points;
    }

    /**
     * Indices of consecutive trace points, except the two around a suspension of the job.
     *
     * @param  list<Row>  $points
     * @return list<array{int, int}>
     */
    private static function pairs(array $points): array
    {
        $pairs = [];
        for ($i = 1; $i < count($points); $i++) {
            if (! $points[$i]['resumed']) {
                $pairs[] = [$i - 1, $i];
            }
        }

        return $pairs;
    }

    /**
     * Game time jumps between two trace points: rests, sleeps, loading, ferry and train rides.
     *
     * @param  list<Row>  $points
     * @return list<array{int, int}>
     */
    private static function timeJumps(array $points): array
    {
        return array_values(array_filter(self::pairs($points), function ($pair) use ($points) {
            [$a, $b] = [$points[$pair[0]], $points[$pair[1]]];

            // Plugin < 1.2.0 wrote 0 instead of null before the first game time arrived.
            return self::truthy($a['game_time']) && self::truthy($b['game_time']) && self::num($b['game_time']) - self::num($a['game_time']) >= self::BREAK_MIN_GAME_MINUTES;
        }));
    }

    private static function startKey(string $config, mixed $jobId, mixed $attrs): string
    {
        if (self::truthy($jobId)) {
            return 'id:'.self::str($jobId);
        }
        // Plugin < 1.5.0 has no job id. cargo.loaded changes during a job with an own trailer and the plugin logs a new config line for it.
        $attrs = self::row($attrs);
        unset($attrs['cargo.loaded']);
        ksort($attrs);

        return "config:{$config}:".json_encode($attrs, JSON_THROW_ON_ERROR);
    }

    /**
     * Drive without cargo: to loading into an own trailer, or to the first trace point with the company trailer connected.
     *
     * @param  list<Row>  $points
     * @param  Row|null  $loaded
     * @return Row|null
     */
    private static function approach(array $points, ?array $loaded): ?array
    {
        $index = null;
        foreach ($points as $i => $p) {
            if ($loaded !== null ? $p['wall'] >= $loaded['wall'] : self::truthy($p['trailer_connected'] ?? null)) {
                $index = $i;
                break;
            }
        }
        if (! self::truthy($index)) {
            return null;
        }
        assert(is_int($index));

        return [
            'kind' => $loaded !== null ? 'loading' : 'trailer',
            'index' => $index,
            'km' => $points[$index]['km'],
            // The trace point after loading already includes the game time the loading took.
            'minutes' => self::num(self::firstTruthy(($loaded ?? $points[$index])['game_time'], 0)) - self::num(self::firstTruthy($points[0]['game_time'], 0)),
        ];
    }

    /**
     * @param  list<Row>  $points
     * @return list<array{int, array<string, float|int>}>
     */
    private static function damageJumps(array $points): array
    {
        $jumps = [];
        foreach (self::pairs($points) as [$i, $j]) {
            $jump = [];
            foreach (self::DAMAGE_FIELDS as $f) {
                $a = $points[$i][$f] ?? null;
                $b = $points[$j][$f] ?? null;
                if ($a !== null && $b !== null && self::num($b) - self::num($a) >= self::DAMAGE_EVENT_MIN) {
                    $jump[$f] = Numbers::roundHalfEven(self::num($b) - self::num($a), 4);
                }
            }
            if ($jump !== []) {
                $jumps[] = [$j, $jump];
            }
        }

        return $jumps;
    }

    /**
     * Wear added during the job (plugin >= 1.5.0), without the suspensions.
     *
     * @param  list<Row>  $points
     * @return array<string, float|int>|null
     */
    private static function wear(array $points): ?array
    {
        $added = [];
        foreach (self::WEAR_FIELDS as $f) {
            $steps = [];
            foreach (self::pairs($points) as [$i, $j]) {
                if (($points[$i][$f] ?? null) !== null && ($points[$j][$f] ?? null) !== null) {
                    $steps[] = self::num($points[$j][$f]) - self::num($points[$i][$f]);
                }
            }
            if ($steps !== []) {
                $added[$f] = Numbers::roundHalfEven(Numbers::compensatedSum($steps), 4);
            }
        }

        return $added !== [] ? $added : null;
    }

    /**
     * Stages of a bus job (plugin >= 1.7.0); times are absolute game minutes, the actual ones only once they happened.
     *
     * @param  Row  $a
     * @return list<array{from: Row, to: Row, departure: array{planned: mixed, actual: mixed}, arrival: array{planned: mixed, actual: mixed}, entering: mixed, leaving: mixed}>
     */
    private function busStages(array $a): array
    {
        $stop = fn (string $prefix, int $i) => ['type' => self::get($a, "{$prefix}.type[{$i}]"), 'id' => self::get($a, "{$prefix}.id[{$i}]"), 'name' => self::get($a, "{$prefix}.name[{$i}]")];
        $stages = [];
        for ($i = 0; $i < self::int(self::get($a, 'bus.stages.count', 0)); $i++) {
            $stages[] = [
                'from' => $stop('source_stop', $i),
                'to' => $stop('destination_stop', $i),
                'departure' => ['planned' => self::get($a, "source_stop.departure_time.planned[{$i}]"), 'actual' => self::get($a, "source_stop.departure_time.actual[{$i}]")],
                'arrival' => ['planned' => self::get($a, "destination_stop.arrival_time.planned[{$i}]"), 'actual' => self::get($a, "destination_stop.arrival_time.actual[{$i}]")],
                'entering' => self::get($a, "source_stop.entering_passengers.planned[{$i}]"),
                'leaving' => self::get($a, "destination_stop.leaving_passengers.planned[{$i}]"),
            ];
        }

        return $stages;
    }

    /**
     * @param  list<Row>  $points
     * @param  Row  $start
     * @param  Row  $end
     * @param  Row|null  $loaded
     * @param  list<Row>  $incidents
     * @param  list<Row>  $suspensions
     * @param  list<array{from: Row, to: Row, departure: array{planned: mixed, actual: mixed}, arrival: array{planned: mixed, actual: mixed}, entering: mixed, leaving: mixed}>  $stages
     * @return list<Row>
     */
    private function timeline(array $points, array $start, array $end, ?array $loaded, array $incidents, array $suspensions, array $stages): array
    {
        $at = function (mixed $wall, mixed $gameTime) use ($points): array {
            $km = 0;
            foreach ($points as $p) {
                if ($p['wall'] <= $wall) {
                    $km = $p['km'];
                }
            }

            return ['wall' => $wall, 'game_time' => $gameTime, 'km' => $km];
        };
        $atGameTime = function (mixed $gameTime) use ($points, $end, $at): array {
            foreach ($points as $p) {
                if (self::truthy($p['game_time']) && $p['game_time'] >= $gameTime) {
                    return $at($p['wall'], $gameTime);
                }
            }

            return $at($end['wall'], $gameTime);
        };
        $first = $points[0] ?? [];
        $last = $points !== [] ? $points[array_key_last($points)] : [];
        $jumps = self::timeJumps($points);

        $entries = [[...$at($start['wall'], self::firstTruthy($start['game_time'], $first['game_time'] ?? null)), 'type' => 'start', 'rest_stop' => $first['rest_stop'] ?? null, 'mandatory_break' => $first['mandatory_break'] ?? null]];
        foreach ($points as $i => $p) {
            if (self::truthy($p['trailer_connected'] ?? null)) {
                if ($i !== 0) {
                    $entries[] = [...$at($p['wall'], $p['game_time']), 'type' => 'trailer'];
                }
                break;
            }
        }
        $loadingJump = null;
        if ($loaded !== null) {
            foreach ($jumps as $pair) {
                if ($points[$pair[0]]['wall'] <= $loaded['wall'] && $loaded['wall'] <= $points[$pair[1]]['wall']) {
                    $loadingJump = $pair;
                    break;
                }
            }
            $minutes = $loadingJump !== null ? self::num($points[$loadingJump[1]]['game_time']) - self::num($points[$loadingJump[0]]['game_time']) : null;
            $entries[] = [...$at($loaded['wall'], $loaded['game_time']), 'type' => 'loaded', 'minutes' => $minutes];
        }
        foreach ($jumps as $pair) {
            [$a, $b] = [$points[$pair[0]], $points[$pair[1]]];
            if ($pair === $loadingJump || array_filter($this->transports, fn ($t) => $a['wall'] <= $t && $t <= $b['wall']) !== []) {
                continue;
            }
            // The game skips the wait for a bus departure.
            $departure = null;
            foreach ($stages as $s) {
                if (self::truthy($s['departure']['actual']) && $a['game_time'] < $s['departure']['actual'] && $s['departure']['actual'] <= $b['game_time']) {
                    $departure = $s;
                    break;
                }
            }
            $entries[] = [
                ...$at($b['wall'], $a['game_time']), 'type' => $departure !== null ? 'wait' : 'break', 'minutes' => self::num($b['game_time']) - self::num($a['game_time']),
                ...($departure !== null ? ['stop' => $departure['from']['name']] : []),
            ];
        }
        // Taking a bus job skips the wait for its first departure already before the first trace point of the job.
        if ($stages !== [] && $points !== [] && self::truthy($start['game_time']) && self::truthy($stages[0]['departure']['actual'])
            && $start['game_time'] < $stages[0]['departure']['actual'] && $stages[0]['departure']['actual'] <= $points[0]['game_time']) {
            $entries[] = [...$at($points[0]['wall'], $start['game_time']), 'type' => 'wait', 'minutes' => self::num($points[0]['game_time']) - self::num($start['game_time']), 'stop' => $stages[0]['from']['name']];
        }
        foreach ($stages as $s) {
            if (self::truthy($s['departure']['actual'])) {
                $entries[] = [...$atGameTime($s['departure']['actual']), 'type' => 'departure', 'stop' => $s['from']['name']];
            }
            if (self::truthy($s['arrival']['actual'])) {
                $late = $s['arrival']['planned'] !== null ? self::num($s['arrival']['actual']) - self::num($s['arrival']['planned']) : null;
                $entries[] = [...$atGameTime($s['arrival']['actual']), 'type' => 'arrival', 'stop' => $s['to']['name'], 'late' => self::truthy($late) && $late > 0 ? $late : null];
            }
        }
        for ($i = 1; $i < count($points); $i++) {
            if ($points[$i]['resumed']) {
                [$a, $b] = [$points[$i - 1], $points[$i]];
                $entries[] = [...$at($a['wall'], $a['game_time']), 'type' => 'suspended', 'minutes' => self::num($b['game_time']) - self::num($a['game_time']), 'resumed_wall' => $b['wall']];
            }
        }
        foreach (self::damageJumps($points) as [$j, $jump]) {
            $entries[] = [...$at($points[$j]['wall'], $points[$j]['game_time']), 'type' => 'damage', 'damage' => $jump];
        }
        foreach ($incidents as $incident) {
            $ride = null;
            if (in_array($incident['wall'], $this->transports, true)) {
                foreach ($jumps as $pair) {
                    if ($points[$pair[0]]['wall'] <= $incident['wall'] && $incident['wall'] <= $points[$pair[1]]['wall']) {
                        $ride = $pair;
                        break;
                    }
                }
            }
            $entries[] = [
                ...$at($incident['wall'], $incident['game_time']), 'type' => 'incident', 'id' => $incident['id'], 'attrs' => $incident['attrs'],
                ...($ride !== null ? ['minutes' => self::num($points[$ride[1]]['game_time']) - self::num($points[$ride[0]]['game_time'])] : []),
            ];
        }
        $late = $end['type'] === 'delivered' && $end['deadline'] !== null && $end['game_time'] !== null ? self::num($end['game_time']) - self::num($end['deadline']) : null;
        $entries[] = [...$at($end['wall'], $end['game_time']), 'type' => $end['type'], 'rest_stop' => $last['rest_stop'] ?? null, 'mandatory_break' => $last['mandatory_break'] ?? null, 'late' => self::truthy($late) && $late > 0 ? $late : null];

        usort($entries, fn ($x, $y) => [$x['wall'], $x['type'] !== 'start'] <=> [$y['wall'], $y['type'] !== 'start']);

        return $entries;
    }

    /**
     * @param  list<Row>  $points
     * @param  Row|null  $loaded
     * @return Row|null
     */
    private function traceSummary(array $points, ?array $loaded): ?array
    {
        if ($points === []) {
            return null;
        }
        $speeds = array_map(fn ($p) => self::num($p['speed']), $points);
        $moving = array_values(array_filter($speeds, fn ($speed) => $speed > 1));
        $burned = [];
        foreach (self::pairs($points) as [$i, $j]) {
            if ($points[$i]['fuel'] > $points[$j]['fuel']) {
                $burned[] = [self::num($points[$i]['fuel']) - self::num($points[$j]['fuel']), $points[$i]['tank_price']];
            }
        }
        $fuelUsed = Numbers::compensatedSum(array_column($burned, 0));
        $unpriced = array_filter($burned, fn ($b) => $b[1] === null) !== [];
        $fuelCost = $points[0]['wall'] < self::FUEL_COST_SINCE || $unpriced ? null : Numbers::roundHalfEven(Numbers::compensatedSum(array_map(fn ($b) => $b[0] * self::num($b[1]), $burned)));
        // Points recorded by plugin < 1.2.0 have no speed limit; the game also sends 0 and -1 (meaning unknown).
        $limited = array_values(array_filter($points, fn ($p) => self::num(self::firstTruthy($p['speed_limit'] ?? null, 0)) > 0 && $p['speed'] > 1));
        $over = [];
        foreach ($limited as $p) {
            if (self::num($p['speed']) > self::num($p['speed_limit']) + self::SPEEDING_TOLERANCE_MS) {
                $over[] = self::num($p['speed']) - self::num($p['speed_limit']);
            }
        }
        $step = max(1, intdiv(count($points), self::TRACE_POINTS_MAX));
        $toTrailer = self::approach($points, $loaded);
        if ($toTrailer !== null) {
            $toTrailer['path_index'] = intdiv(self::int($toTrailer['index']), $step);
        }
        $consumption = null;
        foreach (array_reverse($points) as $p) {
            if (($p['fuel_consumption'] ?? null) !== null) {
                $consumption = $p['fuel_consumption'];
                break;
            }
        }
        $last = $points[array_key_last($points)];
        $wearEnd = [];
        foreach (self::WEAR_FIELDS as $f) {
            if (! str_starts_with($f, 'trailer_') && ($last[$f] ?? null) !== null) {
                $wearEnd[$f] = Numbers::roundHalfEven(self::num($last[$f]), 4);
            }
        }
        $path = [];
        for ($i = 0; $i < count($points); $i += $step) {
            $path[] = [Numbers::roundHalfEven(self::num($points[$i]['x'])), Numbers::roundHalfEven(self::num($points[$i]['z']))];
        }

        return [
            'driven_km' => $last['km'],
            'max_kmh' => Numbers::roundHalfEven(max($speeds) * 3.6),
            'avg_kmh' => $moving !== [] ? Numbers::roundHalfEven(Numbers::compensatedSum($moving) / count($moving) * 3.6) : 0,
            'fuel_used' => Numbers::roundHalfEven($fuelUsed),
            'fuel_cost' => $fuelCost,
            // Plugin >= 1.9.0; the truck computer's average in l/km when the job ended, the game decides when it resets.
            'onboard_consumption' => $consumption,
            'speeding_pct' => $limited !== [] ? Numbers::roundHalfEven(100 * count($over) / count($limited)) : null,
            'max_over_kmh' => $over !== [] ? Numbers::roundHalfEven(max($over) * 3.6) : 0,
            'approach' => $toTrailer,
            'wear' => self::wear($points),
            'wear_end' => $wearEnd !== [] ? $wearEnd : null,
            'path' => $path,
        ];
    }

    /** Falsy as in build.py (Python): null, false, 0, 0.0, '' and [], unlike PHP the string '0' is truthy. */
    private static function truthy(mixed $value): bool
    {
        return ! ($value === null || $value === false || $value === 0 || $value === 0.0 || $value === '' || $value === []);
    }

    /** The first truthy value, or the last one. */
    private static function firstTruthy(mixed ...$values): mixed
    {
        foreach ($values as $value) {
            if (self::truthy($value)) {
                return $value;
            }
        }

        return $values === [] ? null : $values[array_key_last($values)];
    }

    /**
     * The default only when the key is missing, not when its value is null.
     *
     * @param  array<mixed>  $array
     */
    private static function get(array $array, string $key, mixed $default = null): mixed
    {
        return array_key_exists($key, $array) ? $array[$key] : $default;
    }

    /**
     * @param  Row  $truck
     */
    private static function truckId(array $truck): string
    {
        $id = self::str($truck['id']);

        return str_starts_with($id, 'vehicle.') ? substr($id, strlen('vehicle.')) : $id;
    }

    /**
     * @return Row
     */
    private static function row(mixed $value): array
    {
        /** @var Row */
        return is_array($value) ? $value : [];
    }

    private static function num(mixed $value): float|int
    {
        return is_int($value) || is_float($value) ? $value : 0;
    }

    private static function int(mixed $value): int
    {
        return is_numeric($value) ? (int) $value : 0;
    }

    private static function str(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : '';
    }
}
