import { useState, type FormEvent } from 'react';
import { login, register } from './api';

export function Login({ onLogin }: { onLogin: () => void }) {
	const [registering, setRegistering] = useState(false);
	const [form, setForm] = useState({ name: '', email: '', password: '', passwordConfirmation: '' });
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: e.target.value })) });

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError('');
		(registering ? register(form.name, form.email, form.password, form.passwordConfirmation) : login(form.email, form.password))
			.then(onLogin, (e: Error) => setError(e.message))
			.finally(() => setBusy(false));
	};

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
