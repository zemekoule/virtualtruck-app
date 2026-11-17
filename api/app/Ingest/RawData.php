<?php

declare(strict_types=1);

namespace App\Ingest;

use App\Enums\DataFile;
use App\Enums\Game;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class RawData
{
    public const MAX_LINES = 1000;

    public function lastSeq(User $user, Game $game, DataFile $file): int
    {
        $seq = DB::table($file->table())->where('user_id', $user->id)->where('game', $game->value)->max('seq');

        return is_numeric($seq) ? (int) $seq : 0;
    }

    /**
     * Lines resent after a lost response are skipped, but only if they equal the stored ones,
     * otherwise the plugin numbers a different file (e.g. after deleting its data) and nothing is stored.
     *
     * @param  array<mixed>  $lines  decoded jsonl lines, the first one has number $seq
     * @return int the last stored seq
     *
     * @throws ValidationException
     * @throws SeqConflictException
     */
    public function store(User $user, Game $game, DataFile $file, int $seq, array $lines): int
    {
        $lines = $this->validated($file, $lines);
        $last = $this->lastSeq($user, $game, $file);
        if ($seq > $last + 1) {
            throw new SeqConflictException($last, "Lines must continue after seq {$last}.");
        }

        $resent = array_slice($lines, 0, max(0, $last - $seq + 1));
        if ($resent !== [] && $resent !== $this->storedLines($user, $game, $file, $seq, count($resent))) {
            throw new SeqConflictException($last, "Lines up to seq {$last} differ from the stored ones.");
        }

        $rows = [];
        foreach (array_slice($lines, count($resent)) as $i => $line) {
            $row = [
                'user_id' => $user->id,
                'game' => $game->value,
                'seq' => $seq + count($resent) + $i,
                'wall' => gmdate('Y-m-d H:i:s', $line['wall']),
                'game_time' => $line['game_time'] ?? null,
                'data' => json_encode($line, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION),
            ];
            if ($file === DataFile::Events) {
                $row['type'] = $line['type'] ?? '';
            }
            $rows[] = $row;
        }
        DB::table($file->table())->insert($rows);

        return max($last, $seq + count($lines) - 1);
    }

    /**
     * @param  array<mixed>  $lines
     * @return list<array{wall: int, game_time?: int|null, type?: string}&array<string, mixed>>
     *
     * @throws ValidationException
     */
    private function validated(DataFile $file, array $lines): array
    {
        Validator::make(['lines' => $lines], [
            'lines' => ['required', 'list', 'max:'.self::MAX_LINES],
            'lines.*' => ['array'],
            // Up to 2100, so a wall in milliseconds is refused instead of overflowing the datetime column.
            'lines.*.wall' => ['required', 'integer:strict', 'between:0,4102444800'],
            'lines.*.game_time' => ['nullable', 'integer:strict', 'between:0,2147483647'],
            'lines.*.type' => [$file === DataFile::Events ? 'required' : 'nullable', 'string', 'max:64'],
        ])->validate();

        /** @var list<array{wall: int, game_time?: int|null, type?: string}&array<string, mixed>> */
        return $lines;
    }

    /**
     * @return array<mixed>
     */
    private function storedLines(User $user, Game $game, DataFile $file, int $seq, int $count): array
    {
        return DB::table($file->table())
            ->where('user_id', $user->id)
            ->where('game', $game->value)
            ->whereBetween('seq', [$seq, $seq + $count - 1])
            ->orderBy('seq')
            ->pluck('data')
            ->map(fn (mixed $data) => json_decode(is_string($data) ? $data : '', true))
            ->values()
            ->all();
    }
}
