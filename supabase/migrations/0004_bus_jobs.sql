-- Bus jobs (ETS2 bus DLC, plugin >= 1.7.0); their stages are in telemetry.bus.
alter table jobs drop constraint jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in ('truck', 'car', 'bus'));
