---
name: reporte-visitas
description: Genera el reporte semanal de visitas a las oficinas de HIXSA consultando la base de datos real de Supabase por MCP. Úsala cuando pidan el reporte o resumen semanal de visitas, estadísticas de recepción, cuántas visitas hubo, qué empresas nos visitaron, horas pico, o un reporte de visitas para Dirección o Seguridad.
---

# Reporte semanal de visitas HIXSA

Tarea repetitiva del equipo de Recepción y Seguridad: cada lunes se prepara un resumen de la semana anterior para Dirección. Esta skill lo genera en minutos con datos reales.

## Requisitos

- Servidor MCP `supabase` activo (definido en `.mcp.json`, modo **solo lectura**).
  Si no aparece al escribir `/mcp`, pide al usuario que exporte `SUPABASE_PROJECT_REF`, reinicie Claude Code y se autentique en `/mcp`.
- Las consultas están en `consultas.sql` (misma carpeta). Úsalas tal cual; no inventes otras salvo que el usuario lo pida.

## Pasos

1. **Periodo.** Si el usuario no indica fechas, usa la última semana completa (lunes a domingo) en hora de Ciudad de México. Calcula `:desde` (lunes) y `:hasta` (domingo) en formato `AAAA-MM-DD`, y la semana anterior (`:desde_prev`, `:hasta_prev`) para comparar.
2. **Consultas.** Ejecuta cada bloque de `consultas.sql` con la herramienta `execute_sql` del MCP de Supabase, reemplazando los parámetros por fechas entre comillas simples. Son consultas de solo lectura.
3. **Redacción.** Llena `plantilla.md` con los resultados:
   - Escribe en español de México, tono ejecutivo, oraciones cortas.
   - Las cifras salen solo de las consultas. Si un bloque no regresa filas, escribe "Sin datos" en esa sección.
   - Explica variaciones contra la semana anterior en porcentaje cuando la semana anterior tenga datos.
4. **Privacidad.** El reporte **no** incluye correos ni teléfonos de visitantes. Nombres de empresas y de anfitriones internos sí.
5. **Entrega.** Guarda el archivo en `reportes/semana-<desde>.md` y muestra al usuario el resumen ejecutivo y las alertas.
6. **Siguiente paso.** Si el usuario quiere enviarlo por correo, indícale que use el panel (Consultas > Enviar por correo) con el mismo periodo. Esta skill no escribe en la base de datos.

## Criterios de alerta

Marca como alerta, en este orden de prioridad:

- Pases con error de envío de correo (el visitante no recibió su QR).
- Visitas de más de 8 horas.
- Un día con más del doble del promedio diario de la semana.
- Caída o aumento mayor a 30 % contra la semana anterior.
