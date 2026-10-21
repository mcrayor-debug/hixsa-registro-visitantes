-- Consultas de solo lectura para la skill reporte-visitas.
-- Parámetros: :desde, :hasta, :desde_prev, :hasta_prev  (formato 'AAAA-MM-DD')
-- Todas las fechas se interpretan en hora de Ciudad de México.

-- [1] Totales del periodo
select count(*)                                   as visitas,
       count(distinct lower(empresa))             as empresas,
       count(distinct lower(correo))              as visitantes_unicos,
       round(avg(extract(epoch from (salida - entrada)) / 3600)::numeric, 1) as horas_promedio
from public.visitantes
where entrada >= (:desde)::date::timestamp at time zone 'America/Mexico_City'
  and entrada <  ((:hasta)::date + 1)::timestamp at time zone 'America/Mexico_City';

-- [2] Semana anterior (para comparar)
select count(*) as visitas_prev
from public.visitantes
where entrada >= (:desde_prev)::date::timestamp at time zone 'America/Mexico_City'
  and entrada <  ((:hasta_prev)::date + 1)::timestamp at time zone 'America/Mexico_City';

-- [3] Visitas por día
select to_char(entrada at time zone 'America/Mexico_City', 'YYYY-MM-DD') as dia,
       count(*) as visitas
from public.visitantes
where entrada >= (:desde)::date::timestamp at time zone 'America/Mexico_City'
  and entrada <  ((:hasta)::date + 1)::timestamp at time zone 'America/Mexico_City'
group by 1 order by 1;

-- [4] Por motivo
select motivo, count(*) as visitas
from public.visitantes
where entrada >= (:desde)::date::timestamp at time zone 'America/Mexico_City'
  and entrada <  ((:hasta)::date + 1)::timestamp at time zone 'America/Mexico_City'
group by motivo order by visitas desc;

-- [5] Empresas con más visitas (top 10)
select empresa, count(*) as visitas
from public.visitantes
where entrada >= (:desde)::date::timestamp at time zone 'America/Mexico_City'
  and entrada <  ((:hasta)::date + 1)::timestamp at time zone 'America/Mexico_City'
group by empresa order by visitas desc, empresa limit 10;

-- [6] Anfitriones con más visitas (top 10)
select persona_visita as anfitrion, count(*) as visitas
from public.visitantes
where entrada >= (:desde)::date::timestamp at time zone 'America/Mexico_City'
  and entrada <  ((:hasta)::date + 1)::timestamp at time zone 'America/Mexico_City'
group by persona_visita order by visitas desc, anfitrion limit 10;

-- [7] Distribución por hora de entrada
select extract(hour from entrada at time zone 'America/Mexico_City')::int as hora,
       count(*) as visitas
from public.visitantes
where entrada >= (:desde)::date::timestamp at time zone 'America/Mexico_City'
  and entrada <  ((:hasta)::date + 1)::timestamp at time zone 'America/Mexico_City'
group by 1 order by 1;

-- [8] Alertas: pases no enviados y visitas de más de 8 horas
select folio, empresa,
       to_char(entrada at time zone 'America/Mexico_City', 'YYYY-MM-DD HH24:MI') as entrada,
       case when correo_error is not null then 'Pase no enviado'
            else 'Visita de más de 8 h' end as alerta
from public.visitantes
where entrada >= (:desde)::date::timestamp at time zone 'America/Mexico_City'
  and entrada <  ((:hasta)::date + 1)::timestamp at time zone 'America/Mexico_City'
  and (correo_error is not null or salida - entrada > interval '8 hours')
order by entrada;
