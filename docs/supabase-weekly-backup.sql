-- Weekly automatic backup of the cellar, run inside Supabase.
-- Every Monday 03:00 UTC a snapshot of all wines + drinking history is
-- written to a `backups` table; the last 12 weekly snapshots are kept.
-- Photos live in the 'labels' storage bucket and on the devices, so they
-- are not duplicated here.
--
-- One-time setup: paste this whole file into the Supabase SQL Editor
-- and Run. (It enables the pg_cron extension the first time.)

create extension if not exists pg_cron;

create table if not exists public.backups (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null default 'weekly',
  payload jsonb not null
);

-- Locked down: no client policies. Snapshots are written by the scheduled
-- job (runs as the database owner) and read via the dashboard / Claude
-- with owner assistance if a restore is ever needed.
alter table public.backups enable row level security;

select cron.schedule(
  'weekly-cellar-backup',
  '0 3 * * 1',
  $$
  insert into public.backups (kind, payload)
  values ('weekly', jsonb_build_object(
    'taken_at', now(),
    'wines',  (select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) from public.wines  w),
    'drinks', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from public.drinks d)
  ));
  delete from public.backups
  where kind = 'weekly'
    and id not in (
      select id from public.backups
      where kind = 'weekly'
      order by created_at desc
      limit 12
    );
  $$
);

-- Take one snapshot immediately so there's a baseline before next Monday:
insert into public.backups (kind, payload)
values ('initial', jsonb_build_object(
  'taken_at', now(),
  'wines',  (select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) from public.wines  w),
  'drinks', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from public.drinks d)
));
