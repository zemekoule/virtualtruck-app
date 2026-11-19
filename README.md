# virtualtruck – aplikace

Aplikace virtuální spedice [virtualtruck](https://virtualtruck.online) pro American Truck Simulator a Euro Truck Simulator 2. Jízdy do ní posílá plugin [virtualtruck-plugin](https://github.com/zemekoule/virtualtruck-plugin): zakázky s trasou, rychlostí, spotřebou, pokutami a tankováním.

## Struktura

- `api/` – Laravel s MariaDB: přihlášení, příjem dat z pluginu, výpočet zakázek a tankování.
- `web/` – stránka (Vite + React + TS), čte z API po přihlášení.
- `names/<hra>/` – jména firem, měst a nákladů, pumpy a ceny paliva vytažené z archivů her.
- `tools/` – nástroje pro mapu (dlaždice z instalace hry), `tools/trucksim-maps` je submodul s parserem a stylem mapy.
- `page/`, `supabase/` – původní stránka nad Supabase, po přechodu na API se smaže.

## Lokální vývoj

Vše běží v Dockeru (`compose.yaml`): API na http://localhost:8100, stránka na http://localhost:5180.

```sh
git submodule update --init
git -C tools/trucksim-maps apply ../trucksim-maps.patch
cp api/.env.example api/.env
docker compose run --rm api composer install
docker compose run --rm api php artisan key:generate
docker compose run --rm web npm ci   # i po změně package-lock.json
docker compose up -d
docker compose run --rm api php artisan migrate
```

Přihlášení funguje jen na adrese `localhost:5180` (`SANCTUM_STATEFUL_DOMAINS` v `api/.env`); Vite přeposílá `/api` na API, aby byla session cookie na stejné adrese jako stránka.

Patch submodulu mění import `maplibre-gl` (verze 6 nemá výchozí export, který kód mapy používá) a přidává Jižní Dakotu mezi vydaná DLC (jinak styl mapy skrývá silnice na hranicích s ní). Po změně patche: `git -C tools/trucksim-maps checkout -- packages` a znovu `apply`.

Kontroly:

```sh
docker compose run --rm api php artisan test
docker compose run --rm api vendor/bin/pint --test
docker compose run --rm api vendor/bin/phpstan analyse --memory-limit=1G   # Larastan, level max
docker compose run --rm api composer audit
docker compose run --rm web npx tsc
```

Totéž (testy na MariaDB, build `web/` se submodulem a patchem, `npm audit` balíčků stránky) pouští GitHub Actions u každého PR, po merge do `main` a každé pondělí kvůli nově zveřejněným zranitelnostem (`.github/workflows/ci.yml`). Pondělní běh GitHub vypne po 60 dnech bez commitu, pak ho znovu zapni v záložce Actions.

## Po aktualizaci hry nebo novém DLC

Jména (2–6 minut na hru), přepíše JSON soubory v `names/<hra>/` (náklady česky) a `cargo_defs.json` pro stránku „Náklady“:

```sh
python3 page/extract_names.py ats    # nebo eut2
```

Dlaždice a ikony mapy (~6 minut), zapíše je do `web/public/tiles` (~220 MB, mimo git), k tomu parkoviště pro stránku „Živě“ (`parking-<hra>.json`, body do 200 m sloučené do jednoho) a pumpy pro cenu paliva (`names/<hra>/fuel_places.json`):

```sh
make tiles
```

Potřebuje Node 24 (nvm), `tippecanoe` (`brew install tippecanoe`) a závislosti generátoru v klonu (`nvm exec 24 npm install -w packages/clis/generator --ignore-scripts`). Generátor nespouštěj přes `npx generator` – mimo workspace stáhne z npm cizí balík stejného jména.

Mapa ve stránce je MapLibre se stylem z demo aplikace [TruckSim Maps](https://github.com/truckermudgeon/maps) (`GameMapStyle` z `tools/trucksim-maps/packages/libs/ui`, Vite ho bere přes aliasy).

## API

Všechny cesty jsou pod `/api` (i `/api/login`, `/api/register`, `/api/logout` a `/api/sanctum/csrf-cookie`). Registrace jde vypnout (`VIRTUALTRUCK_REGISTRATION=false`), účet pak založí `php artisan user:create <e-mail> <jméno>`. Změna hesla a volitelné dvoufázové ověření jsou cesty Fortify (`/api/user/password`, `/api/user/two-factor-*`, `/api/two-factor-challenge`).

### Data z pluginu

Plugin posílá řádky svých souborů `<hra>/events.jsonl` a `<hra>/trace.jsonl` s osobním tokenem (`Authorization: Bearer …`), který si uživatel vytvoří ve stránce v Nastavení. Token smí jen odesílat data, čtení dat a správa tokenů jdou jen po přihlášení.

- `GET /api/ingest/<hra>/<soubor>` vrátí `last_seq`, číslo posledního uloženého řádku (`seq` = číslo řádku v souboru, od 1).
- `POST /api/ingest/<hra>/<soubor>` s `{"seq": <číslo prvního řádku>, "lines": [ … ]}`, nejvýš 1000 řádků. Už uložené řádky přeskočí (dávku jde poslat znovu), pokud se shodují s uloženými. Mezeru za uloženými řádky nebo jiný obsah pod stejným `seq` (plugin začal soubor znovu) odmítne s `409` a `last_seq`. Řádky se ukládají beze změny (ani mezery v řetězcích se neořezávají).

Import už zapsaných souborů (např. historie, kterou plugin zapsal bez odesílání), uložené řádky přeskočí:

```sh
docker compose run --rm -v "$HOME/Library/Application Support/virtualtruck/data:/data:ro" api php artisan ingest:import <e-mail> /data
```

### Zakázky a tankování

Po každé přijaté dávce se po odeslání odpovědi přepočítají zakázky a tankování uživatele a hry, jen z toho, co přibylo: rozjeté zakázky si výpočet pamatuje (`job_computations.job_state`), čte jen nové události a cenu paliva v nádrži počítá jen pro nové body stopy. Události, ke kterým ještě nedorazila stopa, zpracuje znovu v dalším běhu. Když výpočet už běží, další požadavek na něj nečeká, nová data spočítá běžící výpočet. Pumpy a ceny paliva bere z `names/<hra>/`.

Ručně (`--fresh` spočítá zakázky znovu ze všech událostí, např. po ruční opravě událostí):

```sh
docker compose run --rm api php artisan jobs:compute [--fresh]
```

### Čtení dat

Přihlášený uživatel čte jen svoje data:

- `GET /api/games/<hra>` vrátí `jobs`, `depots`, `cancellations` (id ručně zrušených zakázek) a `refuels`.
- `GET /api/games/<hra>/position` vrátí `point`, poslední bod stopy (stránka „Živě“).
- `PUT` / `DELETE /api/games/<hra>/cancellations/<id zakázky>` ručně zruší / obnoví nedokončenou WoT nebo autobusovou zakázku (jejich zrušení hra pluginu nehlásí), jiné odmítne s `422`.

## Vydání

Vydává se značkou `v*` na commitu z `main` (`.github/workflows/deploy.yml`): kontroly z CI, produkční obraz (`Dockerfile.prod`, jeden kontejner obsluhuje API, stránku i dlaždice) do `ghcr.io/zemekoule/virtualtruck-app`, nasazení a nakonec GitHub release se seznamem sloučených PR (vygeneruje ho GitHub). Při nepovedeném nasazení se vrací předchozí verze, ale ne databáze – migrace proto musí jít tak, aby nad novým schématem běžela i předchozí verze (odebrání nebo přejmenování sloupce rozdělit do dvou vydání).

## Licence

GPL-3.0, viz `LICENSE`. Mapa ve `web/` používá kód z [TruckSim Maps](https://github.com/truckermudgeon/maps) (GPL-3.0).
