<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Fortify\Fortify;
use PHPUnit\Framework\Attributes\DataProvider;
use PragmaRX\Google2FA\Google2FA;
use Tests\TestCase;

class AccountSecurityTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'JBSWY3DPEHPK3PXP';

    protected function setUp(): void
    {
        parent::setUp();

        // Sanctum keeps the session only for requests from a stateful domain.
        $this->withHeader('Referer', 'http://localhost/');
    }

    public function test_user_changes_password(): void
    {
        $user = User::factory()->create(['password' => 'old-password']);

        $this->actingAs($user)->putJson('/api/user/password', [
            'current_password' => 'old-password',
            'password' => 'new-password',
            'password_confirmation' => 'new-password',
        ])->assertOk();

        $this->assertTrue(Hash::check('new-password', $user->fresh()->password ?? ''));
    }

    /**
     * @param  array<string, string>  $input
     */
    #[DataProvider('invalidPasswordChanges')]
    public function test_password_change_is_refused(array $input, string $error): void
    {
        $user = User::factory()->create(['password' => 'old-password']);

        $this->actingAs($user)->putJson('/api/user/password', $input)->assertUnprocessable()->assertJsonValidationErrors($error);

        $this->assertTrue(Hash::check('old-password', $user->fresh()->password ?? ''));
    }

    /**
     * @return array<string, array{array<string, string>, string}>
     */
    public static function invalidPasswordChanges(): array
    {
        return [
            'wrong current password' => [['current_password' => 'wrong', 'password' => 'new-password', 'password_confirmation' => 'new-password'], 'current_password'],
            'confirmation differs' => [['current_password' => 'old-password', 'password' => 'new-password', 'password_confirmation' => 'other-password'], 'password'],
            'too short' => [['current_password' => 'old-password', 'password' => 'short', 'password_confirmation' => 'short'], 'password'],
        ];
    }

    public function test_guest_cannot_change_password(): void
    {
        $this->putJson('/api/user/password', [])->assertUnauthorized();
    }

    /**
     * @param  'post'|'delete'  $method
     */
    #[DataProvider('twoFactorChangesNeedingPassword')]
    public function test_two_factor_change_needs_password_confirmation(string $method, string $uri): void
    {
        $this->actingAs(User::factory()->create())->json($method, $uri)->assertStatus(423);
    }

    /**
     * @return array<string, array{string, string}>
     */
    public static function twoFactorChangesNeedingPassword(): array
    {
        return [
            'enable' => ['post', '/api/user/two-factor-authentication'],
            'disable' => ['delete', '/api/user/two-factor-authentication'],
            'new recovery codes' => ['post', '/api/user/two-factor-recovery-codes'],
        ];
    }

    public function test_user_enables_two_factor_with_a_code_from_the_app(): void
    {
        $user = User::factory()->create(['password' => 'secret-password']);
        $this->actingAs($user)->postJson('/api/user/confirm-password', ['password' => 'secret-password'])->assertCreated();

        $this->postJson('/api/user/two-factor-authentication')->assertOk();
        $this->getJson('/api/user/two-factor-qr-code')->assertOk()->assertJsonStructure(['svg', 'url']);
        $secret = $this->getJson('/api/user/two-factor-secret-key')->assertOk()->json('secretKey');
        $this->assertIsString($secret);
        $this->postJson('/api/user/confirmed-two-factor-authentication', ['code' => '000000'])->assertUnprocessable();
        $this->assertNull($user->fresh()?->two_factor_confirmed_at);

        $this->postJson('/api/user/confirmed-two-factor-authentication', ['code' => (new Google2FA)->getCurrentOtp($secret)])->assertOk();

        $this->assertNotNull($user->fresh()?->two_factor_confirmed_at);
        $this->getJson('/api/user/two-factor-recovery-codes')->assertOk()->assertJsonCount(8);
    }

    public function test_user_does_not_expose_two_factor_secrets(): void
    {
        $this->actingAs($this->userWithTwoFactor())->getJson('/api/user')
            ->assertOk()->assertJsonMissingPath('two_factor_secret')->assertJsonMissingPath('two_factor_recovery_codes')->assertJsonPath('two_factor_confirmed_at', fn ($at) => $at !== null);
    }

    public function test_login_with_two_factor_waits_for_the_code(): void
    {
        $user = $this->userWithTwoFactor();

        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'secret-password'])->assertOk()->assertJsonPath('two_factor', true);

        $this->assertGuest('web');
        $this->getJson('/api/user')->assertUnauthorized();
    }

    /**
     * @param  array{code?: string, recovery_code?: string}  $challenge
     */
    #[DataProvider('twoFactorChallenges')]
    public function test_two_factor_challenge(array $challenge, bool $loggedIn): void
    {
        $user = $this->userWithTwoFactor();
        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'secret-password'])->assertOk();
        // The code from the app is valid only around now, providers run before the tests.
        if (($challenge['code'] ?? null) === 'current') {
            $challenge['code'] = (new Google2FA)->getCurrentOtp(self::SECRET);
        }

        $response = $this->postJson('/api/two-factor-challenge', $challenge);

        if ($loggedIn) {
            $response->assertNoContent();
            $this->assertAuthenticatedAs($user, 'web');
        } else {
            $response->assertUnprocessable();
            $this->assertGuest('web');
        }
    }

    /**
     * @return array<string, array{array{code?: string, recovery_code?: string}, bool}>
     */
    public static function twoFactorChallenges(): array
    {
        return [
            'code from the app' => [['code' => 'current'], true],
            'recovery code' => [['recovery_code' => 'recovery-one'], true],
            'wrong code' => [['code' => '000000'], false],
            'unknown recovery code' => [['recovery_code' => 'unknown'], false],
        ];
    }

    public function test_recovery_code_works_only_once(): void
    {
        $user = $this->userWithTwoFactor();
        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'secret-password']);
        $this->postJson('/api/two-factor-challenge', ['recovery_code' => 'recovery-one'])->assertNoContent();

        $this->assertNotContains('recovery-one', $user->fresh()?->recoveryCodes() ?? []);
    }

    public function test_user_disables_two_factor(): void
    {
        $user = $this->userWithTwoFactor();
        $this->actingAs($user)->postJson('/api/user/confirm-password', ['password' => 'secret-password'])->assertCreated();

        $this->deleteJson('/api/user/two-factor-authentication')->assertOk();

        $this->assertNull($user->fresh()?->two_factor_secret);
        $this->postJson('/api/logout');
        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'secret-password'])->assertOk()->assertJsonPath('two_factor', false);
    }

    private function userWithTwoFactor(): User
    {
        $user = User::factory()->create(['password' => 'secret-password']);
        $user->forceFill([
            'two_factor_secret' => Fortify::currentEncrypter()->encrypt(self::SECRET),
            'two_factor_recovery_codes' => Fortify::currentEncrypter()->encrypt(json_encode(['recovery-one', 'recovery-two'], JSON_THROW_ON_ERROR)),
            'two_factor_confirmed_at' => now(),
        ])->save();

        return $user;
    }
}
