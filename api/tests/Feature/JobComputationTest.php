<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Enums\DataFile;
use App\Enums\Game;
use App\Ingest\RawData;
use App\Models\User;
use App\Telemetry\JobComputation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class JobComputationTest extends TestCase
{
    use RefreshDatabase;

    // After FUEL_COST_SINCE, so jobs get a fuel cost.
    private const T = 1794900000;

    private User $user;

    private string $namesDir;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        $this->namesDir = sys_get_temp_dir().'/names-'.uniqid();
        mkdir("{$this->namesDir}/eut2", recursive: true);
        file_put_contents("{$this->namesDir}/eut2/fuel_places.json", json_encode([[1000, 0, 'czech', false], [5000, 0, 'czech', true]]));
        file_put_contents("{$this->namesDir}/eut2/fuel_prices.json", json_encode([['id' => 'czech', 'name' => 'Česko', 'price' => 2.0]]));
        config(['virtualtruck.names_dir' => $this->namesDir]);
    }

    protected function tearDown(): void
    {
        array_map('unlink', glob("{$this->namesDir}/eut2/*") ?: []);
        rmdir("{$this->namesDir}/eut2");
        rmdir($this->namesDir);

        parent::tearDown();
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function send(DataFile $file, array $lines): void
    {
        $data = app(RawData::class);
        $data->store($this->user, Game::Eut2, $file, $data->lastSeq($this->user, Game::Eut2, $file) + 1, $lines);
    }

    private function compute(): void
    {
        app(JobComputation::class)->run($this->user, Game::Eut2);
    }

    /**
     * @return array<string, mixed>
     */
    private function point(int $second, float $x, float $fuel, float $odometer, int $gameTime): array
    {
        return [
            'wall' => self::T + $second, 'game_time' => $gameTime, 'type' => 'trace', 'x' => $x, 'y' => 0.0, 'z' => 0.0, 'speed' => 20.0,
            'fuel' => $fuel, 'fuel_consumption' => 0.3, 'odometer' => $odometer, 'speed_limit' => 25.0, 'rest_stop' => 600, 'mandatory_break' => 600,
            'trailer_connected' => true,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function jobAttrs(): array
    {
        return [
            'cargo.id' => 'petrol', 'cargo' => 'Benzín', 'cargo.mass' => 21750, 'cargo.unit.count' => 30,
            'source.company.id' => 'ns_oil', 'source.company' => 'NS Oil', 'destination.company.id' => 'rosmark', 'destination.company' => 'Rosmark',
            'source.city.id' => 'praha', 'source.city' => 'Praha', 'destination.city.id' => 'brno', 'destination.city' => 'Brno',
            'delivery.time' => 4294967295, 'planned_distance.km' => 200, 'cargo.loaded' => true, 'job.market' => 'external_contracts',
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function takeJob(): array
    {
        return [
            ['wall' => self::T, 'game_time' => null, 'type' => 'truck', 'attrs' => ['brand_id' => 'man', 'brand' => 'MAN', 'id' => 'vehicle.man.tgx', 'name' => 'TGX']],
            ['wall' => self::T + 10, 'game_time' => 1002, 'type' => 'job', 'job_id' => '100', 'attrs' => $this->jobAttrs()],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function delivered(int $second): array
    {
        return [
            'wall' => self::T + $second, 'game_time' => 1100, 'type' => 'gameplay', 'id' => 'job.delivered', 'job_id' => '100', 'job' => $this->jobAttrs(),
            'attrs' => ['revenue' => 5000, 'earned.xp' => 300, 'distance.km' => 201.5, 'cargo.damage' => 0, 'auto.park.used' => false, 'auto.load.used' => true],
            'truck' => ['brand_id' => 'man', 'brand' => 'MAN', 'id' => 'vehicle.man.tgx', 'name' => 'TGX'],
        ];
    }

    /**
     * Drive from x=0 to the pump at x=1000 burning 10 l, refuel 100 l, take the job (T + 10) and drive on burning 30 l.
     *
     * @return list<array<string, mixed>>
     */
    private function trace(): array
    {
        return [
            $this->point(0, 0, 200, 0, 1000),
            $this->point(5, 990, 190, 1, 1001),
            $this->point(10, 995, 290, 1.2, 1002),
            $this->point(15, 3000, 270, 3, 1003),
            $this->point(20, 6000, 260, 6, 1004),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function job(): array
    {
        $job = DB::table('game_jobs')->where('id', '100')->first();
        $this->assertNotNull($job);

        /** @var array<string, mixed> */
        return (array) $job;
    }

    /**
     * @return array{end: int, trace: array<string, mixed>, timeline: list<array<string, mixed>>}
     */
    private function telemetry(): array
    {
        $telemetry = $this->job()['telemetry'];
        $this->assertIsString($telemetry);

        /** @var array{end: int, trace: array<string, mixed>, timeline: list<array<string, mixed>>} */
        return json_decode($telemetry, true);
    }

    public function test_delivered_job_with_fuel_cost(): void
    {
        $this->send(DataFile::Events, [...$this->takeJob(), $this->delivered(20)]);
        $this->send(DataFile::Trace, $this->trace());
        $this->compute();

        $job = $this->job();
        $this->assertSame(['delivered', 5000, 300, 202, 'man.tgx', 'praha', 'brno', 1], [$job['status'], $job['revenue'], $job['xp'], $job['km'], $job['truck'], $job['src_city'], $job['dst_city'], $job['complete']]);
        $telemetry = $this->telemetry();
        // The fuel in the tank before the first refuel gets its price: 30 l × 2.0.
        $this->assertSame(['driven_km' => 4.8, 'fuel_used' => 30, 'fuel_cost' => 60], array_intersect_key($telemetry['trace'], array_flip(['driven_km', 'fuel_used', 'fuel_cost'])));
        $this->assertSame(['start', 'delivered'], array_column($telemetry['timeline'], 'type'));

        $refuel = DB::table('refuels')->first();
        $this->assertNotNull($refuel);
        $this->assertSame([100.0, 'czech', 2.0, 'man.tgx'], [$refuel->litres, $refuel->country, $refuel->price, $refuel->truck]);
        $this->assertSame('MAN TGX', $job['truck_name']);
    }

    public function test_job_stays_incomplete_until_its_trace_arrives(): void
    {
        $this->send(DataFile::Events, [...$this->takeJob(), $this->delivered(20)]);
        $this->send(DataFile::Trace, array_slice($this->trace(), 0, 3));
        $this->compute();
        $this->assertSame([0, 0], [$this->job()['complete'], $this->telemetry()['trace']['driven_km']]);

        $this->send(DataFile::Trace, array_slice($this->trace(), 3));
        $this->compute();

        $this->assertSame([1, 4.8], [$this->job()['complete'], $this->telemetry()['trace']['driven_km']]);
    }

    public function test_complete_job_is_not_computed_again(): void
    {
        $this->send(DataFile::Events, [...$this->takeJob(), $this->delivered(20)]);
        $this->send(DataFile::Trace, $this->trace());
        $this->compute();
        DB::table('game_jobs')->where('id', '100')->update(['revenue' => 1]);

        $this->send(DataFile::Trace, [$this->point(25, 7000, 255, 7, 1005)]);
        $this->compute();

        $this->assertSame(1, $this->job()['revenue']);
    }

    public function test_running_job_follows_the_trace(): void
    {
        $this->send(DataFile::Events, $this->takeJob());
        $this->send(DataFile::Trace, array_slice($this->trace(), 0, 3));
        $this->compute();
        $this->assertSame(['running', null, self::T + 10], [$this->job()['status'], $this->job()['revenue'], $this->telemetry()['end']]);

        $this->send(DataFile::Trace, array_slice($this->trace(), 3));
        $this->compute();

        $this->assertSame(self::T + 20, $this->telemetry()['end']);
    }

    public function test_refuel_split_over_two_batches_is_one_refuel(): void
    {
        $this->send(DataFile::Events, $this->takeJob());
        $trace = $this->trace();
        $this->send(DataFile::Trace, array_slice($trace, 0, 3));
        $this->compute();
        // The fuel gauge fills up over two trace points.
        $this->send(DataFile::Trace, [$this->point(11, 995, 300, 1.2, 1002)]);
        $this->compute();

        $refuels = DB::table('refuels')->get();
        $this->assertCount(1, $refuels);
        $this->assertSame([110.0], $refuels->pluck('litres')->all());
    }

    public function test_refuel_in_a_country_without_fuel_price_stops_the_computation(): void
    {
        file_put_contents("{$this->namesDir}/eut2/fuel_prices.json", json_encode([]));
        $this->send(DataFile::Events, $this->takeJob());
        $this->send(DataFile::Trace, $this->trace());

        $this->expectExceptionMessage('No fuel price for czech');
        $this->compute();
    }

    public function test_missing_fuel_places_stop_the_computation(): void
    {
        unlink("{$this->namesDir}/eut2/fuel_places.json");
        $this->send(DataFile::Events, $this->takeJob());

        $this->expectExceptionMessage('fuel_places.json');
        $this->compute();
    }

    public function test_event_without_expected_keys_is_skipped(): void
    {
        $this->send(DataFile::Events, [['wall' => self::T, 'game_time' => null, 'type' => 'trailer'], ['wall' => self::T, 'game_time' => null, 'type' => 'gameplay'], ...$this->takeJob()]);
        $this->send(DataFile::Trace, $this->trace());
        $this->compute();

        $this->assertSame('running', $this->job()['status']);
    }

    public function test_received_lines_start_the_computation(): void
    {
        $this->withoutDefer();
        $this->withToken($this->user->createToken('plugin')->plainTextToken);

        $this->postJson('/api/ingest/eut2/events', ['seq' => 1, 'lines' => [...$this->takeJob(), $this->delivered(20)]])->assertOk();
        $this->postJson('/api/ingest/eut2/trace', ['seq' => 1, 'lines' => $this->trace()])->assertOk();

        $this->assertSame(1, $this->job()['complete']);
    }
}
