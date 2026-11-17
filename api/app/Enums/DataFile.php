<?php

declare(strict_types=1);

namespace App\Enums;

/** A jsonl file the plugin writes per game; seq is the line number in it. */
enum DataFile: string
{
    case Events = 'events';
    case Trace = 'trace';

    public function table(): string
    {
        return match ($this) {
            self::Events => 'game_events',
            self::Trace => 'trace_points',
        };
    }
}
