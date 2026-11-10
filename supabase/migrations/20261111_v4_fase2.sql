-- =====================================================================
-- HIXSA - Registro de visitantes
-- Migración v4, fase 2: recepción y seguridad.
--   Perfiles de visitantes (recurrentes y bloqueos), aprobación del anfitrión,
--   selfie para salas de juntas, equipo de cómputo, validación de horario con
--   entradas autorizadas, intentos de acceso y códigos de verificación.
--
-- Requiere: 20261110_v4_fase1.sql ya ejecutada.
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run (idempotente).
-- =====================================================================

-- 1) CONFIGURACIÓN: minutos de llegada temprana -------------------------
alter table public.configuracion
  add column if not exists minutos_anticipacion integer not null default 10;
alter table public.configuracion drop constraint if exists configuracion_anticipacion;
alter table public.configuracion
  add constraint configuracion_anticipacion check (minutos_anticipacion between 0 and 240);
grant update (minutos_anticipacion) on table public.configuracion to authenticated;

-- 2) ROLES: nueva sección "Configuración: visitantes" -------------------
alter table public.roles drop constraint if exists roles_secciones;
alter table public.roles add constraint roles_secciones check (secciones <@ array[
  'recepcion', 'tablero', 'consultas', 'reportes',
  'config_usuarios', 'config_roles', 'config_empresas', 'config_anfitriones',
  'config_visitantes', 'config_correos', 'config_bitacora'
]::text[]);
update public.roles set secciones = array_append(secciones, 'config_visitantes')
 where id in ('superadmin', 'admin') and not ('config_visitantes' = any (secciones));

-- 3) PERFILES DE VISITANTES ------------------------------------------------
create table if not exists public.personas (
  id                     uuid        primary key default gen_random_uuid(),
  correo                 text        not null,
  nombre                 text,
  apellidos              text,
  telefono               text,
  empresa                text,
  tipo_identificacion    text,
  identificacion_detalle text,
  identificacion_path    text,
  selfie_path            text,
  equipo_tipo            text,
  equipo_marca           text,
  equipo_serie           text,
  recurrente             boolean     not null default false,
  estado_bloqueo         text        not null default 'ninguno',
  bloqueo_motivo         text,
  bloqueado_por          uuid        references auth.users (id) on delete set null,
  bloqueado_at           timestamptz,
  ultima_visita_at       timestamptz,
  origen                 text        not null default 'formulario',
  origen_id              text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint personas_correo_formato check (correo ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'),
  constraint personas_bloqueo check (estado_bloqueo in ('ninguno', 'no_deseado', 'restringido', 'bloqueado')),
  constraint personas_bloqueo_motivo check (bloqueo_motivo is null or char_length(bloqueo_motivo) <= 300),
  constraint personas_origen check (origen in ('formulario', 'glide', 'importacion'))
);
create unique index if not exists personas_correo_unico on public.personas (lower(correo));
comment on table public.personas is 'Perfil de cada visitante (uno por correo). Datos personales: solo personal activo.';

-- 4) COLUMNAS NUEVAS EN VISITAS ---------------------------------------------
alter table public.visitantes
  add column if not exists persona_id            uuid references public.personas (id) on delete set null,
  add column if not exists sala_juntas           boolean not null default false,
  add column if not exists selfie_path           text,
  add column if not exists equipo_tipo           text,
  add column if not exists equipo_marca          text,
  add column if not exists equipo_serie          text,
  -- Las visitas anteriores quedan aprobadas; las nuevas las define la Edge Function
  add column if not exists estado_aprobacion     text not null default 'aprobada',
  add column if not exists aprobacion_por        text,
  add column if not exists aprobacion_usuario    uuid references auth.users (id) on delete set null,
  add column if not exists aprobacion_at         timestamptz,
  add column if not exists aprobacion_token_hash text,
  add column if not exists entrada_fuera_horario boolean not null default false,
  add column if not exists autorizacion_motivo   text,
  add column if not exists autorizado_por        uuid references auth.users (id) on delete set null;

alter table public.visitantes
  drop constraint if exists visitantes_aprobacion,
  drop constraint if exists visitantes_aprobacion_por,
  drop constraint if exists visitantes_equipo,
  drop constraint if exists visitantes_autorizacion;
alter table public.visitantes
  add constraint visitantes_aprobacion check (estado_aprobacion in ('pendiente', 'aprobada', 'rechazada')),
  add constraint visitantes_aprobacion_por check (aprobacion_por is null or aprobacion_por in ('anfitrion', 'recepcion', 'sistema')),
  add constraint visitantes_equipo check (
    (equipo_tipo is null or char_length(equipo_tipo) <= 40)
    and (equipo_marca is null or char_length(equipo_marca) <= 60)
    and (equipo_serie is null or char_length(equipo_serie) <= 80)),
  add constraint visitantes_autorizacion check (
    not entrada_fuera_horario or (autorizacion_motivo is not null and char_length(btrim(autorizacion_motivo)) >= 5));

create index if not exists visitantes_persona_idx on public.visitantes (persona_id);
create index if not exists visitantes_token_idx on public.visitantes (aprobacion_token_hash) where aprobacion_token_hash is not null;

-- Perfiles a partir de las visitas existentes (los datos más recientes de cada correo)
insert into public.personas (correo, nombre, apellidos, telefono, empresa, tipo_identificacion,
                             identificacion_detalle, identificacion_path, recurrente, ultima_visita_at, created_at)
select distinct on (lower(v.correo))
       lower(v.correo), v.nombre, v.apellidos, v.telefono, v.empresa, v.tipo_identificacion,
       v.identificacion_detalle, v.identificacion_path,
       count(*) over (partition by lower(v.correo)) > 1,
       max(v.entrada) over (partition by lower(v.correo)),
       min(v.created_at) over (partition by lower(v.correo))
  from public.visitantes v
 order by lower(v.correo), v.entrada desc
on conflict do nothing;
update public.visitantes v set persona_id = p.id
  from public.personas p
 where v.persona_id is null and lower(v.correo) = lower(p.correo);

-- 5) INTENTOS DE ACCESO --------------------------------------------------------
create table if not exists public.intentos_acceso (
  id                  bigint      generated always as identity primary key,
  created_at          timestamptz not null default now(),
  visita_id           uuid        references public.visitantes (id) on delete set null,
  folio               text,
  resultado           text        not null,
  motivo              text        not null,
  detalle             text,
  usuario_id          uuid        references auth.users (id) on delete set null,
  usuario_email       text,
  autorizacion_motivo text,
  constraint intentos_resultado check (resultado in ('rechazado', 'autorizado')),
  constraint intentos_motivo check (motivo in (
    'anticipado', 'tarde', 'fecha_no_asignada', 'caducado', 'bloqueado', 'restringido',
    'pendiente_aprobacion', 'rechazada_anfitrion', 'no_coincide'))
);
create index if not exists intentos_fecha_idx on public.intentos_acceso (created_at desc);
create index if not exists intentos_visita_idx on public.intentos_acceso (visita_id);

-- 6) CÓDIGOS DE VERIFICACIÓN Y TOKENS DE RECURRENTES (solo Edge Functions) ------
create table if not exists public.verificaciones (
  id         bigint      generated always as identity primary key,
  created_at timestamptz not null default now(),
  correo     text        not null,
  tipo       text        not null,
  hash       text        not null,
  expira_at  timestamptz not null,
  intentos   integer     not null default 0,
  usado_at   timestamptz,
  constraint verificaciones_tipo check (tipo in ('codigo', 'token'))
);
create index if not exists verificaciones_correo_idx on public.verificaciones (lower(correo), tipo, created_at desc);

-- 7) RLS -------------------------------------------------------------------------
alter table public.personas        enable row level security;
alter table public.intentos_acceso enable row level security;
alter table public.verificaciones  enable row level security;
revoke all on table public.personas        from anon, authenticated;
revoke all on table public.intentos_acceso from anon, authenticated;
revoke all on table public.verificaciones  from anon, authenticated;

-- personas: las lee el personal activo; los cambios (bloqueos) pasan por la Edge Function
grant select on table public.personas to authenticated;
drop policy if exists "Personal activo ve perfiles de visitantes" on public.personas;
create policy "Personal activo ve perfiles de visitantes" on public.personas for select to authenticated
  using ((select public.es_usuario_activo()));

-- intentos: los ve el personal activo, solo de visitas que puede ver (alcance y auditoría)
grant select on table public.intentos_acceso to authenticated;
drop policy if exists "Personal ve intentos de sus visitas" on public.intentos_acceso;
create policy "Personal ve intentos de sus visitas" on public.intentos_acceso for select to authenticated
  using ((select public.es_usuario_activo())
         and (visita_id is null or exists (select 1 from public.visitantes v where v.id = visita_id)));

-- verificaciones: sin acceso desde el navegador (solo service_role)

-- Bitácora: los bloqueos se registran desde la Edge Function; el trigger cubre cambios directos
drop trigger if exists bitacora_personas on public.personas;
create trigger bitacora_personas after insert or update or delete on public.personas
  for each row execute function public.registrar_cambio();

-- Verificación
select (select count(*) from public.personas) as perfiles,
       (select count(*) from public.visitantes where persona_id is null) as visitas_sin_perfil,
       (select minutos_anticipacion from public.configuracion where id = 1) as minutos_anticipacion;
