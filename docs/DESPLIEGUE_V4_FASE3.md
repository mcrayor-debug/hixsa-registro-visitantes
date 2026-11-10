# Despliegue de la versión 4, fase 3

Requiere las **fases 1 y 2 ya desplegadas**.

## 1. Copiar archivos y borrar los que ya no se usan

1. Descomprime `v4-fase3-archivos.zip` y copia su contenido encima de tu carpeta del proyecto, reemplazando archivos.
2. Borra los archivos del reporte de GitHub (ahora lo hace Supabase):

```powershell
git rm .github/workflows/reporte-diario.yml scripts/reporte-diario.mjs
```

## 2. Base de datos

Supabase → **SQL Editor** → pega `supabase/migrations/20261112_v4_fase3.sql` → **Run**.

## 3. Funciones

```powershell
npx supabase functions deploy registrar-visita --no-verify-jwt --use-api
npx supabase functions deploy registrar-acceso --no-verify-jwt --use-api
npx supabase functions deploy aprobar-visita --no-verify-jwt --use-api
npx supabase functions deploy enviar-reporte --no-verify-jwt --use-api
npx supabase functions deploy reenviar-pase --no-verify-jwt --use-api
npx supabase functions deploy reporte-programado --no-verify-jwt --use-api
npx supabase functions deploy importar-datos --no-verify-jwt --use-api
npx supabase functions deploy borrar-perfiles --no-verify-jwt --use-api
```

## 4. Reportes automáticos (una sola vez)

1. Genera un secreto de 40 caracteres en PowerShell y cópialo:

```powershell
-join ((48..57) + (97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
```

2. Guárdalo en las funciones (cambia el valor):

```powershell
npx supabase secrets set REPORTES_SECRETO=el_secreto_que_generaste
```

3. En **SQL Editor**, abre `supabase/programar-reportes.sql`, reemplaza `TU_PROJECT_REF` (`ziqfcmgufkeydulgtnvl`) y `PEGA_AQUI_EL_SECRETO`, y ejecútalo.
   **No guardes** ese archivo con los valores reales en GitHub.
4. **Qué deberías ver:** dos filas, `hixsa-reporte-diario` y `hixsa-reporte-semanal`, con `active = true`.

> Si marca error con `pg_cron` o `pg_net`, actívalas en **Database → Extensions** y vuelve a ejecutar.

5. En GitHub → **Settings → Secrets and variables → Actions**, ya puedes borrar `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (el CI no los usa).

## 5. Sitio

```powershell
npm install
npm run build
git add -A
git commit -m "feat: versión 4, fase 3 (consultas, reportes, calendario, importación)"
git push
```

## 6. Verificación

1. **Configuración → Correos y avisos:** agrega los **correos para Google Calendar**, guarda y usa **Enviar reporte diario de prueba**.
2. **Reportes:** revisa semanal y mensual; descarga el PDF.
3. **Consultas → Seguridad:** revisa activos, fuera de horario y QR vencidos; exporta el log.
4. **Consultas → Por visitante:** busca a alguien y usa **Reenviar QR** en su invitación vigente.
5. **Importar** (Configuración → Importar y depurar), en este orden:
   1. `visitantes.csv` de Glide (31 perfiles).
   2. `Visitas.csv` de Glide (33 visitas; 3 filas se omiten: una vacía y dos con fecha en lugar de nombre).
   Puedes repetir la importación: no duplica.
6. Después de importar, revisa en **Configuración → Anfitriones** los anfitriones creados *ocultos* y complétalos.
7. Al día siguiente hábil, a las 07:00, debe llegar el reporte diario.

## Notas

- Los **archivos CSV de Glide traen datos personales**: no los subas a GitHub (el `.gitignore` ya ignora `*.csv`) y bórralos de tu computadora al terminar.
- El **borrado de perfiles** solo lo ve el SUPERADMIN y pide escribir *BORRAR*. No se puede deshacer.
- Mientras Resend esté en modo de prueba, todos los correos (incluidos reportes e invitaciones de calendario) solo llegan al correo de tu cuenta de Resend.
