import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { canCancelByHand, setCancelledByHand } from '../api';
import { clock, fmt, gameTime, minutes, percent, useGame, wallClock, wallTime } from '../format';
import { GameMap } from '../GameMap';
import { BackIcon } from '../icons';
import { busStops, costs, durationText, isBad, isExternal, market, passengers, profit, SATISFACTION, speedingText, stars, timelineRow, trailerText, UNFINISHED, wearText } from '../jobText';
import { TimelineChart } from '../TimelineChart';
import type { BusStage, JobKind, RecordedJob, TimelineEntry } from '../types';

// With a company trailer the game always reports auto.load.used; only with an own trailer it means a skipped loading.
const OWN_TRAILER_MARKETS = ['cargo_market', 'external_market'];
const APPROACH = { trailer: 'K návěsu', loading: 'K nakládce' };
const pct = (v: number | null) => v != null ? `${(v * 100).toFixed(1)} %` : '—';
const LISTS: Record<JobKind, [string, string]> = { truck: ['zakazky', 'Zakázky'], car: ['osobni', 'Osobní doprava'], bus: ['autobusy', 'Autobusy'] };
const VEHICLE: Record<JobKind, string> = { truck: 'kamionu', car: 'auta', bus: 'autobusu' };

function Progress({ entries }: { entries: TimelineEntry[] }) {
	const { f } = useGame();
	const loadedAt = (entries.find(e => e.type === 'loaded') ?? entries.find(e => e.type === 'trailer') ?? entries.find(e => e.type === 'departure'))?.game_time;
	const bus = entries.some(e => e.type === 'departure');
	let lastGameDay: number | null = null, lastWallDay: string | null = null;
	const day = (t: number) => Math.floor(t / 1440);
	const gameTimes = (from: number, to: number) => {
		const text = `${day(from) === lastGameDay ? clock(from) : gameTime(from)}${to > from ? ` – ${day(to) === day(from) ? clock(to) : gameTime(to)}` : ''}`;
		lastGameDay = day(to);
		return text;
	};
	const rows: ReactNode[] = [];
	entries.forEach((e, i) => {
		const prev = entries[i - 1];
		// Driving since the previous entry ended (a break or loading ends after its minutes).
		const from = prev && prev.game_time != null ? prev.game_time + (prev.minutes ?? 0) : null;
		if (from != null && e.game_time != null && e.game_time - from >= 1) {
			const label = loadedAt == null || e.game_time > loadedAt ? 'Jízda' : bus ? 'Jízda bez cestujících' : 'Jízda bez nákladu';
			rows.push(
				<li key={`drive-${i}`} className="drive">
					<span className="when">{gameTimes(from, e.game_time)}</span>
					<span className="what">{label} <span className="muted">{f.dist(e.km - prev.km)} {f.units.distance}, {minutes(e.game_time - from)}</span></span>
				</li>,
			);
		}
		const [label, text] = timelineRow(e, f, bus);
		const wallDay = new Date(e.wall * 1000).toDateString();
		const wall = wallDay === lastWallDay ? wallClock(e.wall) : wallTime(e.wall, i === 0);
		lastWallDay = wallDay;
		rows.push(
			<li key={i} className={isBad(e) ? 'bad' : ''}>
				<span className="when">{e.game_time == null ? '—' : gameTimes(e.game_time, e.game_time + (e.minutes ?? 0))}</span>
				<span className="what"><b>{label}</b>{text && <span className="muted"> {text}</span>}<span className="wall">skutečně {wall}</span></span>
			</li>,
		);
	});
	return <ol className="progress">{rows}</ol>;
}

function timeDiff(actual: number | null, planned: number | null) {
	if (actual == null || planned == null) return '';
	const d = actual - planned;
	return d === 0 ? ', včas' : d < 0 ? `, o ${minutes(-d)} dřív` : `, o ${minutes(d)} později`;
}

function Stages({ stages }: { stages: BusStage[] }) {
	const { f } = useGame();
	const time = (label: string, t: { planned: number | null; actual: number | null }) => <>
		{label} {t.planned != null ? gameTime(t.planned) : '—'}
		{t.actual != null && <span className="muted">, skutečně {clock(t.actual)}<span className={t.planned != null && t.actual > t.planned ? 'bad' : ''}>{timeDiff(t.actual, t.planned)}</span></span>}
	</>;
	const name = (s: BusStage['from']) => s.name ?? f.city(s.id);
	return (
		<dl className="details">{stages.map((s, i) => (
			<div key={i}>
				<dt>{name(s.from)} → {name(s.to)}</dt>
				<dd>
					{time('odjezd', s.departure)}<br />
					{time('příjezd', s.arrival)}<br />
					<span className="muted">nastoupí {s.entering ?? '—'}, vystoupí {s.leaving ?? '—'}</span>
				</dd>
			</div>
		))}</dl>
	);
}

function Details({ j }: { j: RecordedJob }) {
	const { data, f, reload } = useGame();
	const [error, setError] = useState('');
	const t = j.telemetry;
	const cancel = (cancelled: boolean) => setCancelledByHand(data.game, j.id, cancelled).then(reload, (e: Error) => setError(e.message));
	const deadline = () => {
		if (t.deadline == null) return isExternal(j) ? 'v reálném čase (WoT), SDK ho neposílá' : '—';
		const late = t.timeline[t.timeline.length - 1].late;
		return <>{gameTime(t.deadline)}{j.status !== 'delivered' ? '' : late ? <>, <span className="bad">doručeno po termínu {minutes(late)}</span></> : ', doručeno včas'}</>;
	};
	const rows: [string, ReactNode][] = [
		['ID zakázky', j.id],
		['Typ zakázky', market(j).join(' – ')],
		['Doba jízdy', durationText(j)],
	];
	if (j.kind === 'bus') rows.push(
		['Spokojenost cestujících', t.bus?.satisfaction != null ? percent(t.bus.satisfaction) : '—'],
		['Cestující', fmt(passengers(j))],
	);
	else rows.push(['Termín', deadline()], ['Poškození nákladu', pct(t.cargo_damage)]);
	if (j.kind === 'car') {
		const c = j.car;
		rows.push(['Poškození vozidla', pct(t.vehicle_damage)]);
		if (c) rows.push(
			['Hodnocení kurýra', stars(c.rating)],
			['Spokojenost zákazníka', Object.entries(SATISFACTION).map(([k, label]) => `${label} ${c.satisfaction[k as keyof typeof SATISFACTION]}`).join(', ')],
			['Priority zákazníka', Object.entries(SATISFACTION).filter(([k]) => c.priority[k as keyof typeof SATISFACTION]).map(([, label]) => label).join(', ') || 'žádné'],
			['Odměna', `předběžná ${f.money(c.provisional_reward)}, výsledná ${f.money(j.revenue ?? 0)}`],
		);
		else rows.push(['Hodnocení', 'zatím jen z pluginu – hodnocení a spokojenost doplní save po uložení hry']);
	}
	else if (j.kind === 'truck') {
		rows.push(
			['Hmotnost', `${fmt(j.mass ?? 0)} kg`],
			...(t.trailers?.length ? [['Návěs', t.trailers.map(trailerText).join(' + ')] as [string, string]] : []),
			['Parkování', t.auto_park == null ? '—' : t.auto_park ? 'automatické (přeskočeno)' : 'ruční'],
			['Nakládka', t.auto_load == null ? '—' : !OWN_TRAILER_MARKETS.includes(t.market ?? '') ? 'návěs firmy, už naložený' : t.auto_load ? 'přeskočena' : 'ruční'],
		);
	}
	if (j.cancelledByHand) rows.push(['Zrušení', <>ručně na stránce <button className="link-button" onClick={() => cancel(false)}>Vrátit</button></>]);
	else if (canCancelByHand(j)) rows.push(['Zrušení', <><button className="link-button" onClick={() => cancel(true)}>Zrušit zakázku</button> <span className="muted">{j.kind === 'bus' ? 'událost zrušení autobusové zakázky ze SDK neznáme' : 'SDK zrušení WoT zakázky nehlásí'}</span></>]);
	rows.push(['Vzdálenost', `plán ${t.planned_km != null ? f.dist(t.planned_km) : '—'} ${f.units.distance}${j.km != null ? `, skutečně ${f.dist(j.km)} ${f.units.distance}` : ''}`]);
	if (t.trace) {
		rows.push(['Ujeto podle tachometru', `${f.dist(t.trace.driven_km)} ${f.units.distance} (od převzetí zakázky${j.kind === 'truck' ? ', včetně cesty bez nákladu' : ''})`]);
		if (t.trace.wear) {
			rows.push([`Opotřebení ${VEHICLE[j.kind]}`, wearText(t.trace.wear, false)]);
			if (j.kind === 'truck') rows.push(['Opotřebení návěsu', wearText(t.trace.wear, true)]);
		}
		const onboard = t.trace.onboard_consumption;
		rows.push(['Spotřebované palivo', `${f.volume(t.trace.fuel_used)} ${f.units.volume}`]);
		if (onboard) rows.push(['Palubní počítač', `průměrná spotřeba ${f.consumption(onboard, 1)} ${f.units.consumption}`]);
		rows.push(['Nad limitem', speedingText(t.trace.speeding_pct, t.trace.max_over_kmh, f)]);
		const c = costs(j);
		rows.push(['Náklady', [
			`palivo ${c.fuel != null ? f.money(c.fuel) : '— (cenu paliva počítám u zakázek od 16. 11. 2026 po prvním tankování vozu)'}`,
			...([['pokuty', c.fines], ['mýtné', c.tolls], ['trajekt a vlak', c.transport]] as const).filter(([, v]) => v).map(([k, v]) => `${k} ${f.money(v)}`),
		].join(', ') + ' (bez oprav, ty SDK nezná)']);
	}
	return (
		<>
			<dl className="details">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
			{error && <p className="bad">Nepovedlo se: {error}</p>}
		</>
	);
}

export function JobDetail() {
	const { data, f } = useGame();
	const { id } = useParams();
	const j = data.jobs.find((j): j is RecordedJob => j.id === id && !!j.telemetry);
	const [list, listTitle] = LISTS[j?.kind ?? 'truck'];
	if (!j) return <main className="page"><p>Zakázku {id} neznám. <Link to={`/${data.game}/zakazky`}>Zpět na zakázky</Link></p></main>;

	const t = j.telemetry, trace = t.trace;
	const hasMap = (trace?.path.length ?? 0) > 1;
	const cityLink = (c: string | null) => <Link to={`/${data.game}/mesta?city=${encodeURIComponent(c ?? '')}`}>{f.city(c)}</Link>;
	const status = UNFINISHED.includes(j.status) ? <span className="pill accent">Probíhá</span>
		: j.status === 'cancelled' ? <span className="pill bad">Zrušena{j.cancelledByHand ? ' ručně' : ''}</span>
		: <span className="pill good">{j.kind === 'bus' ? 'Dokončeno' : 'Doručeno'} {wallTime(t.end, false)}</span>;
	// A bus job ends with the arrival at its last stop; the delivery entry only repeats it.
	const timeline = j.kind === 'bus' ? t.timeline.filter(e => e.type !== 'delivered') : t.timeline;
	// The wait between taking a bus job and its first departure is usually hours long and would dwarf the drive.
	const firstDeparture = timeline.findIndex(e => e.type === 'departure');
	const chart = firstDeparture > 0 ? timeline.slice(firstDeparture) : timeline;

	return (
		<div className={`map-page${hasMap ? '' : ' no-map'}`}>
			{hasMap && <GameMap game={data.game} routes={[{ path: trace!.path, splitIndex: trace!.approach?.path_index }]} fitTo={trace!.path} padding={{ top: 60, right: 80, bottom: 190, left: 460 }} />}
			<aside className="panel">
				<Link to={`/${data.game}/${list}`} className="back"><BackIcon />{listTitle}</Link>
				<div className="pills">{status}<span className={`pill ${isExternal(j) ? 'blue' : ''}`}>{market(j)[1]}</span></div>
				{j.kind === 'bus'
					? <>
						<h1>{busStops(j).map((s, i) => <span key={i}>{i > 0 && ' → '}{s.type === 'city' ? cityLink(s.id) : s.name}</span>)}</h1>
						<div className="cargo-line">{[`${fmt(passengers(j))} cestujících`, f.truck(j.truck)].join(' · ')}</div>
					</>
					: <>
						<h1>{cityLink(j.src_city)} → {cityLink(j.dst_city)}</h1>
						<div className="muted">{f.company(j.src_company)} → {f.company(j.dst_company)}</div>
						<div className="cargo-line">{[f.cargo(j.cargo), j.kind === 'truck' && j.mass ? `${(j.mass / 1000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} t` : '', f.truck(j.truck)].filter(Boolean).join(' · ')}</div>
					</>}

				<div className="grid-stats">
					{trace && <div><span>Ujeto</span><b>{f.dist(trace.driven_km)} <small>{f.units.distance}</small></b></div>}
					<div><span>Výdělek</span><b className="accent">{j.revenue != null ? f.money(j.revenue) : '—'}</b></div>
					<div><span>Zisk</span><b>{profit(j) != null ? f.money(profit(j)!) : '—'}</b></div>
					{j.kind === 'car' ? <div><span>Hodnocení</span><b>{j.car ? stars(j.car.rating) : '—'}</b></div> : <div><span>XP</span><b>{j.xp != null ? fmt(j.xp) : '—'}</b></div>}
					{trace && <>
						<div><span>Max</span><b>{f.speed(trace.max_kmh)} <small>{f.units.speed}</small></b></div>
						<div><span>Průměr v jízdě</span><b>{f.speed(trace.avg_kmh)} <small>{f.units.speed}</small></b></div>
						<div><span>Spotřeba</span><b>{trace.fuel_used > 0 && trace.driven_km > 0 ? <>{f.consumption(trace.fuel_used, trace.driven_km)} <small>{f.units.consumption}</small></> : '—'}</b></div>
					</>}
				</div>

				{trace?.approach && (
					<div className="legs">
						<div><span className="swatch dashed" /><span>{APPROACH[trace.approach.kind]}</span><b>{f.dist(trace.approach.km)} {f.units.distance}</b><span className="muted">{minutes(trace.approach.minutes)}</span></div>
						<div><span className="swatch solid" /><span>S nákladem</span><b>{f.dist(trace.driven_km - trace.approach.km)} {f.units.distance}</b><span /></div>
					</div>
				)}

				{t.bus && <>
					<h2>Zastávky</h2>
					<Stages stages={t.bus.stages} />
				</>}
				<h2>Průběh</h2>
				<Progress entries={timeline} />
				<h2>Podrobnosti</h2>
				<Details j={j} />
			</aside>
			<div className="timeline-card">
				<TimelineChart entries={chart} f={f} />
			</div>
		</div>
	);
}
