import { useSearchParams } from 'react-router';
import { fmt, gameTime, useGame } from '../format';
import { Stat } from '../Stat';

const STATUS: Record<string, string> = { cancelled: 'zrušena', running: 'probíhá', suspended: 'probíhá' };

export function Cities() {
	const { data, f } = useGame();
	const [params, setParams] = useSearchParams();
	const allJobs = data.jobs.filter(j => j.kind !== 'bus');
	const delivered = allJobs.filter(j => j.status === 'delivered');
	const cityCodes = [...new Set([...allJobs.flatMap(j => [j.src_city, j.dst_city]), ...Object.keys(data.depots)].filter((c): c is string => !!c))]
		.sort((a, b) => f.city(a).localeCompare(f.city(b)));

	const input = params.get('city') ?? '';
	const q = input.trim().toLowerCase();
	const code = cityCodes.find(c => c === input || f.city(c).toLowerCase() === q);

	const depots: Record<string, { from: number; to: number }> = Object.fromEntries((code ? data.depots[code] ?? [] : []).map(c => [c, { from: 0, to: 0 }]));
	if (code) for (const j of delivered) {
		if (j.src_city === code) (depots[j.src_company ?? ''] ??= { from: 0, to: 0 }).from++;
		if (j.dst_city === code) (depots[j.dst_company ?? ''] ??= { from: 0, to: 0 }).to++;
	}
	const rows = Object.entries(depots).sort((a, b) => (b[1].from + b[1].to) - (a[1].from + a[1].to) || f.company(a[0]).localeCompare(f.company(b[0])));
	const jobs = code ? allJobs.filter(j => j.src_city === code || j.dst_city === code) : [];
	const place = (company: string | null, city: string | null) => city === code ? f.company(company) : `${f.company(company)}, ${f.city(city)}`;

	return (
		<main className="page">
			<h1>Města</h1>
			<p className="muted lead">Všechny zakázky ze savu a z pluginu.</p>
			<div className="stats">
				<Stat label="Zakázek kamionem" value={fmt(delivered.filter(j => j.kind === 'truck').length)} />
				{data.game === 'ats' && <Stat label="Zakázek osobní dopravy" value={fmt(delivered.filter(j => j.kind === 'car').length)} />}
				<Stat label="Ujeto" value={f.dist(delivered.reduce((s, j) => s + (j.km ?? 0), 0))} unit={f.units.distance} />
				<Stat label="Výdělek" value={f.money(delivered.reduce((s, j) => s + (j.revenue ?? 0), 0))} tone="accent" />
			</div>

			<label className="search wide">
				<span className="sr-only">Město</span>
				<input list="cities" value={code === input ? f.city(code) : input} onChange={e => setParams(e.target.value ? { city: e.target.value } : {}, { replace: true })} placeholder="Název nebo kód města, např. Missoula" autoFocus />
			</label>
			<datalist id="cities">{cityCodes.map(c => <option key={c} value={f.city(c)}>{c}</option>)}</datalist>

			{!code && q && <p className="muted">Takové město neznám.</p>}
			{code && <>
				<p>Vezl jsem z/do {rows.filter(([, n]) => n.from + n.to).length} z {rows.length} dep.</p>
				<div className="table-wrap">
					<table>
						<thead><tr><th>Firma</th><th>Depo</th><th className="num">Odvoz z ní</th><th className="num">Doručení do ní</th></tr></thead>
						<tbody>{rows.map(([c, n]) => (
							<tr key={c} className={n.from + n.to ? '' : 'muted'}><td>{f.company(c)}</td><td><code>{c}</code></td><td className="num">{n.from}</td><td className="num">{n.to}</td></tr>
						))}</tbody>
					</table>
				</div>
				<h2>Zakázky ({fmt(jobs.length)})</h2>
				<div className="table-wrap">
					<table>
						<thead><tr><th>Herní čas</th><th>Odkud</th><th>Kam</th><th>Náklad</th><th className="num">{f.units.distance}</th><th className="num">Výdělek</th><th /></tr></thead>
						<tbody>{jobs.map(j => (
							<tr key={j.id}>
								<td className="nowrap">{j.game_time ? gameTime(j.game_time) : '—'}</td>
								<td>{place(j.src_company, j.src_city)}</td>
								<td>{place(j.dst_company, j.dst_city)}</td>
								<td>{j.kind === 'car' ? 'osobní doprava' : f.cargo(j.cargo)}</td>
								<td className="num">{j.km != null ? f.dist(j.km) : ''}</td>
								<td className="num">{j.revenue != null ? f.money(j.revenue) : ''}</td>
								<td>{STATUS[j.status] && <span className={`pill ${j.status === 'cancelled' ? 'bad' : 'accent'}`}>{STATUS[j.status]}</span>}</td>
							</tr>
						))}</tbody>
					</table>
				</div>
			</>}
		</main>
	);
}
