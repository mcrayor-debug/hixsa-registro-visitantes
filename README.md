# Registro de visitas HIXSA

Sistema web para registrar visitantes, emitir pases con QR, aprobar visitas por el anfitrión, controlar entradas y salidas en recepción, consultar, generar reportes y auditar accesos.

**Versión:** 4.0.0 · **Sitio:** `https://hixsa-registro-visitantes.mcrayor.workers.dev` · **Panel:** `/admin/`

## Funciones principales

- **Bienvenida por empresa** (HIXSA, INSITECH, INAPSA y otras) y **modo auditoría** (solo HIXSA en todo el sistema).
- **Registro** con identificación, selfie para salas de juntas, equipo de cómputo y **visitantes recurrentes** con código por correo.
- **Pase con QR** e invitación de calendario (.ics); **aprobación del anfitrión** por correo.
- **Recepción** para celular y tablet: validación de horario en el servidor, **ACCESO NO PERMITIDO**, autorización con motivo, bloqueos.
- **Roles** con permisos por sección, alcance de fechas y exportación.
- **Consultas** (por fecha, por visitante, seguridad), **Reportes** semanal y mensual, **PDF y CSV**, **reportes automáticos** desde Supabase.
- **Importación** de Glide y plantilla, **borrado de perfiles** con anonimización, bitácora de cambios.

## Documentación

| Documento | Para quién |
|---|---|
| [Guía de instalación desde cero](docs/GUIA_DESPLIEGUE.md) ([PDF](docs/Guia_Despliegue_Hixsa.pdf)) | Quien monte el sistema en cuentas nuevas |
| [Documentación técnica](docs/DOCUMENTACION_TECNICA.md) ([PDF](docs/Documentacion_Tecnica_Hixsa.pdf)) | Desarrolladores y Claude Code |
| [Manual del visitante](docs/MANUAL_VISITANTE.md) ([PDF](docs/Manual_Visitante_Hixsa.pdf)) | Visitantes (modo normal y auditoría) |
| [Manual del personal](docs/MANUAL_PERSONAL.md) ([PDF](docs/Manual_Personal_Hixsa.pdf)) | Recepción, supervisión y administración |
| [Historial de versiones](CHANGELOG.md) | Todos |
| [CLAUDE.md](CLAUDE.md) | Contexto para Claude Code |

## Comandos

```powershell
npm install        # dependencias (primera vez)
npm run build      # genera dist/ (formulario + panel)
npm run dev        # build + servidor local en http://localhost:3000
git push           # publica en Cloudflare
npx supabase functions deploy <funcion> --no-verify-jwt --use-api
```

## Stack

HTML/CSS/JS (formulario) · React 18 + Vite (panel) · Supabase (PostgreSQL + RLS, Storage, Auth, 11 Edge Functions, pg_cron) · Resend · Cloudflare Workers · GitHub Actions.
