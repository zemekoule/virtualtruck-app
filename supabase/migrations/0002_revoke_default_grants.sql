-- After 0001 the page roles had all privileges on all tables (only RLS kept them out), so grant them only what 0001 intended.
revoke all on events, trace, jobs, depots, names, cancellations from anon, authenticated;
grant select on jobs, depots, names, cancellations to anon;
grant insert, delete on cancellations to anon;
