-- The live map on the page polls the latest trace point (position and break countdown).
grant select on trace to anon;
create policy "page reads trace" on trace for select to anon using (true);
