<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Telemetry\Numbers;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class NumbersTest extends TestCase
{
    #[DataProvider('roundings')]
    public function test_rounds_half_to_even_on_the_binary_value(float $value, int $digits, float|int $expected): void
    {
        $this->assertSame($expected, Numbers::roundHalfEven($value, $digits));
    }

    /**
     * @return array<string, array{float, int, float|int}>
     */
    public static function roundings(): array
    {
        return [
            'half down to even' => [2.5, 0, 2],
            'half up to even' => [3.5, 0, 4],
            'negative half' => [-2.5, 0, -2],
            'binary below half' => [2.675, 2, 2.67],
            'tenths' => [0.25, 1, 0.2],
            'plain' => [1.23456, 4, 1.2346],
        ];
    }

    public function test_int_stays_int(): void
    {
        $this->assertSame(5, Numbers::roundHalfEven(5, 1));
    }

    public function test_sums_floats_with_compensation(): void
    {
        $this->assertSame(1.0, Numbers::compensatedSum([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]));
        $this->assertNotSame(1.0, 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1);
    }

    public function test_sum_of_ints_stays_int(): void
    {
        $this->assertSame(0, Numbers::compensatedSum([]));
        $this->assertSame(6, Numbers::compensatedSum([1, 2, 3]));
    }
}
