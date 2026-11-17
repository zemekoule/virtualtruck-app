#!/usr/bin/env python3
"""Imports the jobs the plugin did not record and the depots from the latest save of each game to Supabase; can be run again any time."""

from collections import Counter

from build import GAMES, job_key, latest_save, read_sii, save_car_jobs, save_depots, save_jobs
from sync import JOB_COLUMNS, Supabase, read_env

SAVE_JOB_COLUMNS = tuple(c for c in JOB_COLUMNS if c not in ('id', 'telemetry')) + ('car',)


def import_game(db, game):
    save = latest_save(game)
    if not save:
        print(f'{game}: no save')
        return
    try:
        sii = read_sii(save)
    except ValueError as e:
        print(f'{game}: {e}')
        return
    existing = db.select_all(f'jobs?game=eq.{game}&select=id,source,status,kind,src_company,src_city,dst_company,dst_city,cargo,revenue&order=id')
    imported = {j['id'] for j in existing if j['source'] == 'save'}
    # Counted, so two equal jobs (same route, cargo and revenue) recorded by the plugin skip only two equal jobs of the save.
    recorded = Counter(job_key(j) for j in existing if j['source'] == 'plugin' and j['status'] == 'delivered')
    rows = []
    for j in save_jobs(sii) + save_car_jobs(sii):
        if recorded[job_key(j)]:
            recorded[job_key(j)] -= 1
            continue
        # Two jobs of one kind are never delivered in the same game minute.
        job_id = f"save-{j['kind']}-{j['game_time']}"
        if job_id not in imported:
            rows.append({'game': game, 'id': job_id, 'source': 'save', 'telemetry': None, **{c: j.get(c) for c in SAVE_JOB_COLUMNS}})
    db.upsert('jobs', rows, 'game,id', ignore_duplicates=True)
    depots = [{'game': game, 'city': city, 'company': company} for city, companies in save_depots(sii).items() for company in companies]
    db.upsert('depots', depots, 'game,city,company', ignore_duplicates=True)
    print(f'{game}: {len(rows)} jobs imported, {len(imported)} imported before, {sum(recorded.values())} plugin jobs not in the save; {len(depots)} depots; save {save}')


def main():
    db = Supabase(read_env())
    for game in GAMES:
        import_game(db, game)


if __name__ == '__main__':
    main()
