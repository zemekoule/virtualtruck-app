<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class CancellationTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        GameDataTest::job($this->user, '1794897126', 100, ['status' => 'running', 'telemetry' => '{"market":"external_contracts"}']);
        $this->actingAs($this->user);
    }

    public function test_guest_cannot_cancel(): void
    {
        $this->app['auth']->forgetGuards();
        $this->putJson('/api/games/eut2/cancellations/1794897126')->assertUnauthorized();
    }

    public function test_cancels_and_restores_a_job(): void
    {
        $this->putJson('/api/games/eut2/cancellations/1794897126')->assertNoContent();
        $this->putJson('/api/games/eut2/cancellations/1794897126')->assertNoContent();
        $this->getJson('/api/games/eut2')->assertJsonPath('cancellations', ['1794897126']);

        $this->deleteJson('/api/games/eut2/cancellations/1794897126')->assertNoContent();
        $this->getJson('/api/games/eut2')->assertJsonPath('cancellations', []);
    }

    public function test_cannot_cancel_a_job_that_is_not_own(): void
    {
        GameDataTest::job(User::factory()->create(), '42', 100);

        $this->putJson('/api/games/eut2/cancellations/42')->assertNotFound();
        $this->putJson('/api/games/ats/cancellations/1794897126')->assertNotFound();
        $this->assertSame(0, DB::table('cancellations')->count());
    }

    /**
     * @param  array<string, mixed>  $columns
     */
    #[DataProvider('jobsCancelledByHand')]
    public function test_only_unfinished_external_or_bus_job_is_cancelled_by_hand(array $columns, bool $allowed): void
    {
        GameDataTest::job($this->user, '42', 100, $columns);

        $this->putJson('/api/games/eut2/cancellations/42')->assertStatus($allowed ? 204 : 422);
    }

    /**
     * @return array<string, array{array<string, mixed>, bool}>
     */
    public static function jobsCancelledByHand(): array
    {
        return [
            'suspended WoT job' => [['status' => 'suspended', 'telemetry' => '{"market":"external_market"}'], true],
            'running bus job' => [['kind' => 'bus', 'status' => 'running', 'telemetry' => '{"market":null}'], true],
            'delivered WoT job' => [['status' => 'delivered', 'telemetry' => '{"market":"external_contracts"}'], false],
            'running freight market job' => [['status' => 'running', 'telemetry' => '{"market":"freight_market"}'], false],
            'job from the save' => [['source' => 'save', 'status' => 'delivered'], false],
        ];
    }

    public function test_cannot_restore_a_job_of_another_user(): void
    {
        $other = User::factory()->create();
        DB::table('cancellations')->insert(['user_id' => $other->id, 'game' => 'eut2', 'job_id' => '42']);

        $this->deleteJson('/api/games/eut2/cancellations/42')->assertNoContent();
        $this->assertSame(1, DB::table('cancellations')->count());
    }
}
