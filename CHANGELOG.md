# Historial de versiones

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
