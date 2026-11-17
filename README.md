# virtualtruck – aplikace

Přehled jízd z American Truck Simulator a Euro Truck Simulator 2 zaznamenaných pluginem [virtualtruck-plugin](https://github.com/zemekoule/virtualtruck-plugin) a ze savu profilu `andros`.

## Předpoklady

- Repo pluginu je ve vedlejší složce a plugin zapisuje do `../data/<hra>/` (`data/ats/`, `data/eut2/` vedle tohoto repa), odkud data čtou skripty v `page/`.
- Hra ukládá save jako text: v `config.cfg` (`~/Library/Application Support/American Truck Simulator/`, resp. `Euro Truck Simulator 2/`) je `uset g_save_format "2"`.
- Python 3, Node (`web/`).
- Mapové nástroje jsou v submodulu: `git submodule update --init`, pak postup v sekci Mapa.

## Stránka

Data jsou v Supabase (projekt a klíče v `.env` v kořeni projektu, tabulky v `supabase/migrations/`, migrace se spouští ručně v SQL Editoru).

```sh
make sync           # nech běžet během hraní, Ctrl+C ukončí
make import-save    # kdykoli: zakázky ze savu, které plugin nezaznamenal, a depa
open page/index.html
```

`make sync` (`page/sync.py`) každých 5 s nahraje nové řádky z `../data/<hra>/*.jsonl`, přepočítá zakázky z pluginu (logikou z `build.py`) a jména a při startu zapíše `page/config.js` (publishable key pro stránku). `make import-save` (`page/import_save.py`) vezme poslední save každé hry a přidá zakázky, které v databázi nejsou (ani z pluginu, ani z dřívějšího importu), a depa podle měst. Pouštěj ho až po nahrání zakázek z pluginu, jinak bude zakázka dvakrát.

- `page/nakladni.html` – zakázky kamionem v ATS zaznamenané pluginem, s detailem (trasa, rychlost, spotřeba, pokuty…). Probíhající WoT zakázku jde v detailu zrušit ručně (SDK její zrušení nehlásí), zrušení se ukládá do tabulky `cancellations`.
- `page/nakladni-ets2.html` – totéž pro ETS2 (km, km/h, l, €).
- `page/osobni.html` – zakázky osobní dopravy zaznamenané pluginem (hodnocení a spokojenost zákazníka SDK neposílá, mají je jen zakázky importované ze savu).
- `page/mesta.html`, `page/mesta-ets2.html` – vyhledání města: všechna depa (seznam ze savu), z/do kterých jsem vezl, a seznam zakázek (všechny ze savu i z pluginu), z přehledu jízd se na město jde kliknutím na jeho název.

`make build` (`page/build.py`) zapíše stejná data lokálně do `page/data-<hra>.js` (se starým párováním plugin ↔ save). Stránky ho už nečtou, používají ho jen návrhy grafiky níže.

### Mapa

```sh
python3 page/extract_map.py ats    # nebo eut2
```

Vytvoří `page/map-<hra>.js` (silnice a města) pro mapu v detailu jízdy. Druhý argument může být složka s už hotovým výstupem parseru (parser se pak nespouští). Používá parser projektu [TruckSim Maps](https://github.com/truckermudgeon/maps) v `tools/trucksim-maps` (vyžaduje Node 24 přes nvm). Trvá 1–2 minuty. Spouštěj po koupi nového DLC nebo aktualizaci hry.

První instalace parseru (už hotová, jen pro případ znovusestavení):

```sh
source ~/.nvm/nvm.sh && nvm install 24
cd tools/trucksim-maps
git apply ../trucksim-maps.patch
nvm exec 24 npm install --workspace=packages/clis/parser --include-workspace-root
nvm exec 24 npm run build -w packages/clis/parser
```

### Jména firem, měst a nákladů

```sh
python3 page/extract_names.py ats    # nebo eut2
```

Projde archivy hry (`def.scs`, `locale.scs`, `dlc_*.scs`) a přepíše tři JSON soubory s jmény v `names/<hra>/` (náklady česky) a `cargo_defs.json` – náklady, které některá firma vozí nebo přijímá (stránka „Náklady“ ve `web/` ho bere při sestavení). Trvá 2 (ATS) až 6 (ETS2) minut. Spouštěj po koupi nového DLC nebo velké aktualizaci hry, pak znovu `build.py`.

## Nová stránka (`web/`)

Přepis `page/` do Vite + React + TS, data čte stejně ze Supabase (publishable key bere Vite z `.env` v kořeni, tajný klíč do stránky nejde).

```sh
cd web && npm install   # jen poprvé
make web                # http://localhost:5173
```

Mapa v detailu zakázky je MapLibre se stylem z demo aplikace [TruckSim Maps](https://github.com/truckermudgeon/maps) (`GameMapStyle` z `tools/trucksim-maps/packages/libs/ui`, Vite ho bere přes aliasy, licence GPL-3.0). Dlaždice a ikony jsou v `web/public/tiles` (~320 MB):

```sh
make tiles   # tools/make-tiles.sh, ~6 minut; po aktualizaci hry nebo novém DLC
```

`make tiles` zapíše i `web/public/tiles/parking-<hra>.json` (parkoviště ze stejného výstupu parseru, body do 200 m sloučené do jednoho). Čte je stránka „Živě“: každých 5 s si z tabulky `trace` vezme poslední polohu a minuty do přestávky a zvýrazní parkoviště v dosahu.

Potřebuje `tippecanoe` (`brew install tippecanoe`) a závislosti generátoru v klonu (`nvm exec 24 npm install -w packages/clis/generator --ignore-scripts`). Generátor nespouštěj přes `npx generator` – mimo workspace stáhne z npm cizí balík stejného jména.
