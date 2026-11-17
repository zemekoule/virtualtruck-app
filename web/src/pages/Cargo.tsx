import atsCargo from '../../../names/ats/cargo_defs.json';
import eut2Cargo from '../../../names/eut2/cargo_defs.json';
import { fmt, useGame } from '../format';
import { Stat } from '../Stat';
import type { GameId } from '../types';

// Written by page/extract_names.py from the game archives (base game and owned DLC).
const CARGO_DEFS: Record<GameId, string[]> = { ats: atsCargo, eut2: eut2Cargo };

export function Cargo() {
	const { data, f } = useGame();
	const defs = CARGO_DEFS[data.game];
	const delivered = new Set(data.jobs.filter(j => j.kind === 'truck' && j.status === 'delivered').map(j => j.cargo));
	const todo = defs.filter(c => !delivered.has(c)).sort((a, b) => f.cargo(a).localeCompare(f.cargo(b), 'cs'));

	return (
		<main className="page">
			<h1>Náklady</h1>
			<p className="muted lead">Náklady, které podle archivů hry (včetně DLC) některá firma vozí nebo přijímá, a které jsem ještě nevezl. Všechny zakázky ze savu a z pluginu.</p>
			<div className="stats">
				<Stat label="Nákladů ve hře" value={fmt(defs.length)} />
				<Stat label="Vezl jsem" value={fmt(defs.length - todo.length)} />
				<Stat label="Ještě ne" value={fmt(todo.length)} tone="accent" />
			</div>
			<div className="table-wrap">
				<table>
					<thead><tr><th>Náklad</th><th>Kód</th></tr></thead>
					<tbody>
						{todo.map(c => <tr key={c}><td>{f.cargo(c)}</td><td className="muted">{c}</td></tr>)}
					</tbody>
				</table>
			</div>
		</main>
	);
}
