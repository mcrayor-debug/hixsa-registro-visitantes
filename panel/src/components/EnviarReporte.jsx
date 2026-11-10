import { useEffect, useState } from 'react';
import { invocar } from '../lib/supabase.js';
import { EMAIL_RE, listaCorreos } from '../lib/formato.js';
import { Dialogo, Mensaje, useToast } from './ui.jsx';

/** Envía por correo el CSV del periodo (y, si se da, el PDF generado en el panel). */
export default function EnviarReporte({ abierto, onCerrar, filtros, n, destinatarios, titulo, crearPdf }) {
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [conPdf, setConPdf] = useState(true);
  const toast = useToast();
  useEffect(() => { if (abierto) { setTexto(destinatarios.join('\n')); setError(''); } }, [abierto, destinatarios]);

  async function enviar(e) {
    e.preventDefault();
    const lista = listaCorreos(texto);
    const malos = lista.filter((d) => !EMAIL_RE.test(d));
    if (!lista.length) return setError('Agrega al menos un correo.');
    if (malos.length) return setError(`Revisa estos correos: ${malos.join(', ')}`);
    if (lista.length > 10) return setError('Máximo 10 destinatarios.');
    setEnviando(true);
    try {
      const pdf = crearPdf && conPdf ? await crearPdf() : null;
      const r = await invocar('enviar-reporte', { filtros, destinatarios: lista, titulo, pdf: pdf ? { nombre: pdf.nombre, base64: pdf.base64 } : undefined });
      onCerrar();
      toast(`Reporte enviado a ${r.destinatarios.length} ${r.destinatarios.length === 1 ? 'destinatario' : 'destinatarios'} (${r.total} visitas).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo={`Enviar por correo: ${titulo ?? 'reporte de visitas'}`}>
      <form onSubmit={enviar} noValidate>
        <p className="muted">{n} visitas del {filtros.desde || 'inicio'} al {filtros.hasta || 'hoy'}. Se adjunta un CSV con el detalle.</p>
        {crearPdf && <label className="check"><input type="checkbox" checked={conPdf} onChange={(e) => setConPdf(e.target.checked)} /><span>Adjuntar también el PDF</span></label>}
        <div className="field"><label htmlFor="r-dest">Destinatarios</label>
          <textarea id="r-dest" rows={3} placeholder="Un correo por línea" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
        <Mensaje>{error}</Mensaje>
        <div className="dialog-actions"><button className="btn btn-compact" type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar'}</button></div>
      </form>
    </Dialogo>
  );
}
