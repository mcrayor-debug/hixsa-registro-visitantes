import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { supabase, invocar, CAMPOS_VISITA } from '../lib/supabase.js';
import { estadoVisita, fmtFechaHora, fmtHora, fmtLarga, huella } from '../lib/formato.js';
import { Estado, Mensaje, useToast } from './ui.jsx';

const BLOQUEOS = {
  no_deseado: ['aviso', 'Visitante NO DESEADO'],
  restringido: ['restringido', 'Visitante RESTRINGIDO: solo entra con aprobación de su anfitrión'],
  bloqueado: ['bloqueado', 'Visitante BLOQUEADO: no puede entrar'],
};
const MOTIVOS_INTENTO = {
  anticipado: 'Llegó antes de su horario', tarde: 'Llegó fuera de su horario', fecha_no_asignada: 'Fecha no asignada',
  caducado: 'Pase vencido o caducado', bloqueado: 'Visitante bloqueado', restringido: 'Visitante restringido',
  pendiente_aprobacion: 'Pendiente de aprobación', rechazada_anfitrion: 'Rechazada por el anfitrión', no_coincide: 'El pase no coincide',
};

/**
 * Ficha completa de una visita para Recepción: validación del pase, alertas de bloqueo,
 * aprobación, fotos (ligas firmadas de 5 min), QR, intentos de acceso y acciones.
 */
export default function FichaVisita({ folio, h, onCambio }) {
  const [v, setV] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [coincide, setCoincide] = useState(null);
  const [qr, setQr] = useState('');
  const [fotos, setFotos] = useState({});
  const [intentos, setIntentos] = useState([]);
  const [rechazo, setRechazo] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const toast = useToast();

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data } = await supabase.from('visitantes').select(CAMPOS_VISITA).eq('folio', folio).maybeSingle();
    setV(data);
    if (data) {
      const hv = await huella(data);
      setCoincide(h ? hv === h : null);
      setQr(await QRCode.toDataURL(`${location.origin}/admin.html?pase=${encodeURIComponent(data.folio)}&h=${hv}`,
        { margin: 1, width: 240, color: { dark: '#0047BA', light: '#FFFFFF' } }));
      const { data: it } = await supabase.from('intentos_acceso').select('created_at, resultado, motivo, usuario_email, autorizacion_motivo')
        .eq('visita_id', data.id).order('created_at', { ascending: false }).limit(6);
      setIntentos(it ?? []);
    }
    setCargando(false);
  }, [folio, h]);

  useEffect(() => { setFotos({}); setError(''); setRechazo(null); setMotivo(''); cargar(); }, [cargar]);

  async function verFoto(clave, ruta) {
    const { data, error: err } = await supabase.storage.from('identificaciones').createSignedUrl(ruta, 300);
    if (err) return setError('No se pudo abrir la foto.');
    setFotos((f) => ({ ...f, [clave]: data.signedUrl }));
  }

  async function accion(nombre, extra = {}) {
    setOcupado(true);
    setError('');
    try {
      const r = await invocar('registrar-acceso', { folio, accion: nombre, h: h ?? undefined, ...extra });
      setRechazo(null);
      setMotivo('');
      if (nombre === 'aprobar') toast('Visita aprobada por Recepción.');
      else if (nombre === 'salida') toast(`Salida registrada a las ${fmtHora.format(new Date(r.salida_real_at))}.`);
      else toast(`${r.autorizada ? 'Entrada autorizada' : 'Llegada registrada'} a las ${fmtHora.format(new Date(r.llegada_at))}.${r.anfitrion_avisado ? ' Se avisó al anfitrión.' : ''}`);
      await cargar();
      onCambio?.();
    } catch (e) {
      if (e.datos?.error === 'ACCESO NO PERMITIDO') setRechazo(e.datos);
      else setError(e.message);
      await cargar();
    } finally {
      setOcupado(false);
    }
  }

  if (cargando && !v) return <div className="card ficha"><p className="muted">Buscando {folio}…</p></div>;
  if (!v) {
    return (
      <div className="card ficha" data-resultado="invalido">
        <h2 className="ficha-titulo">Pase no encontrado</h2>
        <p>No existe una visita con el folio <strong>{folio}</strong>, o tu rol no tiene acceso a esa fecha.</p>
      </div>
    );
  }

  const est = estadoVisita(v);
  const bloqueo = BLOQUEOS[v.personas?.estado_bloqueo];
  const anfConCorreo = Boolean(v.anfitriones?.correo);
  const aprobable = v.estado_aprobacion === 'pendiente' && !anfConCorreo && !['bloqueado', 'restringido'].includes(v.personas?.estado_bloqueo);
  const resultado = rechazo || coincide === false || v.personas?.estado_bloqueo === 'bloqueado' || v.estado_aprobacion === 'rechazada' ? 'invalido'
    : ['ausente', 'pendiente'].includes(est.clave) || bloqueo ? 'aviso' : 'valido';
  const fila = (k, val) => (val ? <><dt>{k}</dt><dd>{val}</dd></> : null);
  const aprobacion = v.estado_aprobacion === 'aprobada'
    ? `Aprobada por ${v.aprobacion_por === 'recepcion' ? 'Recepción' : v.aprobacion_por === 'anfitrion' ? 'el anfitrión' : 'el sistema'}`
    : v.estado_aprobacion === 'rechazada' ? 'Rechazada por el anfitrión'
      : anfConCorreo ? `Esperando la aprobación de ${v.anfitriones.nombre}` : 'Pendiente de validación de Recepción';

  return (
    <div className="card ficha" data-resultado={resultado}>
      {bloqueo && (
        <div className={`alerta-bloqueo alerta-${bloqueo[0]}`} role="alert">
          <strong>{bloqueo[1]}</strong>{v.personas?.bloqueo_motivo && <span>Motivo: {v.personas.bloqueo_motivo}</span>}
        </div>
      )}
      <div className="ficha-head">
        <div>
          <p className="ficha-folio mono">{v.folio}</p>
          <h2 className="ficha-titulo">{v.nombre_completo}</h2>
          <p className="muted">De: {v.empresa}{v.personas?.recurrente && <span className="pill">Recurrente</span>}</p>
        </div>
        <Estado {...est} />
      </div>

      {coincide === false && <Mensaje>El pase no coincide con el registro: los datos o el horario cambiaron después de emitirlo.</Mensaje>}
      {coincide === true && !rechazo && <p className="ficha-ok">Pase auténtico: coincide con el registro.</p>}

      {rechazo && (
        <section className="acceso-denegado" aria-labelledby="denegado-titulo">
          <h3 id="denegado-titulo">ACCESO NO PERMITIDO</h3>
          <ul>{rechazo.problemas.map((x) => <li key={x.codigo}><strong>{x.motivo}.</strong> {x.detalle}</li>)}</ul>
          <p className="acceso-sugerencia">{rechazo.sugerencia}</p>
          {rechazo.autorizable && (
            <div className="autorizar">
              <label htmlFor="motivo-aut">Motivo de la autorización</label>
              <textarea id="motivo-aut" rows={2} maxLength={300} value={motivo} placeholder="Ej.: llegó tarde por tráfico; confirmado con el anfitrión"
                onChange={(e) => setMotivo(e.target.value)} />
              <button type="button" className="btn btn-autorizar" disabled={ocupado || motivo.trim().length < 5}
                onClick={() => accion('autorizar', { motivo: motivo.trim() })}>Autorizar entrada</button>
              <p className="hint">Queda registrado quién autorizó, cuándo y por qué. No cuenta como llegada puntual.</p>
            </div>
          )}
        </section>
      )}

      <div className="ficha-cuerpo">
        <dl className="pase-detalle">
          {fila('Aprobación', aprobacion)}
          {fila('Empresa a visitar', v.empresas?.nombre)}
          {fila('Visita a', v.persona_visita)}
          {fila('Motivo', v.motivo)}
          {fila('Horario', `${fmtLarga.format(new Date(v.entrada))} a ${fmtHora.format(new Date(v.salida))}`)}
          {fila('Llegada', v.llegada_at && `${fmtHora.format(new Date(v.llegada_at))}${v.entrada_fuera_horario ? ' (autorizada fuera de horario)' : ''}`)}
          {fila('Autorización', v.autorizacion_motivo)}
          {fila('Salida', v.salida_real_at && fmtHora.format(new Date(v.salida_real_at)))}
          {fila('Identificación', v.tipo_identificacion && `${v.tipo_identificacion}${v.identificacion_detalle ? `: ${v.identificacion_detalle}` : ''}`)}
          {fila('Salas de juntas', v.sala_juntas ? 'Sí' : null)}
          {fila('Equipo', v.equipo_tipo && [v.equipo_tipo, v.equipo_marca, v.equipo_serie && `serie ${v.equipo_serie}`].filter(Boolean).join(', '))}
          {fila('Teléfono', v.telefono)}
          {fila('Comentarios', v.comentarios)}
        </dl>
        <div className="ficha-medios">
          {qr && <figure className="ficha-qr"><img src={qr} alt={`Código QR del pase ${v.folio}`} /><figcaption className="hint">QR del pase</figcaption></figure>}
        </div>
      </div>

      <div className="ficha-fotos">
        {v.identificacion_path && (fotos.id
          ? <figure className="ficha-foto"><img src={fotos.id} alt={`Identificación de ${v.nombre_completo}`} /><figcaption className="hint">Identificación (liga de 5 min)</figcaption></figure>
          : <button type="button" className="btn btn-secondary btn-compact" onClick={() => verFoto('id', v.identificacion_path)}>Ver identificación</button>)}
        {v.selfie_path && (fotos.selfie
          ? <figure className="ficha-foto"><img src={fotos.selfie} alt={`Selfie de ${v.nombre_completo}`} /><figcaption className="hint">Selfie (liga de 5 min)</figcaption></figure>
          : <button type="button" className="btn btn-secondary btn-compact" onClick={() => verFoto('selfie', v.selfie_path)}>Ver selfie</button>)}
      </div>

      <Mensaje>{error}</Mensaje>

      <div className="ficha-acciones">
        {aprobable && !v.llegada_at && (
          <button className="btn btn-aprobar" type="button" disabled={ocupado} onClick={() => accion('aprobar')}>Aprobar visita</button>
        )}
        {!v.llegada_at && v.estado_aprobacion !== 'rechazada' && (
          <button className="btn" type="button" disabled={ocupado} onClick={() => accion('llegada')}>{ocupado ? 'Validando…' : 'Registrar entrada'}</button>
        )}
        {v.llegada_at && !v.salida_real_at && (
          <button className="btn" type="button" disabled={ocupado} onClick={() => accion('salida')}>{ocupado ? 'Registrando…' : 'Registrar salida'}</button>
        )}
        {v.salida_real_at && <p className="muted">La visita ya concluyó.</p>}
      </div>

      {intentos.length > 0 && (
        <details className="intentos">
          <summary>Intentos de acceso ({intentos.length})</summary>
          <ul>{intentos.map((x, i) => (
            <li key={i}><span className={`pill ${x.resultado === 'autorizado' ? 'ok' : 'error'}`}>{x.resultado === 'autorizado' ? 'Autorizado' : 'Rechazado'}</span>
              {' '}{MOTIVOS_INTENTO[x.motivo] ?? x.motivo}, {fmtFechaHora.format(new Date(x.created_at))}{x.usuario_email ? ` (${x.usuario_email})` : ''}
              {x.autorizacion_motivo && <span className="muted"> · {x.autorizacion_motivo}</span>}</li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}
