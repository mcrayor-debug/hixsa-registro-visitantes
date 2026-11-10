# Historial de versiones

## 4.0.0-fase.1 (noviembre 2026)

### Nuevo
- **Identidad oficial HIXSA**: paleta del Manual de Identidad (azul #0047BA, cian #00A9E0, naranja #F38A00, amarillo #FFCD00), tipografía Calibri y logotipo en formulario, panel y correos.
- **Bienvenida por empresa**: pantalla completa para elegir la empresa a visitar (botones con logo y lista). En **modo auditoría** solo aparece HIXSA.
- **Empresas a visitar** configurables (nombre, logo, botón o lista, orden, activa) y **logo del sistema** editable.
- **Modo auditoría** aplicado en la base de datos: el panel y los reportes solo muestran la empresa principal.
- **Roles con permisos**: SUPERADMIN, ADMIN, SUPERVISOR, RECEPCIÓN y CONSULTA, con secciones, alcance de consulta (hoy, semana, sin límite) y permiso de exportar. El SUPERADMIN crea, edita y borra roles y usuarios.
- **Nombre y apellidos** por separado; **empresa de origen** y **empresa a visitar** como campos distintos.
- **Anfitriones**: celular, foto (privada) y varias empresas; el formulario los filtra por la empresa elegida.
- **Tolerancia de llegada** configurable (minutos).
- **Bitácora de cambios**: quién cambió qué y cuándo en usuarios, roles, empresas, anfitriones y configuración.
- Botón visible **“Acceso para personal”** en la bienvenida y en el formulario.

### Cambios
- El rol `admin` se conserva como ADMIN y `consulta` como CONSULTA; CONSULTA ya no exporta ni envía reportes.
- El formulario obtiene empresas y anfitriones con la función pública `config_publica()` (sin acceso directo a tablas).
- Ya no se cargan fuentes de Google; las cabeceras de seguridad se ajustaron.
- Migraciones en `supabase/migrations/` (la primera: `20261110_v4_fase1.sql`).

## 3.0.0 (noviembre 2026)

### Nuevo
- Panel interno migrado a **React 18 + Vite**, publicado en `/admin/` (`admin.html` redirige).
- **Recepción**: lector de QR con la cámara, ficha de la visita y registro de **llegada y salida reales**.
- **Aviso al anfitrión** por correo cuando llega su visita (activable en Configuración).
- **Directorio de anfitriones** administrable; el formulario muestra solo nombre y área.
- **Identificación** en el registro: tipo (INE, licencia, pasaporte, ID de empresa, otro) y foto, guardada en un bucket privado.
- **Tablero de estadísticas**: asistencia, en sitio, duración real, visitas por día, hora de llegada, motivos, anfitriones y empresas.
- Nueva Edge Function `registrar-acceso`.
- Reporte diario: asistencia, visitas que no se presentaron y visitas sin salida registrada.

### Cambios
- Cloudflare publica la carpeta `dist` (antes `public`); requiere `npm install` en local.
- `scripts/build-config.js` pasa a `build-config.cjs`; nuevo `scripts/build.mjs`.
- Cabeceras: cámara permitida para el sitio e imágenes de Supabase Storage.

## 2.0.0 (octubre 2026)

### Nuevo
- Fecha y hora de entrada y salida elegidas por el visitante.
- Pase con código QR (folio + huella de datos y horario) enviado por correo y mostrado en pantalla.
- Panel interno con inicio de sesión: Consultas (filtros, CSV, reporte por correo) y Configuración (usuarios, roles, correos, bitácora).
- Validación del pase al escanear el QR.
- Edge Functions: `registrar-visita`, `admin-usuarios`, `enviar-reporte`.
- Reporte diario automático con API de Supabase y API de Claude (GitHub Actions, 07:00 CDMX).
- Conexión MCP a Supabase (solo lectura) y skill `reporte-visitas` para Claude Code.
- Verificación automática (CI) en cada push.

### Cambios
- El público ya no inserta directo en la base: todo pasa por `registrar-visita`.
- Modelo de datos v2 con migración segura desde la v1.

## 1.0.0
- Formulario público de registro con paleta HIXSA, Supabase con RLS y despliegue en Cloudflare Pages.
