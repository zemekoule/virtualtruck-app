<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Enums\DataFile;
use App\Enums\Game;
use App\Ingest\RawData;
use App\Ingest\SeqConflictException;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class IngestController extends Controller
{
    public function show(Request $request, Game $game, DataFile $file, RawData $data): JsonResponse
    {
        return response()->json(['last_seq' => $data->lastSeq($this->user($request), $game, $file)]);
    }

    public function store(Request $request, Game $game, DataFile $file, RawData $data): JsonResponse
    {
        $request->validate(['seq' => ['required', 'integer', 'min:1']]);
        $lines = $request->input('lines');

        try {
            $last = $data->store($this->user($request), $game, $file, $request->integer('seq'), is_array($lines) ? $lines : []);
        } catch (SeqConflictException $e) {
            return response()->json(['message' => $e->getMessage(), 'last_seq' => $e->lastSeq], 409);
        }

        return response()->json(['last_seq' => $last]);
    }

    private function user(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
