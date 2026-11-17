<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class TokenController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json($this->user($request)->tokens()->orderBy('id')->get(['id', 'name', 'last_used_at', 'created_at']));
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate(['name' => ['required', 'string', 'max:255']]);
        $token = $this->user($request)->createToken($request->string('name')->toString(), ['ingest']);

        return response()->json(['id' => $token->accessToken->getKey(), 'token' => $token->plainTextToken], 201);
    }

    public function destroy(Request $request, int $id): Response
    {
        abort_unless($this->user($request)->tokens()->whereKey($id)->delete() === 1, 404);

        return response()->noContent();
    }
}
