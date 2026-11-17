import { useState } from 'react';
import { Link } from 'react-router';
import { fmt, percent, wallTime, useGame } from '../format';
import { SearchIcon } from '../icons';
import { busStops, fines, isExternal, market, passengers, stars, UNFINISHED } from '../jobText';
import { Stat } from '../Stat';
import type { JobKind, RecordedJob } from '../types';

const FILTERS = [
	['all', 'Vše', () => true],
	['delivered', 'Doručené', (j: RecordedJob) => j.status === 'delivered'],
	['open', 'Probíhá', (j: RecordedJob) => UNFINISHED.includes(j.status)],
	['cancelled', 'Zrušené', (j: RecordedJob) => j.status === 'cancelled'],
] as const;

const STATUS: Record<string, [string, string]> = {
	running: ['Probíhá', 'accent'], suspended: ['Probíhá', 'accent'], cancelled: ['Zrušena', 'bad'],
};

const TITLES: Record<JobKind, [string, string, string]> = {
	truck: ['Nákladní zakázky', 'Zakázky kamionem zaznamenané pluginem virtualtruck.', 'Kamion'],
	car: ['Osobní doprava', 'Zakázky osobní dopravy zaznamenané pluginem virtualtruck (od verze 1.3.0). Hodnocení a spokojenost zákazníka doplní save po uložení hry.', 'Auto'],
	bus: ['Autobusy', 'Linky a zájezdy autobusem zaznamenané pluginem virtualtruck (od verze 1.7.0).', 'Autobus'],
};

export function Jobs({ kind }: { kind: JobKind }) {
	const { data, f } = useGame();
	const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
	const [query, setQuery] = useState('');
	const jobs = data.jobs.filter((j): j is RecordedJob => !!j.telemetry && j.kind === kind);
	const delivered = jobs.filter(j => j.status === 'delivered');
	const fined = jobs.filter(j => fines(j));

	const q = query.trim().toLowerCase();
	const stopName = (s: { id: string | null; name: string | null }) => s.name ?? f.city(s.id);
	const matches = (j: RecordedJob) => !q || [f.city(j.src_city), f.city(j.dst_city), f.company(j.src_company), f.company(j.dst_company), f.cargo(j.cargo), ...busStops(j).map(stopName)].some(s => s.toLowerCase().includes(q));
	const [title, lead, vehicle] = TITLES[kind];
	const done = kind === 'bus' ? 'Dokončeno' : 'Doručeno';
	const test = FILTERS.find(([id]) => id === filter)![2];
	const shown = jobs.filter(j => test(j) && matches(j));

	return (
		<main className="page">
			<h1>{title}</h1>
			<p className="muted lead">{lead} Kliknutím na trasu otevřeš mapu.</p>
			<div className="stats">
				<Stat label={done} value={fmt(delivered.length)} note={`${jobs.filter(j => UNFINISHED.includes(j.status)).length} probíhá, ${jobs.filter(j => j.status === 'cancelled').length} zrušeno`} />
				<Stat label="Ujeto" value={f.dist(delivered.reduce((s, j) => s + (j.km ?? 0), 0))} unit={f.units.distance} />
				<Stat label="Výdělek" value={f.money(delivered.reduce((s, j) => s + (j.revenue ?? 0), 0))} tone="accent" />
				<Stat label="Pokuty" value={f.money(jobs.reduce((s, j) => s + fines(j), 0))} tone={fined.length ? 'bad' : undefined} note={fined.length ? `u ${fined.length} ${fined.length === 1 ? 'zakázky' : 'zakázek'}` : undefined} />
			</div>

			<div className="toolbar">
				{FILTERS.map(([id, label, t]) => (
					<button key={id} className={`chip${filter === id ? ' active' : ''}`} onClick={() => setFilter(id)}>{id === 'delivered' && kind === 'bus' ? 'Dokončené' : label} {jobs.filter(t).length}</button>
				))}
				<label className="search">
					<SearchIcon />
					<span className="sr-only">Hledat</span>
					<input value={query} onChange={e => setQuery(e.target.value)} placeholder={kind === 'bus' ? 'Zastávka' : 'Město, firma, náklad'} />
				</label>
			</div>

			<div className="table-wrap">
				<table className="jobs">
					<thead>
						<tr>
							<th>{done}</th><th>Trasa</th><th className={kind === 'bus' ? 'num' : ''}>{kind === 'bus' ? 'Cestující' : 'Náklad'}</th><th>Typ</th><th>{vehicle}</th>
							<th className="num">{f.units.distance}</th><th className="num">Výdělek</th><th className={kind === 'car' ? '' : 'num'}>{{ car: 'Hodnocení', bus: 'Spokojenost', truck: 'XP' }[kind]}</th>
							<th className="num">Pokuty</th><th>Stav</th>
						</tr>
					</thead>
					<tbody>
						{shown.map(j => {
							const [statusText, tone] = j.status === 'delivered' ? [done, 'good'] : STATUS[j.status];
							return (
								<tr key={j.id}>
									<td className="nowrap muted-strong">{UNFINISHED.includes(j.status) ? '—' : wallTime(j.telemetry.end, false)}</td>
									<td>
										{kind === 'bus'
											? <Link to={j.id} className="route">{busStops(j).map(stopName).join(' → ')}</Link>
											: <>
												<Link to={j.id} className="route">{f.city(j.src_city)} → {f.city(j.dst_city)}</Link>
												<div className="sub">{f.company(j.src_company)} → {f.company(j.dst_company)}</div>
											</>}
									</td>
									{kind === 'bus' ? <td className="num">{fmt(passengers(j))}</td> : <td>{f.cargo(j.cargo)}</td>}
									<td><span className={`pill ${isExternal(j) ? 'blue' : ''}`}>{market(j)[kind === 'truck' ? 0 : 1]}</span></td>
									<td className="muted-strong">{f.truck(j.truck)}</td>
									<td className="num">{j.km != null ? f.dist(j.km) : ''}</td>
									<td className="num strong">{j.revenue != null ? f.money(j.revenue) : ''}</td>
									{kind === 'car'
										? <td className="nowrap">{j.car ? stars(j.car.rating) : ''}</td>
										: kind === 'bus'
										? <td className="num muted-strong">{j.telemetry.bus?.satisfaction != null ? percent(j.telemetry.bus.satisfaction) : ''}</td>
										: <td className="num muted-strong">{j.xp != null ? fmt(j.xp) : ''}</td>}
									<td className="num bad">{fines(j) ? f.money(fines(j)) : ''}</td>
									<td className="nowrap"><span className="status"><span className={`dot ${tone}`} />{statusText}</span></td>
								</tr>
							);
						})}
						{!shown.length && <tr><td colSpan={10} className="muted">{jobs.length ? 'Filtru nic neodpovídá.' : 'Zatím žádná jízda zaznamenaná pluginem.'}</td></tr>}
					</tbody>
				</table>
			</div>
		</main>
	);
}
