-- =====================================================================
-- Programar los reportes automáticos (diario y semanal) en Supabase.
-- Se ejecuta UNA vez en: Supabase > SQL Editor (no lo subas con valores reales).
--
-- Antes: crea el secreto compartido y guárdalo en las Edge Functions:
--   npx supabase secrets set REPORTES_SECRETO=<secreto>
-- Reemplaza abajo TU_PROJECT_REF y PEGA_AQUI_EL_SECRETO.
--
-- Horarios (Ciudad de México = UTC-6, sin horario de verano):
--   Diario:  lunes a viernes 07:00  → '0 13 * * 1-5'  (visitas de ayer + agenda de hoy)
--   Semanal: lunes 07:05             → '5 13 * * 1'    (semana anterior, lunes a domingo)
-- =====================================================================
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  v_url  text := 'https://TU_PROJECT_REF.supabase.co/functions/v1/reporte-programado';
  v_sec  text := 'PEGA_AQUI_EL_SECRETO';
  v_id   uuid;
begin
  if v_url like '%TU_PROJECT_REF%' or v_sec = 'PEGA_AQUI_EL_SECRETO' then
    raise exception 'Reemplaza TU_PROJECT_REF y PEGA_AQUI_EL_SECRETO antes de ejecutar.';
  end if;
  select id into v_id from vault.secrets where name = 'reportes_url';
  if v_id is null then perform vault.create_secret(v_url, 'reportes_url', 'URL de la función reporte-programado');
  else perform vault.update_secret(v_id, v_url); end if;
  select id into v_id from vault.secrets where name = 'reportes_secreto';
  if v_id is null then perform vault.create_secret(v_sec, 'reportes_secreto', 'Secreto compartido con reporte-programado');
  else perform vault.update_secret(v_id, v_sec); end if;
end $$;

-- Quita tareas anteriores con el mismo nombre (idempotente)
select cron.unschedule(jobid) from cron.job where jobname in ('hixsa-reporte-diario', 'hixsa-reporte-semanal');

select cron.schedule('hixsa-reporte-diario', '0 13 * * 1-5', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reportes_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reportes_secreto')),
    body    := jsonb_build_object('tipo', 'diario'),
    timeout_milliseconds := 60000);
$job$);

select cron.schedule('hixsa-reporte-semanal', '5 13 * * 1', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reportes_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reportes_secreto')),
    body    := jsonb_build_object('tipo', 'semanal'),
    timeout_milliseconds := 60000);
$job$);

-- Verificación: deben aparecer las dos tareas activas
select jobname, schedule, active from cron.job where jobname like 'hixsa-%' order by jobname;
-- Para revisar ejecuciones: select * from cron.job_run_details order by start_time desc limit 10;
