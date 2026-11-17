<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Enums\Game;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GameDataController extends Controller
{
    private const JOB_COLUMNS = ['id', 'kind', 'status', 'game_time', 'src_company', 'src_city', 'dst_company', 'dst_city', 'cargo', 'xp', 'revenue', 'km', 'truck', 'truck_name', 'mass', 'units', 'car', 'telemetry'];

    public function show(Request $request, Game $game): JsonResponse
    {
        $user = $this->user($request);
        $rows = fn (string $table) => DB::table($table)->where('user_id', $user->id)->where('game', $game->value);

        return response()->json([
            'jobs' => $rows('game_jobs')->orderByDesc('game_time')->orderBy('id')->get(self::JOB_COLUMNS)->map(fn (object $j) => [
                ...(array) $j,
                'car' => self::decoded($j->car),
                'telemetry' => self::decoded($j->telemetry),
            ]),
            'depots' => $rows('depots')->orderBy('city')->orderBy('company')->get(['city', 'company']),
            'cancellations' => $rows('cancellations')->orderBy('job_id')->pluck('job_id'),
            'refuels' => $rows('refuels')->orderByDesc('wall')->get(['wall', 'game_time', 'truck', 'litres', 'country', 'garage', 'price'])->map(fn (object $r) => [
                ...(array) $r,
                'wall' => CarbonImmutable::parse(is_string($r->wall) ? $r->wall : '', 'UTC')->toIso8601ZuluString(),
                'garage' => (bool) $r->garage,
            ]),
        ]);
    }

    public function position(Request $request, Game $game): JsonResponse
    {
        $data = DB::table('trace_points')->where('user_id', $this->user($request)->id)->where('game', $game->value)->orderByDesc('seq')->value('data');

        return response()->json(['point' => self::decoded($data)]);
    }

    private static function decoded(mixed $value): mixed
    {
        return is_string($value) ? json_decode($value, true, flags: JSON_THROW_ON_ERROR) : null;
    }
}
