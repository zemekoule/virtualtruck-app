<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trace_points', function (Blueprint $table) {
            // Average purchase price per litre of the fuel in the tank, null until the vehicle's first refuel.
            $table->double('tank_price')->nullable();
            $table->index(['user_id', 'game', 'wall']);
        });

        Schema::create('game_jobs', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('game', 8);
            $table->string('id', 64);
            $table->string('source', 8);
            $table->string('kind', 8);
            $table->string('status', 16);
            $table->integer('game_time');
            $table->string('src_company', 64)->nullable();
            $table->string('src_city', 64)->nullable();
            $table->string('dst_company', 64)->nullable();
            $table->string('dst_city', 64)->nullable();
            $table->string('cargo', 64)->nullable();
            $table->integer('xp')->nullable();
            $table->integer('revenue')->nullable();
            $table->integer('km')->nullable();
            $table->string('truck', 64)->nullable();
            $table->string('truck_name')->nullable();
            $table->double('mass')->nullable();
            $table->integer('units')->nullable();
            $table->json('telemetry')->nullable();
            // A delivered or cancelled job whose whole trace has arrived; it is not computed again.
            $table->boolean('complete')->default(false);
            $table->primary(['user_id', 'game', 'id']);
            $table->index(['user_id', 'game', 'game_time']);
        });

        Schema::create('refuels', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('game', 8);
            $table->dateTime('wall');
            $table->dateTime('last_wall');
            $table->integer('game_time')->nullable();
            $table->string('truck', 64)->nullable();
            $table->double('litres');
            $table->string('country', 64);
            $table->boolean('garage');
            $table->double('price');
            $table->primary(['user_id', 'game', 'wall']);
        });

        Schema::create('job_computations', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('game', 8);
            $table->unsignedInteger('events_seq');
            $table->unsignedInteger('trace_seq');
            $table->json('tank_state');
            $table->primary(['user_id', 'game']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('job_computations');
        Schema::dropIfExists('refuels');
        Schema::dropIfExists('game_jobs');
        Schema::table('trace_points', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'game', 'wall']);
            $table->dropColumn('tank_price');
        });
    }
};
