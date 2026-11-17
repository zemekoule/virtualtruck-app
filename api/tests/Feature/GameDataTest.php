<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class GameDataTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @param  array<string, mixed>  $columns
     */
    public static function job(User $user, string $id, int $gameTime, array $columns = []): void
    {
        DB::table('game_jobs')->insert(['user_id' => $user->id, 'game' => 'eut2', 'id' => $id, 'source' => 'plugin', 'kind' => 'truck', 'status' => 'delivered', 'game_time' => $gameTime, ...$columns]);
    }

    public function test_guest_cannot_read(): void
    {
        $this->getJson('/api/games/eut2')->assertUnauthorized();
        $this->getJson('/api/games/eut2/position')->assertUnauthorized();
    }

    public function test_returns_own_data_of_the_game(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        self::job($user, '1', 100, ['telemetry' => '{"start":1,"market":"external_contracts"}', 'truck' => 'daf.2021', 'truck_name' => 'DAF NGD']);
        self::job($user, 'save-car-200', 200, ['source' => 'save', 'kind' => 'car', 'car' => '{"rating":4}']);
        self::job($other, '3', 300);
        DB::table('game_jobs')->insert(['user_id' => $user->id, 'game' => 'ats', 'id' => '4', 'source' => 'plugin', 'kind' => 'truck', 'status' => 'delivered', 'game_time' => 400]);
        DB::table('depots')->insert([['user_id' => $user->id, 'game' => 'eut2', 'city' => 'praha', 'company' => 'tradeaux'], ['user_id' => $other->id, 'game' => 'eut2', 'city' => 'brno', 'company' => 'posped']]);
        DB::table('cancellations')->insert(['user_id' => $user->id, 'game' => 'eut2', 'job_id' => '1']);
        DB::table('refuels')->insert(['user_id' => $user->id, 'game' => 'eut2', 'wall' => '2026-11-16 20:38:32', 'last_wall' => '2026-11-16 20:38:42', 'game_time' => 150, 'truck' => 'daf.2021', 'litres' => 361.5, 'country' => 'czech', 'garage' => true, 'price' => 1.76]);

        $response = $this->actingAs($user)->getJson('/api/games/eut2')->assertOk();

        $response->assertJsonPath('jobs.*.id', ['save-car-200', '1'])
            ->assertJsonPath('jobs.0.car', ['rating' => 4])
            ->assertJsonPath('jobs.0.telemetry', null)
            ->assertJsonPath('jobs.1.telemetry', ['start' => 1, 'market' => 'external_contracts'])
            ->assertJsonPath('jobs.1.truck_name', 'DAF NGD')
            ->assertJsonPath('depots', [['city' => 'praha', 'company' => 'tradeaux']])
            ->assertJsonPath('cancellations', ['1'])
            ->assertJsonPath('refuels', [['wall' => '2026-11-16T20:38:32Z', 'game_time' => 150, 'truck' => 'daf.2021', 'litres' => 361.5, 'country' => 'czech', 'garage' => true, 'price' => 1.76]]);
    }

    public function test_position_is_the_latest_own_trace_point(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)->getJson('/api/games/eut2/position')->assertOk()->assertExactJson(['point' => null]);

        foreach ([[$user, 1, 10.5], [$user, 2, 20.5], [User::factory()->create(), 3, 30.5]] as [$owner, $seq, $x]) {
            DB::table('trace_points')->insert(['user_id' => $owner->id, 'game' => 'eut2', 'seq' => $seq, 'wall' => '2026-11-16 20:38:32', 'data' => json_encode(['wall' => 1, 'x' => $x, 'z' => 1])]);
        }

        $this->getJson('/api/games/eut2/position')->assertOk()->assertExactJson(['point' => ['wall' => 1, 'x' => 20.5, 'z' => 1]]);
    }
}
