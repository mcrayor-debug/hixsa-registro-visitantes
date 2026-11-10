// Lectura de CSV (Glide y plantilla HIXSA) y normalización de filas para importar-datos.
const OFFSET = '-06:00';

/** Parser CSV (comillas, comas y saltos de línea dentro de comillas, BOM). */
export function leerCsv(texto) {
  const t = texto.replace(/^\uFEFF/, '');
  const sep = (t.split('\n')[0].match(/;/g)?.length ?? 0) > (t.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const filas = []; let fila = []; let campo = ''; let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') comillas = false; else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some((x) => x.trim())) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim())) filas.push(fila);
  const [enc, ...datos] = filas;
  const claves = (enc ?? []).map((h) => h.replace(/^🔒\s*/, '').trim());
  return datos.map((f) => Object.fromEntries(claves.map((k, i) => [k, (f[i] ?? '').trim()])));
}

export function detectarFormato(filas) {
  const k = new Set(Object.keys(filas[0] ?? {}));
  if (k.has('nombre_visitante') && k.has('hora_llegada')) return 'glide_visitas';
  if (k.has('NombreVisitante') && k.has('correo')) return 'glide_perfiles';
  if (k.has('correo') && k.has('nombre') && k.has('entrada')) return 'plantilla';
  return null;
}

/** "15/7/2026, 10:34:31 a.m." (Glide, hora de CDMX) → ISO. */
export function fechaGlide(s) {
  const m = String(s ?? '').replace(/\u202f|\u00a0/g, ' ').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i);
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[7].toLowerCase() === 'p') h += 12;
  const p2 = (n) => String(n).padStart(2, '0');
  return new Date(`${m[3]}-${p2(m[2])}-${p2(m[1])}T${p2(h)}:${m[5]}:${p2(m[6] ?? 0)}${OFFSET}`).toISOString();
}
/** Hora suelta "6:00:00 p.m." aplicada al día (CDMX) de otra fecha. */
function horaEnDia(hora, iso) {
  const m = String(hora ?? '').replace(/\u202f|\u00a0/g, ' ').match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?\s*m\.?/i);
  if (!m || !iso) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(iso));
  return new Date(`${dia}T${String(h).padStart(2, '0')}:${m[2]}:00${OFFSET}`).toISOString();
}
/** "2026-11-12 10:00" (hora de CDMX) → ISO. */
const fechaPlantilla = (s) => {
  const m = String(s ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/);
  return m ? new Date(`${m[1]}T${m[2].padStart(2, '0')}:${m[3]}:00${OFFSET}`).toISOString() : null;
};
const mismoDia = (a, b) => a && b && new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(a))
  === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(b));

/** Nombre completo → nombre y apellidos (las 2 últimas palabras como apellidos). */
export function separarNombre(completo) {
  const p = String(completo ?? '').trim().split(/\s+/).filter(Boolean);
  if (p.length <= 1) return { nombre: p[0] ?? '', apellidos: '', revisar: true };
  const n = p.length >= 3 ? p.length - 2 : 1;
  return { nombre: p.slice(0, n).join(' '), apellidos: p.slice(n).join(' '), revisar: p.length > 4 };
}

export function normalizar(formato, filas) {
  if (formato === 'glide_perfiles') {
    const cuenta = new Map();
    filas.forEach((f) => { const c = f.correo.toLowerCase(); cuenta.set(c, (cuenta.get(c) ?? 0) + 1); });
    return { tipo: 'perfiles', filas: filas.map((f, i) => ({
      _fila: i + 2, origen: 'glide', origen_id: f['Row ID'], correo: f.correo, ...separarNombre(f.NombreVisitante),
      telefono: f.telefono, empresa: f.Empresa, foto_url: f.foto_perfi, recurrente: (cuenta.get(f.correo.toLowerCase()) ?? 0) > 1,
    })) };
  }
  if (formato === 'glide_visitas') {
    return { tipo: 'visitas', filas: filas.map((f, i) => {
      // Si no hay hora de inicio ni llegada, se usa la fecha de registro de la invitación
      const inicio = fechaGlide(f.hora_inicio) ?? (f.hora_llegada ? null : fechaGlide(f.FechaEntrada));
      const llegada = fechaGlide(f.hora_llegada);
      const entrada = inicio && (!llegada || mismoDia(inicio, llegada)) ? inicio : llegada ?? inicio;
      const salida = fechaGlide(f.HoraFinalCheckIN) ?? horaEnDia(f.HoraFinalCheckIN || '6:00:00 p.m.', entrada);
      return {
        _fila: i + 2, origen: 'glide', origen_id: f['Row ID'], persona_origen_id: f.row_Visitante,
        correo: f.mail, ...separarNombre(f.nombre_visitante), empresa: f.empresa,
        anfitrion: f.Anfitrion, entrada, salida, llegada, salida_real: fechaGlide(f.hora_salida),
        escaneos_expirados: Number(f.Num_Escaner_exp) || 0, registrado_por: f.User_registra,
        equipo_tipo: f.EquipoComputo, equipo_marca: f.Marca, equipo_serie: f.NoSerie,
        foto_id_url: f.foto_id_DNI_IN, foto_user_url: f.foto_user, motivo: 'Otro',
      };
    }) };
  }
  if (formato === 'plantilla') {
    return { tipo: 'visitas', filas: filas.map((f, i) => ({
      _fila: i + 2, origen: 'importacion', origen_id: f.folio_externo || `${f.correo}|${f.entrada}`.slice(0, 120),
      correo: f.correo, nombre: f.nombre, apellidos: f.apellidos, telefono: f.telefono, empresa: f.empresa_origen,
      empresa_visita: f.empresa_visita, anfitrion: f.anfitrion, motivo: f.motivo, entrada: fechaPlantilla(f.entrada),
      salida: fechaPlantilla(f.salida), llegada: fechaPlantilla(f.llegada_real), salida_real: fechaPlantilla(f.salida_real),
      tipo_identificacion: f.tipo_identificacion, equipo_tipo: f.equipo_tipo, equipo_marca: f.equipo_marca, equipo_serie: f.equipo_serie,
      comentarios: f.comentarios,
    })) };
  }
  return null;
}

/** Revisión previa (antes de enviar): errores evidentes por fila. */
export function revisar(norm) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return norm.filas.map((f) => {
    const errores = [], avisos = [];
    // Filas de Glide con fecha en lugar de nombre (error de captura): no se importan
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(String(f.nombre ?? '').trim())) errores.push('el nombre contiene una fecha (error de captura en Glide)');
    if (!re.test(String(f.correo ?? '').trim())) {
      if (f.persona_origen_id) avisos.push('correo inválido: se tomará del perfil importado de visitantes.csv');
      else if (norm.tipo === 'visitas' && f.origen === 'glide' && f.nombre) avisos.push('sin correo válido: se importará con un correo provisional');
      else errores.push('correo inválido');
    }
    if (norm.tipo === 'visitas' && !f.entrada) errores.push('sin fecha de entrada');
    if (norm.tipo === 'visitas' && !f.origen_id) errores.push('sin identificador');
    return { fila: f._fila, nombre: `${f.nombre ?? ''} ${f.apellidos ?? ''}`.trim(), errores, avisos, revisar: f.revisar };
  });
}

export const PLANTILLA = [
  'folio_externo', 'correo', 'nombre', 'apellidos', 'telefono', 'empresa_origen', 'empresa_visita', 'anfitrion', 'motivo',
  'entrada', 'salida', 'llegada_real', 'salida_real', 'tipo_identificacion', 'equipo_tipo', 'equipo_marca', 'equipo_serie', 'comentarios',
];
export function descargarPlantilla() {
  const ejemplo = ['EXT-0001', 'ana.lopez@empresa.com', 'Ana', 'López Rivera', '5512345678', 'Grupo Norte', 'HIXSA', 'Carlos Méndez',
    'Reunión', '2026-07-15 10:00', '2026-07-15 12:00', '2026-07-15 10:05', '2026-07-15 11:50', 'INE', 'Laptop', 'Dell', 'SN123', 'Ejemplo: borra esta fila'];
  const csv = '\uFEFF' + [PLANTILLA.join(','), ejemplo.map((x) => `"${x}"`).join(',')].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'plantilla_importacion_visitas.csv' });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
