# Despliegue de la versión 4, fase 1

Esta fase **no requiere crear cuentas ni cambiar secretos**. Solo: migración de base de datos, funciones y `git push`.

## 1. Copiar los archivos

1. Descomprime `v4-fase1-archivos.zip`.
2. Copia **su contenido** encima de tu carpeta del proyecto (la que tiene `package.json`), aceptando **reemplazar** archivos.
3. En VS Code, revisa en el panel de **Control de código fuente** que aparezcan los archivos modificados.

## 2. Base de datos (Supabase)

1. Supabase → proyecto `ziqfcmgufkeydulgtnvl` → **SQL Editor → New query**.
2. Pega todo `supabase/migrations/20261110_v4_fase1.sql` y haz clic en **Run** (confirma si pide *Run this query*).
3. **Qué deberías ver:** una tabla con `mario.rivera@hixsa.com | superadmin | true` y otra con los 5 roles.

> Si la primera tabla sale vacía, el usuario no existe en **Authentication → Users**. Créalo y ejecuta `supabase/crear-admin.sql`.

## 3. Funciones del servidor

En la terminal de VS Code, dentro de la carpeta del proyecto:

```powershell
npx supabase functions deploy registrar-visita --no-verify-jwt --use-api
npx supabase functions deploy registrar-acceso --no-verify-jwt --use-api
npx supabase functions deploy admin-usuarios --no-verify-jwt --use-api
npx supabase functions deploy enviar-reporte --no-verify-jwt --use-api
```

## 4. Sitio (GitHub → Cloudflare)

```powershell
npm install
npm run build
git add -A
git commit -m "feat: versión 4, fase 1 (roles, empresas, modo auditoría, marca HIXSA)"
git push
```

`npm run build` es solo una prueba local: si termina con `✔ Build listo`, el despliegue en Cloudflare también funcionará.

## 5. Verificación

1. Abre el sitio: debe aparecer la **bienvenida** con HIXSA, INSITECH e INAPSA.
2. Entra al panel con `mario.rivera@hixsa.com`: la insignia debe decir **SUPERADMIN** y aparecer **Configuración → Roles**.
3. **Configuración → Empresas:** sube los logos de INSITECH e INAPSA (botón ✏️ de cada una).
4. **Configuración → Anfitriones:** los anfitriones existentes quedaron asignados a HIXSA; asigna los de las otras empresas.
5. Activa y desactiva el **modo auditoría** y revisa la bienvenida en otra pestaña.
6. Registra una visita de prueba eligiendo una empresa y un anfitrión.

## Notas

- El rol `consulta` ahora **no exporta** ni envía reportes. Si alguien lo necesita, cámbialo a otro rol o edita el rol en **Configuración → Roles**.
- El reporte diario de GitHub sigue funcionando sin cambios hasta la fase 3, cuando se reemplaza por el de Supabase. Mientras tanto, **no aplica el modo auditoría**.
