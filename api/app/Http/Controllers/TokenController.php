<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TokenController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $request->validate(['name' => ['required', 'string', 'max:255']]);
        $token = $this->user($request)->createToken($request->string('name')->toString());

        return response()->json(['id' => $token->accessToken->getKey(), 'token' => $token->plainTextToken], 201);
    }
}
