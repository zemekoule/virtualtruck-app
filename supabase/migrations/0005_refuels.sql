-- Refuels found by the sync script in the trace (fuel added while standing at a pump or an own garage).
create table refuels (
	game text not null check (game in ('ats', 'eut2')),
	wall timestamptz not null,
	game_time integer,
	truck text,
	litres real not null,
	country text not null,
	garage boolean not null,
	price real not null,
	primary key (game, wall)
);

alter table refuels enable row level security;
revoke all on refuels from anon, authenticated;
grant select, insert, update, delete on refuels to service_role;
grant select on refuels to anon;
create policy "page reads refuels" on refuels for select to anon using (true);
