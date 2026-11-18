<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\CreatesNewUsers;

class CreateUser extends Command
{
    protected $signature = 'user:create {email} {name}';

    protected $description = 'Create an account, also when the registration is closed (the password is asked for)';

    public function handle(CreatesNewUsers $users): int
    {
        try {
            $users->create([
                'email' => $this->argument('email'),
                'name' => $this->argument('name'),
                'password' => $this->password('Password'),
                'password_confirmation' => $this->password('Password again'),
            ]);
        } catch (ValidationException $e) {
            foreach ($e->validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }
        $this->info('Created.');

        return self::SUCCESS;
    }

    private function password(string $question): string
    {
        $password = $this->secret($question);

        return is_string($password) ? $password : '';
    }
}
