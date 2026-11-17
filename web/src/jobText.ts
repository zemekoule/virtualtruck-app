import { type Format, minutes, percent } from './format';
import type { BusStop, Job, TimelineEntry, Trailer } from './types';

const OFFENCES: Record<string, string> = {
	crash: 'nehoda', avoid_sleeping: 'nedodržení odpočinku', wrong_way: 'jízda v protisměru',
	speeding_camera: 'překročení rychlosti (radar)', no_lights: 'jízda bez světel', red_signal: 'jízda na červenou',
	speeding: 'překročení rychlosti', avoid_weighing: 'vyhnutí se vážení', illegal_trailer: 'nepovolený návěs',
	avoid_inspection: 'vyhnutí se kontrole', illegal_border_crossing: 'nepovolený přejezd hranice',
	hard_shoulder_violation: 'jízda po krajnici', damaged_vehicle_usage: 'jízda s poškozeným vozidlem', generic: 'přestupek',
};

const MARKETS: Record<string, [string, string]> = {
	freight_market: ['interní', 'trh s náklady, návěs firmy'],
	cargo_market: ['interní', 'trh s nákladem, vlastní návěs'],
	quick_job: ['interní', 'rychlá zakázka'],
	external_contracts: ['externí (WoT)', 'kontrakty World of Trucks'],
	external_market: ['externí (WoT)', 'trh World of Trucks, vlastní návěs'],
};
const CAR_MARKETS: Record<string, string> = { quick_job: 'rychlá zakázka', dispatch_job: 'dispečink' };
const BUS_MARKETS: Record<string, string> = { company_job: 'linka', tourist_job: 'zájezd' };

export const market = (j: Job): [string, string] => {
	const m = j.telemetry?.market;
	if (j.kind === 'car') return ['osobní doprava', (m && CAR_MARKETS[m]) ?? m ?? '—'];
	if (j.kind === 'bus') return ['autobus', (m && BUS_MARKETS[m]) ?? m ?? '—'];
	return (m ? MARKETS[m] : undefined) ?? [m ?? '—', m ?? '—'];
};
export const isExternal = (j: Job) => !!j.telemetry?.market?.startsWith('external_');

export const SATISFACTION = { cargo: 'náklad', time: 'čas', car: 'vzhled vozidla' } as const;
export const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));

// All stops of a bus job in order: the departure stop and the destination of every stage.
export const busStops = (j: Job): BusStop[] => {
	const stages = j.telemetry?.bus?.stages ?? [];
	return stages.length ? [stages[0].from, ...stages.map(s => s.to)] : [];
};
export const passengers = (j: Job) => (j.telemetry?.bus?.stages ?? []).reduce((sum, s) => sum + (s.entering ?? 0), 0);

const paid = (j: Job, id: string, field: string) => (j.telemetry?.incidents ?? []).filter(i => i.id === id).reduce((s, i) => s + Number(i.attrs[field]), 0);
export const fines = (j: Job) => paid(j, 'player.fined', 'fine.amount');
export const costs = (j: Job) => ({
	fuel: j.telemetry?.trace?.fuel_cost ?? null,
	fines: fines(j),
	tolls: paid(j, 'player.tollgate.paid', 'pay.amount'),
	transport: paid(j, 'player.use.ferry', 'pay.amount') + paid(j, 'player.use.train', 'pay.amount'),
});
// Repairs are not in the SDK.
export const profit = (j: Job) => {
	const c = costs(j);
	return j.revenue == null || c.fuel == null ? null : j.revenue - c.fuel - c.fines - c.tolls - c.transport;
};

export const UNFINISHED = ['running', 'suspended'];

export function incidentRow(i: TimelineEntry, f: Format): [string, string] {
	const a = i.attrs ?? {};
	const route = [`${a['source.name']} → ${a['target.name']}`, i.minutes ? `${minutes(i.minutes)} herního času` : '', f.money(Number(a['pay.amount']))].filter(Boolean).join(', ');
	switch (i.id) {
		case 'player.fined': return ['Pokuta', `${OFFENCES[a['fine.offence']] ?? a['fine.offence']}, ${f.money(Number(a['fine.amount']))}`];
		case 'player.tollgate.paid': return ['Mýtné', f.money(Number(a['pay.amount']))];
		case 'player.use.ferry': return ['Trajekt', route];
		case 'player.use.train': return ['Vlak', route];
		default: return [i.id ?? '', JSON.stringify(a)];
	}
}

const remaining = (m: number | null | undefined) => m != null && m < 0 ? `překročeno o ${minutes(-m)}` : minutes(m);
const restText = (e: TimelineEntry) => e.rest_stop == null ? ''
	: e.rest_stop === e.mandatory_break ? `do přestávky ${remaining(e.rest_stop)}`
	: `do odpočinku ${remaining(e.rest_stop)}, do povinné přestávky ${remaining(e.mandatory_break)}`;

export const WEAR: Record<string, string> = {
	wear_engine: 'motor', wear_transmission: 'převodovka', wear_cabin: 'kabina', wear_chassis: 'podvozek', wear_wheels: 'kola',
	trailer_wear_body: 'návěs – nástavba', trailer_wear_chassis: 'návěs – podvozek', trailer_wear_wheels: 'návěs – kola',
};
const damageText = (fields: Record<string, number>) => Object.entries(fields).map(([k, v]) => `${k === 'cargo_damage' ? 'náklad' : WEAR[k]} +${percent(v)}`).join(', ');
export const wearText = (wear: Record<string, number>, trailer: boolean) => {
	const parts = Object.entries(wear).filter(([k, v]) => k.startsWith('trailer_') === trailer && v > 0);
	return parts.length ? parts.map(([k, v]) => `${WEAR[k].replace('návěs – ', '')} +${percent(v)}`).join(', ') : 'beze změny';
};
export const trailerText = (t: Trailer) => [[t.brand, t.name].filter(Boolean).join(' '), t['body.type'], t['license.plate']?.trim()].filter(Boolean).join(', ');

// Bus jobs: the game sends the rest countdowns too, but they do not apply to driving a bus.
export function timelineRow(e: TimelineEntry, f: Format, bus = false): [string, string] {
	const rest = (e: TimelineEntry) => bus ? '' : restText(e);
	switch (e.type) {
		case 'start': return ['Převzetí zakázky', rest(e)];
		case 'trailer': return ['Návěs připojen', ''];
		case 'loaded': return ['Naloženo', e.minutes ? `nakládka ${minutes(e.minutes)} herního času` : ''];
		case 'damage': return ['Poškození', damageText(e.damage ?? {})];
		case 'break': return ['Přestávka', `${minutes(e.minutes)} herního času`];
		case 'wait': return ['Čekání na odjezd', `${e.stop}, ${minutes(e.minutes)} herního času (hra přeskočila)`];
		case 'departure': return ['Odjezd', e.stop ?? ''];
		case 'arrival': return ['Příjezd', [e.stop, e.late ? `pozdě o ${minutes(e.late)}` : ''].filter(Boolean).join(', ')];
		case 'suspended': return ['Zakázka pozastavena', e.minutes != null ? `${minutes(e.minutes)} herního času` : ''];
		case 'running': return ['Poslední záznam', rest(e)];
		case 'incident': return incidentRow(e, f);
		case 'delivered': return ['Doručení', [e.late ? `po termínu ${minutes(e.late)}` : '', rest(e)].filter(Boolean).join(', ')];
		case 'cancelled': return ['Zrušení', rest(e)];
	}
}

export const isBad = (e: TimelineEntry) => e.id === 'player.fined' || e.type === 'damage' || !!e.late;

export function durationText(j: Job) {
	const t = j.telemetry!;
	const [first, last] = [t.timeline[0], t.timeline[t.timeline.length - 1]];
	const suspended = t.timeline.filter(e => e.type === 'suspended' && e.resumed_wall).reduce((sum, e) => sum + e.resumed_wall! - e.wall, 0);
	const real = `skutečně ${minutes(Math.round((t.end - t.start - suspended) / 60))}`;
	if (first.game_time == null || last.game_time == null) return real;
	const total = last.game_time - first.game_time;
	const stops = t.timeline.filter(e => ['break', 'loaded', 'suspended', 'incident', 'wait'].includes(e.type)).reduce((sum, e) => sum + (e.minutes ?? 0), 0);
	return stops
		? `${minutes(total - stops)} herního času bez přestávek, ${j.kind === 'bus' ? 'čekání na odjezd' : 'nakládky'}, pozastavení a přepravy (celkem ${minutes(total)}), ${real}`
		: `${minutes(total)} herního času, ${real}`;
}

export const speedingText = (speedingPct: number | null, maxOverKmh: number, f: Format) => speedingPct == null
	? 'limit nezaznamenán (plugin < 1.2.0 nebo ho hra neposílá)'
	: `${speedingPct === 0 && maxOverKmh ? 'méně než 1' : speedingPct} % jízdy s limitem${maxOverKmh ? `, nejvíc o ${f.speed(maxOverKmh)} ${f.units.speed}` : ''}`;
