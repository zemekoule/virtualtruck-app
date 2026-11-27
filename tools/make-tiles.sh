#!/bin/bash
# Map tiles and icons for web/ from the installed games (tools/trucksim-maps parser + generator); rerun after a game update or a new DLC.
# Needs tippecanoe (brew) and Node 24 from nvm; the generator runs from the clone, `npx generator` would fetch an unrelated npm package.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MAPS_DIR="$PROJECT_DIR/tools/trucksim-maps"
OUT_DIR="$PROJECT_DIR/web/public/tiles"
STEAM_GAMES="$HOME/Library/Application Support/Steam/steamapps/common"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

source ~/.nvm/nvm.sh
nvm use 24 >/dev/null
cd "$MAPS_DIR"
export NODE_OPTIONS=--max-old-space-size=8192
generator() { ./node_modules/.bin/tsx packages/clis/generator/index.ts "$@"; }

./node_modules/.bin/parser -i "$STEAM_GAMES/American Truck Simulator" -o "$WORK/ats"
./node_modules/.bin/parser -i "$STEAM_GAMES/Euro Truck Simulator 2" -o "$WORK/eut2"

mkdir -p "$OUT_DIR"
# Real-world base layer (sea, country and state borders), as in the Makefile of tools/trucksim-maps.
RESOURCES=packages/clis/generator/resources
tippecanoe -Z4 -z8 -y name -b 10 -X --force --quiet -o "$OUT_DIR/world.pmtiles" "$RESOURCES/water.geojson" "$RESOURCES/countries.geojson" "$RESOURCES/states.geojson"
for game in "usa ats" "europe eut2"; do
	read -r map dir <<< "$game"
	generator map -h -m "$map" -i "$WORK/$dir" -o "$OUT_DIR" --dataOverridesPath packages/clis/generator/resources/trucksim-overrides.json
	generator footprints -m "$map" -i "$WORK/$dir" -o "$OUT_DIR"
	python3 "$PROJECT_DIR/tools/extract-parking.py" "$WORK/$dir/$map-pois.json" > "$OUT_DIR/parking-$dir.json"
	python3 "$PROJECT_DIR/tools/extract-fuel-places.py" "$WORK/$dir" "$map" > "$PROJECT_DIR/names/$dir/fuel_places.json"
done

# The spritesheet takes the icons of both maps from one directory.
mkdir -p "$WORK/all/icons"
# The map data reader needs more than the POIs (cities, companies).
ln -s "$WORK"/ats/usa-*.json "$WORK"/eut2/europe-*.json "$WORK/all/"
# ATS last, so its icon wins where both games have one.
cp "$WORK"/eut2/icons/*.png "$WORK/all/icons/"
cp "$WORK"/ats/icons/*.png "$WORK/all/icons/"
generator spritesheet -m usa -m europe -i "$WORK/all" -o "$OUT_DIR"

ls -la "$OUT_DIR"
