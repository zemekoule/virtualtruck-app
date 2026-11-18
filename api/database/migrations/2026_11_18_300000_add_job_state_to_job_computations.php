<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('job_computations', function (Blueprint $table) {
            // Jobs started and not ended after the events up to job_events_seq; the next run reads only the events after it.
            $table->unsignedInteger('job_events_seq')->default(0);
            $table->json('job_state')->nullable();
        });

        // A job is computed again until the trace up to its end has arrived (job_events_seq), the flag is not needed.
        Schema::table('game_jobs', function (Blueprint $table) {
            $table->dropColumn('complete');
        });

        // Gameplay events of one job and the truck changes before new trace points.
        Schema::table('game_events', function (Blueprint $table) {
            $table->index(['user_id', 'game', 'type', 'wall']);
        });
    }

    public function down(): void
    {
        Schema::table('game_events', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'game', 'type', 'wall']);
        });
        Schema::table('game_jobs', function (Blueprint $table) {
            $table->boolean('complete')->default(false);
        });
        Schema::table('job_computations', function (Blueprint $table) {
            $table->dropColumn(['job_events_seq', 'job_state']);
        });
    }
};
