#!/usr/bin/env python3
"""Extracts company, city and Czech cargo names and the cargo companies ship from the game archives into JSON files; rerun after buying a new DLC.

Usage: extract_names.py ats|eut2
"""

import json
import mmap
import re
import sys
import zlib
from pathlib import Path

from build import GAMES, names_path

# Cargo from the delivery log without a cargo_data definition in the archives; localization keys picked by hand.
MISSING_CARGO_KEYS = {
    'valentine': 'cn_valentine_gifts',
    'gifts': 'cn_gifts',
    'megapotato': 'cn_big_idaho_potato',
}

# Event cargo the game removed from its archives after the event; names as the archives had them (Halloween 2026).
REMOVED_CARGO_NAMES = {
    'halloween': 'Halloween Treats',
    'halloween_1': 'Halloween Treats',
    'halloween_2a': 'Halloween Costumes',
    'halloween_2b': 'Halloween Herbs & Spices',
    'halloween_2c': 'Halloween Crafts',
}


def scs_texts(path):
    """Decompressed files of a HashFS v2 archive (.scs), found by scanning for zlib streams."""
    with open(path, 'rb') as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as data:
        i = 0
        while (i := data.find(b'\x78', i)) >= 0:
            if data[i + 1:i + 2] in (b'\x9c', b'\xda', b'\x01', b'\x5e'):
                try:
                    yield zlib.decompressobj().decompress(data[i:i + 4_000_000]).decode('utf-8', 'replace')
                except zlib.error:
                    pass
            i += 1


def is_czech(text):
    # Archive paths are hashed, so the language is recognised by letters no other game language uses.
    return 'ř' in text and 'ů' in text


def write_names(path, names, label):
    path.write_text(json.dumps(dict(sorted(names.items())), ensure_ascii=False, indent=1))
    print(f'{path} ({len(names)} {label})')


def main():
    game = sys.argv[1] if len(sys.argv) > 1 else ''
    if game not in GAMES:
        sys.exit(f'usage: {sys.argv[0]} {"|".join(GAMES)}')
    install_dir = GAMES[game]['install_dir']
    companies, cities, city_tokens, cargo_tokens, czech = {}, {}, {}, {}, {}
    cargo_defs = set()
    countries = {}
    archives = [install_dir / 'def.scs', install_dir / 'locale.scs', *sorted(install_dir.glob('dlc_*.scs'))]
    for archive in archives:
        for text in scs_texts(archive):
            companies.update(re.findall(r'company_permanent\s*:\s*company\.permanent\.(\w+)\s*\{[^}]*?\bname:\s*"([^"]*)"', text))
            cities.update(re.findall(r'city_data\s*:\s*city\.(\w+)\s*\{[^}]*?\bcity_name:\s*"([^"]*)"', text))
            # The game shows the localized name (e.g. Russian cities in Latin script), the SDK sends city_name.
            city_tokens.update(re.findall(r'city_data\s*:\s*city\.(\w+)\s*\{[^}]*?\bcity_name_localized:\s*"([^"]*)"', text))
            cargo_tokens.update(re.findall(r'(?:car_)?cargo_data\s*:\s*(?:car_)?cargo\.(\w+)\s*\{[^}]*?\bname:\s*"([^"]*)"', text))
            # Cargo a company ships or accepts (def/company/<company>/in|out); cargo_data alone also covers car jobs and unused cargo.
            cargo_defs.update(re.findall(r'cargo_def\s*:\s*[\w.]+\s*\{[^}]*?\bcargo:\s*"cargo\.(\w+)"', text))
            for code, block in re.findall(r'country_data\s*:\s*country\.data\.(\w+)\s*\{([^}]*)\}', text):
                fields = dict(re.findall(r'^\s*(name|name_localized|fuel_price):\s*"?([^"\s#]*(?: [^"#\n]+)?)"?', block, re.M))
                if 'fuel_price' in fields:
                    countries[code] = fields
            if is_czech(text):
                czech.update(re.findall(r'key\[\]:\s*"([^"]*)"\s*val\[\]:\s*"([^"]*)"', text))
        print(archive.name)

    cargo_tokens = {**MISSING_CARGO_KEYS, **cargo_tokens}
    cargo = {**REMOVED_CARGO_NAMES, **{code: czech.get(token.strip('@'), token) for code, token in cargo_tokens.items()}}
    cities.update({code: czech[token.strip('@')] for code, token in city_tokens.items() if token.strip('@') in czech})
    names_path(game, 'companies').parent.mkdir(parents=True, exist_ok=True)
    write_names(names_path(game, 'companies'), companies, 'companies')
    write_names(names_path(game, 'cities'), cities, 'cities')
    write_names(names_path(game, 'cargo'), cargo, 'cargo types')
    names_path(game, 'cargo_defs').write_text(json.dumps(sorted(cargo_defs)))
    fuel_prices = sorted(({'id': code, 'name': czech.get(f.get('name_localized', '').strip('@'), f.get('name', code)), 'price': float(f['fuel_price'])} for code, f in countries.items()), key=lambda c: c['name'])
    names_path(game, 'fuel_prices').write_text(json.dumps(fuel_prices, ensure_ascii=False, indent=1))
    print(f"{names_path(game, 'fuel_prices')} ({len(fuel_prices)} countries with a fuel price)")
    print(f"{names_path(game, 'cargo_defs')} ({len(cargo_defs)} cargo types companies ship)")
    untranslated = sorted(code for code, name in cargo.items() if name.startswith('@@'))
    if untranslated:
        print(f'untranslated cargo: {", ".join(untranslated)}')


if __name__ == '__main__':
    main()
