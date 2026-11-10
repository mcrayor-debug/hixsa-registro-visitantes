# Despliegue de la versión 4, fase 2

Requiere la **fase 1 ya desplegada**. No hay cuentas ni secretos nuevos.

> Revisa que el secreto `PUBLIC_SITE_URL` de Supabase tenga la dirección de tu sitio
> (`https://hixsa-registro-visitantes.mcrayor.workers.dev`): los correos de aprobación del anfitrión
> apuntan ahí. Compruébalo con `npx supabase secrets list`.

## 1. Copiar los archivos

Descomprime `v4-fase2-archivos.zip` y copia su contenido encima de tu carpeta del proyecto, reemplazando archivos.

## 2. Base de datos

Supabase → **SQL Editor → New query** → pega todo `supabase/migrations/20261111_v4_fase2.sql` → **Run**.

**Qué deberías ver:** una fila con el número de **perfiles** creados a partir de tus visitas, `visitas_sin_perfil = 0` y `minutos_anticipacion = 10`.

## 3. Funciones (3 nuevas y 2 actualizadas)

```powershell
npx supabase functions deploy registrar-visita --no-verify-jwt --use-api
npx supabase functions deploy registrar-acceso --no-verify-jwt --use-api
npx supabase functions deploy visitante-recurrente --no-verify-jwt --use-api
npx supabase functions deploy aprobar-visita --no-verify-jwt --use-api
npx supabase functions deploy gestionar-visitante --no-verify-jwt --use-api
```

## 4. Sitio

```powershell
npm install
npm run build
git add -A
git commit -m "feat: versión 4, fase 2 (recepción y seguridad)"
git push
```

## 5. Verificación

1. **Registro nuevo** con anfitrión: marca *Guardar mis datos* y *Salas de juntas* (pide selfie). Al anfitrión le llega el correo **Aprobar / Rechazar**.
2. Desde ese correo, **aprueba** la visita: al visitante le llega la confirmación.
3. **Recepción** (celular o tablet): escanea el QR fuera de la ventana → **ACCESO NO PERMITIDO** → autoriza con motivo.
4. **Recurrente:** en otra visita usa *Recuperar mis datos*, recibe el código y verifica que se llenen los datos.
5. **Configuración → Visitantes:** marca a alguien como *No deseado* y revisa la alerta en su ficha y el correo de aviso.
6. **Configuración → Correos y avisos:** ajusta *Llegada temprana permitida* y *Tolerancia*.

## Notas

- Las visitas registradas **antes** de esta fase quedan como *aprobadas*.
- En modo de prueba de Resend, los correos (código, aprobación, avisos) solo llegan al correo de tu cuenta de Resend.
- El rol que deba bloquear visitantes necesita la sección *Configuración: visitantes y bloqueos* (ya la tienen SUPERADMIN y ADMIN).
