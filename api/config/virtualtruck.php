<?php

declare(strict_types=1);

return [
    // Names, fuel prices and fuel places extracted from the games (names/ in the repository).
    'names_dir' => env('VIRTUALTRUCK_NAMES_DIR', base_path('../names')),

    // Read with the publishable key by supabase:import until the switch to this API.
    'supabase' => [
        'project_id' => env('SUPABASE_PROJECT_ID', ''),
        'publishable_key' => env('SUPABASE_PUBLISHABLE_KEY', ''),
    ],
];
