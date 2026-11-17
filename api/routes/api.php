<?php

declare(strict_types=1);

use App\Http\Controllers\CancellationController;
use App\Http\Controllers\GameDataController;
use App\Http\Controllers\IngestController;
use App\Http\Controllers\TokenController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'abilities:ingest'])->group(function () {
    Route::get('/ingest/{game}/{file}', [IngestController::class, 'show']);
    Route::post('/ingest/{game}/{file}', [IngestController::class, 'store']);
});

// Session only, so a plugin token (stored in a plain file) cannot read the data or mint new tokens.
Route::middleware('auth:web')->group(function () {
    Route::get('/user', fn (Request $request) => $request->user());
    Route::get('/games/{game}', [GameDataController::class, 'show']);
    Route::get('/games/{game}/position', [GameDataController::class, 'position']);
    Route::put('/games/{game}/cancellations/{jobId}', [CancellationController::class, 'store']);
    Route::delete('/games/{game}/cancellations/{jobId}', [CancellationController::class, 'destroy']);
    Route::get('/tokens', [TokenController::class, 'index']);
    Route::post('/tokens', [TokenController::class, 'store']);
    Route::delete('/tokens/{id}', [TokenController::class, 'destroy'])->whereNumber('id');
});
