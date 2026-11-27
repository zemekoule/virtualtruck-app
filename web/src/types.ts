// The shape of the jobs build.py computes (page/build.py telemetry_job) and import_save.py adds.

export type GameId = 'ats' | 'eut2';
export type JobKind = 'truck' | 'car' | 'bus';
export type JobStatus = 'delivered' | 'cancelled' | 'running' | 'suspended';

export type TimelineEntry = {
	wall: number;
	game_time: number | null;
	km: number;
	type: 'start' | 'trailer' | 'loaded' | 'break' | 'suspended' | 'damage' | 'incident' | 'delivered' | 'cancelled' | 'running' | 'wait' | 'departure' | 'arrival';
	minutes?: number | null;
	rest_stop?: number | null;
	mandatory_break?: number | null;
	late?: number | null;
	resumed_wall?: number;
	damage?: Record<string, number>;
	id?: string;
	attrs?: Record<string, string | number>;
	// Bus stop name of a wait, departure or arrival.
	stop?: string | null;
};

export type Trailer = Record<string, string>;

export type TraceSummary = {
	driven_km: number;
	max_kmh: number;
	avg_kmh: number;
	fuel_used: number;
	fuel_cost?: number | null;
	onboard_consumption?: number | null;
	speeding_pct: number | null;
	max_over_kmh: number;
	approach: { kind: 'trailer' | 'loading'; index: number; km: number; minutes: number; path_index: number } | null;
	wear: Record<string, number> | null;
	wear_end?: Record<string, number> | null;
	path: [number, number][];
};

export type BusStop = { type: string | null; id: string | null; name: string | null };

// Times are absolute game minutes; the actual ones only once they happened.
export type BusStage = {
	from: BusStop;
	to: BusStop;
	departure: { planned: number | null; actual: number | null };
	arrival: { planned: number | null; actual: number | null };
	entering: number | null;
	leaving: number | null;
};

export type Telemetry = {
	start: number;
	end: number;
	market: string | null;
	planned_km: number | null;
	deadline: number | null;
	cargo_damage: number | null;
	vehicle_damage: number | null;
	trailers: Trailer[];
	fuel_capacity?: number | null;
	// Plugin >= 1.9.0.
	plate?: string | null;
	auto_park: boolean | null;
	auto_load: boolean | null;
	incidents: { id: string; attrs: Record<string, string | number> }[];
	trace: TraceSummary | null;
	timeline: TimelineEntry[];
	bus?: { satisfaction: number | null; stages: BusStage[] };
};

export type CarRating = {
	rating: number;
	satisfaction: { cargo: number; time: number; car: number };
	priority: { cargo: boolean; time: boolean; car: boolean };
	provisional_reward: number;
};

export type Job = {
	id: string;
	kind: JobKind;
	status: JobStatus;
	game_time: number;
	src_company: string | null;
	src_city: string | null;
	dst_company: string | null;
	dst_city: string | null;
	cargo: string | null;
	xp: number | null;
	revenue: number | null;
	km: number | null;
	truck: string | null;
	mass: number | null;
	units: number | null;
	car: CarRating | null;
	telemetry: Telemetry | null;
	cancelledByHand?: boolean;
};

export type RecordedJob = Job & { telemetry: Telemetry };

export type NameKind = 'companies' | 'cities' | 'cargo' | 'trucks';

export type GameData = {
	game: GameId;
	jobs: Job[];
	depots: Record<string, string[]>;
	names: Record<NameKind, Record<string, string>>;
	refuels: Refuel[];
};

// Found by sync.py in the trace; price per litre in the game's currency, with the own garage discount.
export type Refuel = { wall: string; game_time: number | null; truck: string | null; litres: number; country: string; garage: boolean; price: number };

// One line of data/<game>/trace.jsonl written by the plugin (only the fields the page reads).
export type TracePoint = {
	wall: number;
	x: number;
	z: number;
	rest_stop: number | null;
	mandatory_break: number | null;
};
