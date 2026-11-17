<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;

abstract class Controller
{
    protected function user(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
