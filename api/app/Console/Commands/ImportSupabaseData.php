<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Enums\Game;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class ImportSupabaseData extends Command
{
    protected $signature = 'supabase:import {email : Owner of the data}';

    protected $description = 'Replace the jobs from the save, depots and cancellations with those in Supabase (the plugin data comes from the plugin)';

    // The Data API returns at most 1000 rows per request.
    private const PAGE_ROWS = 1000;

    private const JOB_COLUMNS = ['id', 'kind', 'status', 'game_time', 'src_company', 'src_city', 'dst_company', 'dst_city', 'cargo', 'xp', 'revenue', 'km', 'truck', 'mass', 'units', 'car', 'telemetry'];

    public function handle(): int
    {
        $user = User::where('email', $this->argument('email'))->firstOrFail();
        if (config('virtualtruck.supabase.project_id') === '' || config('virtualtruck.supabase.publishable_key') === '') {
            $this->error('Set SUPABASE_PROJECT_ID and SUPABASE_PUBLISHABLE_KEY in api/.env.');

            return self::FAILURE;
        }

        foreach (Game::cases() as $game) {
            $trucks = array_column($this->select("names?game=eq.{$game->value}&kind=eq.trucks&select=id,name&order=id"), 'name', 'id');
            $jobs = array_map(fn (array $j) => [
                'user_id' => $user->id, 'game' => $game->value, 'source' => 'save',
                ...array_intersect_key($j, array_flip(self::JOB_COLUMNS)),
                'truck_name' => is_string($j['truck'] ?? null) ? $trucks[$j['truck']] ?? null : null,
                'car' => self::json($j['car'] ?? null),
                'telemetry' => self::json($j['telemetry'] ?? null),
            ], $this->select("jobs?game=eq.{$game->value}&source=eq.save&select=*&order=id"));
            $depots = array_map(fn (array $d) => ['user_id' => $user->id, 'game' => $game->value, 'city' => $d['city'], 'company' => $d['company']],
                $this->select("depots?game=eq.{$game->value}&select=city,company&order=city,company"));
            $cancellations = array_map(fn (array $c) => ['user_id' => $user->id, 'game' => $game->value, 'job_id' => $c['job_id'], 'created_at' => CarbonImmutable::parse(is_string($c['created_at']) ? $c['created_at'] : '')->utc()->format('Y-m-d H:i:s')],
                $this->select("cancellations?game=eq.{$game->value}&select=job_id,created_at&order=job_id"));

            DB::transaction(function () use ($user, $game, $jobs, $depots, $cancellations) {
                $rows = fn (string $table) => DB::table($table)->where('user_id', $user->id)->where('game', $game->value);
                $rows('game_jobs')->where('source', 'save')->delete();
                $rows('depots')->delete();
                $rows('cancellations')->delete();
                foreach ([['game_jobs', $jobs], ['depots', $depots], ['cancellations', $cancellations]] as [$table, $new]) {
                    foreach (array_chunk($new, 500) as $chunk) {
                        DB::table($table)->insert($chunk);
                    }
                }
            });
            $this->info("{$game->value}: ".count($jobs).' jobs from the save, '.count($depots).' depots, '.count($cancellations).' cancellations');
        }

        return self::SUCCESS;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function select(string $path): array
    {
        $url = 'https://'.config()->string('virtualtruck.supabase.project_id').'.supabase.co/rest/v1/';
        $key = config()->string('virtualtruck.supabase.publishable_key');
        $rows = [];
        do {
            /** @var list<array<string, mixed>> $page */
            $page = Http::withHeaders(['apikey' => $key])->get($url.$path.'&limit='.self::PAGE_ROWS.'&offset='.count($rows))->throw()->json();
            array_push($rows, ...$page);
        } while (count($page) === self::PAGE_ROWS);

        return $rows;
    }

    private static function json(mixed $value): ?string
    {
        return $value === null ? null : json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    }
}
