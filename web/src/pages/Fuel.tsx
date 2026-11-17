import { useState } from 'react';
import atsPrices from '../../../names/ats/fuel_prices.json';
import eut2Prices from '../../../names/eut2/fuel_prices.json';
import { useGame } from '../format';
import type { GameId } from '../types';

const PRICES: Record<GameId, { id: string; name: string; price: number }[]> = { ats: atsPrices, eut2: eut2Prices };

export function Fuel() {
	const { data, f } = useGame();
	const ats = data.game === 'ats';
	// Prices are per litre in the game data; ATS shows them per US gallon.
	const price = (perLitre: number) => (perLitre / f.units.litre).toLocaleString('cs-CZ', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
	const unit = ats ? '$/gal' : '€/l';
	const [order, setOrder] = useState<'price' | 'name'>('price');
	const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'cs');
	const countries = [...PRICES[data.game]].sort((a, b) => order === 'name' ? byName(a, b) : a.price - b.price || byName(a, b));
	const max = Math.max(...countries.map(c => c.price));

	return (
		<main className="page">
			<h1>Palivo</h1>
			<p className="muted lead">Cena paliva podle {ats ? 'států' : 'zemí'} z herních dat (nainstalovaná DLC). Ve vlastní garáži je o 15 % levnější.</p>
			<section className="chart-card">
				<h2>Cena paliva</h2>
				<div className="toolbar">
					<button className={`chip${order === 'price' ? ' active' : ''}`} onClick={() => setOrder('price')}>Od nejlevnějšího</button>
					<button className={`chip${order === 'name' ? ' active' : ''}`} onClick={() => setOrder('name')}>Podle {ats ? 'státu' : 'země'}</button>
				</div>
				<ul className="hbars">
					{countries.map(c => (
						<li key={c.id}>
							<span className="hbar-label">{c.name}</span>
							<span className="hbar-track"><span className="hbar" style={{ width: `${c.price / max * 100}%` }} /></span>
							<b className="hbar-value">{price(c.price)} <small>{unit}</small></b>
						</li>
					))}
				</ul>
			</section>
		</main>
	);
}
