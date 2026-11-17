<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Sanctum keeps the session only for requests from a stateful domain.
        $this->withHeader('Referer', 'http://localhost/');
    }

    public function test_guest_cannot_read_user(): void
    {
        $this->getJson('/api/user')->assertUnauthorized();
    }

    public function test_guest_without_json_accept_header_gets_unauthorized(): void
    {
        $this->get('/api/user')->assertUnauthorized();
    }

    public function test_registered_user_is_logged_in(): void
    {
        $this->postJson('/api/register', [
            'name' => 'andros',
            'email' => 'andros@example.com',
            'password' => 'secret-password',
            'password_confirmation' => 'secret-password',
        ])->assertCreated();

        $this->assertAuthenticatedAs(User::where('email', 'andros@example.com')->sole());
    }

    public function test_registration_rejects_taken_email(): void
    {
        User::factory()->create(['email' => 'andros@example.com']);

        $this->postJson('/api/register', [
            'name' => 'andros',
            'email' => 'andros@example.com',
            'password' => 'secret-password',
            'password_confirmation' => 'secret-password',
        ])->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_user_logs_in_with_correct_password(): void
    {
        $user = User::factory()->create(['password' => 'secret-password']);

        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'secret-password'])->assertOk();

        $this->getJson('/api/user')->assertOk()->assertJsonPath('id', $user->id);
    }

    public function test_login_fails_with_wrong_password(): void
    {
        $user = User::factory()->create(['password' => 'secret-password']);

        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'wrong'])->assertUnprocessable();

        $this->assertGuest();
    }

    public function test_logout_ends_session(): void
    {
        $this->actingAs(User::factory()->create());

        $this->postJson('/api/logout')->assertNoContent();

        $this->assertGuest('web');
    }
}
