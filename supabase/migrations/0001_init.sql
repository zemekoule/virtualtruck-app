-- Raw plugin data: one row per line of data/<game>/events.jsonl and trace.jsonl (seq = line number).
create table events (
	game text not null check (game in ('ats', 'eut2')),
	seq integer not null,
	wall timestamptz not null,
	game_time integer,
	type text not null,
	data jsonb not null,
	primary key (game, seq)
);

create table trace (
	game text not null check (game in ('ats', 'eut2')),
	seq integer not null,
	wall timestamptz not null,
	game_time integer,
	data jsonb not null,
	primary key (game, seq)
);

-- Jobs computed by the sync script from the plugin data, plus jobs imported from a save that the plugin did not record.
create table jobs (
	game text not null check (game in ('ats', 'eut2')),
	id text not null,
	source text not null check (source in ('plugin', 'save')),
	kind text not null check (kind in ('truck', 'car')),
	status text not null check (status in ('delivered', 'cancelled', 'running', 'suspended')),
	game_time integer not null,
	src_company text,
	src_city text,
	dst_company text,
	dst_city text,
	cargo text,
	xp integer,
	revenue integer,
	km integer,
	truck text,
	mass real,
	units integer,
	car jsonb,
	telemetry jsonb,
	primary key (game, id)
);
create index jobs_game_time on jobs (game, game_time desc);

create table depots (
	game text not null check (game in ('ats', 'eut2')),
	city text not null,
	company text not null,
	primary key (game, city, company)
);

create table names (
	game text not null check (game in ('ats', 'eut2')),
	kind text not null check (kind in ('companies', 'cities', 'cargo', 'trucks')),
	id text not null,
	name text not null,
	primary key (game, kind, id)
);

-- Cancelling an external (WoT) job sends no SDK event, so it is marked by hand on the page.
create table cancellations (
	game text not null check (game in ('ats', 'eut2')),
	job_id text not null,
	created_at timestamptz not null default now(),
	primary key (game, job_id)
);

alter table events enable row level security;
alter table trace enable row level security;
alter table jobs enable row level security;
alter table depots enable row level security;
alter table names enable row level security;
alter table cancellations enable row level security;

grant select, insert, update, delete on events, trace, jobs, depots, names, cancellations to service_role;

grant select on jobs, depots, names, cancellations to anon;
create policy "page reads jobs" on jobs for select to anon using (true);
create policy "page reads depots" on depots for select to anon using (true);
create policy "page reads names" on names for select to anon using (true);
create policy "page reads cancellations" on cancellations for select to anon using (true);

grant insert, delete on cancellations to anon;
create policy "page cancels jobs" on cancellations for insert to anon with check (true);
create policy "page restores jobs" on cancellations for delete to anon using (true);
