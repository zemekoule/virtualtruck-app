#!/usr/bin/env python3
"""Prints the fuel pumps from a TruckSim Maps parser output as [x, y, country token, in a player garage], for the fuel prices in build.py."""

import json
import math
import sys

GRID_M = 2000


def main():
    parsed_dir, map_name = sys.argv[1], sys.argv[2]
    countries = {c['id']: c['token'] for c in json.load(open(f'{parsed_dir}/{map_name}-countries.json'))}
    grid = {}
    for n in json.load(open(f'{parsed_dir}/{map_name}-nodes.json')):
        country = n['forwardCountryId'] or n['backwardCountryId']
        if country in countries:
            grid.setdefault((math.floor(n['x'] / GRID_M), math.floor(n['y'] / GRID_M)), []).append((n['x'], n['y'], countries[country]))
    places = []
    for p in json.load(open(f'{parsed_dir}/{map_name}-pois.json')):
        if p.get('icon') != 'gas_ico':
            continue
        cx, cy = math.floor(p['x'] / GRID_M), math.floor(p['y'] / GRID_M)
        near = [n for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2) for n in grid.get((cx + dx, cy + dy), [])]
        if near:
            country = min(near, key=lambda n: (n[0] - p['x']) ** 2 + (n[1] - p['y']) ** 2)[2]
            places.append([round(p['x']), round(p['y']), country, '/garage_player/' in p['prefabPath']])
    print(json.dumps(sorted(places)))


if __name__ == '__main__':
    main()
