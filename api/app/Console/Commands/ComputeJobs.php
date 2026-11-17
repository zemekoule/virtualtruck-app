<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Enums\Game;
use App\Models\User;
use App\Telemetry\JobComputation;
use Illuminate\Console\Command;

class ComputeJobs extends Command
{
    protected $signature = 'jobs:compute';

    protected $description = 'Compute jobs and refuels from the plugin data that arrived since the last computation';

    public function handle(JobComputation $computation): int
    {
        foreach (User::all() as $user) {
            foreach (Game::cases() as $game) {
                $computation->run($user, $game);
            }
        }

        return self::SUCCESS;
    }
}
