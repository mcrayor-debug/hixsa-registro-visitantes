-- =====================================================================
-- HIXSA - Registro de visitantes
-- Migración v4, fase 1: roles con permisos, empresas a visitar, modo auditoría,
-- anfitriones por empresa, nombre y apellidos, tolerancia y bitácora de cambios.
--
-- Requiere: supabase/schema.sql (v3) ya ejecutado.
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run
-- Es idempotente: se puede volver a ejecutar sin romper nada.
-- =====================================================================

-- 1) ROLES CON PERMISOS POR SECCIÓN --------------------------------------
create table if not exists public.roles (
  id             text        primary key,
  nombre         text        not null,
  descripcion    text,
  secciones      text[]      not null default '{}',
  alcance        text        not null default 'hoy',
  puede_exportar boolean     not null default false,
  sistema        boolean     not null default false,  -- protegido: no se edita ni se borra
  created_at     timestamptz not null default now(),
  constraint roles_id_formato  check (id ~ '^[a-z][a-z0-9_]{1,29}$'),
  constraint roles_nombre_len  check (char_length(btrim(nombre)) between 2 and 40),
  constraint roles_desc_len    check (descripcion is null or char_length(descripcion) <= 200),
  constraint roles_alcance     check (alcance in ('hoy', 'semana', 'sin_limite')),
  constraint roles_secciones   check (secciones <@ array[
    'recepcion', 'tablero', 'consultas', 'reportes',
    'config_usuarios', 'config_roles', 'config_empresas',
    'config_anfitriones', 'config_correos', 'config_bitacora'
  ]::text[])
);

insert into public.roles (id, nombre, descripcion, secciones, alcance, puede_exportar, sistema) values
  ('superadmin', 'SUPERADMIN', 'Acceso total. Crea y edita roles y cualquier perfil.',
   array['recepcion','tablero','consultas','reportes','config_usuarios','config_roles','config_empresas','config_anfitriones','config_correos','config_bitacora'],
   'sin_limite', true, true),
  ('admin', 'ADMIN', 'Administra la operación y la configuración, excepto roles.',
   array['recepcion','tablero','consultas','reportes','config_usuarios','config_empresas','config_anfitriones','config_correos','config_bitacora'],
   'sin_limite', true, false),
  ('supervisor', 'SUPERVISOR', 'Supervisa la operación de la semana.',
   array['recepcion','tablero','consultas','reportes'], 'semana', false, false),
  ('recepcion', 'RECEPCIÓN', 'Recibe visitas y registra llegadas y salidas del día.',
   array['recepcion','consultas'], 'hoy', false, false),
  ('consulta', 'CONSULTA', 'Consulta información y estadísticas.',
   array['tablero','consultas','reportes'], 'sin_limite', false, false)
on conflict (id) do nothing;

-- El rol del perfil ahora apunta a la tabla de roles (los valores admin y consulta ya existen)
alter table public.perfiles drop constraint if exists perfiles_rol_valido;
alter table public.perfiles drop constraint if exists perfiles_rol_fk;
alter table public.perfiles
  add constraint perfiles_rol_fk foreign key (rol) references public.roles (id)
  on update cascade on delete restrict;
alter table public.perfiles alter column rol set default 'recepcion';

-- 2) EMPRESAS A VISITAR -----------------------------------------------------
create table if not exists public.empresas (
  id           uuid        primary key default gen_random_uuid(),
  nombre       text        not null,
  logo_url     text,
  mostrar_como text        not null default 'lista',
  orden        integer     not null default 100,
  activa       boolean     not null default true,
  es_principal boolean     not null default false,
  created_at   timestamptz not null default now(),
  constraint empresas_nombre_len   check (char_length(btrim(nombre)) between 2 and 80),
  constraint empresas_logo_url     check (logo_url is null or logo_url ~ '^https://'),
  constraint empresas_mostrar_como check (mostrar_como in ('boton', 'lista')),
  constraint empresas_principal_activa check (not es_principal or activa)
);
create unique index if not exists empresas_nombre_unico on public.empresas (lower(btrim(nombre)));
create unique index if not exists empresas_una_principal on public.empresas (es_principal) where es_principal;

insert into public.empresas (nombre, mostrar_como, orden, es_principal) values
  ('HIXSA', 'boton', 1, true),
  ('INSITECH', 'boton', 2, false),
  ('INAPSA', 'boton', 3, false)
on conflict do nothing;

-- 3) CONFIGURACIÓN: auditoría, tolerancia y logo del sistema ----------------
alter table public.configuracion
  add column if not exists modo_auditoria boolean not null default false,
  add column if not exists tolerancia_min integer not null default 15,
  add column if not exists logo_url       text;
alter table public.configuracion drop constraint if exists configuracion_tolerancia;
alter table public.configuracion drop constraint if exists configuracion_logo_url;
alter table public.configuracion
  add constraint configuracion_tolerancia check (tolerancia_min between 0 and 240),
  add constraint configuracion_logo_url   check (logo_url is null or logo_url ~ '^https://');

-- 4) VISITAS: nombre y apellidos, empresa a visitar ------------------------
alter table public.visitantes
  add column if not exists nombre            text,
  add column if not exists apellidos         text,
  add column if not exists empresa_visita_id uuid references public.empresas (id) on delete restrict;

-- Registros anteriores: primera palabra = nombre, el resto = apellidos
update public.visitantes
   set nombre    = split_part(btrim(nombre_completo), ' ', 1),
       apellidos = nullif(btrim(substr(btrim(nombre_completo), length(split_part(btrim(nombre_completo), ' ', 1)) + 1)), '')
 where nombre is null;
update public.visitantes
   set empresa_visita_id = (select id from public.empresas where es_principal)
 where empresa_visita_id is null;
alter table public.visitantes alter column empresa_visita_id set not null;

alter table public.visitantes drop constraint if exists visitantes_nombre_v4;
alter table public.visitantes drop constraint if exists visitantes_apellidos_v4;
alter table public.visitantes
  add constraint visitantes_nombre_v4    check (nombre is null or char_length(btrim(nombre)) between 1 and 60),
  add constraint visitantes_apellidos_v4 check (apellidos is null or char_length(apellidos) <= 80);
create index if not exists visitantes_empresa_visita_idx on public.visitantes (empresa_visita_id);

comment on column public.visitantes.empresa is 'Empresa de origen del visitante (de dónde viene, particular, repartidor...).';
comment on column public.visitantes.empresa_visita_id is 'Empresa a visitar (HIXSA, INSITECH, INAPSA...).';

-- 5) ANFITRIONES: celular, foto y varias empresas ----------------------------
alter table public.anfitriones
  add column if not exists celular   text,
  add column if not exists foto_path text;
alter table public.anfitriones drop constraint if exists anfitriones_celular;
alter table public.anfitriones
  add constraint anfitriones_celular check (celular is null or celular ~ '^\+?[0-9]{10,15}$');

create table if not exists public.anfitrion_empresas (
  anfitrion_id uuid not null references public.anfitriones (id) on delete cascade,
  empresa_id   uuid not null references public.empresas (id) on delete cascade,
  primary key (anfitrion_id, empresa_id)
);
-- Los anfitriones existentes pertenecen a la empresa principal
insert into public.anfitrion_empresas (anfitrion_id, empresa_id)
select a.id, e.id from public.anfitriones a cross join public.empresas e
 where e.es_principal
   and not exists (select 1 from public.anfitrion_empresas x where x.anfitrion_id = a.id)
on conflict do nothing;

-- 6) BITÁCORA DE CAMBIOS -------------------------------------------------------
create table if not exists public.bitacora_cambios (
  id            bigint      generated always as identity primary key,
  created_at    timestamptz not null default now(),
  usuario_id    uuid        references auth.users (id) on delete set null,
  usuario_email text,
  tabla         text        not null,
  accion        text        not null,
  registro_id   text,
  antes         jsonb,
  despues       jsonb,
  constraint bitacora_cambios_accion check (accion in ('alta', 'edicion', 'baja'))
);
create index if not exists bitacora_cambios_fecha_idx on public.bitacora_cambios (created_at desc);

-- Registra los cambios hechos desde el panel. Los que hacen las Edge Functions
-- (service_role, sin usuario) los registra la propia función con su autor.
create or replace function public.registrar_cambio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  correo text;
  fila   jsonb := to_jsonb(coalesce(new, old));
begin
  if uid is null then
    return coalesce(new, old);
  end if;
  select email into correo from public.perfiles where id = uid;
  insert into public.bitacora_cambios (usuario_id, usuario_email, tabla, accion, registro_id, antes, despues)
  values (
    uid, correo, tg_table_name,
    case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'edicion' else 'baja' end,
    coalesce(fila ->> 'id', fila ->> 'anfitrion_id'),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['roles', 'empresas', 'anfitriones', 'anfitrion_empresas', 'configuracion', 'perfiles'] loop
    execute format('drop trigger if exists bitacora_%1$s on public.%1$I', t);
    execute format('create trigger bitacora_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.registrar_cambio()', t);
  end loop;
end $$;

-- 7) FUNCIONES DE APOYO PARA PERMISOS ------------------------------------------
create or replace function public.tiene_permiso(p_seccion text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfiles p join public.roles r on r.id = p.rol
     where p.id = (select auth.uid()) and p.activo
       and (r.id = 'superadmin' or p_seccion = any (r.secciones))
  );
$$;

create or replace function public.es_superadmin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles p
                  where p.id = (select auth.uid()) and p.activo and p.rol = 'superadmin');
$$;

-- Compatibilidad con la v3: "admin" = superadmin o admin
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles p
                  where p.id = (select auth.uid()) and p.activo and p.rol in ('superadmin', 'admin'));
$$;

create or replace function public.modo_auditoria()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select modo_auditoria from public.configuracion where id = 1), false);
$$;

create or replace function public.empresa_principal_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.empresas where es_principal limit 1;
$$;

-- En modo auditoría solo es visible la empresa principal (HIXSA)
create or replace function public.empresa_visible(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not public.modo_auditoria() or p_empresa = public.empresa_principal_id();
$$;

-- Alcance de consulta del rol: hoy / semana (7 días atrás y 7 adelante) / sin límite
create or replace function public.visita_en_alcance(p_entrada timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  with a as (
    select r.alcance from public.perfiles p join public.roles r on r.id = p.rol
     where p.id = (select auth.uid()) and p.activo
  ), d as (
    select (now() at time zone 'America/Mexico_City')::date as hoy,
           (p_entrada at time zone 'America/Mexico_City')::date as dia
  )
  select coalesce((
    select case a.alcance
             when 'sin_limite' then true
             when 'semana'     then d.dia between d.hoy - 6 and d.hoy + 7
             when 'hoy'        then d.dia = d.hoy
             else false
           end
      from a, d), false);
$$;

revoke execute on function public.tiene_permiso(text)              from public, anon;
revoke execute on function public.es_superadmin()                  from public, anon;
revoke execute on function public.visita_en_alcance(timestamptz)   from public, anon;
revoke execute on function public.empresa_visible(uuid)            from public, anon;
revoke execute on function public.modo_auditoria()                 from public, anon;
revoke execute on function public.empresa_principal_id()           from public, anon;
revoke execute on function public.registrar_cambio()               from public, anon, authenticated;
grant  execute on function public.tiene_permiso(text)              to authenticated;
grant  execute on function public.es_superadmin()                  to authenticated;
grant  execute on function public.visita_en_alcance(timestamptz)   to authenticated;
grant  execute on function public.empresa_visible(uuid)            to authenticated;
grant  execute on function public.modo_auditoria()                 to authenticated;
grant  execute on function public.empresa_principal_id()           to authenticated;

-- 8) DATOS PÚBLICOS PARA EL FORMULARIO (una sola llamada) ----------------------
-- Modo auditoría, logo, empresas visibles y anfitriones activos (sin correos).
create or replace function public.config_publica()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'modo_auditoria', public.modo_auditoria(),
    'logo_url', (select logo_url from public.configuracion where id = 1),
    'empresas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'nombre', e.nombre, 'logo_url', e.logo_url,
               'mostrar_como', e.mostrar_como, 'es_principal', e.es_principal)
             order by e.orden, e.nombre)
        from public.empresas e
       where e.activa and public.empresa_visible(e.id)), '[]'::jsonb),
    'anfitriones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'nombre', a.nombre, 'area', a.area,
               'empresas', (select coalesce(jsonb_agg(ae.empresa_id), '[]'::jsonb)
                              from public.anfitrion_empresas ae where ae.anfitrion_id = a.id))
             order by a.nombre)
        from public.anfitriones a
       where a.activo), '[]'::jsonb)
  );
$$;
revoke execute on function public.config_publica() from public;
grant  execute on function public.config_publica() to anon, authenticated;

-- 9) SEGURIDAD A NIVEL DE FILA (RLS) -------------------------------------------
alter table public.roles              enable row level security;
alter table public.empresas           enable row level security;
alter table public.anfitrion_empresas enable row level security;
alter table public.bitacora_cambios   enable row level security;

revoke all on table public.roles              from anon, authenticated;
revoke all on table public.empresas           from anon, authenticated;
revoke all on table public.anfitrion_empresas from anon, authenticated;
revoke all on table public.bitacora_cambios   from anon, authenticated;

-- roles: los ve el personal activo; solo el SUPERADMIN los crea, edita y borra
grant select, insert, update, delete on table public.roles to authenticated;
drop policy if exists "Personal activo ve roles" on public.roles;
create policy "Personal activo ve roles" on public.roles for select to authenticated
  using ((select public.es_usuario_activo()));
drop policy if exists "Superadmin crea roles" on public.roles;
create policy "Superadmin crea roles" on public.roles for insert to authenticated
  with check ((select public.es_superadmin()) and not sistema);
drop policy if exists "Superadmin edita roles" on public.roles;
create policy "Superadmin edita roles" on public.roles for update to authenticated
  using ((select public.es_superadmin()) and not sistema)
  with check ((select public.es_superadmin()) and not sistema);
drop policy if exists "Superadmin borra roles" on public.roles;
create policy "Superadmin borra roles" on public.roles for delete to authenticated
  using ((select public.es_superadmin()) and not sistema);

-- empresas: en modo auditoría el panel solo ve la principal
grant select, insert, update, delete on table public.empresas to authenticated;
drop policy if exists "Personal ve empresas visibles" on public.empresas;
create policy "Personal ve empresas visibles" on public.empresas for select to authenticated
  using ((select public.es_usuario_activo()) and public.empresa_visible(id));
drop policy if exists "Config agrega empresas" on public.empresas;
create policy "Config agrega empresas" on public.empresas for insert to authenticated
  with check ((select public.tiene_permiso('config_empresas')) and not es_principal);
drop policy if exists "Config edita empresas" on public.empresas;
create policy "Config edita empresas" on public.empresas for update to authenticated
  using ((select public.tiene_permiso('config_empresas')) and public.empresa_visible(id))
  with check ((select public.tiene_permiso('config_empresas')));
drop policy if exists "Config borra empresas" on public.empresas;
create policy "Config borra empresas" on public.empresas for delete to authenticated
  using ((select public.tiene_permiso('config_empresas')) and not es_principal);

-- anfitrion_empresas
grant select, insert, delete on table public.anfitrion_empresas to authenticated;
drop policy if exists "Personal ve anfitrion_empresas" on public.anfitrion_empresas;
create policy "Personal ve anfitrion_empresas" on public.anfitrion_empresas for select to authenticated
  using ((select public.es_usuario_activo()));
drop policy if exists "Config asigna empresas a anfitriones" on public.anfitrion_empresas;
create policy "Config asigna empresas a anfitriones" on public.anfitrion_empresas for insert to authenticated
  with check ((select public.tiene_permiso('config_anfitriones')));
drop policy if exists "Config quita empresas a anfitriones" on public.anfitrion_empresas;
create policy "Config quita empresas a anfitriones" on public.anfitrion_empresas for delete to authenticated
  using ((select public.tiene_permiso('config_anfitriones')));

-- anfitriones: el formulario público ya usa config_publica(); se retira el acceso anónimo directo
revoke select on table public.anfitriones from anon;
drop policy if exists "Publico ve anfitriones activos" on public.anfitriones;
grant insert (nombre, area, correo, activo, celular, foto_path),
      update (nombre, area, correo, activo, celular, foto_path),
      delete on table public.anfitriones to authenticated;
drop policy if exists "Admin agrega anfitriones" on public.anfitriones;
drop policy if exists "Admin edita anfitriones" on public.anfitriones;
drop policy if exists "Config agrega anfitriones" on public.anfitriones;
create policy "Config agrega anfitriones" on public.anfitriones for insert to authenticated
  with check ((select public.tiene_permiso('config_anfitriones')));
drop policy if exists "Config edita anfitriones" on public.anfitriones;
create policy "Config edita anfitriones" on public.anfitriones for update to authenticated
  using ((select public.tiene_permiso('config_anfitriones')))
  with check ((select public.tiene_permiso('config_anfitriones')));
drop policy if exists "Config borra anfitriones" on public.anfitriones;
create policy "Config borra anfitriones" on public.anfitriones for delete to authenticated
  using ((select public.tiene_permiso('config_anfitriones')));

-- visitantes: personal activo, dentro del alcance de su rol y de las empresas visibles
drop policy if exists "Usuarios activos consultan visitas" on public.visitantes;
drop policy if exists "Personal consulta visitas en su alcance" on public.visitantes;
create policy "Personal consulta visitas en su alcance" on public.visitantes for select to authenticated
  using ((select public.es_usuario_activo())
         and public.visita_en_alcance(entrada)
         and public.empresa_visible(empresa_visita_id));

-- perfiles: el propio, o todos con permiso de usuarios
drop policy if exists "Ver perfil propio o todos si es admin" on public.perfiles;
drop policy if exists "Ver perfil propio o con permiso" on public.perfiles;
create policy "Ver perfil propio o con permiso" on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select public.tiene_permiso('config_usuarios')));

-- configuracion: la editan quienes tienen permiso de correos o de empresas
grant update (modo_auditoria, tolerancia_min, logo_url) on table public.configuracion to authenticated;
drop policy if exists "Admin actualiza configuracion" on public.configuracion;
drop policy if exists "Config actualiza configuracion" on public.configuracion;
create policy "Config actualiza configuracion" on public.configuracion for update to authenticated
  using ((select public.tiene_permiso('config_correos')) or (select public.tiene_permiso('config_empresas')))
  with check ((select public.tiene_permiso('config_correos')) or (select public.tiene_permiso('config_empresas')));

-- bitácoras: solo con permiso de bitácora
drop policy if exists "Admin consulta bitacora" on public.bitacora_reportes;
drop policy if exists "Permiso consulta bitacora de reportes" on public.bitacora_reportes;
create policy "Permiso consulta bitacora de reportes" on public.bitacora_reportes for select to authenticated
  using ((select public.tiene_permiso('config_bitacora')));
grant select on table public.bitacora_cambios to authenticated;
drop policy if exists "Permiso consulta bitacora de cambios" on public.bitacora_cambios;
create policy "Permiso consulta bitacora de cambios" on public.bitacora_cambios for select to authenticated
  using ((select public.tiene_permiso('config_bitacora')));

-- 10) STORAGE: logos (público) y fotos de anfitriones (privado) ------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anfitriones', 'anfitriones', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Config sube logos" on storage.objects;
create policy "Config sube logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and (select public.tiene_permiso('config_empresas')));
drop policy if exists "Config reemplaza logos" on storage.objects;
create policy "Config reemplaza logos" on storage.objects for update to authenticated
  using (bucket_id = 'logos' and (select public.tiene_permiso('config_empresas')));
drop policy if exists "Config borra logos" on storage.objects;
create policy "Config borra logos" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and (select public.tiene_permiso('config_empresas')));

drop policy if exists "Personal ve fotos de anfitriones" on storage.objects;
create policy "Personal ve fotos de anfitriones" on storage.objects for select to authenticated
  using (bucket_id = 'anfitriones' and (select public.es_usuario_activo()));
drop policy if exists "Config sube fotos de anfitriones" on storage.objects;
create policy "Config sube fotos de anfitriones" on storage.objects for insert to authenticated
  with check (bucket_id = 'anfitriones' and (select public.tiene_permiso('config_anfitriones')));
drop policy if exists "Config borra fotos de anfitriones" on storage.objects;
create policy "Config borra fotos de anfitriones" on storage.objects for delete to authenticated
  using (bucket_id = 'anfitriones' and (select public.tiene_permiso('config_anfitriones')));

-- 11) PRIMER SUPERADMIN ----------------------------------------------------------
insert into public.perfiles (id, email, nombre, rol, activo)
select id, email, 'Mario Rivera', 'superadmin', true
  from auth.users where lower(email) = 'mario.rivera@hixsa.com'
on conflict (id) do update set rol = 'superadmin', activo = true;

-- Verificación: debe mostrar al SUPERADMIN y los 5 roles
select p.email, p.rol, p.activo from public.perfiles p where p.rol = 'superadmin';
select id, nombre, alcance, puede_exportar from public.roles order by sistema desc, id;
