import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { EMAIL_RE, listaCorreos } from '../../lib/formato.js';
import { mensajeError } from '../../lib/archivos.js';
import { Mensaje, useToast } from '../ui.jsx';

export default function Correos({ recargar }) {
  const [c, setC] = useState(null);
  const [dest, setDest] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  useEffect(() => {
    supabase.from('configuracion').select('*').eq('id', 1).maybeSingle().then(({ data }) => {
      setC(data); setDest((data?.destinatarios_reporte ?? []).join('\n'));
    });
  }, []);
  if (!c) return <section className="card"><p className="muted">Cargando…</p></section>;

  async function guardar(e) {
    e.preventDefault();
    const recepcion = (c.correo_recepcion ?? '').trim().toLowerCase();
    const lista = listaCorreos(dest);
    const tolerancia = Number(c.tolerancia_min);
    const anticipacion = Number(c.minutos_anticipacion);
    if (recepcion && !EMAIL_RE.test(recepcion)) return setError('Revisa el correo de recepción.');
    const malos = lista.filter((d) => !EMAIL_RE.test(d));
    if (malos.length) return setError(`Revisa estos correos: ${malos.join(', ')}`);
    if (lista.length > 10) return setError('Máximo 10 destinatarios.');
    if (c.copia_recepcion && !recepcion) return setError('Para enviar copia, escribe el correo de recepción.');
    if (!Number.isInteger(tolerancia) || tolerancia < 0 || tolerancia > 240) return setError('La tolerancia debe ser de 0 a 240 minutos.');
    if (!Number.isInteger(anticipacion) || anticipacion < 0 || anticipacion > 240) return setError('La llegada temprana debe ser de 0 a 240 minutos.');
    const cambios = {
      correo_recepcion: recepcion || null, copia_recepcion: c.copia_recepcion, avisar_anfitrion: c.avisar_anfitrion,
      destinatarios_reporte: lista, tolerancia_min: tolerancia, minutos_anticipacion: anticipacion, updated_at: new Date().toISOString(),
    };
    const { error: err } = await supabase.from('configuracion').update(cambios).eq('id', 1);
    if (err) return setError(mensajeError(err, 'No se pudieron guardar los cambios.'));
    setError(''); toast('Configuración guardada.'); recargar();
  }
  return (
    <section className="card" aria-labelledby="correos-titulo">
      <h2 id="correos-titulo">Correos, avisos y tolerancia</h2>
      <form onSubmit={guardar} noValidate className="form-config">
        <div className="field"><label htmlFor="c-rec">Correo de recepción</label>
          <input id="c-rec" type="email" placeholder="recepcion@hixsa.com" value={c.correo_recepcion ?? ''} onChange={(e) => setC({ ...c, correo_recepcion: e.target.value })} /></div>
        <label className="check"><input type="checkbox" checked={c.copia_recepcion} onChange={(e) => setC({ ...c, copia_recepcion: e.target.checked })} /><span>Enviar a recepción una copia de cada pase</span></label>
        <label className="check"><input type="checkbox" checked={c.avisar_anfitrion !== false} onChange={(e) => setC({ ...c, avisar_anfitrion: e.target.checked })} /><span>Avisar al anfitrión cuando llega su visita</span></label>
        <div className="field"><label htmlFor="c-dest">Destinatarios de los reportes</label>
          <textarea id="c-dest" rows={3} placeholder="Un correo por línea" value={dest} onChange={(e) => setDest(e.target.value)} />
          <p className="hint">Se usan al enviar reportes y en los reportes automáticos. Máximo 10.</p></div>
        <div className="field field-corto"><label htmlFor="c-ant">Llegada temprana permitida (minutos)</label>
          <input id="c-ant" type="number" min="0" max="240" step="1" value={c.minutos_anticipacion ?? 10} onChange={(e) => setC({ ...c, minutos_anticipacion: e.target.value })} />
          <p className="hint">Minutos antes de su hora en los que el visitante ya puede entrar. Antes de eso, Recepción verá ACCESO NO PERMITIDO.</p></div>
        <div className="field field-corto"><label htmlFor="c-tol">Tolerancia de llegada (minutos)</label>
          <input id="c-tol" type="number" min="0" max="240" step="1" value={c.tolerancia_min ?? 15} onChange={(e) => setC({ ...c, tolerancia_min: e.target.value })} />
          <p className="hint">Minutos después de su hora en los que todavía puede entrar y cuenta como puntual. Después, la entrada requiere autorización.</p></div>
        <Mensaje>{error}</Mensaje>
        <button className="btn btn-compact" type="submit">Guardar</button>
      </form>
    </section>
  );
}
