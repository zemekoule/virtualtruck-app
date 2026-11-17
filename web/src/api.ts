import type { GameData, GameId, Job, Refuel, TracePoint } from './types';

const SUPABASE_URL = `https://${SUPABASE.projectId}.supabase.co/rest/v1/`;
const PAGE_ROWS = 1000;

async function supabase<T>(path: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(SUPABASE_URL + path, { ...options, headers: { apikey: SUPABASE.publishableKey, 'Content-Type': 'application/json', ...options.headers } });
	const text = await response.text();
	if (!response.ok) throw new Error(`${response.status} ${text}`);
	return text ? JSON.parse(text) : (null as T);
}

async function selectAll<T>(path: string): Promise<T[]> {
	// The Data API returns at most 1000 rows per request.
	const rows: T[] = [];
	for (;;) {
		const page = await supabase<T[]>(`${path}&limit=${PAGE_ROWS}&offset=${rows.length}`);
		rows.push(...page);
		if (page.length < PAGE_ROWS) return rows;
	}
}

const UNFINISHED = ['running', 'suspended'];
// Cancelling an external (WoT) job sends no SDK event and a bus job cancel event is not known, so both are marked by hand on the page.
export const canCancelByHand = (j: Job) => (j.kind === 'bus' || !!j.telemetry?.market?.startsWith('external_')) && UNFINISHED.includes(j.status);

export async function loadGame(game: GameId): Promise<GameData> {
	const [jobs, depots, names, cancellations, refuels] = await Promise.all([
		selectAll<Job & { game: string; source: string }>(`jobs?game=eq.${game}&select=*&order=game_time.desc,id`),
		selectAll<{ city: string; company: string }>(`depots?game=eq.${game}&select=city,company&order=city,company`),
		selectAll<{ kind: keyof GameData['names']; id: string; name: string }>(`names?game=eq.${game}&select=kind,id,name&order=kind,id`),
		selectAll<{ job_id: string }>(`cancellations?game=eq.${game}&select=job_id&order=job_id`),
		selectAll<Refuel>(`refuels?game=eq.${game}&select=wall,game_time,truck,litres,country,garage,price&order=wall.desc`),
	]);
	const data: GameData = {
		game,
		jobs: jobs.map(({ game: _game, source: _source, ...job }) => job),
		depots: {},
		names: { companies: {}, cities: {}, cargo: {}, trucks: {} },
		refuels,
	};
	for (const d of depots) (data.depots[d.city] ??= []).push(d.company);
	for (const n of names) data.names[n.kind][n.id] = n.name;
	for (const { job_id } of cancellations) {
		const j = data.jobs.find(j => j.id === job_id);
		if (j && canCancelByHand(j)) {
			j.status = 'cancelled';
			j.cancelledByHand = true;
		}
	}
	return data;
}

export const setCancelledByHand = (game: GameId, id: string, cancelled: boolean) => cancelled
	? supabase('cancellations', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ game, job_id: id }) })
	: supabase(`cancellations?game=eq.${game}&job_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });

export async function latestTracePoint(game: GameId): Promise<TracePoint | null> {
	const rows = await supabase<{ data: TracePoint }[]>(`trace?game=eq.${game}&select=data&order=seq.desc&limit=1`);
	return rows[0]?.data ?? null;
}
