<?php

declare(strict_types=1);

namespace App\Telemetry;

/** Rounding and summing like page/build.py (Python) does, so both compute the same numbers. */
final class Numbers
{
    /** Half to even on the exact binary value, e.g. 2.5 → 2, 2.675 → 2.67 (sprintf rounds this way). */
    public static function roundHalfEven(float|int $value, int $digits = 0): float|int
    {
        if (is_int($value)) {
            return $value;
        }
        $rounded = (float) sprintf("%.{$digits}F", $value);

        return $digits === 0 ? (int) $rounded : $rounded;
    }

    /**
     * Neumaier compensated summation of floats, ints are added plainly (Python >= 3.12 sum()).
     *
     * @param  iterable<float|int>  $values
     */
    public static function compensatedSum(iterable $values): float|int
    {
        $total = 0;
        $compensation = 0.0;
        foreach ($values as $value) {
            if (is_int($value)) {
                $total += $value;

                continue;
            }
            $total = (float) $total;
            $sum = $total + $value;
            $compensation += abs($total) >= abs($value) ? ($total - $sum) + $value : ($value - $sum) + $total;
            $total = $sum;
        }

        return is_float($total) && $compensation !== 0.0 && is_finite($compensation) ? $total + $compensation : $total;
    }
}
