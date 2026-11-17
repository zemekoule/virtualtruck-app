<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

class IngestTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        $this->withToken($this->user->createToken('plugin')->plainTextToken);
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return TestResponse<Response>
     */
    private function send(int $seq, array $lines, string $path = 'eut2/events'): TestResponse
    {
        return $this->postJson("/api/ingest/{$path}", ['seq' => $seq, 'lines' => $lines]);
    }

    /**
     * @return array<string, mixed>
     */
    private function event(int $wall, string $type = 'job'): array
    {
        return ['wall' => $wall, 'game_time' => 2477420, 'type' => $type];
    }

    public function test_guest_cannot_send_lines(): void
    {
        $this->withToken('')->send(1, [$this->event(1)])->assertUnauthorized();
    }

    public function test_stores_lines_with_their_seq(): void
    {
        $this->send(1, [$this->event(1792943006, 'start'), $this->event(1792943015)])->assertOk()->assertJson(['last_seq' => 2]);

        $row = DB::table('game_events')->where('seq', 2)->first();
        $this->assertNotNull($row);
        $this->assertSame($this->user->id, $row->user_id);
        $this->assertSame('eut2', $row->game);
        $this->assertSame('job', $row->type);
        $this->assertSame('2026-10-25 15:43:35', $row->wall);
        $this->getJson('/api/ingest/eut2/events')->assertOk()->assertJson(['last_seq' => 2]);
    }

    public function test_keeps_the_line_exactly(): void
    {
        $line = ['wall' => 1, 'game_time' => null, 'type' => 'trailer', 'attrs' => ['license_plate' => '  TB2110', 'brand' => '', 'mass' => 21750.5]];

        $this->send(1, [$line])->assertOk();

        $data = DB::table('game_events')->value('data');
        $this->assertIsString($data);
        $this->assertSame($line, json_decode($data, true));
    }

    public function test_resent_lines_are_skipped(): void
    {
        $this->send(1, [$this->event(1), $this->event(2)])->assertOk();

        $this->send(2, [$this->event(2), $this->event(3)])->assertOk()->assertJson(['last_seq' => 3]);

        $this->assertSame(
            ['1970-01-01 00:00:01', '1970-01-01 00:00:02', '1970-01-01 00:00:03'],
            DB::table('game_events')->orderBy('seq')->pluck('wall')->all(),
        );
    }

    public function test_resent_lines_with_different_content_are_rejected(): void
    {
        $this->send(1, [$this->event(1), $this->event(2)])->assertOk();

        $this->send(1, [$this->event(50), $this->event(51), $this->event(52)])->assertConflict()->assertJson(['last_seq' => 2]);

        $this->assertSame(2, DB::table('game_events')->count());
    }

    public function test_gap_after_stored_lines_is_rejected(): void
    {
        $this->send(1, [$this->event(1)])->assertOk();

        $this->send(3, [$this->event(3)])->assertConflict()->assertJson(['last_seq' => 1]);

        $this->assertSame(1, DB::table('game_events')->count());
    }

    public function test_users_have_separate_seq(): void
    {
        $this->send(1, [$this->event(1)])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken(User::factory()->create()->createToken('plugin')->plainTextToken);

        $this->getJson('/api/ingest/eut2/events')->assertJson(['last_seq' => 0]);
        $this->send(1, [$this->event(1)])->assertOk();
        $this->assertSame(2, DB::table('game_events')->count());
    }

    public function test_games_and_files_have_separate_seq(): void
    {
        $this->send(1, [$this->event(1)])->assertOk();

        $this->send(1, [['wall' => 1, 'game_time' => 5, 'type' => 'trace', 'x' => 1.5]], 'eut2/trace')->assertOk();
        $this->send(1, [$this->event(1)], 'ats/events')->assertOk();

        $this->assertSame(1, DB::table('trace_points')->count());
        $this->assertSame(2, DB::table('game_events')->count());
    }

    public function test_unknown_game_or_file_is_not_found(): void
    {
        $this->send(1, [$this->event(1)], 'fs22/events')->assertNotFound();
        $this->send(1, [$this->event(1)], 'eut2/jobs')->assertNotFound();
    }

    /**
     * @param  array<string, mixed>  $body
     */
    #[DataProvider('invalidBodies')]
    public function test_invalid_batch_is_rejected(array $body, string $error): void
    {
        $this->postJson('/api/ingest/eut2/events', $body)->assertUnprocessable()->assertJsonValidationErrors($error);
    }

    /**
     * @return array<string, array{array<string, mixed>, string}>
     */
    public static function invalidBodies(): array
    {
        return [
            'missing seq' => [['lines' => [['wall' => 1, 'type' => 'job']]], 'seq'],
            'zero seq' => [['seq' => 0, 'lines' => [['wall' => 1, 'type' => 'job']]], 'seq'],
            'no lines' => [['seq' => 1, 'lines' => []], 'lines'],
            'too many lines' => [['seq' => 1, 'lines' => array_fill(0, 1001, ['wall' => 1, 'type' => 'job'])], 'lines'],
            'line without wall' => [['seq' => 1, 'lines' => [['type' => 'job']]], 'lines.0.wall'],
            'event without type' => [['seq' => 1, 'lines' => [['wall' => 1]]], 'lines.0.type'],
            'wall in milliseconds' => [['seq' => 1, 'lines' => [['wall' => 1794938439000, 'type' => 'job']]], 'lines.0.wall'],
            'game_time over int' => [['seq' => 1, 'lines' => [['wall' => 1, 'game_time' => 2147483648, 'type' => 'job']]], 'lines.0.game_time'],
            'wall as string' => [['seq' => 1, 'lines' => [['wall' => '1700000000', 'type' => 'job']]], 'lines.0.wall'],
            'game_time as string' => [['seq' => 1, 'lines' => [['wall' => 1, 'game_time' => '5', 'type' => 'job']]], 'lines.0.game_time'],
            'line not an object' => [['seq' => 1, 'lines' => ['job']], 'lines.0'],
        ];
    }
}
