import { useState, type FormEvent } from 'react';
import { login, register, twoFactorChallenge } from './api';

export function Login({ onLogin }: { onLogin: () => void }) {
	const [registering, setRegistering] = useState(false);
	const [twoFactor, setTwoFactor] = useState(false);
	const [recovery, setRecovery] = useState(false);
	const [form, setForm] = useState({ name: '', email: '', password: '', passwordConfirmation: '', code: '' });
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: e.target.value })) });

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError('');
		const done = twoFactor
			? twoFactorChallenge(recovery ? { recovery_code: form.code.trim() } : { code: form.code.trim() }).then(onLogin)
			: registering
				? register(form.name, form.email, form.password, form.passwordConfirmation).then(onLogin)
				: login(form.email, form.password).then(waits => waits ? setTwoFactor(true) : onLogin());
		done.catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
	};

	if (twoFactor) {
		return (
			<form className="card login" onSubmit={submit}>
				<h1>Dvoufázové ověření</h1>
				<label>
					{recovery ? 'Záložní kód' : 'Kód z aplikace'}
					<input autoComplete="one-time-code" inputMode={recovery ? 'text' : 'numeric'} required autoFocus {...field('code')} />
				</label>
				{error && <p className="bad">{error}</p>}
				<button type="submit" className="link-button" disabled={busy}>Ověřit</button>
				<button type="button" className="text-button" onClick={() => { setRecovery(!recovery); setForm(f => ({ ...f, code: '' })); setError(''); }}>
					{recovery ? 'Použít kód z aplikace' : 'Nemám telefon, použít záložní kód'}
				</button>
				<button type="button" className="text-button" onClick={() => { setTwoFactor(false); setRecovery(false); setForm(f => ({ ...f, code: '' })); setError(''); }}>
					Zpět na přihlášení
				</button>
			</form>
		);
	}

	return (
		<form className="card login" onSubmit={submit}>
			<h1>{registering ? 'Registrace' : 'Přihlášení'}</h1>
			{registering && <label>Jméno<input autoComplete="name" required {...field('name')} /></label>}
			<label>E-mail<input type="email" autoComplete="email" required {...field('email')} /></label>
			<label>Heslo<input type="password" autoComplete={registering ? 'new-password' : 'current-password'} required {...field('password')} /></label>
			{registering && <label>Heslo znovu<input type="password" autoComplete="new-password" required {...field('passwordConfirmation')} /></label>}
			{error && <p className="bad">{error}</p>}
			<button type="submit" className="link-button" disabled={busy}>{registering ? 'Zaregistrovat' : 'Přihlásit'}</button>
			<button type="button" className="text-button" onClick={() => { setRegistering(!registering); setError(''); }}>
				{registering ? 'Už mám účet' : 'Nemám účet, zaregistrovat'}
			</button>
		</form>
	);
}
