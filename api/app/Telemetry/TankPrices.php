<?php

declare(strict_types=1);

namespace App\Telemetry;

/**
 * Port of tank_prices() in page/build.py that goes through new trace points only.
 *
 * @phpstan-type State array{tanks: array<string, array{litres: float|int, price: float|int|null}>, prev: array{wall: int, odometer: float|int, game_time: int|null}|null, refuel: array{wall: int, last_wall: int, vehicle: string, litres: float|int}|null}
 */
class TankPrices
{
    private const REFUEL_MIN_L = 0.1;

    // Refuelling happens standing; a bigger odometer change means another vehicle or a loaded save.
    private const REFUEL_MAX_KM = 1;

    // Fuel added farther from a pump or garage (e.g. 10 l at once in the middle of nowhere, ATS) is not a purchase at the pump price.
    private const REFUEL_PLACE_MAX_M = 500;

    // fuel_discount_in_garage in both games; refuelling is only possible in an own garage.
    private const GARAGE_FUEL_DISCOUNT = 0.15;

    /** @var array<int, array{wall: int, last_wall: int, game_time: int|null, vehicle: string, litres: float|int, country: string, garage: bool, price: float}> refuels by wall */
    public array $refuels = [];

    /** @var array<int, array{litres: float|int, last_wall: int}> refuels found in an earlier run that went on, by wall */
    public array $continued = [];

    /**
     * @param  State  $state
     * @param  list<array{wall: int, key: string}>  $vehicles  vehicle changes in the order of the events
     * @param  list<array{0: float|int, 1: float|int, 2: string, 3: bool}>  $places  pumps and garages: x, z, country, garage
     * @param  array<string, float|int>  $prices  fuel price per litre by country
     */
    public function __construct(public array $state, private readonly array $vehicles, private readonly array $places, private readonly array $prices) {}

    public static function vehicleKey(mixed $id, mixed $plate): string
    {
        return json_encode([$id, $plate], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    }

    /**
     * @param  array{wall: int, game_time: int|null, fuel: float|int, odometer: float|int, x: float|int, z: float|int}  $p
     * @return float|int|null price of the fuel in the tank after the point
     */
    public function add(array $p): float|int|null
    {
        $vehicle = 'null';
        foreach ($this->vehicles as $v) {
            if ($v['wall'] > $p['wall']) {
                break;
            }
            $vehicle = $v['key'];
        }
        $this->state['tanks'][$vehicle] ??= ['litres' => $p['fuel'], 'price' => null];
        $tank = $this->state['tanks'][$vehicle];
        $added = $p['fuel'] - $tank['litres'];
        $prev = $this->state['prev'];
        $standing = $prev !== null && 0 <= $p['odometer'] - $prev['odometer'] && $p['odometer'] - $prev['odometer'] <= self::REFUEL_MAX_KM
            && ($p['game_time'] ?? 0) >= ($prev['game_time'] ?? 0);
        if ($added >= self::REFUEL_MIN_L && $standing && $this->places !== []) {
            [$x, $z, $country, $garage] = $this->nearestPlace($p);
            if (($x - $p['x']) ** 2 + ($z - $p['z']) ** 2 <= self::REFUEL_PLACE_MAX_M ** 2) {
                if (! isset($this->prices[$country])) {
                    throw new \RuntimeException("No fuel price for {$country}, regenerate fuel_prices.json.");
                }
                $price = $this->prices[$country] * ($garage ? 1 - self::GARAGE_FUEL_DISCOUNT : 1);
                $old = $tank['price'] ?? $price;
                $litres = max(0, $tank['litres']);
                $tank['price'] = ($litres * $old + $added * $price) / ($litres + $added);
                $last = $this->state['refuel'];
                // The fuel gauge may take two trace points to fill up.
                if ($last !== null && $last['last_wall'] === $prev['wall'] && $last['vehicle'] === $vehicle) {
                    $last['litres'] = Numbers::roundHalfEven($last['litres'] + $added, 2);
                    $last['last_wall'] = $p['wall'];
                    if (isset($this->refuels[$last['wall']])) {
                        $this->refuels[$last['wall']]['litres'] = $last['litres'];
                        $this->refuels[$last['wall']]['last_wall'] = $p['wall'];
                    } else {
                        $this->continued[$last['wall']] = ['litres' => $last['litres'], 'last_wall' => $p['wall']];
                    }
                    $this->state['refuel'] = $last;
                } else {
                    $litresAdded = Numbers::roundHalfEven($added, 2);
                    $this->refuels[$p['wall']] = ['wall' => $p['wall'], 'last_wall' => $p['wall'], 'game_time' => $p['game_time'], 'vehicle' => $vehicle, 'litres' => $litresAdded, 'country' => $country, 'garage' => $garage, 'price' => (float) $price];
                    $this->state['refuel'] = ['wall' => $p['wall'], 'last_wall' => $p['wall'], 'vehicle' => $vehicle, 'litres' => $litresAdded];
                }
            }
        }
        $tank['litres'] = $p['fuel'];
        $this->state['tanks'][$vehicle] = $tank;
        $this->state['prev'] = ['wall' => $p['wall'], 'odometer' => $p['odometer'], 'game_time' => $p['game_time']];

        return $tank['price'];
    }

    /**
     * @param  array{x: float|int, z: float|int}  $p
     * @return array{0: float|int, 1: float|int, 2: string, 3: bool}
     */
    private function nearestPlace(array $p): array
    {
        $nearest = $this->places[0];
        $best = INF;
        foreach ($this->places as $place) {
            $distance = ($place[0] - $p['x']) ** 2 + ($place[1] - $p['z']) ** 2;
            if ($distance < $best) {
                [$nearest, $best] = [$place, $distance];
            }
        }

        return $nearest;
    }
}
