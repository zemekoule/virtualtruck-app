import type { GameData, GameId, Job, NameKind, Refuel, TracePoint } from './types';

export class Unauthenticated extends Error {
	constructor() {
		super('Přihlášení vypršelo, načti stránku a přihlas se znovu.');
	}
}

export type User = { name: string; email: string };

function xsrfToken() {
	const cookie = document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN='));
	return cookie ? decodeURIComponent(cookie.slice('XSRF-TOKEN='.length)) : undefined;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
	const xsrf = xsrfToken();
	const response = await fetch(`/api/${path}`, {
		...options,
		headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}), ...options.headers },
	});
	if (response.status === 401) throw new Unauthenticated();
	const text = await response.text();
	if (!response.ok) throw new Error(response.status === 422 ? validationMessage(text) : `${response.status} ${text}`);
	return text ? JSON.parse(text) : (null as T);
}

function validationMessage(text: string) {
	const { message, errors } = JSON.parse(text) as { message: string; errors?: Record<string, string[]> };
	return errors ? Object.values(errors).flat().join(' ') : message;
}

export async function currentUser(): Promise<User | null> {
	try {
		return await api<User>('user');
	} catch (e) {
		if (e instanceof Unauthenticated) return null;
		throw e;
	}
}

// Sanctum sets the XSRF-TOKEN cookie, which the session login and registration need.
const csrfCookie = () => api('sanctum/csrf-cookie');

export async function login(email: string, password: string) {
	await csrfCookie();
	await api('login', { method: 'POST', body: JSON.stringify({ email, password, remember: true }) });
}

export async function register(name: string, email: string, password: string, passwordConfirmation: string) {
	await csrfCookie();
	await api('register', { method: 'POST', body: JSON.stringify({ name, email, password, password_confirmation: passwordConfirmation }) });
}

export const logout = () => api('logout', { method: 'POST' });

const NAME_FILES = import.meta.glob<Record<string, string>>('../../names/*/{companies,cities,cargo}.json', { import: 'default' });
const names = (game: GameId, kind: Exclude<NameKind, 'trucks'>) => NAME_FILES[`../../names/${game}/${kind}.json`]();

const UNFINISHED = ['running', 'suspended'];
// Cancelling an external (WoT) job sends no SDK event and a bus job cancel event is not known, so both are marked by hand on the page.
export const canCancelByHand = (j: Job) => (j.kind === 'bus' || !!j.telemetry?.market?.startsWith('external_')) && UNFINISHED.includes(j.status);

export async function loadGame(game: GameId): Promise<GameData> {
	const [{ jobs, depots, cancellations, refuels }, companies, cities, cargo] = await Promise.all([
		api<{ jobs: (Job & { truck_name: string | null })[]; depots: { city: string; company: string }[]; cancellations: string[]; refuels: Refuel[] }>(`games/${game}`),
		names(game, 'companies'),
		names(game, 'cities'),
		names(game, 'cargo'),
	]);
	const data: GameData = {
		game,
		jobs: jobs.map(({ truck_name: _truckName, ...job }) => job),
		depots: {},
		names: { companies, cities, cargo, trucks: {} },
		refuels,
	};
	// The game sends the truck name only with a job, so a truck is named after its latest job (jobs come newest first).
	for (const j of jobs) if (j.truck && j.truck_name) data.names.trucks[j.truck] ??= j.truck_name;
	for (const d of depots) (data.depots[d.city] ??= []).push(d.company);
	const cancelled = new Set(cancellations);
	for (const j of data.jobs) {
		if (cancelled.has(j.id) && canCancelByHand(j)) {
			j.status = 'cancelled';
			j.cancelledByHand = true;
		}
	}
	return data;
}

export const setCancelledByHand = (game: GameId, id: string, cancelled: boolean) =>
	api(`games/${game}/cancellations/${encodeURIComponent(id)}`, { method: cancelled ? 'PUT' : 'DELETE' });

export const latestTracePoint = async (game: GameId) => (await api<{ point: TracePoint | null }>(`games/${game}/position`)).point;

export type Token = { id: number; name: string; last_used_at: string | null; created_at: string };

export const tokens = () => api<Token[]>('tokens');
export const createToken = (name: string) => api<{ id: number; token: string }>('tokens', { method: 'POST', body: JSON.stringify({ name }) });
export const deleteToken = (id: number) => api(`tokens/${id}`, { method: 'DELETE' });
