-- =====================================================================
-- HIXSA - Registro de visitantes
-- Migración v4.2.1: días con horario especial en el calendario laboral.
--   tipo "inhabil": no se agendan visitas (como hasta ahora)
--   tipo "especial": se reciben visitas solo de hora_inicio a hora_fin
-- Requiere: 20261118_v4_2_0.sql ya ejecutada. Idempotente.
-- =====================================================================
alter table public.dias_festivos
  add column if not exists tipo        text not null default 'inhabil',
  add column if not exists hora_inicio time,
  add column if not exists hora_fin    time;
alter table public.dias_festivos drop constraint if exists dias_festivos_tipo;
alter table public.dias_festivos add constraint dias_festivos_tipo check (
  tipo = 'inhabil' or (tipo = 'especial' and hora_inicio is not null and hora_fin is not null and hora_inicio < hora_fin));

-- Datos públicos del formulario: días inhábiles y días con horario especial.
-- La última entrada de un día especial guarda el mismo margen que el horario normal (p. ej. 15 min antes del cierre).
create or replace function public.config_publica()
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (select modo_auditoria, logo_url, anfitrion_solo_nombre, hora_apertura, hora_ultima_entrada, hora_cierre
               from public.configuracion where id = 1),
       d as (select (now() at time zone 'America/Mexico_City')::date as hoy)
  select jsonb_build_object(
    'modo_auditoria', public.modo_auditoria(),
    'logo_url', (select logo_url from c),
    'horario', (select jsonb_build_object('apertura', to_char(hora_apertura, 'HH24:MI'),
                  'ultima_entrada', to_char(hora_ultima_entrada, 'HH24:MI'), 'cierre', to_char(hora_cierre, 'HH24:MI')) from c),
    'festivos', coalesce((select jsonb_agg(f.fecha order by f.fecha) from public.dias_festivos f, d
                           where f.tipo = 'inhabil' and f.fecha between d.hoy - 1 and d.hoy + 400), '[]'::jsonb),
    'especiales', coalesce((select jsonb_agg(jsonb_build_object(
                    'fecha', f.fecha, 'nombre', f.nombre,
                    'apertura', to_char(f.hora_inicio, 'HH24:MI'),
                    'ultima_entrada', to_char(greatest(f.hora_inicio, f.hora_fin - (c.hora_cierre - c.hora_ultima_entrada)), 'HH24:MI'),
                    'cierre', to_char(f.hora_fin, 'HH24:MI')) order by f.fecha)
                  from public.dias_festivos f, c, d
                  where f.tipo = 'especial' and f.fecha between d.hoy - 1 and d.hoy + 400), '[]'::jsonb),
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

select count(*) filter (where tipo = 'inhabil') as dias_inhabiles, count(*) filter (where tipo = 'especial') as dias_especiales
  from public.dias_festivos;
