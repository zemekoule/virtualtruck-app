<?php

declare(strict_types=1);

use App\Http\Controllers\IngestController;
use App\Http\Controllers\TokenController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', fn (Request $request) => $request->user());
    Route::get('/ingest/{game}/{file}', [IngestController::class, 'show']);
    Route::post('/ingest/{game}/{file}', [IngestController::class, 'store']);
});

// Session only, so a leaked plugin token cannot mint new tokens.
Route::middleware('auth:web')->group(function () {
    Route::post('/tokens', [TokenController::class, 'store']);
});
