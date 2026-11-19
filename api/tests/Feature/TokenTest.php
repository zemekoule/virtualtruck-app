<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class TokenTest extends TestCase
{
    use RefreshDatabase;

    public function test_logged_in_user_creates_token(): void
    {
        $user = User::factory()->create();

        $token = $this->actingAs($user)->postJson('/api/tokens', ['name' => 'plugin'])
            ->assertCreated()
            ->json('token');

        $this->assertIsString($token);
        $this->assertSame(['plugin'], $user->tokens()->pluck('name')->all());
        $this->assertSame([['ingest']], $user->tokens()->pluck('abilities')->all());
    }

    public function test_token_without_ingest_ability_cannot_send_data(): void
    {
        $token = User::factory()->create()->createToken('other', ['read'])->plainTextToken;

        $this->withToken($token)->getJson('/api/ingest/eut2/events')->assertForbidden();
    }

    public function test_non_numeric_token_id_is_not_found(): void
    {
        $this->actingAs(User::factory()->create())->deleteJson('/api/tokens/abc')->assertNotFound();
    }

    public function test_lists_own_tokens_without_their_value(): void
    {
        $user = User::factory()->create();
        $user->createToken('plugin');
        User::factory()->create()->createToken('other');

        $this->actingAs($user)->getJson('/api/tokens')
            ->assertOk()
            ->assertJsonPath('*.name', ['plugin'])
            ->assertJsonMissingPath('0.token');
    }

    public function test_deletes_only_own_token(): void
    {
        $user = User::factory()->create();
        $own = $user->createToken('plugin')->accessToken->id;
        $other = User::factory()->create()->createToken('other')->accessToken->id;

        $this->actingAs($user)->deleteJson("/api/tokens/{$other}")->assertNotFound();
        $this->deleteJson("/api/tokens/{$own}")->assertNoContent();

        $this->assertSame(0, $user->tokens()->count());
        $this->assertSame(1, User::query()->whereKeyNot($user->id)->firstOrFail()->tokens()->count());
    }

    public function test_guest_cannot_create_token(): void
    {
        $this->postJson('/api/tokens', ['name' => 'plugin'])->assertUnauthorized();
    }

    #[DataProvider('sessionOnlyRoutes')]
    public function test_token_is_only_for_sending_data(string $method, string $uri): void
    {
        $token = User::factory()->create()->createToken('plugin')->plainTextToken;

        $this->withToken($token)->json($method, $uri)->assertUnauthorized();
    }

    /**
     * @return array<string, array{string, string}>
     */
    public static function sessionOnlyRoutes(): array
    {
        return [
            'user' => ['GET', '/api/user'],
            'game data' => ['GET', '/api/games/eut2'],
            'position' => ['GET', '/api/games/eut2/position'],
            'cancel a job' => ['PUT', '/api/games/eut2/cancellations/1'],
            'restore a job' => ['DELETE', '/api/games/eut2/cancellations/1'],
            'list tokens' => ['GET', '/api/tokens'],
            'create a token' => ['POST', '/api/tokens'],
            'delete a token' => ['DELETE', '/api/tokens/1'],
            'change the password' => ['PUT', '/api/user/password'],
            'confirm the password' => ['POST', '/api/user/confirm-password'],
            'disable two-factor' => ['DELETE', '/api/user/two-factor-authentication'],
        ];
    }
}
