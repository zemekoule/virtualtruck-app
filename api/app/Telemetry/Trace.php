<?php

declare(strict_types=1);

namespace App\Telemetry;

use App\Enums\Game;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/** Trace points of one user and game, each with the tank_price computed by TankPrices. */
class Trace
{
    public function __construct(private readonly int $userId, private readonly Game $game) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function between(int $from, int $to): array
    {
        return $this->points($this->query()->whereBetween('wall', [gmdate('Y-m-d H:i:s', $from), gmdate('Y-m-d H:i:s', $to)])->orderBy('seq'));
    }

    /**
     * @return array<string, mixed>|null
     */
    public function last(): ?array
    {
        return $this->points($this->query()->orderByDesc('seq')->limit(1))[0] ?? null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function lastAtOrBefore(int $wall): ?array
    {
        return $this->points($this->query()->where('wall', '<=', gmdate('Y-m-d H:i:s', $wall))->orderByDesc('seq')->limit(1))[0] ?? null;
    }

    private function query(): Builder
    {
        return DB::table('trace_points')->where('user_id', $this->userId)->where('game', $this->game->value);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function points(Builder $query): array
    {
        $points = [];
        foreach ($query->get(['data', 'tank_price']) as $row) {
            /** @var array<string, mixed> $point */
            $point = json_decode(is_string($row->data) ? $row->data : '', true, flags: JSON_THROW_ON_ERROR);
            $point['tank_price'] = is_numeric($row->tank_price) ? (float) $row->tank_price : null;
            $points[] = $point;
        }

        return $points;
    }
}
