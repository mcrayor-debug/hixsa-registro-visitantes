import { useEffect, useState } from 'react';
import { supabase, invocar } from '../lib/supabase.js';
import { MOTIVOS } from '../lib/formato.js';
import { Dialogo, Mensaje, useToast } from './ui.jsx';

const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function horarioInicial() {
  const e = new Date(); e.setMinutes(0, 0, 0); e.setHours(e.getHours() + 1);
  return { entrada: local(e), salida: local(new Date(e.getTime() + 2 * 3600000)) };
}

/** Invitación creada por el personal para un visitante con perfil: se aprueba sola y se avisa al anfitrión. */
export default function NuevaInvitacion({ persona, empresas = [], onCerrar, onCreada }) {
  const principal = empresas.find((e) => e.es_principal) ?? empresas[0];
  const [f, setF] = useState(() => ({ empresa: principal?.id ?? '', anfitrion: '', otro: '', motivo: 'Reunión', comentarios: '', ...horarioInicial() }));
  const [anfitriones, setAnfitriones] = useState([]);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const toast = useToast();

  useEffect(() => {
    supabase.from('anfitriones').select('id, nombre, area, anfitrion_empresas(empresa_id)').eq('activo', true).order('nombre')
      .then(({ data }) => setAnfitriones((data ?? []).map((a) => ({ ...a, empresas: a.anfitrion_empresas.map((x) => x.empresa_id) }))));
  }, []);
  const deEmpresa = anfitriones.filter((a) => a.empresas.includes(f.empresa));
  const cambiar = (k) => (e) => setF({ ...f, [k]: e.target.value, ...(k === 'empresa' ? { anfitrion: '' } : {}) });

  async function enviar(e) {
    e.preventDefault();
    if (!f.empresa) return setError('Elige la empresa a visitar.');
    if (!f.anfitrion) return setError('Elige al anfitrión.');
    if (f.anfitrion === 'otro' && f.otro.trim().length < 3) return setError('Escribe a quién visita.');
    if (!f.entrada || !f.salida || new Date(f.salida) <= new Date(f.entrada)) return setError('La salida debe ser después de la entrada.');
    setEnviando(true); setError('');
    try {
      const r = await invocar('crear-invitacion', {
        persona_id: persona.id, empresa_visita_id: f.empresa, anfitrion_id: f.anfitrion === 'otro' ? null : f.anfitrion,
        persona_visita: f.anfitrion === 'otro' ? f.otro.trim() : undefined, motivo: f.motivo, comentarios: f.comentarios.trim() || null,
        entrada: new Date(f.entrada).toISOString(), salida: new Date(f.salida).toISOString(),
      });
      toast(`Invitación ${r.folio} ${r.estado === 'aprobada' ? 'aprobada' : 'pendiente del anfitrión'}.${r.correo_enviado ? ` QR enviado a ${persona.correo}.` : ' No se pudo enviar el correo.'}`);
      onCreada?.(r); onCerrar();
    } catch (err) { setError(err.message); } finally { setEnviando(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo="Nueva invitación" ancho={560}>
      <form onSubmit={enviar} noValidate>
        <div className="invitado">
          <span className="avatar avatar-vacio" aria-hidden="true">{(persona.nombre ?? persona.correo).charAt(0).toUpperCase()}</span>
          <span><strong>{`${persona.nombre ?? ''} ${persona.apellidos ?? ''}`.trim() || persona.correo}</strong><br />
            <span className="muted small">{persona.correo} · {persona.empresa}{persona.identificacion_path ? ' · identificación guardada' : ' · sin identificación guardada'}</span></span>
        </div>
        <div className="grid-2">
          <div className="field"><label htmlFor="ni-emp">Empresa a visitar</label>
            <select id="ni-emp" value={f.empresa} onChange={cambiar('empresa')}>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></div>
          <div className="field"><label htmlFor="ni-anf">Anfitrión</label>
            <select id="ni-anf" value={f.anfitrion} onChange={cambiar('anfitrion')}>
              <option value="">{deEmpresa.length ? 'Elige a la persona' : 'Sin anfitriones en esta empresa'}</option>
              {deEmpresa.map((a) => <option key={a.id} value={a.id}>{a.area ? `${a.nombre} (${a.area})` : a.nombre}</option>)}
              <option value="otro">Otra persona o área</option>
            </select></div>
        </div>
        {f.anfitrion === 'otro' && <div className="field"><label htmlFor="ni-otro">¿A quién visita?</label><input id="ni-otro" type="text" maxLength={120} value={f.otro} onChange={cambiar('otro')} /></div>}
        <div className="grid-2">
          <div className="field"><label htmlFor="ni-ent">Entrada</label><input id="ni-ent" type="datetime-local" value={f.entrada} onChange={cambiar('entrada')} /></div>
          <div className="field"><label htmlFor="ni-sal">Salida</label><input id="ni-sal" type="datetime-local" value={f.salida} onChange={cambiar('salida')} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label htmlFor="ni-mot">Motivo</label>
            <select id="ni-mot" value={f.motivo} onChange={cambiar('motivo')}>{MOTIVOS.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div className="field"><label htmlFor="ni-com">Comentarios (opcional)</label><input id="ni-com" type="text" maxLength={500} value={f.comentarios} onChange={cambiar('comentarios')} /></div>
        </div>
        <p className="hint">Se reutilizan sus datos y su identificación. La invitación queda aprobada, se avisa al anfitrión y se envía un QR nuevo al mismo correo. El historial se conserva.</p>
        <Mensaje>{error}</Mensaje>
        <div className="dialog-actions"><button className="btn btn-compact" type="submit" disabled={enviando} aria-busy={enviando}>{enviando ? 'Enviando…' : 'Enviar invitación'}</button></div>
      </form>
    </Dialogo>
  );
}
