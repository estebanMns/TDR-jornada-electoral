-- 010 · Catalog and acta version history (owner: actas module). GENERAL §6.2.
-- Run AFTER 001 (platform): `usuarios` and `verificaciones` (auditor decisions)
-- belong to that migration.
--
-- Every table has RLS enabled and NO policies: only the server, using the
-- service-role key, reads or writes them. Browsers never talk to Postgres.

begin;

-- ---------------------------------------------------------------- catalog

create table if not exists public.municipalities (
  id   integer primary key,
  name text    not null
);

create table if not exists public.stations (
  id              integer primary key,
  municipality_id integer not null references public.municipalities (id),
  name            text    not null
);
create index if not exists stations_municipality_idx on public.stations (municipality_id);

create table if not exists public.voting_tables (
  id         integer primary key,           -- global table number (1..6400)
  station_id integer not null references public.stations (id),
  number     integer not null,              -- table number inside the station
  enabled    integer not null check (enabled > 0),
  acta_id    text    not null unique,
  unique (station_id, number)
);
create index if not exists voting_tables_station_idx on public.voting_tables (station_id);

create table if not exists public.vote_options (
  id    text primary key,                   -- C1..C5, BLANK, NULL, UNMARKED
  name  text not null,
  party text not null,
  color text not null
);

-- ---------------------------------------------------------------- actas

-- One row per received version. Written asynchronously by the persistence
-- worker (XREADGROUP on `ev:actas`), so Supabase is never on the hot path.
create table if not exists public.acta_versions (
  acta_id         text        not null,
  version         integer     not null check (version >= 1),
  table_id        integer     not null references public.voting_tables (id),
  station_id      integer     not null references public.stations (id),
  municipality_id integer     not null references public.municipalities (id),
  juror           text        not null,
  votes           jsonb       not null,
  voters          integer     not null check (voters >= 0),
  photo_hash      text        not null,
  photo_path      text,
  status          text        not null check (status in ('APPLIED', 'UNDER_REVIEW', 'CONFLICT', 'REJECTED', 'OBSOLETE')),
  reason          text,
  idempotency_key text        not null,
  instance        text        not null,
  received_at     timestamptz not null,
  primary key (acta_id, version)
);
create index if not exists acta_versions_table_idx on public.acta_versions (table_id);
create index if not exists acta_versions_status_idx on public.acta_versions (status);

alter table public.municipalities enable row level security;
alter table public.stations       enable row level security;
alter table public.voting_tables  enable row level security;
alter table public.vote_options   enable row level security;
alter table public.acta_versions  enable row level security;

-- ---------------------------------------------------------------- storage

-- Private bucket for acta photos: `{acta_id}/v{version}.jpg`.
-- Auditors only see them through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('acta-photos', 'acta-photos', false, 409600, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

commit;
