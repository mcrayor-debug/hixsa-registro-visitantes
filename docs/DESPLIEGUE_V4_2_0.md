# Despliegue de la versión 4.2.0

No hay cuentas nuevas. **Ejecuta los comandos uno por uno** en PowerShell.

## 1. Preparar la carpeta (antes de copiar el zip)

```powershell
cd "C:\Users\mario.rivera\Documents\MARIO\HIXSA\APP REG VISITAS CLAUDE\PROYECTO CLAUDE\VERSION_QR_ADMIN\files_regitro hixsa_2\hixsa-registro-visitantes\hixsa-registro-visitantes"
```

```powershell
git status --short
```

Si muestra cambios, guárdalos primero (`git add -A` y `git commit -m "cambios pendientes"`). Con la carpeta limpia:

```powershell
git pull --rebase origin main
```

## 2. Copiar los archivos
Copia el contenido de `v4.2.0-archivos.zip` encima de la carpeta del proyecto, reemplazando archivos.

## 3. Base de datos
Supabase, proyecto **hixsa-visitantes** (la dirección contiene `ziqfcmgufkeydulgtnvl`) → **SQL Editor → New query** → pega `supabase/migrations/20261118_v4_2_0.sql` → **Run**.

**Qué deberías ver:** `horario = 09:00 / 17:45 / 18:00` y `notificaciones = 0`.

## 4. Funciones (2 nuevas y 7 actualizadas)

```powershell
npx supabase functions deploy cancelar-visita --no-verify-jwt --use-api
```
```powershell
npx supabase functions deploy respaldos --no-verify-jwt --use-api
```
```powershell
npx supabase functions deploy registrar-visita --no-verify-jwt --use-api
```
```powershell
npx supabase functions deploy crear-invitacion --no-verify-jwt --use-api
```
```powershell
npx supabase functions deploy registrar-acceso --no-verify-jwt --use-api
```
```powershell
npx supabase functions deploy aprobar-visita --no-verify-jwt --use-api
```
```powershell
npx supabase functions deploy reenviar-pase --no-verify-jwt --use-api
```
```powershell
npx supabase functions deploy reporte-programado --no-verify-jwt --use-api
```
```powershell
npx supabase functions deploy gestionar-visitante --no-verify-jwt --use-api
```

**Qué deberías ver** en cada uno: `Deployed Functions on project ziqfcmgufkeydulgtnvl`.

## 5. Programar los respaldos automáticos (una vez)
1. Abre `supabase/programar-respaldos.sql` y **copia su contenido** (no edites el archivo).
2. En el **SQL Editor** del proyecto hixsa-visitantes, pégalo, reemplaza `TU_PROJECT_REF` por `ziqfcmgufkeydulgtnvl` y presiona **Run**. No guardes la consulta.
3. **Qué deberías ver:** cuatro tareas activas: `hixsa-reporte-diario`, `hixsa-reporte-semanal`, `hixsa-respaldo-mensual` y `hixsa-respaldo-semanal`.

Usa el mismo secreto que los reportes; no hay que crear otro.

## 6. Publicar el sitio

```powershell
npm install
```
```powershell
npm run build
```
```powershell
git add -A
git commit -m "feat: versión 4.2.0"
git push
```

**Qué deberías ver:** `✔ Build listo` y `main -> main` sin *rejected*. En Cloudflare, el despliegue termina en **Success**. Recarga el panel con **Ctrl + F5**.

## 7. Configuración inicial
1. **Configuración → Calendario laboral → Horario de recepción:** revisa 09:00, 17:45 y 18:00.
2. **Configuración → Respaldos:** genera un **respaldo manual** con contraseña y guárdalo fuera de Supabase. Revisa los interruptores de semanal y mensual.

## 8. Verificación
1. La pestaña **Dashboard** reemplaza a *Tablero*.
2. **Formulario:** una entrada a las 8:30 o a las 17:50 muestra el aviso del horario.
3. Registra una visita de prueba: aparece en la **campana** como *pendiente de aprobación*. Su correo trae **Cancelar mi visita**.
4. **Recepción:** el calendario muestra la visita en su día; ábrela, usa **Cancelar visita** con un motivo. Llegan los avisos al visitante y al anfitrión.
5. **Dashboard** y **Reportes** muestran *Cancelaciones por motivo*.
6. El domingo después de las 02:00 aparece un respaldo **semanal** en Configuración → Respaldos.

## Notas
- **Plan Free:** incluye 1 GB de archivos. Los respaldos automáticos **sin fotos** ocupan poco; con fotos, revisa el espacio usado en Configuración → Respaldos.
- Los pases enviados **antes** de esta versión no traen el enlace de cancelación; usa **Reenviar QR** si el visitante lo necesita.
- La importación de respaldos **solo agrega lo que falte**; no restaura contraseñas de usuarios.
- Pendiente: manuales y documentación técnica de la 4.2.0 (cuando lo autorices).
