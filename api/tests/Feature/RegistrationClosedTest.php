<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\PendingCommand;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class RegistrationClosedTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        // Fortify registers its routes when the app boots.
        $_ENV['VIRTUALTRUCK_REGISTRATION'] = 'false';
        parent::setUp();
    }

    protected function tearDown(): void
    {
        unset($_ENV['VIRTUALTRUCK_REGISTRATION']);
        parent::tearDown();
    }

    public function test_cannot_register(): void
    {
        $this->postJson('/api/register', [
            'name' => 'andros',
            'email' => 'andros@example.com',
            'password' => 'secret-password',
            'password_confirmation' => 'secret-password',
        ])->assertNotFound();

        $this->assertSame(0, User::count());
    }

    public function test_command_creates_the_account(): void
    {
        $this->createUser('andros@example.com')
            ->expectsQuestion('Password', 'secret-password')
            ->expectsQuestion('Password again', 'secret-password')
            ->assertSuccessful();

        $this->postJson('/api/login', ['email' => 'andros@example.com', 'password' => 'secret-password'])->assertOk();
    }

    /**
     * @return array<string, array{string, string, string}>
     */
    public static function invalidAccounts(): array
    {
        return [
            'passwords differ' => ['new@example.com', 'secret-password', 'other-password'],
            'email taken' => ['taken@example.com', 'secret-password', 'secret-password'],
            'not an email' => ['andros', 'secret-password', 'secret-password'],
        ];
    }

    #[DataProvider('invalidAccounts')]
    public function test_command_rejects_an_invalid_account(string $email, string $password, string $again): void
    {
        User::factory()->create(['email' => 'taken@example.com']);

        $this->createUser($email)
            ->expectsQuestion('Password', $password)
            ->expectsQuestion('Password again', $again)
            ->assertFailed();

        $this->assertSame(1, User::count());
    }

    private function createUser(string $email): PendingCommand
    {
        $command = $this->artisan('user:create', ['email' => $email, 'name' => 'andros']);
        $this->assertInstanceOf(PendingCommand::class, $command);

        return $command;
    }
}
