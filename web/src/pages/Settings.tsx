import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createToken, deleteToken, tokens, type Token } from '../api';
import { wallTime } from '../format';

const time = (iso: string | null) => iso ? wallTime(Date.parse(iso) / 1000) : 'nikdy';

export function Settings() {
	const [list, setList] = useState<Token[]>();
	const [name, setName] = useState('plugin');
	const [created, setCreated] = useState<string>();
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const load = useCallback(() => tokens().then(setList, (e: Error) => setError(e.message)), []);
	useEffect(() => void load(), [load]);

	const create = (e: FormEvent) => {
		e.preventDefault();
		setError('');
		setBusy(true);
		createToken(name).then(t => {
			setCreated(t.token);
			return load();
		}, (e: Error) => setError(e.message)).finally(() => setBusy(false));
	};
	const remove = (t: Token) => {
		if (!confirm(`Zrušit token „${t.name}“? Plugin s ním přestane posílat data.`)) return;
		setError('');
		setCreated(undefined);
		deleteToken(t.id).then(load, (e: Error) => setError(e.message));
	};

	return (
		<main className="page">
			<h1>Nastavení</h1>
			<h2>Tokeny pro plugin</h2>
			<p className="muted lead">Plugin posílá data s tokenem ze souboru <code>~/Library/Application Support/virtualtruck/config</code>. Token smí jen posílat data, číst je nebo vytvořit další token nejde.</p>
			{error && <p className="bad">{error}</p>}
			{created && (
				<div className="notice">
					<p>Nový token se ukáže jen teď. Zapiš ho do <code>config</code>:</p>
					<pre className="config">{`url=${location.origin}\ntoken=${created}`}</pre>
				</div>
			)}
			{list && (list.length ? (
				<div className="table-wrap">
					<table>
						<thead><tr><th>Název</th><th>Vytvořen</th><th>Naposledy použit</th><th /></tr></thead>
						<tbody>
							{list.map(t => (
								<tr key={t.id}>
									<td>{t.name}</td>
									<td>{time(t.created_at)}</td>
									<td>{time(t.last_used_at)}</td>
									<td><button type="button" className="link-button" onClick={() => remove(t)}>Zrušit</button></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : <p className="muted">Zatím žádný token.</p>)}
			<form className="token-form" onSubmit={create}>
				<input aria-label="Název tokenu" required maxLength={255} value={name} onChange={e => setName(e.target.value)} />
				<button type="submit" className="link-button" disabled={busy}>Vytvořit token</button>
			</form>
		</main>
	);
}
