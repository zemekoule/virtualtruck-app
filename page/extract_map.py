#!/usr/bin/env python3
"""Builds page/map-<game>.js (roads and cities of the game map) with the TruckSim Maps parser; rerun after buying a new DLC.

Usage: extract_map.py ats|eut2 [parser output dir to reuse]
"""

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from build import GAMES

PROJECT_DIR = Path(__file__).resolve().parent.parent
PARSER_DIR = PROJECT_DIR / 'tools/trucksim-maps'
# The parser requires Node >= 24, while the default Node of this machine is 22.
NODE_VERSION = '24'


def run_parser(install_dir, out_dir):
    command = f'source ~/.nvm/nvm.sh && nvm exec {NODE_VERSION} npx parser -i "{install_dir}" -o "{out_dir}"'
    subprocess.run(['bash', '-c', command], cwd=PARSER_DIR, check=True)


def europe_road_shield(icon):
    """Label and kind of a route shield icon token, e.g. 'd_a9' -> ('A9', 'motorway'), 'cz_e55' -> ('E55', 'e'); None for non-route icons."""
    m = re.fullmatch(r'[a-z]+_([a-z]*)(\d\w*)', icon)
    if not m:
        return None
    road_class = m.group(1)
    kind = 'e' if road_class == 'e' else 'motorway' if road_class in ('a', 'ap', 'm') else 'state'
    return f'{road_class.upper()}{m.group(2).upper()}', kind


def road_shield(icon):
    """Label and kind of a route shield icon token, e.g. 'is80' -> ('I-80', 'i'); None for non-route icons."""
    patterns = (
        (r'is(\w+)', 'I-{}', 'i'),
        (r'us(\w+)', 'US {}', 'us'),
        (r'ca_r(\w+)', 'CA {}', 'state'),
        (r'bus(\w+)', 'BUS {}', 'state'),
        (r'txl(\w+)', 'Loop {}', 'state'),
        (r'([a-z]{2})(\d\w*)', None, 'state'),
    )
    for pattern, label, kind in patterns:
        m = re.fullmatch(pattern, icon)
        if m:
            return (label.format(m.group(1).upper()) if label else f'{m.group(1).upper()} {m.group(2).upper()}'), kind
    return None


def read_parser_output(out, map_name):
    roads = [r for r in json.loads((out / f'{map_name}-roads.json').read_text()) if not r.get('hidden')]
    needed = {uid for r in roads for uid in (r['startNodeUid'], r['endNodeUid'])}
    nodes = {n['uid']: (round(n['x']), round(n['y'])) for n in json.loads((out / f'{map_name}-nodes.json').read_text()) if n['uid'] in needed}
    cities = json.loads((out / f'{map_name}-cities.json').read_text())
    pois = json.loads((out / f'{map_name}-pois.json').read_text())
    return roads, nodes, cities, pois


def main():
    game = sys.argv[1] if len(sys.argv) > 1 else ''
    if game not in GAMES:
        sys.exit(f'usage: {sys.argv[0]} {"|".join(GAMES)} [parser output dir to reuse]')
    map_name, shield = ('usa', road_shield) if game == 'ats' else ('europe', europe_road_shield)
    if len(sys.argv) > 2:
        roads, nodes, cities, pois = read_parser_output(Path(sys.argv[2]), map_name)
    else:
        with tempfile.TemporaryDirectory() as out:
            run_parser(GAMES[game]['install_dir'], out)
            roads, nodes, cities, pois = read_parser_output(Path(out), map_name)
    output = PROJECT_DIR / f'page/map-{game}.js'

    # Parser x/y are the game x/z world coordinates, the same as in the drivelog trace.
    segments = [coord for r in roads for coord in (*nodes[r['startNodeUid']], *nodes[r['endNodeUid']])]
    shields = [[*s, round(p['x']), round(p['y'])] for p in pois if p['type'] == 'road' and (s := shield(p['icon']))]
    companies = [[p['label'], round(p['x']), round(p['y'])] for p in pois if p['type'] == 'company']
    data = {
        'roads': segments,
        'cities': [[c['name'], round(c['x']), round(c['y'])] for c in cities],
        'shields': shields,
        'companies': companies,
    }
    output.write_text('const MAP = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'{output} ({len(roads)} roads, {len(cities)} cities, {len(shields)} shields, {len(companies)} companies, {output.stat().st_size / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
