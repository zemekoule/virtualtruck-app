import { useEffect, useState, type FormEvent } from 'react';
import {
	confirmPassword, confirmTwoFactor, currentUser, disableTwoFactor, enableTwoFactor, recoveryCodes, regenerateRecoveryCodes, twoFactorSetup, updatePassword,
} from '../api';

const input = (value: string, set: (v: string) => void) => ({ value, onChange: (e: { target: { value: string } }) => set(e.target.value) });

export function PasswordChange() {
	const [current, setCurrent] = useState('');
	const [password, setPassword] = useState('');
	const [confirmation, setConfirmation] = useState('');
	const [message, setMessage] = useState<{ ok: boolean; text: string }>();
	const [busy, setBusy] = useState(false);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setMessage(undefined);
		updatePassword(current, password, confirmation).then(() => {
			setCurrent('');
			setPassword('');
			setConfirmation('');
			setMessage({ ok: true, text: 'Heslo je změněné.' });
		}, (e: Error) => setMessage({ ok: false, text: e.message })).finally(() => setBusy(false));
	};

	return (
		<form className="form" onSubmit={submit}>
			<label>Současné heslo<input type="password" autoComplete="current-password" required {...input(current, setCurrent)} /></label>
			<label>Nové heslo<input type="password" autoComplete="new-password" required minLength={8} {...input(password, setPassword)} /></label>
			<label>Nové heslo znovu<input type="password" autoComplete="new-password" required {...input(confirmation, setConfirmation)} /></label>
			{message && <p className={message.ok ? 'muted' : 'bad'}>{message.text}</p>}
			<button type="submit" className="link-button" disabled={busy}>Změnit heslo</button>
		</form>
	);
}

type Step = { kind: 'idle' } | { kind: 'setup'; svg: string; secretKey: string } | { kind: 'codes'; codes: string[] };

export function TwoFactor() {
	const [enabled, setEnabled] = useState<boolean>();
	const [step, setStep] = useState<Step>({ kind: 'idle' });
	const [password, setPassword] = useState('');
	const [code, setCode] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);
	useEffect(() => void currentUser().then(u => setEnabled(!!u?.two_factor_confirmed_at), (e: Error) => setError(e.message)), []);

	const run = (action: () => Promise<unknown>) => {
		setBusy(true);
		setError('');
		action().catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
	};
	// Every change asks for the password, a forgotten open session must not be enough to switch it off.
	const withPassword = (action: () => Promise<unknown>) => run(() => confirmPassword(password).then(() => setPassword('')).then(action));
	const showCodes = () => recoveryCodes().then(codes => { setCopied(false); setStep({ kind: 'codes', codes }); });

	const enable = (e: FormEvent) => {
		e.preventDefault();
		withPassword(() => enableTwoFactor().then(twoFactorSetup).then(s => setStep({ kind: 'setup', ...s })));
	};
	const confirm = (e: FormEvent) => {
		e.preventDefault();
		run(() => confirmTwoFactor(code.trim()).then(() => { setCode(''); setEnabled(true); }).then(showCodes));
	};
	const copy = (codes: string[]) => navigator.clipboard.writeText(codes.join('\n')).then(() => setCopied(true), () => setError('Kopírování se nepovedlo, označ kódy a zkopíruj je ručně.'));

	if (enabled === undefined) return error ? <p className="bad">{error}</p> : null;

	if (step.kind === 'setup') {
		return (
			<form className="form" onSubmit={confirm}>
				<p>Naskenuj kód v aplikaci pro ověřování (Google Authenticator, Microsoft Authenticator, 1Password…) a opiš kód, který ukáže.</p>
				<img className="qr" alt="QR kód pro aplikaci" src={`data:image/svg+xml;utf8,${encodeURIComponent(step.svg)}`} />
				<p className="muted">Nebo zadej klíč ručně: <code>{step.secretKey}</code></p>
				<label>Kód z aplikace<input autoComplete="one-time-code" inputMode="numeric" required autoFocus {...input(code, setCode)} /></label>
				{error && <p className="bad">{error}</p>}
				<div className="buttons">
					<button type="submit" className="link-button" disabled={busy}>Zapnout</button>
					<button type="button" className="text-button" onClick={() => { setStep({ kind: 'idle' }); setError(''); }}>Zrušit</button>
				</div>
			</form>
		);
	}

	if (step.kind === 'codes') {
		return (
			<div className="form">
				<p>Záložní kódy: když přijdeš o telefon, přihlásíš se jedním z nich místo kódu z aplikace. Každý platí jen jednou. Ulož si je hned (třeba do správce hesel), znovu je neuvidíš, jde jen vytvořit nové.</p>
				<ul className="codes">{step.codes.map(c => <li key={c}><code>{c}</code></li>)}</ul>
				{error && <p className="bad">{error}</p>}
				<div className="buttons">
					<button type="button" className="link-button" onClick={() => void copy(step.codes)}>{copied ? 'Zkopírováno' : 'Zkopírovat'}</button>
					<button type="button" className="link-button" onClick={() => setStep({ kind: 'idle' })}>Hotovo</button>
				</div>
			</div>
		);
	}

	return (
		<form className="form" onSubmit={enabled ? e => e.preventDefault() : enable}>
			<p className="muted">
				{enabled
					? 'Zapnuto: při přihlášení zadáváš kromě hesla i kód z aplikace.'
					: 'Vypnuto. Po zapnutí zadáš při přihlášení kromě hesla i kód z aplikace v telefonu. Plugin to neovlivní, posílá data s tokenem.'}
			</p>
			<label>Heslo<input type="password" autoComplete="current-password" required {...input(password, setPassword)} /></label>
			{error && <p className="bad">{error}</p>}
			{enabled ? (
				<div className="buttons">
					<button type="button" className="link-button" disabled={busy || !password} onClick={() => withPassword(() => regenerateRecoveryCodes().then(showCodes))}>Nové záložní kódy</button>
					<button type="button" className="link-button" disabled={busy || !password} onClick={() => withPassword(() => disableTwoFactor().then(() => setEnabled(false)))}>Vypnout</button>
				</div>
			) : <button type="submit" className="link-button" disabled={busy}>Zapnout</button>}
		</form>
	);
}
