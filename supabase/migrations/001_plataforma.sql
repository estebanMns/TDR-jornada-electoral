-- 001 · Plataforma (Meneses): usuarios, verificaciones y usuarios demo.
-- Ejecutar antes de 010_* (Jose) y 020_* (Evelyn). Idempotente.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Usuarios (GENERAL §4, §6.2). La contraseña va con bcrypt ($2a$, compatible con bcryptjs).
-- ---------------------------------------------------------------------------
create table if not exists public.usuarios (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  password_hash text not null,
  rol           text not null check (rol in ('JURADO', 'AUDITOR', 'COORDINADOR', 'ADMIN')),
  nombre        text not null,
  mesa          int null,
  creado_en     timestamptz not null default now(),
  constraint jurado_tiene_mesa check ((rol = 'JURADO') = (mesa is not null))
);

-- ---------------------------------------------------------------------------
-- Decisiones de auditoría (RF-7). `fencing` es monótono: permite detectar en el
-- histórico a un auditor tardío (su fencing es menor que el de la decisión vigente).
-- ---------------------------------------------------------------------------
create table if not exists public.verificaciones (
  id               bigserial primary key,
  acta_id          text not null,
  version          int not null,
  auditor          uuid not null references public.usuarios (id),
  decision         text not null check (decision in ('APROBAR', 'APROBAR_CON_CORRECCION', 'RECHAZAR')),
  votos_corregidos jsonb null,
  motivo           text null,
  fencing          bigint not null,
  creado_en        timestamptz not null default now(),
  unique (acta_id, fencing)
);
create index if not exists verificaciones_acta_idx on public.verificaciones (acta_id, version);

-- Solo el servidor (service_role) accede: RLS activa y sin políticas = sin acceso
-- desde la clave anónima del navegador.
alter table public.usuarios enable row level security;
alter table public.verificaciones enable row level security;

-- ---------------------------------------------------------------------------
-- Usuarios demo (contraseñas de demostración: cambiarlas antes de la jornada).
--   admin / admin-demo · coordinador / coord-demo · auditor001…auditor120 / auditor-demo
-- Los jurados (uno por mesa) los crea el seed de Jose.
-- ---------------------------------------------------------------------------
insert into public.usuarios (username, password_hash, rol, nombre)
values
  ('admin',       extensions.crypt('admin-demo', extensions.gen_salt('bf', 10)), 'ADMIN',       'Administración'),
  ('coordinador', extensions.crypt('coord-demo', extensions.gen_salt('bf', 10)), 'COORDINADOR', 'Coordinación general')
on conflict (username) do nothing;

insert into public.usuarios (username, password_hash, rol, nombre)
select
  format('auditor%s', lpad(n::text, 3, '0')),
  extensions.crypt('auditor-demo', extensions.gen_salt('bf', 10)),
  'AUDITOR',
  format('Auditor %s', lpad(n::text, 3, '0'))
from generate_series(1, 120) as n
on conflict (username) do nothing;
