import { fmt, percent, plural, useGame, wallTime } from '../format';
import { UNFINISHED, WEAR } from '../jobText';
import type { Job, RecordedJob } from '../types';

type Vehicle = { truck: string; plate: string | null; jobs: number; km: number; litres: number; capacity: number | null };

const vehicleKey = (truck: string, plate: string | null) => JSON.stringify([truck, plate]);

// Jobs from plugins < 1.9.0 have no plate: a model with a single known plate is taken as that vehicle.
function plateOf(jobs: Job[]) {
	const plates = new Map<string, Set<string>>();
	for (const j of jobs) if (j.truck && j.telemetry?.plate) plates.set(j.truck, (plates.get(j.truck) ?? new Set()).add(j.telemetry.plate));
	return (j: Job) => {
		const known = plates.get(j.truck ?? '');
		return j.telemetry?.plate ?? (known?.size === 1 ? [...known][0] : null);
	};
}

function vehicles(jobs: RecordedJob[]) {
	const plate = plateOf(jobs);
	const byId = new Map<string, Vehicle>();
	for (const j of [...jobs].sort((a, b) => a.telemetry.end - b.telemetry.end)) {
		const trace = j.telemetry.trace;
		if (!j.truck) continue;
		const key = vehicleKey(j.truck, plate(j));
		const v = byId.get(key) ?? { truck: j.truck, plate: plate(j), jobs: 0, km: 0, litres: 0, capacity: null };
		byId.set(key, v);
		// The newest known tank wins: the vehicle may have been upgraded since.
		v.capacity = j.telemetry.fuel_capacity ?? v.capacity;
		if (UNFINISHED.includes(j.status) || !trace || trace.driven_km <= 0 || trace.fuel_used <= 0) continue;
		v.jobs++;
		v.km += trace.driven_km;
		v.litres += trace.fuel_used;
	}
	return [...byId.values()].filter(v => v.km > 0);
}

function Range() {
	const { data, f } = useGame();
	const all = vehicles(data.jobs.filter((j): j is RecordedJob => !!j.telemetry));
	const range = (v: Vehicle) => v.capacity! * v.km / v.litres;
	const known = all.filter(v => v.capacity).sort((a, b) => range(b) - range(a));
	const unknown = all.filter(v => !v.capacity).sort((a, b) => b.km - a.km);
	const max = Math.max(...known.map(range), 1);
	const note = (v: Vehicle) => `${f.consumption(v.litres, v.km)} ${f.units.consumption} z ${fmt(v.jobs)} ${plural(v.jobs, 'zakázky', 'zakázek', 'zakázek')} (${f.dist(v.km)} ${f.units.distance})`;

	return (
		<section className="chart-card">
			<h2>Dojezd na plnou nádrž</h2>
			<p className="muted">Objem nádrže × průměrná spotřeba vozu na zakázkách zaznamenaných pluginem.</p>
			{known.length > 0 && (
				<ul className="hbars">
					{known.map(v => (
						<li key={vehicleKey(v.truck, v.plate)}>
							<span className="hbar-label">{f.vehicle(v.truck, v.plate)}</span>
							<span className="hbar-track"><span className="hbar" style={{ width: `${range(v) / max * 100}%` }} /></span>
							<b className="hbar-value">{f.dist(range(v))} <small>{f.units.distance}</small></b>
							<span className="hbar-note muted">nádrž {f.volume(v.capacity!)} {f.units.volume}, spotřeba {note(v)}</span>
						</li>
					))}
				</ul>
			)}
			{unknown.length > 0 && (
				<>
					<h3>Objem nádrže zatím neznámý</h3>
					<p className="muted">Plugin ho zapisuje od verze 1.8.0, stačí s vozem jednou vyjet.</p>
					<ul className="plain-list">
						{unknown.map(v => <li key={vehicleKey(v.truck, v.plate)}>{f.vehicle(v.truck, v.plate)} <span className="muted">– spotřeba {note(v)}</span></li>)}
					</ul>
				</>
			)}
			{!all.length && <p className="muted">Zatím žádná zakázka se záznamem paliva.</p>}
		</section>
	);
}

const PARTS = ['wear_wheels', 'wear_engine', 'wear_transmission', 'wear_chassis', 'wear_cabin'];

function Wear() {
	const { data, f } = useGame();
	const plate = plateOf(data.jobs);
	const latest = new Map<string, { truck: string; plate: string | null; wear: Record<string, number>; at: number }>();
	for (const j of data.jobs) {
		const wear = j.telemetry?.trace?.wear_end;
		if (!j.truck || !wear) continue;
		const key = vehicleKey(j.truck, plate(j));
		if (j.telemetry!.end > (latest.get(key)?.at ?? 0)) latest.set(key, { truck: j.truck, plate: plate(j), wear, at: j.telemetry!.end });
	}
	const vehicles = [...latest.entries()].sort((a, b) => b[1].at - a[1].at);

	return (
		<section className="chart-card">
			<h2>Opotřebení vozů</h2>
			<p className="muted">Stav na konci poslední zaznamenané zakázky vozu (plugin od verze 1.5.0). Kola jsou průměr přes všechna kola, jednotlivě je SDK neposílá.</p>
			{vehicles.length ? (
				<div className="table-wrap">
					<table className="wear">
						<thead><tr><th>Vůz</th>{PARTS.map(p => <th key={p}>{WEAR[p][0].toUpperCase() + WEAR[p].slice(1)}</th>)}</tr></thead>
						<tbody>
							{vehicles.map(([key, { truck, plate, wear, at }]) => (
								<tr key={key}>
									<td><b>{f.vehicle(truck, plate)}</b><div className="sub">{wallTime(at, false)}</div></td>
									{PARTS.map(p => (
										<td key={p}>
											{wear[p] != null && <>
												<span className="wear-value">{percent(wear[p])}</span>
												<span className="wear-track"><span className="hbar" style={{ width: `${Math.min(wear[p], 1) * 100}%` }} /></span>
											</>}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : <p className="muted">Zatím žádná zakázka se záznamem opotřebení.</p>}
		</section>
	);
}

export function Stats() {
	return (
		<main className="page">
			<h1>Statistiky</h1>
			<Range />
			<Wear />
		</main>
	);
}
