# Despliegue de la versión 4.1.1

No hay cuentas ni secretos nuevos. Trabaja en la carpeta del proyecto (la que contiene `package.json`):

```powershell
cd "C:\Users\mario.rivera\Documents\MARIO\HIXSA\APP REG VISITAS CLAUDE\PROYECTO CLAUDE\VERSION_QR_ADMIN\files_regitro hixsa_2\hixsa-registro-visitantes\hixsa-registro-visitantes"
```

> **¿Ya desplegaste la 4.1.0?** Si no, primero ejecuta su migración (`supabase/migrations/20261113_v4_1_0.sql`) y despliega `crear-invitacion`, `gestionar-visitante` e `importar-datos` (ver `docs/DESPLIEGUE_V4_1_0.md`). El zip de esta versión ya incluye todos sus archivos.

## 1. Archivos
Primero trae lo que haya en GitHub, con la carpeta limpia (`git status` sin cambios):

```powershell
git pull --rebase origin main
```

Después copia el contenido de `v4.1.1-archivos.zip` encima de la carpeta del proyecto, reemplazando archivos.

## 2. Base de datos
Supabase, proyecto **hixsa-visitantes** (la dirección contiene `ziqfcmgufkeydulgtnvl`) → **SQL Editor → New query** → pega `supabase/migrations/20261116_v4_1_1.sql` → **Run**.

**Qué deberías ver:** `festivos = 0` y `foto_usuarios = 1`.

## 3. Funciones (1 nueva y 5 actualizadas)
Ejecuta **uno por uno**:

```powershell
npx supabase functions deploy depurar-informacion --no-verify-jwt --use-api
npx supabase functions deploy registrar-visita --no-verify-jwt --use-api
npx supabase functions deploy crear-invitacion --no-verify-jwt --use-api
npx supabase functions deploy reenviar-pase --no-verify-jwt --use-api
npx supabase functions deploy reporte-programado --no-verify-jwt --use-api
npx supabase functions deploy admin-usuarios --no-verify-jwt --use-api
```

**Qué deberías ver** en cada uno: `Deployed Functions on project ziqfcmgufkeydulgtnvl`.

## 4. Sitio
Uno por uno:

```powershell
npm install
npm run build
git add -A
git commit -m "feat: versión 4.1.1"
git push
```

**Qué deberías ver:** `✔ Build listo` y `main -> main` sin *rejected*. En Cloudflare, el despliegue termina en **Success**.

## 5. Configuración inicial (una vez)
1. **Configuración → Calendario laboral:** elige el año y usa **Cargar descanso obligatorio**. Repite para el año siguiente. Agrega los días propios de la empresa si los hay.
2. Cada persona puede subir su foto en **su nombre (arriba a la derecha) → Mi perfil**.

## 6. Verificación
1. **Celular:** abre el panel; arriba aparece ☰. El menú muestra tu foto, las secciones y *Salir*. En Configuración → Usuarios, la tabla se ve como tarjetas.
2. **Formulario:** elige un sábado o un festivo → aviso *Las visitas se agendan de lunes a viernes…*. Un viernes a lunes sí se permite.
3. **Reportes:** el bloque *Enviar reporte a los destinatarios ahora* está arriba; la fecha propuesta es el día hábil anterior. La semana muestra lunes a viernes.
4. **Consultas → Por visitante → Reenviar QR**; luego **Configuración → Bitácora**: aparece *Reenvío de pase*.
5. **Configuración → Importar y depurar → Depurar información:** elige *Más de 365 días* → **Vista previa** (no borra nada).
6. El próximo **lunes a las 07:00** debe llegar el reporte diario **del viernes**.

## Notas
- **Depurar no se puede deshacer.** Usa siempre la vista previa y descarga el respaldo CSV antes.
- Si un lunes es festivo, ese día no sale el reporte diario; el martes llega el del viernes.
- Si la foto de un usuario marca error, confirma que ejecutaste la migración (crea el almacenamiento `usuarios`) y que desplegaste `admin-usuarios`.
- La función `borrar-perfiles` sigue desplegada, pero el panel ya usa *Depurar información*.
- Pendiente: actualizar manuales y documentación técnica a la 4.1.1 (cuando lo autorices).
