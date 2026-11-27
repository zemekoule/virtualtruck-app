import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { fmt, GAME_NAMES, plural, useGame } from '../format';
import { BusIcon, CarIcon, CityIcon, TruckIcon } from '../icons';
import { Stat } from '../Stat';

const jobsText = (n: number) => `${fmt(n)} ${plural(n, 'zakázka', 'zakázky', 'zakázek')}`;

function Card({ to, icon, tone, title, children }: { to: string; icon: ReactNode; tone: string; title: string; children: ReactNode }) {
	return (
		<Link to={to} className="card">
			<span className={`card-icon ${tone}`}>{icon}</span>
			<span><b>{title}</b><span className="muted">{children}</span></span>
		</Link>
	);
}

export function Overview() {
	const { data, f } = useGame();
	const delivered = data.jobs.filter(j => j.status === 'delivered');
	const cities = new Set(delivered.flatMap(j => [j.src_city, j.dst_city]).filter(Boolean));
	const recorded = (kind: string) => data.jobs.filter(j => j.telemetry && j.kind === kind).length;
	return (
		<main className="page">
			<p className="eyebrow">Profil andros</p>
			<h1 className="hero">{GAME_NAMES[data.game]}</h1>
			<div className="stats">
				<Stat label="Zakázek kamionem" value={fmt(delivered.filter(j => j.kind === 'truck').length)} />
				{data.game === 'ats' && <Stat label="Osobní doprava" value={fmt(delivered.filter(j => j.kind === 'car').length)} />}
				{data.game === 'eut2' && <Stat label="Autobusy" value={fmt(delivered.filter(j => j.kind === 'bus').length)} />}
				<Stat label="Ujeto" value={f.dist(delivered.reduce((s, j) => s + (j.km ?? 0), 0))} unit={f.units.distance} />
				<Stat label="Výdělek" value={f.money(delivered.reduce((s, j) => s + (j.revenue ?? 0), 0))} tone="accent" />
			</div>
			<div className="cards">
				<Card to="zakazky" icon={<TruckIcon />} tone="accent" title="Nákladní zakázky">Zaznamenáno pluginem: {jobsText(recorded('truck'))}. Trasa, rychlost, spotřeba, pokuty.</Card>
				{data.game === 'ats' && <Card to="osobni" icon={<CarIcon />} tone="blue" title="Osobní doprava">Zaznamenáno pluginem: {jobsText(recorded('car'))}. Hodnocení, spokojenost zákazníka, trasa.</Card>}
				{data.game === 'eut2' && <Card to="autobusy" icon={<BusIcon />} tone="blue" title="Autobusy">Zaznamenáno pluginem: {jobsText(recorded('bus'))}. Linky, zastávky, spokojenost cestujících.</Card>}
				<Card to="mesta" icon={<CityIcon />} tone="plain" title="Města">{fmt(cities.size)} {plural(cities.size, 'město', 'města', 'měst')} z {jobsText(delivered.length)} – z/do kterých dep jsem vezl.</Card>
			</div>
		</main>
	);
}
