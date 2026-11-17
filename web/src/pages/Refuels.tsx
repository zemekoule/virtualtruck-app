import atsPrices from '../../../names/ats/fuel_prices.json';
import eut2Prices from '../../../names/eut2/fuel_prices.json';
import { fmt, gameTime, useGame, wallTime } from '../format';
import { Stat } from '../Stat';
import type { GameId } from '../types';

const COUNTRIES: Record<GameId, Record<string, string>> = {
	ats: Object.fromEntries(atsPrices.map(c => [c.id, c.name])),
	eut2: Object.fromEntries(eut2Prices.map(c => [c.id, c.name])),
};

export function Refuels() {
	const { data, f } = useGame();
	const ats = data.game === 'ats';
	const refuels = data.refuels;
	const litres = refuels.reduce((s, r) => s + r.litres, 0);
	const spent = refuels.reduce((s, r) => s + r.litres * r.price, 0);
	const unit = ats ? '$/gal' : '€/l';
	const price = (perLitre: number) => (perLitre / f.units.litre).toLocaleString('cs-CZ', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

	return (
		<main className="page">
			<h1>Tankování</h1>
			<p className="muted lead">Tankování poznaná ve stopě z pluginu: nárůst paliva na místě do 500 m od pumpy nebo vlastní garáže. Cena je cena {ats ? 'státu' : 'země'} z herních dat, v garáži o 15 % nižší. Kolik hra skutečně strhla, SDK neposílá.</p>
			<div className="stats">
				<Stat label="Tankování" value={fmt(refuels.length)} />
				<Stat label="Natankováno" value={f.volume(litres)} unit={f.units.volume} />
				<Stat label="Utraceno" value={f.money(spent)} tone="accent" />
				<Stat label="Průměrná cena" value={litres ? price(spent / litres) : '—'} unit={unit} />
			</div>
			<div className="table-wrap">
				<table className="jobs">
					<thead>
						<tr><th>Kdy</th><th>Herní čas</th><th>Vozidlo</th><th>{ats ? 'Stát' : 'Země'}</th><th>Místo</th><th className="num">{f.units.volume}</th><th className="num">{unit}</th><th className="num">Cena</th></tr>
					</thead>
					<tbody>
						{refuels.map(r => (
							<tr key={r.wall}>
								<td>{wallTime(Date.parse(r.wall) / 1000)}</td>
								<td className="muted">{r.game_time != null ? gameTime(r.game_time) : ''}</td>
								<td>{f.truck(r.truck)}</td>
								<td>{COUNTRIES[data.game][r.country] ?? r.country}</td>
								<td>{r.garage ? 'vlastní garáž' : 'pumpa'}</td>
								<td className="num">{f.volume(r.litres)}</td>
								<td className="num">{price(r.price)}</td>
								<td className="num strong">{f.money(r.litres * r.price)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</main>
	);
}
