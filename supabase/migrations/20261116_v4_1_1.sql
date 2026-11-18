-- =====================================================================
-- HIXSA - Registro de visitantes
-- Migración v4.1.1: calendario laboral (días festivos), foto de usuarios,
-- nuevos tipos de registro en la bitácora.
-- Requiere: 20261113_v4_1_0.sql ya ejecutada. Idempotente.
-- =====================================================================

-- 1) Días festivos: no se agendan visitas ni se envía el reporte diario
create table if not exists public.dias_festivos (
  fecha      date        primary key,
  nombre     text        not null,
  created_at timestamptz not null default now(),
  constraint dias_festivos_nombre check (char_length(btrim(nombre)) between 2 and 80)
);
alter table public.dias_festivos enable row level security;
revoke all on table public.dias_festivos from anon, authenticated;
grant select, insert, update, delete on table public.dias_festivos to authenticated;
drop policy if exists "Personal ve festivos" on public.dias_festivos;
create policy "Personal ve festivos" on public.dias_festivos for select to authenticated
  using ((select public.es_usuario_activo()));
drop policy if exists "Config administra festivos" on public.dias_festivos;
create policy "Config administra festivos" on public.dias_festivos for all to authenticated
  using ((select public.tiene_permiso('config_correos')))
  with check ((select public.tiene_permiso('config_correos')));
drop trigger if exists bitacora_dias_festivos on public.dias_festivos;
create trigger bitacora_dias_festivos after insert or update or delete on public.dias_festivos
  for each row execute function public.registrar_cambio();

-- 2) Foto de los usuarios del panel (bucket privado "usuarios", carpeta = id del usuario)
alter table public.perfiles add column if not exists foto_path text;
-- Cada usuario puede cambiar SOLO su foto
grant update (foto_path) on table public.perfiles to authenticated;
drop policy if exists "Usuario cambia su foto" on public.perfiles;
create policy "Usuario cambia su foto" on public.perfiles for update to authenticated
  using (id = (select auth.uid()) and (select public.es_usuario_activo()))
  with check (id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('usuarios', 'usuarios', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Personal ve fotos de usuarios" on storage.objects;
create policy "Personal ve fotos de usuarios" on storage.objects for select to authenticated
  using (bucket_id = 'usuarios' and (select public.es_usuario_activo()));
drop policy if exists "Sube su foto o con permiso" on storage.objects;
create policy "Sube su foto o con permiso" on storage.objects for insert to authenticated
  with check (bucket_id = 'usuarios' and (
    (storage.foldername(name))[1] = (select auth.uid())::text or (select public.tiene_permiso('config_usuarios'))));
drop policy if exists "Borra su foto o con permiso" on storage.objects;
create policy "Borra su foto o con permiso" on storage.objects for delete to authenticated
  using (bucket_id = 'usuarios' and (
    (storage.foldername(name))[1] = (select auth.uid())::text or (select public.tiene_permiso('config_usuarios'))));

-- 3) Bitácora: reenvío de pase, invitaciones del personal y depuraciones
alter table public.bitacora_cambios drop constraint if exists bitacora_cambios_accion;
alter table public.bitacora_cambios
  add constraint bitacora_cambios_accion check (accion in ('alta', 'edicion', 'baja', 'reenvio', 'invitacion', 'depuracion'));

-- 4) Datos públicos del formulario: festivos próximos para validar fechas
create or replace function public.config_publica()
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (select modo_auditoria, logo_url, anfitrion_solo_nombre from public.configuracion where id = 1)
  select jsonb_build_object(
    'modo_auditoria', public.modo_auditoria(),
    'logo_url', (select logo_url from c),
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

select (select count(*) from public.dias_festivos) as festivos,
       (select count(*) from information_schema.columns where table_name = 'perfiles' and column_name = 'foto_path') as foto_usuarios;
