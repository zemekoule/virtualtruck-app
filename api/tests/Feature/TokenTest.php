<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
    }

    public function test_guest_cannot_create_token(): void
    {
        $this->postJson('/api/tokens', ['name' => 'plugin'])->assertUnauthorized();
    }

    public function test_token_cannot_create_another_token(): void
    {
        $token = User::factory()->create()->createToken('plugin')->plainTextToken;

        $this->withToken($token)->postJson('/api/tokens', ['name' => 'stolen'])->assertUnauthorized();
    }
}
