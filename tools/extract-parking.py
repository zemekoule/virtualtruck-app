#!/usr/bin/env python3
"""Prints the parking places from a TruckSim Maps parser <map>-pois.json as [x, y] game coordinates, for the break range on the live map."""

import json
import math
import sys

# One parking area has several parking POIs (triggers, map overlay) up to ~200 m apart.
MERGE_M = 200


def main():
    points = [(p['x'], p['y']) for p in json.load(open(sys.argv[1])) if p.get('icon') == 'parking_ico']
    clusters = []
    grid = {}
    for x, y in points:
        cell = (math.floor(x / MERGE_M), math.floor(y / MERGE_M))
        near = [c for dx in (-1, 0, 1) for dy in (-1, 0, 1) for c in grid.get((cell[0] + dx, cell[1] + dy), []) if math.hypot(c[0] / c[2] - x, c[1] / c[2] - y) <= MERGE_M]
        if near:
            near[0][0] += x
            near[0][1] += y
            near[0][2] += 1
        else:
            c = [x, y, 1]
            clusters.append(c)
            grid.setdefault(cell, []).append(c)
    print(json.dumps(sorted([round(sx / n), round(sy / n)] for sx, sy, n in clusters)))


if __name__ == '__main__':
    main()
