<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('game_jobs', function (Blueprint $table) {
            // Passenger job rating, only in the save.
            $table->json('car')->nullable()->after('units');
        });

        Schema::create('depots', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('game', 8);
            $table->string('city', 64);
            $table->string('company', 64);
            $table->primary(['user_id', 'game', 'city', 'company']);
        });

        // Cancelling an external (WoT) or bus job sends no SDK event, so it is marked by hand.
        Schema::create('cancellations', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('game', 8);
            $table->string('job_id', 64);
            $table->timestamp('created_at')->useCurrent();
            $table->primary(['user_id', 'game', 'job_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cancellations');
        Schema::dropIfExists('depots');
        Schema::table('game_jobs', function (Blueprint $table) {
            $table->dropColumn('car');
        });
    }
};
