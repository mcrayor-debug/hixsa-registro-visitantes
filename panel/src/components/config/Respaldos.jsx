import { useCallback, useEffect, useState } from 'react';
import { supabase, invocar } from '../../lib/supabase.js';
import { fmtFechaHora } from '../../lib/formato.js';
import { usePaginacion } from '../../lib/paginacion.jsx';
import { Mensaje, useToast } from '../ui.jsx';
import { BotonIcono, Icono } from '../iconos.jsx';

const ORDEN = ['roles', 'empresas', 'dias_festivos', 'anfitriones', 'anfitrion_empresas', 'personas', 'visitantes', 'intentos_acceso', 'bitacora_cambios', 'bitacora_reportes'];
const NOMBRES = { roles: 'Roles', empresas: 'Empresas', dias_festivos: 'Días festivos', anfitriones: 'Anfitriones', anfitrion_empresas: 'Empresas de anfitriones',
  personas: 'Perfiles de visitantes', visitantes: 'Visitas', intentos_acceso: 'Intentos de acceso', bitacora_cambios: 'Bitácora de cambios', bitacora_reportes: 'Reportes enviados' };
const MB = (b) => `${(Number(b) / 1048576).toFixed(1)} MB`;

async function leerArchivo(archivo, contrasena) {
  let bytes = new Uint8Array(await archivo.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 7)) === 'HIXBAK1') {
    if (!contrasena) throw new Error('Este respaldo está protegido: escribe su contraseña.');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(contrasena), 'PBKDF2', false, ['deriveKey']);
    const clave = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes.slice(7, 23), iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(23, 35) }, clave, bytes.slice(35))); }
    catch { throw new Error('La contraseña no es correcta.'); }
  }
  const texto = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const datos = JSON.parse(texto);
  if (datos.formato !== 'hixsa-respaldo') throw new Error('El archivo no es un respaldo de este sistema.');
  return datos;
}

export default function Respaldos() {
  const [cfg, setCfg] = useState(null);
  const [lista, setLista] = useState([]);
  const [total, setTotal] = useState(0);
  const [manual, setManual] = useState({ fotos: false, contrasena: '', proteger: true });
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');
  const [imp, setImp] = useState({ archivo: null, contrasena: '', datos: null, previa: null, fotos: false });
  const toast = useToast();
  const pag = usePaginacion(lista, 10);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('configuracion').select('respaldo_semanal, respaldo_mensual, respaldo_fotos').eq('id', 1).maybeSingle();
    setCfg(data);
    try { const r = await invocar('respaldos', { accion: 'listar' }); setLista(r.respaldos); setTotal(r.total_bytes); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function cambiarCfg(k, v) {
    const { error: err } = await supabase.from('configuracion').update({ [k]: v }).eq('id', 1);
    if (err) return toast('No se pudo guardar.');
    setCfg({ ...cfg, [k]: v });
  }
  async function generar() {
    if (manual.proteger && manual.contrasena.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    if (!manual.proteger && !confirm('El respaldo sin contraseña contiene datos personales legibles. ¿Continuar?')) return;
    setOcupado('generar'); setError('');
    try {
      const r = await invocar('respaldos', { accion: 'generar', tipo: 'manual', incluir_fotos: manual.fotos, contrasena: manual.proteger ? manual.contrasena : null });
      if (r.url) window.location.href = r.url;
      toast(`Respaldo generado (${MB(r.tamano)}).${r.fotos_incompletas ? ' Las fotos superan 60 MB: se incluyó solo una parte.' : ''}`);
      setManual({ ...manual, contrasena: '' }); cargar();
    } catch (e) { setError(e.message); } finally { setOcupado(''); }
  }
  async function descargar(id) {
    try { const r = await invocar('respaldos', { accion: 'descargar', id }); window.location.href = r.url; } catch (e) { toast(e.message); }
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar este respaldo? No se puede deshacer.')) return;
    try { await invocar('respaldos', { accion: 'eliminar', id }); toast('Respaldo eliminado.'); cargar(); } catch (e) { toast(e.message); }
  }

  async function revisar() {
    setOcupado('revisar'); setError('');
    try {
      const datos = await leerArchivo(imp.archivo, imp.contrasena);
      const previa = {};
      for (const t of ORDEN) {
        const filas = datos.tablas[t] ?? [];
        previa[t] = { total: filas.length, nuevas: 0, existentes: 0 };
        for (let i = 0; i < filas.length; i += 500) {
          const r = await invocar('respaldos', { accion: 'importar', tabla: t, filas: filas.slice(i, i + 500), simular: true });
          previa[t].nuevas += r.nuevas; previa[t].existentes += r.existentes;
        }
      }
      setImp({ ...imp, datos, previa });
    } catch (e) { setError(e.message); } finally { setOcupado(''); }
  }
  async function restaurar() {
    if (!confirm('Se agregarán los registros que faltan. No se borra ni se sobrescribe nada. ¿Continuar?')) return;
    setOcupado('restaurar'); setError('');
    const resumen = {};
    try {
      for (const t of ORDEN) {
        const filas = imp.datos.tablas[t] ?? [];
        resumen[t] = 0;
        for (let i = 0; i < filas.length; i += 500) {
          const r = await invocar('respaldos', { accion: 'importar', tabla: t, filas: filas.slice(i, i + 500), simular: false });
          resumen[t] += r.insertadas ?? 0;
        }
      }
      if (imp.fotos && imp.datos.archivos) {
        const lista2 = Object.entries(imp.datos.archivos);
        resumen.archivos = 0;
        for (let i = 0; i < lista2.length; i += 10) {
          const r = await invocar('respaldos', { accion: 'importar_archivos', simular: false, archivos: lista2.slice(i, i + 10).map(([ruta, b64]) => ({ ruta, b64 })) });
          resumen.archivos += r.nuevos;
        }
      }
      await invocar('respaldos', { accion: 'registrar_restauracion', resumen });
      toast(`Restauración terminada: ${Object.values(resumen).reduce((a, b) => a + b, 0)} registros agregados.`);
      setImp({ archivo: null, contrasena: '', datos: null, previa: null, fotos: false });
    } catch (e) { setError(e.message); } finally { setOcupado(''); }
  }

  const nuevasTotal = imp.previa ? Object.values(imp.previa).reduce((s, x) => s + x.nuevas, 0) : 0;
  return (
    <div className="config-col">
      <section className="card" aria-labelledby="resp-auto">
        <h2 id="resp-auto">Respaldos automáticos</h2>
        <p className="muted">Se guardan en el almacenamiento privado de Supabase. Semanal: domingo 02:00 (se conservan 8). Mensual: día 1, 02:30 (se conservan 12). Espacio usado: <strong>{MB(total)}</strong>.</p>
        {cfg && <div className="opciones-respaldo">
          <label className="check"><input type="checkbox" checked={cfg.respaldo_semanal} onChange={(e) => cambiarCfg('respaldo_semanal', e.target.checked)} /><span>Respaldo semanal</span></label>
          <label className="check"><input type="checkbox" checked={cfg.respaldo_mensual} onChange={(e) => cambiarCfg('respaldo_mensual', e.target.checked)} /><span>Respaldo mensual</span></label>
          <label className="check"><input type="checkbox" checked={cfg.respaldo_fotos} onChange={(e) => cambiarCfg('respaldo_fotos', e.target.checked)} /><span>Incluir fotos en los automáticos (ocupa mucho más espacio)</span></label>
        </div>}
        <div className="table-wrap">
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Tamaño</th><th>Contenido</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>{pag.visibles.map((r) => (
              <tr key={r.id}><td className="nowrap">{fmtFechaHora.format(new Date(r.created_at))}</td><td>{r.tipo[0].toUpperCase() + r.tipo.slice(1)}</td><td>{MB(r.tamano_bytes)}</td>
                <td className="small">{r.conteos?.visitantes ?? 0} visitas{r.incluye_fotos ? ' · con fotos' : ''}{r.cifrado ? ' · con contraseña' : ''}</td>
                <td className="acciones-fila"><BotonIcono icono="subir" texto="Descargar" onClick={() => descargar(r.id)} /><BotonIcono icono="eliminar" texto="Eliminar respaldo" peligro onClick={() => eliminar(r.id)} /></td></tr>
            ))}</tbody>
          </table>
          {!lista.length && <p className="vacio">Aún no hay respaldos.</p>}
        </div>
        {pag.controles}
      </section>

      <section className="card" aria-labelledby="resp-manual">
        <h2 id="resp-manual">Respaldo manual</h2>
        <p className="muted">Visitas, perfiles, anfitriones, empresas, roles, festivos y bitácoras. <strong>Contiene datos personales.</strong> No incluye contraseñas de usuarios.</p>
        <label className="check"><input type="checkbox" checked={manual.proteger} onChange={(e) => setManual({ ...manual, proteger: e.target.checked })} /><span>Proteger con contraseña (recomendado)</span></label>
        {manual.proteger && <div className="field field-corto"><label htmlFor="rs-pass">Contraseña del respaldo</label>
          <input id="rs-pass" type="password" autoComplete="new-password" value={manual.contrasena} onChange={(e) => setManual({ ...manual, contrasena: e.target.value })} />
          <p className="hint">Mínimo 8 caracteres. Si la pierdes, el respaldo no se puede abrir.</p></div>}
        <label className="check"><input type="checkbox" checked={manual.fotos} onChange={(e) => setManual({ ...manual, fotos: e.target.checked })} /><span>Incluir fotos (archivo mucho más grande)</span></label>
        <Mensaje>{error}</Mensaje>
        <button type="button" className="btn btn-compact btn-icono" disabled={Boolean(ocupado)} aria-busy={ocupado === 'generar'} onClick={generar}>
          <Icono nombre="subir" /> {ocupado === 'generar' ? 'Generando…' : 'Generar y descargar'}</button>
      </section>

      <section className="card" aria-labelledby="resp-imp">
        <h2 id="resp-imp">Importar respaldo</h2>
        <p className="muted">Modo seguro: <strong>agrega solo lo que falte</strong>; nunca borra ni sobrescribe. No restaura contraseñas de usuarios.</p>
        <label className="btn btn-secondary btn-compact btn-icono"><Icono nombre="subir" /> {imp.archivo ? imp.archivo.name : 'Elegir archivo de respaldo'}
          <input type="file" accept=".gz,.hixbak" className="sr-only" onChange={(e) => setImp({ archivo: e.target.files?.[0] ?? null, contrasena: '', datos: null, previa: null, fotos: false })} /></label>
        {imp.archivo && <div className="importar-respaldo">
          <div className="field field-corto"><label htmlFor="ri-pass">Contraseña (si el respaldo la tiene)</label>
            <input id="ri-pass" type="password" value={imp.contrasena} onChange={(e) => setImp({ ...imp, contrasena: e.target.value })} /></div>
          <button type="button" className="btn btn-secondary btn-compact" disabled={Boolean(ocupado)} aria-busy={ocupado === 'revisar'} onClick={revisar}>{ocupado === 'revisar' ? 'Revisando…' : 'Vista previa'}</button>
        </div>}
        {imp.previa && <>
          <div className="table-wrap"><table className="tabla">
            <thead><tr><th>Datos</th><th>En el respaldo</th><th>Faltan (se agregarán)</th><th>Ya existen</th></tr></thead>
            <tbody>{ORDEN.map((t) => <tr key={t}><td>{NOMBRES[t]}</td><td>{imp.previa[t].total}</td><td><strong>{imp.previa[t].nuevas}</strong></td><td>{imp.previa[t].existentes}</td></tr>)}</tbody>
          </table></div>
          {imp.datos.archivos && Object.keys(imp.datos.archivos).length > 0 && (
            <label className="check"><input type="checkbox" checked={imp.fotos} onChange={(e) => setImp({ ...imp, fotos: e.target.checked })} /><span>Restaurar también las fotos que falten ({Object.keys(imp.datos.archivos).length} en el respaldo)</span></label>)}
          <button type="button" className="btn btn-compact" disabled={Boolean(ocupado) || (!nuevasTotal && !imp.fotos)} aria-busy={ocupado === 'restaurar'} onClick={restaurar}>
            {ocupado === 'restaurar' ? 'Restaurando…' : `Agregar ${nuevasTotal} registros que faltan`}</button>
        </>}
      </section>
    </div>
  );
}
