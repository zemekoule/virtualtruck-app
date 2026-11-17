<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ImportPluginDataTest extends TestCase
{
    use RefreshDatabase;

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();

        $this->dir = sys_get_temp_dir().'/plugin-data-'.uniqid();
        mkdir("{$this->dir}/eut2", recursive: true);
        User::factory()->create(['email' => 'andros@example.com']);
    }

    protected function tearDown(): void
    {
        array_map('unlink', glob("{$this->dir}/eut2/*") ?: []);
        rmdir("{$this->dir}/eut2");
        rmdir($this->dir);

        parent::tearDown();
    }

    private function import(): void
    {
        $this->assertSame(0, Artisan::call('ingest:import', ['email' => 'andros@example.com', 'dir' => $this->dir]));
    }

    public function test_imports_complete_lines_and_later_only_new_ones(): void
    {
        $line = fn (int $wall) => json_encode(['wall' => $wall, 'game_time' => null, 'type' => 'start'])."\n";
        file_put_contents("{$this->dir}/eut2/events.jsonl", $line(1).$line(2).'{"wall":3,"ty');

        $this->import();
        $this->assertSame([1, 2], DB::table('game_events')->orderBy('seq')->pluck('seq')->all());

        file_put_contents("{$this->dir}/eut2/events.jsonl", $line(1).$line(2).$line(3));
        $this->import();
        $this->assertSame([1, 2, 3], DB::table('game_events')->orderBy('seq')->pluck('seq')->all());
        $this->assertSame('1970-01-01 00:00:03', DB::table('game_events')->where('seq', 3)->value('wall'));
    }

    public function test_imports_in_batches(): void
    {
        $lines = array_map(fn (int $wall) => json_encode(['wall' => $wall, 'game_time' => null, 'x' => 1.5])."\n", range(1, 2500));
        file_put_contents("{$this->dir}/eut2/trace.jsonl", implode('', $lines));

        $this->import();

        $this->assertSame(2500, DB::table('trace_points')->count());
        $this->assertSame('1970-01-01 00:41:40', DB::table('trace_points')->where('seq', 2500)->value('wall'));
    }
}
