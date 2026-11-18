<?php

declare(strict_types=1);

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Laravel\Sanctum\Http\Middleware\CheckAbilities;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->statefulApi();
        // The only proxy of the server, the app port is not published.
        $middleware->trustProxies(at: '*');
        $middleware->alias(['abilities' => CheckAbilities::class]);
        $middleware->redirectGuestsTo(fn () => null);
        // Plugin lines are stored as the game sent them (e.g. licence plates with leading spaces).
        $isIngest = fn (Request $request) => $request->is('api/ingest/*');
        $middleware->trimStrings(except: [$isIngest]);
        $middleware->convertEmptyStringsToNull(except: [$isIngest]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
