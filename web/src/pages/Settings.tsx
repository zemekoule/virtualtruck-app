import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createToken, deleteToken, tokens, type Token } from '../api';
import { wallTime } from '../format';
import { PasswordChange, TwoFactor } from './Account';

const time = (iso: string | null) => iso ? wallTime(Date.parse(iso) / 1000) : 'nikdy';

export function Settings() {
	const [list, setList] = useState<Token[]>();
	const [name, setName] = useState('plugin');
	const [created, setCreated] = useState<string>();
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);
	const load = useCallback(() => tokens().then(setList, (e: Error) => setError(e.message)), []);
	useEffect(() => void load(), [load]);

	const create = (e: FormEvent) => {
		e.preventDefault();
		setError('');
		setBusy(true);
		createToken(name).then(t => {
			setCreated(t.token);
			setCopied(false);
			return load();
		}, (e: Error) => setError(e.message)).finally(() => setBusy(false));
	};
	const remove = (t: Token) => {
		if (!confirm(`Zrušit token „${t.name}“? Plugin s ním přestane posílat data.`)) return;
		setError('');
		setCreated(undefined);
		deleteToken(t.id).then(load, (e: Error) => setError(e.message));
	};

	const config = created && `url=${location.origin}\ntoken=${created}`;
	const copy = () => {
		if (!config) return;
		navigator.clipboard.writeText(config).then(() => setCopied(true), () => setError('Kopírování se nepovedlo, označ text a zkopíruj ho ručně.'));
	};

	return (
		<main className="page">
			<h1>Nastavení</h1>
			<h2>Heslo</h2>
			<PasswordChange />
			<h2>Dvoufázové ověření</h2>
			<TwoFactor />
			<h2>Tokeny pro plugin</h2>
			<p className="muted lead">Plugin posílá data s tokenem ze souboru <code>~/Library/Application Support/virtualtruck/config</code>. Token smí jen posílat data, číst je nebo vytvořit další token nejde.</p>
			{error && <p className="bad">{error}</p>}
			{config && (
				<div className="notice">
					<p>Token uvidíš jen teď. Ulož celý tento obsah do souboru <code>~/Library/Application Support/virtualtruck/config</code>:</p>
					<pre className="config">{config}</pre>
					<button type="button" className="link-button" onClick={copy}>{copied ? 'Zkopírováno' : 'Zkopírovat'}</button>
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
