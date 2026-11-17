<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Enums\Game;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

class CancellationController extends Controller
{
    public function store(Request $request, Game $game, string $jobId): Response
    {
        $user = $this->user($request);
        $job = DB::table('game_jobs')->where('user_id', $user->id)->where('game', $game->value)->where('id', $jobId)->first(['kind', 'status', 'telemetry']);
        abort_if($job === null, 404);
        $telemetry = is_string($job->telemetry) ? json_decode($job->telemetry, true, flags: JSON_THROW_ON_ERROR) : null;
        $market = is_array($telemetry) && is_string($telemetry['market'] ?? null) ? $telemetry['market'] : '';
        // Same rule as the web: other jobs get a cancel event from the SDK.
        $byHand = ($job->kind === 'bus' || str_starts_with($market, 'external_')) && in_array($job->status, ['running', 'suspended'], true);
        abort_unless($byHand, 422, 'Only an unfinished external (WoT) or bus job is cancelled by hand.');
        DB::table('cancellations')->insertOrIgnore(['user_id' => $user->id, 'game' => $game->value, 'job_id' => $jobId]);

        return response()->noContent();
    }

    public function destroy(Request $request, Game $game, string $jobId): Response
    {
        DB::table('cancellations')->where('user_id', $this->user($request)->id)->where('game', $game->value)->where('job_id', $jobId)->delete();

        return response()->noContent();
    }
}
