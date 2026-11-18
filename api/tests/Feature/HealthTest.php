<?php

declare(strict_types=1);

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class HealthTest extends TestCase
{
    public function test_healthy_with_the_database(): void
    {
        $this->get('/up')->assertOk();
    }

    public function test_unhealthy_without_the_database(): void
    {
        $connection = config()->string('database.default');
        config(["database.connections.{$connection}.database" => '/nonexistent/database']);
        DB::purge($connection);

        $this->get('/up')->assertServerError();
    }
}
