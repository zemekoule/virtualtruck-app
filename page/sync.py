#!/usr/bin/env python3
"""Uploads the drivelog plugin output to Supabase and keeps the jobs computed from it up to date, until Ctrl+C."""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from build import GAMES, PROJECT_DIR, names_path, read_jsonl, read_names, tank_prices, telemetry_jobs

# The plugin writes a trace point every 5 s.
SYNC_INTERVAL_S = 5
BATCH_ROWS = 1000
RAW_TABLES = ('events', 'trace')
NAME_KINDS = ('companies', 'cities', 'cargo')
JOB_COLUMNS = ('id', 'kind', 'status', 'game_time', 'src_company', 'src_city', 'dst_company', 'dst_city', 'cargo', 'xp', 'revenue', 'km', 'truck', 'mass', 'units', 'telemetry')


def read_env():
    return dict(line.split('=', 1) for line in (PROJECT_DIR / '.env').read_text().splitlines() if '=' in line)


def write_page_config(env):
    config = {'project_id': env['SUPABASE_PROJECT_ID'], 'publishable_key': env['SUPABASE_PUBLISHABLE_KEY']}
    (PROJECT_DIR / 'page/config.js').write_text(f'// Written by sync.py from .env; the publishable key only reads what the database policies allow.\nconst SUPABASE = {json.dumps(config)};\n')


def iso(wall):
    return datetime.fromtimestamp(wall, timezone.utc).isoformat()


class Supabase:
    def __init__(self, env):
        self.url = f"https://{env['SUPABASE_PROJECT_ID']}.supabase.co/rest/v1/"
        self.key = env['SUPABASE_SECRET_KEY']

    def request(self, method, path, body=None, prefer=None):
        request = urllib.request.Request(
            self.url + path, method=method, data=json.dumps(body).encode() if body is not None else None,
            headers={'apikey': self.key, 'Content-Type': 'application/json', **({'Prefer': prefer} if prefer else {})},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            content = response.read()
        return json.loads(content) if content else None

    def select_all(self, path):
        # The Data API returns at most 1000 rows per request.
        rows = []
        while True:
            page = self.request('GET', f'{path}&limit={BATCH_ROWS}&offset={len(rows)}')
            rows += page
            if len(page) < BATCH_ROWS:
                return rows

    def upsert(self, table, rows, on_conflict, ignore_duplicates=False):
        prefer = f"resolution={'ignore' if ignore_duplicates else 'merge'}-duplicates,return=minimal"
        for i in range(0, len(rows), BATCH_ROWS):
            self.request('POST', f'{table}?on_conflict={on_conflict}', rows[i:i + BATCH_ROWS], prefer)


class GameSync:
    def __init__(self, db, game):
        self.db, self.game = db, game
        self.dir = PROJECT_DIR / 'data' / game
        # Loaded from the database on the first sync, so the script can start offline.
        self.uploaded_lines = None
        self.jobs = None
        self.refuels = None
        self.names = {}
        self.jobs_dirty = True

    def load_state(self):
        lines = {}
        for table in RAW_TABLES:
            rows = self.db.request('GET', f'{table}?game=eq.{self.game}&select=seq&order=seq.desc&limit=1')
            lines[table] = rows[0]['seq'] if rows else 0
        self.jobs = {r['id']: None for r in self.db.select_all(f'jobs?game=eq.{self.game}&source=eq.plugin&select=id&order=id')}
        self.refuels = {r['wall']: None for r in self.db.select_all(f'refuels?game=eq.{self.game}&select=wall&order=wall')}
        self.uploaded_lines = lines

    def upload_lines(self, table):
        path = self.dir / f'{table}.jsonl'
        if not path.exists():
            return 0
        text = path.read_text()
        # The plugin may be just writing the last line.
        lines = text[:text.rfind('\n') + 1].splitlines()
        start = self.uploaded_lines[table]
        rows = []
        for seq, line in enumerate(lines[start:], start + 1):
            e = json.loads(line)
            rows.append({'game': self.game, 'seq': seq, 'wall': iso(e['wall']), 'game_time': e.get('game_time'), 'data': e, **({'type': e['type']} if table == 'events' else {})})
        if rows:
            self.db.upsert(table, rows, 'game,seq', ignore_duplicates=True)
            self.uploaded_lines[table] += len(rows)
        return len(rows)

    def sync_jobs(self):
        names = {**{kind: read_names(names_path(self.game, kind)) for kind in NAME_KINDS}, 'trucks': {}}
        jobs = {j['id']: {'game': self.game, 'source': 'plugin', **{c: j[c] for c in JOB_COLUMNS}} for j in telemetry_jobs(self.dir, names)}
        changed = [row for job_id, row in jobs.items() if self.jobs.get(job_id) != row]
        if changed:
            self.db.upsert('jobs', changed, 'game,id')
        gone = self.jobs.keys() - jobs.keys()
        if gone:
            ids = ','.join(json.dumps(job_id) for job_id in gone)
            self.db.request('DELETE', f'jobs?game=eq.{self.game}&source=eq.plugin&id=in.({urllib.parse.quote(ids)})', prefer='return=minimal')
        self.jobs = jobs
        name_rows = {(kind, name_id): name for kind, by_id in names.items() for name_id, name in by_id.items()}
        changed_names = [{'game': self.game, 'kind': kind, 'id': name_id, 'name': name} for (kind, name_id), name in name_rows.items() if self.names.get((kind, name_id)) != name]
        if changed_names:
            self.db.upsert('names', changed_names, 'game,kind,id')
        self.names = name_rows
        return len(changed), len(gone)

    def sync_refuels(self):
        found, _ = tank_prices(self.game, read_jsonl(self.dir / 'trace.jsonl'), read_jsonl(self.dir / 'events.jsonl'))
        refuels = {}
        for r in found:
            row = {'game': self.game, 'wall': iso(r['wall']), 'game_time': r['game_time'], 'truck': r['vehicle'][0].removeprefix('vehicle.') if r['vehicle'] and r['vehicle'][0] else None,
                   'litres': r['litres'], 'country': r['country'], 'garage': r['garage'], 'price': r['price']}
            refuels[row['wall']] = row
        changed = [row for wall, row in refuels.items() if self.refuels.get(wall) != row]
        if changed:
            self.db.upsert('refuels', changed, 'game,wall')
        gone = self.refuels.keys() - refuels.keys()
        if gone:
            walls = ','.join(json.dumps(wall) for wall in gone)
            self.db.request('DELETE', f'refuels?game=eq.{self.game}&wall=in.({urllib.parse.quote(walls)})', prefer='return=minimal')
        self.refuels = refuels

    def sync(self):
        if self.uploaded_lines is None:
            self.load_state()
        uploaded = {table: self.upload_lines(table) for table in RAW_TABLES}
        if any(uploaded.values()):
            self.jobs_dirty = True
        if not self.jobs_dirty:
            return
        try:
            changed, gone = self.sync_jobs()
            self.sync_refuels()
        except json.JSONDecodeError:
            # build.py reads the whole files, the plugin may be just writing the last line; next sync tries again.
            return
        self.jobs_dirty = False
        if any(uploaded.values()) or changed or gone:
            print(f"{time.strftime('%H:%M:%S')} {self.game}: +{uploaded['events']} events, +{uploaded['trace']} trace points, {changed} jobs updated, {gone} removed")


def main():
    env = read_env()
    write_page_config(env)
    db = Supabase(env)
    syncs = [GameSync(db, game) for game in GAMES]
    print(f"Syncing {', '.join(GAMES)} to Supabase every {SYNC_INTERVAL_S} s, Ctrl+C stops.")
    try:
        while True:
            for s in syncs:
                try:
                    s.sync()
                except urllib.error.HTTPError as e:
                    print(f"{time.strftime('%H:%M:%S')} {s.game}: {e} {e.read().decode()}")
                except (urllib.error.URLError, OSError) as e:
                    print(f"{time.strftime('%H:%M:%S')} {s.game}: {e}, retrying")
            time.sleep(SYNC_INTERVAL_S)
    except KeyboardInterrupt:
        print('Stopped.')


if __name__ == '__main__':
    main()
