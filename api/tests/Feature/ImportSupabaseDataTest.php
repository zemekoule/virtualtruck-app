<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ImportSupabaseDataTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    /** @var array<string, list<array<string, mixed>>> rows of eut2 by table, ats is empty */
    private array $supabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['virtualtruck.supabase' => ['project_id' => 'proj', 'publishable_key' => 'pk']]);
        $this->user = User::factory()->create(['email' => 'andros@example.com']);
        $this->supabase = [
            'jobs' => [['game' => 'eut2', 'id' => 'save-car-200', 'source' => 'save', 'kind' => 'car', 'status' => 'delivered', 'game_time' => 200, 'src_company' => null, 'src_city' => 'praha', 'dst_company' => null, 'dst_city' => 'brno', 'cargo' => null, 'xp' => 10, 'revenue' => 500, 'km' => 200, 'truck' => 'daf.2021', 'mass' => null, 'units' => null, 'car' => ['rating' => 4, 'provisional_reward' => 1.5], 'telemetry' => null]],
            'names' => [['id' => 'daf.2021', 'name' => 'DAF NGD']],
            'depots' => [['city' => 'praha', 'company' => 'tradeaux']],
            'cancellations' => [['job_id' => '1794897126', 'created_at' => '2026-11-12T18:31:00.123+00:00']],
        ];
        Http::fake(function (Request $request) {
            $this->assertSame('pk', $request->header('apikey')[0]);
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
            $table = substr((string) parse_url($request->url(), PHP_URL_PATH), strlen('/rest/v1/'));
            $rows = $query['game'] === 'eq.eut2' ? $this->supabase[$table] : [];

            return Http::response(array_slice($rows, (int) $query['offset'], (int) $query['limit']));
        });
    }

    public function test_imports_save_jobs_depots_and_cancellations(): void
    {
        $this->assertSame(0, Artisan::call('supabase:import', ['email' => 'andros@example.com']));

        $job = DB::table('game_jobs')->first();
        $this->assertNotNull($job);
        $this->assertSame(['save-car-200', 'save', 'DAF NGD', $this->user->id], [$job->id, $job->source, $job->truck_name, $job->user_id]);
        $this->assertSame(['rating' => 4, 'provisional_reward' => 1.5], json_decode(is_string($job->car) ? $job->car : '', true));
        $this->assertNull($job->telemetry);
        $this->assertSame(['praha'], DB::table('depots')->pluck('city')->all());
        $this->assertSame(['2026-11-12 18:31:00'], DB::table('cancellations')->where('job_id', '1794897126')->pluck('created_at')->all());
    }

    public function test_running_again_replaces_what_was_imported_and_keeps_plugin_jobs(): void
    {
        GameDataTest::job($this->user, '1794897126', 100);
        $this->assertSame(0, Artisan::call('supabase:import', ['email' => 'andros@example.com']));
        DB::table('cancellations')->insert(['user_id' => $this->user->id, 'game' => 'eut2', 'job_id' => 'only-local']);
        $this->supabase['jobs'] = [];
        $this->supabase['depots'][] = ['city' => 'brno', 'company' => 'posped'];

        $this->assertSame(0, Artisan::call('supabase:import', ['email' => 'andros@example.com']));

        $this->assertSame(['1794897126'], DB::table('game_jobs')->pluck('id')->all());
        $this->assertSame(['brno', 'praha'], DB::table('depots')->orderBy('city')->pluck('city')->all());
        $this->assertSame(['1794897126'], DB::table('cancellations')->pluck('job_id')->all());
    }

    public function test_missing_supabase_config_stops_the_import(): void
    {
        config(['virtualtruck.supabase.publishable_key' => '']);

        $this->assertSame(1, Artisan::call('supabase:import', ['email' => 'andros@example.com']));
        Http::assertNothingSent();
    }

    public function test_reads_all_pages(): void
    {
        $this->supabase['depots'] = array_map(fn (int $i) => ['city' => "city{$i}", 'company' => 'tradeaux'], range(1, 1001));

        $this->assertSame(0, Artisan::call('supabase:import', ['email' => 'andros@example.com']));

        $this->assertSame(1001, DB::table('depots')->count());
    }
}
