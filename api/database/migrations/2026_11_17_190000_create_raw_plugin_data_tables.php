<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('game_events', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('game', 8);
            $table->unsignedInteger('seq');
            $table->dateTime('wall');
            $table->integer('game_time')->nullable();
            $table->string('type', 64);
            $table->json('data');
            $table->primary(['user_id', 'game', 'seq']);
        });

        Schema::create('trace_points', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('game', 8);
            $table->unsignedInteger('seq');
            $table->dateTime('wall');
            $table->integer('game_time')->nullable();
            $table->json('data');
            $table->primary(['user_id', 'game', 'seq']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trace_points');
        Schema::dropIfExists('game_events');
    }
};
