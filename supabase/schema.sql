-- =====================================================================
-- HIXSA - Registro de visitantes (v3)
-- Esquema completo para Supabase (PostgreSQL).
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run
-- Es idempotente: sirve para instalación nueva y para actualizar la v1 o la v2.
-- =====================================================================

-- 0) FOLIO LEGIBLE ------------------------------------------------------
-- Ejemplo: HX-261022-7F3A9
create or replace function public.generar_folio()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'HX-'
    || to_char(now() at time zone 'America/Mexico_City', 'YYMMDD')
    || '-'
    || upper(substr(md5(gen_random_uuid()::text), 1, 5));
$$;

-- 1) VISITANTES ---------------------------------------------------------
create table if not exists public.visitantes (
  id              uuid        primary key default gen_random_uuid(),
  -- created_at: momento en que se llenó el formulario
  created_at      timestamptz not null    default now(),
  nombre_completo text        not null,
  empresa         text        not null,
  correo          text        not null,
  telefono        text        not null,
  persona_visita  text        not null,
  motivo          text        not null,
  comentarios     text,
  acepta_aviso    boolean     not null    default false
);

-- Columnas nuevas de la v2 (seguras si ya existen)
alter table public.visitantes
  add column if not exists folio         text,
  add column if not exists entrada       timestamptz,
  add column if not exists salida        timestamptz,
  add column if not exists qr_enviado_at timestamptz,
  add column if not exists correo_error  text;

-- Registros de la v1 (sin horario): se usa la hora de registro + 1 h
update public.visitantes set folio = public.generar_folio() where folio is null;
update public.visitantes set entrada = created_at where entrada is null;
update public.visitantes set salida = entrada + interval '1 hour' where salida is null;

alter table public.visitantes
  alter column folio   set default public.generar_folio(),
  alter column folio   set not null,
  alter column entrada set not null,
  alter column salida  set not null;

-- Validaciones en el servidor (se recrean para poder re-ejecutar)
alter table public.visitantes
  drop constraint if exists visitantes_folio_unico,
  drop constraint if exists visitantes_nombre_len,
  drop constraint if exists visitantes_empresa_len,
  drop constraint if exists visitantes_correo_formato,
  drop constraint if exists visitantes_telefono_formato,
  drop constraint if exists visitantes_persona_len,
  drop constraint if exists visitantes_motivo_valido,
  drop constraint if exists visitantes_comentarios_len,
  drop constraint if exists visitantes_acepta_aviso,
  drop constraint if exists visitantes_horario;

alter table public.visitantes
  add constraint visitantes_folio_unico unique (folio),
  add constraint visitantes_nombre_len
    check (char_length(btrim(nombre_completo)) between 3 and 120),
  add constraint visitantes_empresa_len
    check (char_length(btrim(empresa)) between 2 and 120),
  add constraint visitantes_correo_formato check (
    char_length(correo) <= 254
    and correo ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
  ),
  add constraint visitantes_telefono_formato
    check (telefono ~ '^\+?[0-9]{10,15}$'),
  add constraint visitantes_persona_len
    check (char_length(btrim(persona_visita)) between 3 and 120),
  add constraint visitantes_motivo_valido check (motivo in (
    'Reunión', 'Entrevista', 'Proveedor o servicio', 'Entrega o paquetería', 'Otro'
  )),
  add constraint visitantes_comentarios_len
    check (comentarios is null or char_length(comentarios) <= 500),
  add constraint visitantes_acepta_aviso
    check (acepta_aviso is true),
  -- La salida es posterior a la entrada y la visita dura máximo 7 días
  add constraint visitantes_horario
    check (salida > entrada and salida <= entrada + interval '7 days');

create index if not exists visitantes_entrada_idx
  on public.visitantes (entrada desc);
create index if not exists visitantes_empresa_idx
  on public.visitantes (lower(empresa));

comment on table public.visitantes
  is 'Visitas a oficinas HIXSA. Se insertan solo vía la Edge Function registrar-visita.';
comment on column public.visitantes.entrada is 'Fecha y hora de entrada elegida por el visitante.';
comment on column public.visitantes.salida  is 'Fecha y hora de salida elegida por el visitante.';

-- 2) PERFILES DE USUARIOS INTERNOS -------------------------------------
create table if not exists public.perfiles (
  id         uuid        primary key references auth.users (id) on delete cascade,
  email      text        not null,
  nombre     text        not null,
  rol        text        not null default 'consulta',
  activo     boolean     not null default true,
  created_at timestamptz not null default now(),
  constraint perfiles_rol_valido check (rol in ('admin', 'consulta'))
);

-- 3) CONFIGURACIÓN (una sola fila) --------------------------------------
create table if not exists public.configuracion (
  id                    smallint    primary key default 1,
  correo_recepcion      text,
  copia_recepcion       boolean     not null default false,
  destinatarios_reporte text[]      not null default '{}',
  updated_at            timestamptz not null default now(),
  updated_by            uuid        references auth.users (id) on delete set null,
  constraint configuracion_fila_unica check (id = 1),
  constraint configuracion_max_destinatarios
    check (coalesce(array_length(destinatarios_reporte, 1), 0) <= 10)
);
insert into public.configuracion (id) values (1) on conflict (id) do nothing;

-- 4) BITÁCORA DE REPORTES ENVIADOS --------------------------------------
create table if not exists public.bitacora_reportes (
  id              bigint      generated always as identity primary key,
  created_at      timestamptz not null default now(),
  origen          text        not null,
  enviado_por     uuid        references auth.users (id) on delete set null,
  destinatarios   text[]      not null,
  filtros         jsonb       not null default '{}',
  total_registros integer     not null,
  constraint bitacora_origen_valido
    check (origen in ('panel', 'automatico', 'claude-code'))
);

-- 5) FUNCIONES DE APOYO PARA RLS ----------------------------------------
create or replace function public.es_usuario_activo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = (select auth.uid()) and p.activo
  );
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = (select auth.uid()) and p.activo and p.rol = 'admin'
  );
$$;

revoke execute on function public.es_usuario_activo() from public, anon;
revoke execute on function public.es_admin()          from public, anon;
grant  execute on function public.es_usuario_activo() to authenticated;
grant  execute on function public.es_admin()          to authenticated;

-- 6) SEGURIDAD A NIVEL DE FILA (RLS) ------------------------------------
alter table public.visitantes        enable row level security;
alter table public.perfiles          enable row level security;
alter table public.configuracion     enable row level security;
alter table public.bitacora_reportes enable row level security;

-- Sin permisos por defecto para los roles públicos
revoke all on table public.visitantes        from anon, authenticated;
revoke all on table public.perfiles          from anon, authenticated;
revoke all on table public.configuracion     from anon, authenticated;
revoke all on table public.bitacora_reportes from anon, authenticated;

-- La política anónima de la v1 ya no se usa: ahora inserta la Edge Function
drop policy if exists "Registro anonimo de visitantes" on public.visitantes;

-- visitantes: lectura para usuarios internos activos
grant select on table public.visitantes to authenticated;
drop policy if exists "Usuarios activos consultan visitas" on public.visitantes;
create policy "Usuarios activos consultan visitas"
  on public.visitantes for select to authenticated
  using ((select public.es_usuario_activo()));

-- perfiles: cada quien ve el suyo; el admin ve todos
grant select on table public.perfiles to authenticated;
drop policy if exists "Ver perfil propio o todos si es admin" on public.perfiles;
create policy "Ver perfil propio o todos si es admin"
  on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select public.es_admin()));

-- configuracion: la leen los usuarios activos; solo el admin la cambia
grant select on table public.configuracion to authenticated;
grant update (correo_recepcion, copia_recepcion, destinatarios_reporte, updated_at, updated_by)
  on table public.configuracion to authenticated;
drop policy if exists "Usuarios activos leen configuracion" on public.configuracion;
create policy "Usuarios activos leen configuracion"
  on public.configuracion for select to authenticated
  using ((select public.es_usuario_activo()));
drop policy if exists "Admin actualiza configuracion" on public.configuracion;
create policy "Admin actualiza configuracion"
  on public.configuracion for update to authenticated
  using ((select public.es_admin()))
  with check ((select public.es_admin()));

-- bitacora_reportes: solo el admin la consulta
grant select on table public.bitacora_reportes to authenticated;
drop policy if exists "Admin consulta bitacora" on public.bitacora_reportes;
create policy "Admin consulta bitacora"
  on public.bitacora_reportes for select to authenticated
  using ((select public.es_admin()));

-- Nota: anon no tiene ningún permiso. Los registros públicos, el alta de
-- usuarios y el envío de reportes pasan por Edge Functions con service_role.

-- =====================================================================
-- v3: anfitriones, identificación con foto, llegada y salida reales
-- =====================================================================

-- 7) ANFITRIONES (personal que recibe visitas) --------------------------
create table if not exists public.anfitriones (
  id         uuid        primary key default gen_random_uuid(),
  nombre     text        not null,
  area       text,
  correo     text,
  activo     boolean     not null default true,
  created_at timestamptz not null default now(),
  constraint anfitriones_nombre_len check (char_length(btrim(nombre)) between 3 and 120),
  constraint anfitriones_area_len   check (area is null or char_length(area) <= 80),
  constraint anfitriones_correo_formato check (
    correo is null or correo ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
  )
);

-- 8) COLUMNAS NUEVAS EN VISITANTES ----------------------------------------
alter table public.visitantes
  add column if not exists anfitrion_id          uuid references public.anfitriones (id) on delete set null,
  add column if not exists tipo_identificacion   text,
  add column if not exists identificacion_detalle text,
  add column if not exists identificacion_path   text,
  add column if not exists llegada_at            timestamptz,
  add column if not exists llegada_por           uuid references auth.users (id) on delete set null,
  add column if not exists salida_real_at        timestamptz,
  add column if not exists salida_por            uuid references auth.users (id) on delete set null,
  add column if not exists anfitrion_avisado_at  timestamptz;

alter table public.visitantes
  drop constraint if exists visitantes_tipo_identificacion,
  drop constraint if exists visitantes_identificacion_detalle,
  drop constraint if exists visitantes_salida_real;

alter table public.visitantes
  -- Nulo solo en registros anteriores a la v3
  add constraint visitantes_tipo_identificacion check (
    tipo_identificacion is null
    or tipo_identificacion in ('INE', 'Licencia', 'Pasaporte', 'ID empresa', 'Otro')
  ),
  add constraint visitantes_identificacion_detalle check (
    identificacion_detalle is null or char_length(identificacion_detalle) <= 60
  ),
  -- La salida real solo existe después de la llegada real
  add constraint visitantes_salida_real check (
    salida_real_at is null or (llegada_at is not null and salida_real_at >= llegada_at)
  );

create index if not exists visitantes_anfitrion_idx on public.visitantes (anfitrion_id);

comment on column public.visitantes.identificacion_path is
  'Ruta de la foto en el bucket privado identificaciones. Dato personal sensible.';
comment on column public.visitantes.llegada_at     is 'Llegada real, registrada al escanear el QR en recepción.';
comment on column public.visitantes.salida_real_at is 'Salida real, registrada al escanear el QR al salir.';

-- 9) CONFIGURACIÓN: aviso al anfitrión ---------------------------------
alter table public.configuracion
  add column if not exists avisar_anfitrion boolean not null default true;
grant update (avisar_anfitrion) on table public.configuracion to authenticated;

-- 10) RLS DE ANFITRIONES -------------------------------------------------
alter table public.anfitriones enable row level security;
revoke all on table public.anfitriones from anon, authenticated;

-- El formulario público solo ve nombre y área de anfitriones activos (nunca el correo)
grant select (id, nombre, area) on table public.anfitriones to anon;
drop policy if exists "Publico ve anfitriones activos" on public.anfitriones;
create policy "Publico ve anfitriones activos"
  on public.anfitriones for select to anon
  using (activo);

-- Personal activo ve todo; solo el admin agrega o edita (no se borran: se desactivan)
grant select on table public.anfitriones to authenticated;
grant insert (nombre, area, correo, activo), update (nombre, area, correo, activo)
  on table public.anfitriones to authenticated;
drop policy if exists "Personal activo ve anfitriones" on public.anfitriones;
create policy "Personal activo ve anfitriones"
  on public.anfitriones for select to authenticated
  using ((select public.es_usuario_activo()));
drop policy if exists "Admin agrega anfitriones" on public.anfitriones;
create policy "Admin agrega anfitriones"
  on public.anfitriones for insert to authenticated
  with check ((select public.es_admin()));
drop policy if exists "Admin edita anfitriones" on public.anfitriones;
create policy "Admin edita anfitriones"
  on public.anfitriones for update to authenticated
  using ((select public.es_admin()))
  with check ((select public.es_admin()));

-- 11) FOTOS DE IDENTIFICACIÓN (Storage privado) -------------------------
-- Las sube solo la Edge Function registrar-visita. El personal activo las ve
-- con ligas firmadas que caducan; el público no puede leer ni listar nada.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identificaciones', 'identificaciones', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Personal activo ve identificaciones" on storage.objects;
create policy "Personal activo ve identificaciones"
  on storage.objects for select to authenticated
  using (bucket_id = 'identificaciones' and (select public.es_usuario_activo()));
