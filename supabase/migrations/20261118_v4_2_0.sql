-- =====================================================================
-- HIXSA - Registro de visitantes
-- Migración v4.2.0: horario de recepción, cancelación de visitas,
-- notificaciones del panel y respaldos.
-- Requiere: 20261116_v4_1_1.sql ya ejecutada. Idempotente.
-- =====================================================================

-- 1) Horario de recepción y opciones de respaldo
alter table public.configuracion
  add column if not exists hora_apertura       time    not null default '09:00',
  add column if not exists hora_ultima_entrada time    not null default '17:45',
  add column if not exists hora_cierre         time    not null default '18:00',
  add column if not exists respaldo_semanal    boolean not null default true,
  add column if not exists respaldo_mensual    boolean not null default true,
  add column if not exists respaldo_fotos      boolean not null default false;
alter table public.configuracion drop constraint if exists configuracion_horario;
alter table public.configuracion
  add constraint configuracion_horario check (hora_apertura < hora_ultima_entrada and hora_ultima_entrada <= hora_cierre);
grant update (hora_apertura, hora_ultima_entrada, hora_cierre, respaldo_semanal, respaldo_mensual, respaldo_fotos)
  on table public.configuracion to authenticated;

-- 2) Cancelación de visitas (personal, visitante o anfitrión)
alter table public.visitantes
  add column if not exists cancelada_at                    timestamptz,
  add column if not exists cancelada_por                   text,
  add column if not exists cancelacion_usuario             uuid references auth.users (id) on delete set null,
  add column if not exists cancelacion_motivo              text,
  add column if not exists cancelacion_detalle             text,
  add column if not exists cancelacion_token_hash          text,
  add column if not exists cancelacion_anfitrion_token_hash text;
alter table public.visitantes drop constraint if exists visitantes_cancelacion;
alter table public.visitantes add constraint visitantes_cancelacion check (
  cancelada_at is null or (
    cancelada_por in ('personal', 'visitante', 'anfitrion')
    and cancelacion_motivo in ('Cambio de agenda', 'El anfitrión no está disponible', 'Ya no es necesaria', 'Error en el registro', 'Otro')
    and (cancelacion_motivo <> 'Otro' or char_length(btrim(coalesce(cancelacion_detalle, ''))) >= 3)
    and (cancelacion_detalle is null or char_length(cancelacion_detalle) <= 300)));
create index if not exists visitantes_cancel_token_idx on public.visitantes (cancelacion_token_hash) where cancelacion_token_hash is not null;
create index if not exists visitantes_cancel_anf_token_idx on public.visitantes (cancelacion_anfitrion_token_hash) where cancelacion_anfitrion_token_hash is not null;

alter table public.intentos_acceso drop constraint if exists intentos_motivo;
alter table public.intentos_acceso add constraint intentos_motivo check (motivo in (
  'anticipado', 'tarde', 'fecha_no_asignada', 'caducado', 'bloqueado', 'restringido',
  'pendiente_aprobacion', 'rechazada_anfitrion', 'no_coincide', 'cancelada'));

alter table public.bitacora_cambios drop constraint if exists bitacora_cambios_accion;
alter table public.bitacora_cambios add constraint bitacora_cambios_accion check (accion in (
  'alta', 'edicion', 'baja', 'reenvio', 'invitacion', 'depuracion', 'cancelacion', 'respaldo', 'restauracion'));

-- 3) Notificaciones del panel (campana)
--    audiencia "operacion": Recepción, SUPERVISOR, ADMIN y SUPERADMIN
--    audiencia "administracion": solo ADMIN y SUPERADMIN
create table if not exists public.notificaciones (
  id          bigint      generated always as identity primary key,
  created_at  timestamptz not null default now(),
  tipo        text        not null,
  audiencia   text        not null default 'operacion',
  titulo      text        not null,
  detalle     text,
  folio       text,
  empresa_id  uuid        references public.empresas (id) on delete set null,
  constraint notificaciones_audiencia check (audiencia in ('operacion', 'administracion')),
  constraint notificaciones_titulo check (char_length(titulo) <= 200)
);
create index if not exists notificaciones_fecha_idx on public.notificaciones (created_at desc);
alter table public.notificaciones enable row level security;
revoke all on table public.notificaciones from anon, authenticated;
grant select on table public.notificaciones to authenticated;
drop policy if exists "Personal ve sus notificaciones" on public.notificaciones;
create policy "Personal ve sus notificaciones" on public.notificaciones for select to authenticated
  using ((select public.es_usuario_activo())
         and (empresa_id is null or public.empresa_visible(empresa_id))
         and ((audiencia = 'operacion' and (select public.tiene_permiso('recepcion'))) or (select public.es_admin())));

-- Cada usuario marca sus notificaciones como leídas (fecha de la última lectura)
alter table public.perfiles add column if not exists notificaciones_leidas_at timestamptz;
grant update (notificaciones_leidas_at) on table public.perfiles to authenticated;

-- 4) Respaldos: registro de archivos (el bucket "respaldos" es solo para las Edge Functions)
create table if not exists public.respaldos (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  tipo          text        not null,
  ruta          text        not null,
  tamano_bytes  bigint      not null default 0,
  incluye_fotos boolean     not null default false,
  cifrado       boolean     not null default false,
  conteos       jsonb,
  creado_por    uuid        references auth.users (id) on delete set null,
  constraint respaldos_tipo check (tipo in ('manual', 'semanal', 'mensual'))
);
alter table public.respaldos enable row level security;
revoke all on table public.respaldos from anon, authenticated;
grant select on table public.respaldos to authenticated;
drop policy if exists "Superadmin ve respaldos" on public.respaldos;
create policy "Superadmin ve respaldos" on public.respaldos for select to authenticated
  using ((select public.es_superadmin()));
insert into storage.buckets (id, name, public, file_size_limit)
values ('respaldos', 'respaldos', false, 209715200)
on conflict (id) do update set public = false;

-- 5) Datos públicos del formulario: horario de recepción
create or replace function public.config_publica()
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (select modo_auditoria, logo_url, anfitrion_solo_nombre, hora_apertura, hora_ultima_entrada, hora_cierre
               from public.configuracion where id = 1)
  select jsonb_build_object(
    'modo_auditoria', public.modo_auditoria(),
    'logo_url', (select logo_url from c),
    'horario', (select jsonb_build_object('apertura', to_char(hora_apertura, 'HH24:MI'),
                  'ultima_entrada', to_char(hora_ultima_entrada, 'HH24:MI'), 'cierre', to_char(hora_cierre, 'HH24:MI')) from c),
    'festivos', coalesce((select jsonb_agg(f.fecha order by f.fecha) from public.dias_festivos f
                           where f.fecha >= (now() at time zone 'America/Mexico_City')::date - 1
                             and f.fecha <= (now() at time zone 'America/Mexico_City')::date + 400), '[]'::jsonb),
    'empresas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'nombre', e.nombre, 'logo_url', e.logo_url,
               'mostrar_como', e.mostrar_como, 'es_principal', e.es_principal)
             order by e.orden, e.nombre)
        from public.empresas e
       where e.activa and public.empresa_visible(e.id)), '[]'::jsonb),
    'anfitriones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'nombre', case when coalesce((select anfitrion_solo_nombre from c), false)
                              then split_part(btrim(a.nombre), ' ', 1) else a.nombre end,
               'area', a.area,
               'empresas', (select coalesce(jsonb_agg(ae.empresa_id), '[]'::jsonb)
                              from public.anfitrion_empresas ae where ae.anfitrion_id = a.id))
             order by a.nombre)
        from public.anfitriones a
       where a.activo), '[]'::jsonb)
  );
$$;
revoke execute on function public.config_publica() from public;
grant  execute on function public.config_publica() to anon, authenticated;

select (select to_char(hora_apertura, 'HH24:MI') || ' / ' || to_char(hora_ultima_entrada, 'HH24:MI') || ' / ' || to_char(hora_cierre, 'HH24:MI')
          from public.configuracion where id = 1) as horario,
       (select count(*) from public.notificaciones) as notificaciones;
