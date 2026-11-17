#!/usr/bin/env python3
"""Builds page/data-<game>.js (used by the pages in page/) from the latest save of the profile and the virtualtruck plugin output."""

import json
import re
import subprocess
import zlib
from pathlib import Path

PROFILE = 'andros'
PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path.home() / 'Library/Application Support/virtualtruck/data'
STEAM_GAMES_DIR = Path.home() / 'Library/Application Support/Steam/steamapps/common'
# Keys are the game ids the virtualtruck plugin names its data directories after.
GAMES = {
    'ats': {'install_dir': STEAM_GAMES_DIR / 'American Truck Simulator', 'user_dir': Path.home() / 'Library/Application Support/American Truck Simulator'},
    'eut2': {'install_dir': STEAM_GAMES_DIR / 'Euro Truck Simulator 2', 'user_dir': Path.home() / 'Library/Application Support/Euro Truck Simulator 2'},
}
SII_KEY = '2a5fcb1791d22fb60245b3d8369ed0b2c27371563fbf1f3c9edf6b11825a5d0a'
TRACE_POINTS_MAX = 500
SPEEDING_TOLERANCE_MS = 0.447  # 1 mph
# Between two trace points (5 s apart) normally passes at most about a game minute (ATS ~0.9, ETS2 ~0.5).
BREAK_MIN_GAME_MINUTES = 10
WEAR_FIELDS = ('wear_engine', 'wear_transmission', 'wear_cabin', 'wear_chassis', 'wear_wheels', 'trailer_wear_body', 'trailer_wear_chassis', 'trailer_wear_wheels')
DAMAGE_FIELDS = ('cargo_damage',) + WEAR_FIELDS
# Wear also grows slowly with distance; only a bigger jump between two trace points (5 s) counts as damage in the timeline (a crash in ETS2 added 1.5 %).
DAMAGE_EVENT_MIN = 0.001
JOB_KINDS = {'job': 'truck', 'car_job': 'car', 'bus_job': 'bus'}
# WoT jobs have a real-time deadline, the SDK sends this instead.
NO_DEADLINE = 4294967295
REFUEL_MIN_L = 0.1
# Refuelling happens standing; a bigger odometer change means another vehicle or a loaded save.
REFUEL_MAX_KM = 1
# Fuel added farther from a pump or garage (e.g. 10 l at once in the middle of nowhere, ATS) is not a purchase at the pump price.
REFUEL_PLACE_MAX_M = 500
# fuel_discount_in_garage in both games; refuelling is only possible in an own garage.
GARAGE_FUEL_DISCOUNT = 0.15
# Jobs taken before 2026-11-16 only feed the value of the fuel in the tank.
FUEL_COST_SINCE = 1794783600
# The cancel event of a bus job is not known yet (SDK 1.16 does not document bus job events).
JOB_END_EVENTS = {'job.delivered': 'job', 'job.cancelled': 'job', 'car_job.delivered': 'car_job', 'car_job.cancelled': 'car_job', 'bus_job.completed': 'bus_job'}


def latest_save(game):
    """None when the profile has no local save (yet)."""
    saves = [s for profiles in ('profiles', 'steam_profiles') for s in (GAMES[game]['user_dir'] / profiles / PROFILE.encode().hex().upper() / 'save').glob('*/game.sii')]
    return max(saves, key=lambda p: p.stat().st_mtime, default=None)


def read_sii(path):
    raw = path.read_bytes()
    if raw.startswith(b'ScsC'):
        iv = raw[36:52].hex()
        decrypted = subprocess.run(
            ['openssl', 'enc', '-d', '-aes-256-cbc', '-K', SII_KEY, '-iv', iv],
            input=raw[56:], capture_output=True, check=True,
        ).stdout
        raw = zlib.decompress(decrypted)
    if raw.startswith(b'BSII'):
        raise ValueError(f'{path} is in binary format; set uset g_save_format "2" in config.cfg and save the game again.')
    return raw.decode('utf-8', 'replace')


def names_path(game, kind):
    return PROJECT_DIR / 'names' / game / f'{kind}.json'


def read_names(path):
    return json.loads(path.read_text()) if path.exists() else {}


def save_jobs(sii):
    jobs = []
    for body in re.findall(r'^delivery_log_entry : \S+ \{\n(.*?)^\}', sii, re.S | re.M):
        p = {int(k): v.strip('"') for k, v in re.findall(r'^ params\[(\d+)\]: (.*)$', body, re.M)}
        if not p[1]:
            continue
        src_company, src_city = p[1].split('.')[-2:]
        dst_company, dst_city = p[2].split('.')[-2:]
        jobs.append({
            'kind': 'truck',
            'game_time': int(p[0]),
            'src_company': src_company, 'src_city': src_city,
            'dst_company': dst_company, 'dst_city': dst_city,
            'cargo': p[3].removeprefix('cargo.'),
            'xp': int(p[4]), 'revenue': int(p[5]), 'km': int(p[6]),
            'truck': p[16].removeprefix('vehicle.'),
            'mass': float(p[22]), 'units': int(p[23]),
            'status': 'delivered',
        })
    return jobs


def save_depots(sii):
    """All depots of the game economy by city, including those I never delivered from or to."""
    depots = {}
    for company, city in re.findall(r'^company : company\.volatile\.(\w+)\.(\w+) \{', sii, re.M):
        depots.setdefault(city, []).append(company)
    return {city: sorted(companies) for city, companies in depots.items()}


def save_car_jobs(sii):
    jobs = []
    for body in re.findall(r'^car_job_log_entry : \S+ \{\n(.*?)^\}', sii, re.S | re.M):
        p = {k: v.strip('"') for k, v in re.findall(r'^ (\w+): (.*)$', body, re.M)}
        src_company, src_city = p['source'].split('.')[-2:]
        dst_company, dst_city = p['destination'].split('.')[-2:]
        jobs.append({
            'kind': 'car',
            'game_time': int(p['end_time']),
            'src_company': src_company, 'src_city': src_city,
            'dst_company': dst_company, 'dst_city': dst_city,
            'cargo': p['cargo'] or None,
            'xp': 0, 'revenue': int(p['reward']), 'km': int(p['travelled_distance']),
            'truck': p['assigned_car'].removeprefix('vehicle.'),
            'mass': None, 'units': None,
            'status': 'delivered' if p['type'] == 'finished_job' else p['type'],
            'car': {
                'rating': int(p['rating_lvl']),
                'satisfaction': {'cargo': int(p['cargo_satisfaction']), 'time': int(p['time_satisfaction']), 'car': int(p['car_satisfaction'])},
                'priority': {'cargo': p['customer_prio_cargo_handling'] == 'true', 'time': p['customer_prio_time'] == 'true', 'car': p['customer_prio_vehicle_appearance'] == 'true'},
                'job_type': p['job_type'],
                'provisional_reward': int(p['provisional_reward']),
                'fines': int(p['fines']),
            },
        })
    return jobs


def read_jsonl(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def tank_prices(game, trace, events):
    """Refuels, and the average purchase price per litre of the fuel in the tank at each trace point (wall -> price), per vehicle; None until the vehicle's first refuel."""
    places = json.loads(names_path(game, 'fuel_places').read_text()) if names_path(game, 'fuel_places').exists() else []
    prices = {c['id']: c['price'] for c in json.loads(names_path(game, 'fuel_prices').read_text())} if names_path(game, 'fuel_prices').exists() else {}
    vehicles = [(e['wall'], e['attrs'].get('id'), e['attrs'].get('license.plate')) for e in events if e['type'] == 'truck']
    tanks, result, refuels, prev, v = {}, {}, [], None, 0
    for p in trace:
        while v < len(vehicles) and vehicles[v][0] <= p['wall']:
            v += 1
        vehicle = vehicles[v - 1][1:] if v else None
        tank = tanks.setdefault(vehicle, {'litres': p['fuel'], 'price': None})
        added = p['fuel'] - tank['litres']
        standing = prev is not None and 0 <= p['odometer'] - prev['odometer'] <= REFUEL_MAX_KM and (p['game_time'] or 0) >= (prev['game_time'] or 0)
        if added >= REFUEL_MIN_L and standing and places:
            x, z, country, garage = min(places, key=lambda c: (c[0] - p['x']) ** 2 + (c[1] - p['z']) ** 2)
            if (x - p['x']) ** 2 + (z - p['z']) ** 2 <= REFUEL_PLACE_MAX_M ** 2:
                price = prices[country] * (1 - GARAGE_FUEL_DISCOUNT if garage else 1)
                old = tank['price'] if tank['price'] is not None else price
                tank['price'] = (max(0, tank['litres']) * old + added * price) / (max(0, tank['litres']) + added)
                # The fuel gauge may take two trace points to fill up.
                if refuels and refuels[-1]['last_wall'] == prev['wall'] and refuels[-1]['vehicle'] == vehicle:
                    refuels[-1]['litres'] = round(refuels[-1]['litres'] + added, 2)
                    refuels[-1]['last_wall'] = p['wall']
                else:
                    refuels.append({'wall': p['wall'], 'last_wall': p['wall'], 'game_time': p['game_time'], 'vehicle': vehicle, 'litres': round(added, 2), 'country': country, 'garage': garage, 'price': price})
        tank['litres'] = p['fuel']
        result[p['wall']] = tank['price']
        prev = p
    return refuels, result


def job_points(trace, start, end, suspensions):
    """Trace points of a job without its suspensions, each with km driven since the job start and resumed=True right after a suspension."""
    points, km = [], 0
    for p in trace:
        if not start <= p['wall'] <= end or any(s['from'] < p['wall'] < s['to'] for s in suspensions):
            continue
        # A loaded save rewinds game time; the drive after the saved moment never happened.
        if points and p['game_time'] and points[-1]['game_time'] and points[-1]['game_time'] > p['game_time']:
            while points and points[-1]['game_time'] > p['game_time']:
                points.pop()
            km = points[-1]['km'] if points else 0
        resumed = bool(points) and any(points[-1]['wall'] <= s['from'] and s['to'] <= p['wall'] for s in suspensions)
        if points and not resumed:
            km += p['odometer'] - points[-1]['odometer']
        points.append({**p, 'km': round(km, 1), 'resumed': resumed})
    return points


def pairs(points):
    """Consecutive trace points, except the two around a suspension of the job."""
    return [(a, b) for a, b in zip(points, points[1:]) if not b['resumed']]


def time_jumps(points):
    """Game time jumps between two trace points: rests, sleeps, loading, ferry and train rides."""
    for a, b in pairs(points):
        # Plugin < 1.2.0 wrote 0 instead of null before the first game time arrived.
        if a['game_time'] and b['game_time'] and b['game_time'] - a['game_time'] >= BREAK_MIN_GAME_MINUTES:
            yield a, b


def job_start_key(config, job_id, attrs):
    if job_id:
        return job_id
    # Plugin < 1.5.0 has no job id. cargo.loaded changes during a job with an own trailer and the plugin logs a new config line for it.
    return (config, json.dumps({k: v for k, v in attrs.items() if k != 'cargo.loaded'}, sort_keys=True))


def approach(points, loaded):
    """Drive without cargo: to loading into an own trailer, or to the first trace point with the company trailer connected."""
    if loaded:
        kind = 'loading'
        i = next((i for i, p in enumerate(points) if p['wall'] >= loaded['wall']), None)
    else:
        kind = 'trailer'
        i = next((i for i, p in enumerate(points) if p.get('trailer_connected')), None)
    if not i:
        return None
    return {
        'kind': kind,
        'index': i,
        'km': points[i]['km'],
        # The trace point after loading already includes the game time the loading took.
        'minutes': ((loaded or points[i])['game_time'] or 0) - (points[0]['game_time'] or 0),
    }


def damage_jumps(points):
    for a, b in pairs(points):
        jump = {f: round(b[f] - a[f], 4) for f in DAMAGE_FIELDS if a.get(f) is not None and b.get(f) is not None and b[f] - a[f] >= DAMAGE_EVENT_MIN}
        if jump:
            yield b, jump


def wear(points):
    """Wear added during the job (plugin >= 1.5.0), without the suspensions."""
    added = {}
    for f in WEAR_FIELDS:
        steps = [b[f] - a[f] for a, b in pairs(points) if a.get(f) is not None and b.get(f) is not None]
        if steps:
            added[f] = round(sum(steps), 4)
    return added or None


def bus_stages(a):
    """Stages of a bus job (plugin >= 1.7.0); times are absolute game minutes, the actual ones only once they happened."""
    def stop(prefix, i):
        return {k: a.get(f'{prefix}.{k}[{i}]') for k in ('type', 'id', 'name')}
    return [{
        'from': stop('source_stop', i), 'to': stop('destination_stop', i),
        'departure': {'planned': a.get(f'source_stop.departure_time.planned[{i}]'), 'actual': a.get(f'source_stop.departure_time.actual[{i}]')},
        'arrival': {'planned': a.get(f'destination_stop.arrival_time.planned[{i}]'), 'actual': a.get(f'destination_stop.arrival_time.actual[{i}]')},
        'entering': a.get(f'source_stop.entering_passengers.planned[{i}]'),
        'leaving': a.get(f'destination_stop.leaving_passengers.planned[{i}]'),
    } for i in range(a.get('bus.stages.count', 0))]


def timeline(points, start, end, loaded, incidents, transports, suspensions, stages):
    def at(wall, game_time):
        before = [p for p in points if p['wall'] <= wall]
        return {'wall': wall, 'game_time': game_time, 'km': before[-1]['km'] if before else 0}

    def at_game_time(game_time):
        reached = next((p for p in points if p['game_time'] and p['game_time'] >= game_time), None)
        return at(reached['wall'] if reached else end['wall'], game_time)

    first, last = (points[0], points[-1]) if points else ({}, {})
    entries = [{**at(start['wall'], start['game_time'] or first.get('game_time')), 'type': 'start', 'rest_stop': first.get('rest_stop'), 'mandatory_break': first.get('mandatory_break')}]
    connected = next((i for i, p in enumerate(points) if p.get('trailer_connected')), None)
    if connected:
        p = points[connected]
        entries.append({**at(p['wall'], p['game_time']), 'type': 'trailer'})
    loading_jump = None
    if loaded:
        loading_jump = next(((a, b) for a, b in time_jumps(points) if a['wall'] <= loaded['wall'] <= b['wall']), None)
        entries.append({**at(loaded['wall'], loaded['game_time']), 'type': 'loaded', 'minutes': loading_jump[1]['game_time'] - loading_jump[0]['game_time'] if loading_jump else None})
    for a, b in time_jumps(points):
        if (a, b) == loading_jump or any(a['wall'] <= t <= b['wall'] for t in transports):
            continue
        # The game skips the wait for a bus departure.
        departure = next((s for s in stages if s['departure']['actual'] and a['game_time'] < s['departure']['actual'] <= b['game_time']), None)
        entries.append({**at(b['wall'], a['game_time']), 'type': 'wait' if departure else 'break', 'minutes': b['game_time'] - a['game_time'], **({'stop': departure['from']['name']} if departure else {})})
    # Taking a bus job skips the wait for its first departure already before the first trace point of the job.
    if stages and points and start['game_time'] and stages[0]['departure']['actual'] and start['game_time'] < stages[0]['departure']['actual'] <= points[0]['game_time']:
        entries.append({**at(points[0]['wall'], start['game_time']), 'type': 'wait', 'minutes': points[0]['game_time'] - start['game_time'], 'stop': stages[0]['from']['name']})
    for s in stages:
        if s['departure']['actual']:
            entries.append({**at_game_time(s['departure']['actual']), 'type': 'departure', 'stop': s['from']['name']})
        if s['arrival']['actual']:
            late = s['arrival']['actual'] - s['arrival']['planned'] if s['arrival']['planned'] is not None else None
            entries.append({**at_game_time(s['arrival']['actual']), 'type': 'arrival', 'stop': s['to']['name'], 'late': late if late and late > 0 else None})
    for a, b in zip(points, points[1:]):
        if b['resumed']:
            entries.append({**at(a['wall'], a['game_time']), 'type': 'suspended', 'minutes': b['game_time'] - a['game_time'], 'resumed_wall': b['wall']})
    for p, jump in damage_jumps(points):
        entries.append({**at(p['wall'], p['game_time']), 'type': 'damage', 'damage': jump})
    for i in incidents:
        ride = next(((a, b) for a, b in time_jumps(points) if a['wall'] <= i['wall'] <= b['wall']), None) if i['wall'] in transports else None
        entries.append({**at(i['wall'], i['game_time']), 'type': 'incident', 'id': i['id'], 'attrs': i['attrs'], **({'minutes': ride[1]['game_time'] - ride[0]['game_time']} if ride else {})})
    late = end['game_time'] - end['deadline'] if end['type'] == 'delivered' and end['deadline'] is not None and end['game_time'] is not None else None
    entries.append({**at(end['wall'], end['game_time']), 'type': end['type'], 'rest_stop': last.get('rest_stop'), 'mandatory_break': last.get('mandatory_break'), 'late': late if late and late > 0 else None})
    return sorted(entries, key=lambda e: (e['wall'], e['type'] != 'start'))


def trace_summary(points, loaded, tank_price):
    if not points:
        return None
    moving = [p['speed'] for p in points if p['speed'] > 1]
    burned = [(a['fuel'] - b['fuel'], tank_price.get(a['wall'])) for a, b in pairs(points) if a['fuel'] > b['fuel']]
    fuel_used = sum(litres for litres, _ in burned)
    fuel_cost = None if points[0]['wall'] < FUEL_COST_SINCE or any(price is None for _, price in burned) else round(sum(litres * price for litres, price in burned))
    # Points recorded by plugin < 1.2.0 have no speed limit; the game also sends 0 and -1 (meaning unknown).
    limited = [p for p in points if (p.get('speed_limit') or 0) > 0 and p['speed'] > 1]
    over = [p['speed'] - p['speed_limit'] for p in limited if p['speed'] > p['speed_limit'] + SPEEDING_TOLERANCE_MS]
    step = max(1, len(points) // TRACE_POINTS_MAX)
    to_trailer = approach(points, loaded)
    if to_trailer:
        to_trailer['path_index'] = to_trailer['index'] // step
    return {
        'driven_km': points[-1]['km'],
        'max_kmh': round(max(p['speed'] for p in points) * 3.6),
        'avg_kmh': round(sum(moving) / len(moving) * 3.6) if moving else 0,
        'fuel_used': round(fuel_used),
        'fuel_cost': fuel_cost,
        # Plugin >= 1.9.0; the truck computer's average in l/km when the job ended, the game decides when it resets.
        'onboard_consumption': next((p['fuel_consumption'] for p in reversed(points) if p.get('fuel_consumption') is not None), None),
        'speeding_pct': round(100 * len(over) / len(limited)) if limited else None,
        'max_over_kmh': round(max(over) * 3.6) if over else 0,
        'approach': to_trailer,
        'wear': wear(points),
        'wear_end': {f: round(points[-1][f], 4) for f in WEAR_FIELDS if not f.startswith('trailer_') and points[-1].get(f) is not None} or None,
        'path': [[round(p['x']), round(p['z'])] for p in points[::step]],
    }


def suspension_start(trace, state, until):
    """Last trace point of the job with a trailer: suspending an external job with a company trailer removes the trailer (ATS and ETS2, 2026-10-25)."""
    since = state['suspensions'][-1]['to'] if state['suspensions'] else state['wall']
    walls = [p['wall'] for p in trace if since <= p['wall'] <= until and p.get('trailer_connected') is not None]
    return walls[-1] if walls else since


def telemetry_job(trace, tank_price, incidents, transports, names, config, job_id, state, a, r, end, truck, trailers):
    start, loaded, suspensions = state['wall'], state['loaded'], state['suspensions']
    points = job_points(trace, start, end['wall'], suspensions)
    job_incidents = [i for i in incidents if start <= i['wall'] <= end['wall'] and not any(s['from'] < i['wall'] < s['to'] for s in suspensions)]
    deadline = a.get('delivery.time') if a.get('delivery.time') != NO_DEADLINE else None
    # Special transport jobs have no company attributes (see SDK docs of the job configuration).
    for kind, prefix in (('companies', 'source.company'), ('companies', 'destination.company'), ('cities', 'source.city'), ('cities', 'destination.city'), ('cargo', 'cargo')):
        if a.get(f'{prefix}.id') and a.get(prefix):
            names[kind].setdefault(a[f'{prefix}.id'], a[prefix])
    if truck:
        names['trucks'][truck['id'].removeprefix('vehicle.')] = f"{truck['brand']} {truck['name']}"
    stages = bus_stages(a) if config == 'bus_job' else []
    for stop in [s['from'] for s in stages] + [s['to'] for s in stages]:
        if stop['type'] == 'city' and stop['id'] and stop['name']:
            names['cities'].setdefault(stop['id'], stop['name'])
    finished = end['type'] in ('delivered', 'cancelled')
    return {
        # Plugin < 1.5.0 has no job id; the plugin's id is the wall time of the job start too.
        'id': job_id or str(start),
        'kind': JOB_KINDS[config],
        'game_time': end['game_time'] or state['game_time'] or 0,
        'src_company': a.get('source.company.id'), 'src_city': stages[0]['from']['id'] if stages else a.get('source.city.id'),
        'dst_company': a.get('destination.company.id'), 'dst_city': stages[-1]['to']['id'] if stages else a.get('destination.city.id'),
        'cargo': a.get('cargo.id'),
        'xp': r.get('earned.xp', 0) if finished else None,
        'revenue': r.get('revenue', -r.get('cancel.penalty', 0)) if finished else None,
        'km': round(r.get('distance.km', a.get('planned_distance.km', 0))) if finished else None,
        'truck': truck['id'].removeprefix('vehicle.') if truck else None, 'mass': a.get('cargo.mass', 0), 'units': a.get('cargo.unit.count', 0),
        'status': end['type'],
        'telemetry': {
            'start': start, 'end': end['wall'],
            'market': a.get('job.market') or a.get('car_job.market') or a.get('bus_job.market'),
            'planned_km': a.get('planned_distance.km'),
            'deadline': deadline,
            'cargo_damage': r.get('cargo.damage'),
            'vehicle_damage': r.get('vehicle.damage'),
            'trailers': trailers,
            # Plugin >= 1.8.0; litres.
            'fuel_capacity': truck.get('fuel.capacity') if truck else None,
            'auto_park': r.get('auto.park.used'), 'auto_load': r.get('auto.load.used'),
            'incidents': [{'id': i['id'], 'attrs': i['attrs']} for i in job_incidents],
            'trace': trace_summary(points, loaded, tank_price),
            'timeline': timeline(points, state, {**end, 'deadline': deadline}, loaded, job_incidents, transports, suspensions, stages),
            **({'bus': {'satisfaction': r.get('passenger.satisfaction'), 'stages': stages}} if config == 'bus_job' else {}),
        },
    }


def telemetry_jobs(plugin_dir, names):
    events = read_jsonl(plugin_dir / 'events.jsonl')
    trace = read_jsonl(plugin_dir / 'trace.jsonl')
    _, tank_price = tank_prices(plugin_dir.name, trace, events)
    incidents = [e for e in events if e['type'] == 'gameplay' and e['id'].startswith('player.')]
    transports = [e['wall'] for e in incidents if e['id'] in ('player.use.ferry', 'player.use.train')]
    started, jobs = {}, []
    truck = None
    for e in events:
        if e['type'] == 'truck':
            truck = e['attrs']
            for state in started.values():
                if not state['suspended']:
                    state['truck'] = e['attrs']
            continue
        if e['type'] == 'trailer' and e['index'] == 0:
            for state in started.values():
                if state['suspended']:
                    continue
                state['trailers'] = [e['attrs']]
                if e['attrs'].get('cargo.accessory.id'):
                    state['trailer_cargo'] = True
                # Suspending an external job with an own trailer removes the cargo from the trailer (seen once, 2026-10-25); trailers without a cargo model never have it.
                elif state['trailer_cargo'] and state['config'] == 'job' and state['cargo_loaded']:
                    state['unloaded_at'] = e['wall']
            continue
        if e['type'] in JOB_KINDS:
            job_id = e.get(f"{e['type']}_id")
            key = job_start_key(e['type'], job_id, e['attrs'])
            # An external job is suspended by taking another job and resumed later with its own config again (plugin >= 1.6.0 keeps its id).
            for other_key, other in started.items():
                if other_key != key and other['config'] == e['type'] and not other['suspended']:
                    other['suspended'] = {'from': other['unloaded_at'] or suspension_start(trace, other, e['wall'])}
            state = started.setdefault(key, {'wall': e['wall'], 'game_time': e['game_time'], 'unloaded': False, 'loaded': None, 'config': e['type'], 'id': job_id, 'suspended': None, 'suspensions': [], 'trailers': [], 'trailer_cargo': False, 'truck': truck})
            state['attrs'] = e['attrs']
            state['cargo_loaded'] = e['attrs'].get('cargo.loaded')
            state['unloaded_at'] = None
            if state['suspended']:
                state['suspensions'].append({**state['suspended'], 'to': e['wall']})
                state['suspended'] = None
            if e['attrs'].get('cargo.loaded') is False:
                state['unloaded'] = True
            elif e['attrs'].get('cargo.loaded') and state['unloaded'] and not state['loaded']:
                state['loaded'] = {'wall': e['wall'], 'game_time': e['game_time']}
            continue
        config = JOB_END_EVENTS.get(e['id']) if e['type'] == 'gameplay' else None
        if not config or not e.get(config):
            continue
        job_id = e.get(f'{config}_id')
        state = started.pop(job_start_key(config, job_id, e[config]), None) or {'wall': e['wall'], 'game_time': e['game_time'], 'loaded': None, 'suspensions': []}
        end = {'wall': e['wall'], 'game_time': e['game_time'], 'type': 'cancelled' if e['id'].endswith('.cancelled') else 'delivered'}
        jobs.append(telemetry_job(trace, tank_price, incidents, transports, names, config, job_id, state, e[config], e['attrs'], end, e.get('truck'), e.get('trailers') or []))
    for state in started.values():
        if state['suspended']:
            last = next((p for p in reversed(trace) if p['wall'] <= state['suspended']['from']), {})
            end = {'wall': state['suspended']['from'], 'game_time': last.get('game_time'), 'type': 'suspended'}
        else:
            last = next((p for p in reversed(trace) if p['wall'] >= state['wall']), None)
            end = {'wall': last['wall'] if last else state['wall'], 'game_time': last['game_time'] if last else state['game_time'], 'type': 'running'}
        jobs.append(telemetry_job(trace, tank_price, incidents, transports, names, state['config'], state['id'], state, state['attrs'], {}, end, state['truck'], state['trailers']))
    return jobs


def job_key(job):
    # Car jobs without cargo (e.g. driving a car to a dealer) may differ in the cargo id between save and telemetry.
    cargo = job['cargo'] if job['kind'] == 'truck' else None
    return (job['kind'], job['src_company'], job['src_city'], job['dst_company'], job['dst_city'], cargo, job['revenue'])


def build(game):
    save = latest_save(game)
    names = {**{kind: read_names(names_path(game, kind)) for kind in ('companies', 'cities', 'cargo')}, 'trucks': {}}
    try:
        sii = read_sii(save) if save else ''
    except ValueError as e:
        print(f'{game}: {e} Using the plugin data only.')
        save, sii = None, ''
    jobs = save_jobs(sii) + save_car_jobs(sii)
    by_key = {job_key(j): j for j in jobs}
    for t in telemetry_jobs(DATA_DIR / game, names):
        match = by_key.get(job_key(t)) if t['status'] == 'delivered' else None
        if match:
            match['id'] = t['id']
            match['telemetry'] = t['telemetry']
        else:
            jobs.append(t)
    jobs.sort(key=lambda j: j['game_time'], reverse=True)

    output = PROJECT_DIR / f'page/data-{game}.js'
    output.write_text('const DATA = ' + json.dumps({'game': game, 'save': str(save) if save else None, 'jobs': jobs, 'depots': save_depots(sii), 'names': names}, ensure_ascii=False) + ';\n')
    print(f'{output} ({len(jobs)} jobs, {sum("telemetry" in j for j in jobs)} with telemetry, save {save or "none"})')


def main():
    for game in GAMES:
        build(game)


if __name__ == '__main__':
    main()
