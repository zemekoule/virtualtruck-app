<?php

declare(strict_types=1);

namespace App\Ingest;

use RuntimeException;

class SeqConflictException extends RuntimeException
{
    public function __construct(public readonly int $lastSeq, string $message)
    {
        parent::__construct($message);
    }
}
