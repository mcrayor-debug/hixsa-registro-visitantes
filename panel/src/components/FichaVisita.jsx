import { useCallback, useEffect, useState } from 'react';
import { supabase, invocar, CAMPOS_VISITA } from '../lib/supabase.js';
import { estadoVisita, fmtLarga, fmtHora, huella } from '../lib/formato.js';
import { Estado, Mensaje, useToast } from './ui.jsx';

/**
 * Ficha completa de una visita: validación del pase (si viene la huella del QR),
 * foto de identificación (liga firmada de 5 min) y registro de llegada/salida.
 */
export default function FichaVisita({ folio, h, onCambio }) {
  const [v, setV] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [coincide, setCoincide] = useState(null);
  const [foto, setFoto] = useState(null);
  const [verFoto, setVerFoto] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const toast = useToast();

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data } = await supabase.from('visitantes').select(CAMPOS_VISITA).eq('folio', folio).maybeSingle();
    setV(data);
    setCoincide(data && h ? (await huella(data)) === h : null);
    setCargando(false);
  }, [folio, h]);

  useEffect(() => { setVerFoto(false); setFoto(null); setError(''); cargar(); }, [cargar]);

  async function mostrarFoto() {
    if (!v?.identificacion_path) return;
    const { data, error: err } = await supabase.storage.from('identificaciones').createSignedUrl(v.identificacion_path, 300);
    if (err) return setError('No se pudo abrir la foto de la identificación.');
    setFoto(data.signedUrl);
    setVerFoto(true);
  }

  async function registrar(accion) {
    setOcupado(true);
    setError('');
    try {
      const r = await invocar('registrar-acceso', { folio, accion });
      toast(accion === 'llegada'
        ? `Llegada registrada a las ${fmtHora.format(new Date(r.llegada_at))}.${r.anfitrion_avisado ? ' Se avisó al anfitrión.' : ''}`
        : `Salida registrada a las ${fmtHora.format(new Date(r.salida_real_at))}.`);
      await cargar();
      onCambio?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (cargando) return <div className="card ficha"><p className="muted">Buscando {folio}…</p></div>;
  if (!v) {
    return (
      <div className="card ficha" data-resultado="invalido">
        <h2 className="ficha-titulo">Pase no encontrado</h2>
        <p>No existe una visita con el folio <strong>{folio}</strong>.</p>
      </div>
    );
  }

  const est = estadoVisita(v);
  const resultado = coincide === false ? 'invalido' : est.clave === 'ausente' ? 'aviso' : 'valido';
  const fila = (k, val) => val ? <><dt>{k}</dt><dd>{val}</dd></> : null;

  return (
    <div className="card ficha" data-resultado={resultado}>
      <div className="ficha-head">
        <div>
          <p className="ficha-folio mono">{v.folio}</p>
          <h2 className="ficha-titulo">{v.nombre_completo}</h2>
          <p className="muted">De: {v.empresa}</p>
        </div>
        <Estado {...est} />
      </div>

      {coincide === false && (
        <Mensaje>El pase no coincide con el registro: los datos o el horario cambiaron después de emitirlo. Verifica la identidad antes de dar acceso.</Mensaje>
      )}
      {coincide === true && <p className="ficha-ok">Pase válido: coincide con el registro.</p>}

      <dl className="pase-detalle">
        {fila('Empresa a visitar', v.empresas?.nombre)}
        {fila('Visita a', v.persona_visita)}
        {fila('Motivo', v.motivo)}
        {fila('Horario', `${fmtLarga.format(new Date(v.entrada))} a ${fmtHora.format(new Date(v.salida))}`)}
        {fila('Llegada', v.llegada_at && `${fmtHora.format(new Date(v.llegada_at))}${v.anfitrion_avisado_at ? ' (anfitrión avisado)' : ''}`)}
        {fila('Salida', v.salida_real_at && fmtHora.format(new Date(v.salida_real_at)))}
        {fila('Identificación', v.tipo_identificacion && `${v.tipo_identificacion}${v.identificacion_detalle ? `: ${v.identificacion_detalle}` : ''}`)}
        {fila('Teléfono', v.telefono)}
        {fila('Comentarios', v.comentarios)}
      </dl>

      {v.identificacion_path && (
        verFoto && foto
          ? <figure className="ficha-foto"><img src={foto} alt={`Identificación de ${v.nombre_completo}`} /><figcaption className="hint">La liga de la foto caduca en 5 minutos.</figcaption></figure>
          : <button type="button" className="link-btn" onClick={mostrarFoto}>Ver foto de la identificación</button>
      )}

      <Mensaje>{error}</Mensaje>

      <div className="ficha-acciones">
        {!v.llegada_at && (
          <button className="btn" type="button" disabled={ocupado} onClick={() => registrar('llegada')}>
            {ocupado ? 'Registrando…' : 'Registrar llegada'}
          </button>
        )}
        {v.llegada_at && !v.salida_real_at && (
          <button className="btn" type="button" disabled={ocupado} onClick={() => registrar('salida')}>
            {ocupado ? 'Registrando…' : 'Registrar salida'}
          </button>
        )}
        {v.salida_real_at && <p className="muted">La visita ya concluyó.</p>}
      </div>
    </div>
  );
}
