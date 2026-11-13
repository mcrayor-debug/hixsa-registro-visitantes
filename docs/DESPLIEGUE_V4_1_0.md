# Despliegue de la versión 4.1.0

Requiere la 4.0.0 desplegada. No hay cuentas ni secretos nuevos.

## 1. Archivos
Copia el contenido de `v4.1.0-archivos.zip` encima de tu carpeta del proyecto, reemplazando archivos.

## 2. Base de datos
Supabase (proyecto **hixsa-visitantes**) → **SQL Editor** → pega `supabase/migrations/20261113_v4_1_0.sql` → **Run**.
**Qué deberías ver:** `anfitrion_solo_nombre = false` y `celular_usuarios = 1`.

## 3. Funciones (1 nueva y 7 actualizadas)
Ejecuta uno por uno:
```powershell
npx supabase functions deploy crear-invitacion --no-verify-jwt --use-api
npx supabase functions deploy admin-usuarios --no-verify-jwt --use-api
npx supabase functions deploy gestionar-visitante --no-verify-jwt --use-api
npx supabase functions deploy importar-datos --no-verify-jwt --use-api
npx supabase functions deploy reporte-programado --no-verify-jwt --use-api
npx supabase functions deploy reenviar-pase --no-verify-jwt --use-api
npx supabase functions deploy registrar-visita --no-verify-jwt --use-api
npx supabase functions deploy aprobar-visita --no-verify-jwt --use-api
```
(`registrar-visita` y `aprobar-visita` cambian porque el calendario ahora incluye el correo de recepción.)

## 4. Sitio
```powershell
git pull --rebase origin main
npm install
npm run build
git add -A
git commit -m "feat: versión 4.1.0"
git push
```

## 5. Verificación
1. El navegador muestra el ícono de HIXSA en la pestaña (si no, recarga con Ctrl + F5).
2. **Recepción → Visitas de hoy:** cada visita muestra su rango de horas.
3. **Consultas → Por visitante:** busca a alguien → **Nueva invitación** → llega el QR y el aviso al anfitrión.
4. **Configuración → Usuarios:** edita el celular de alguien.
5. **Configuración → Visitantes:** edita el teléfono de un visitante.
6. **Configuración → Anfitriones:** prueba *mostrar solo el nombre* y revisa el formulario.
7. **Reportes → Enviar ahora** (diario, fecha de ayer).
8. **Configuración → Correos y avisos → Sincronizar visitas próximas**.
9. **Configuración → Bitácora:** filtra fechas y cambia de página.
