<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Enums\DataFile;
use App\Enums\Game;
use App\Ingest\RawData;
use App\Models\User;
use Illuminate\Console\Command;
use SplFileObject;

class ImportPluginData extends Command
{
    protected $signature = 'ingest:import {email : Owner of the data} {dir : Plugin data folder with <game>/<file>.jsonl}';

    protected $description = 'Import jsonl files written by the plugin, lines already stored are skipped';

    public function handle(RawData $data): int
    {
        $user = User::where('email', $this->argument('email'))->firstOrFail();

        foreach (Game::cases() as $game) {
            foreach (DataFile::cases() as $file) {
                $path = "{$this->argument('dir')}/{$game->value}/{$file->value}.jsonl";
                if (! is_file($path)) {
                    continue;
                }
                $last = $data->lastSeq($user, $game, $file);
                $seq = $last + 1;
                $chunk = [];
                foreach ($this->newLines($path, $last) as $line) {
                    $chunk[] = $line;
                    if (count($chunk) === RawData::MAX_LINES) {
                        $seq = $data->store($user, $game, $file, $seq, $chunk) + 1;
                        $chunk = [];
                    }
                }
                if ($chunk !== []) {
                    $seq = $data->store($user, $game, $file, $seq, $chunk) + 1;
                }
                $this->info("{$game->value}/{$file->value}: ".($seq - 1 - $last).' new lines');
            }
        }

        return self::SUCCESS;
    }

    /**
     * Lines after the first $skip ones, without the last line if the plugin is just writing it.
     *
     * @return iterable<mixed>
     */
    private function newLines(string $path, int $skip): iterable
    {
        $file = new SplFileObject($path);
        $file->seek($skip);
        while (! $file->eof()) {
            $line = $file->fgets();
            if (! str_ends_with($line, "\n")) {
                return;
            }
            yield json_decode($line, true, flags: JSON_THROW_ON_ERROR);
        }
    }
}
