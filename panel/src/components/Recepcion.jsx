import { useCallback, useEffect, useState } from 'react';
import { consultaVisitas } from '../lib/supabase.js';
import { estadoVisita, fmtHora, hoyCDMX, parsearQR } from '../lib/formato.js';
import Escaner from './Escaner.jsx';
import FichaVisita from './FichaVisita.jsx';
import { Estado, Mensaje } from './ui.jsx';

export default function Recepcion({ paseInicial }) {
  const [sel, setSel] = useState(paseInicial);
  const [escaneando, setEscaneando] = useState(false);
  const [folio, setFolio] = useState('');
  const [error, setError] = useState('');
  const [hoy, setHoy] = useState([]);

  const cargarHoy = useCallback(async () => {
    const { data } = await consultaVisitas({ desde: hoyCDMX(), hasta: hoyCDMX() },
      'folio, nombre_completo, empresa, persona_visita, entrada, salida, llegada_at, salida_real_at')
      .order('entrada', { ascending: true }).limit(300);
    setHoy(data ?? []);
  }, []);
  useEffect(() => { cargarHoy(); }, [cargarHoy]);

  const alLeer = useCallback((texto) => {
    setEscaneando(false);
    const r = parsearQR(texto);
    if (!r?.folio) return setError('Ese código no es un pase de HIXSA.');
    setError('');
    setSel(r);
  }, []);

  function buscar(e) {
    e.preventDefault();
    const r = parsearQR(folio);
    if (!r) return setError('Escribe un folio como HX-261103-7F3A9.');
    setError('');
    setSel(r);
    setFolio('');
  }

  const enSitio = hoy.filter((v) => v.llegada_at && !v.salida_real_at).length;
  const pendientes = hoy.filter((v) => !v.llegada_at && Date.now() <= new Date(v.salida).getTime()).length;

  return (
    <div className="recepcion">
      <div className="recepcion-izq">
        <section className="card" aria-labelledby="esc-titulo">
          <h2 id="esc-titulo">Escanear pase</h2>
          {escaneando
            ? <><Escaner onLeer={alLeer} /><button type="button" className="link-btn" onClick={() => setEscaneando(false)}>Cancelar</button></>
            : <button type="button" className="btn" onClick={() => { setError(''); setEscaneando(true); }}>Abrir cámara</button>}
          <form className="folio-form" onSubmit={buscar} noValidate>
            <label htmlFor="folio-manual">O escribe el folio</label>
            <div className="folio-row">
              <input id="folio-manual" type="text" value={folio} placeholder="HX-261103-7F3A9"
                autoCapitalize="characters" onChange={(e) => setFolio(e.target.value)} />
              <button className="btn btn-secondary btn-compact" type="submit">Buscar</button>
            </div>
          </form>
          <Mensaje>{error}</Mensaje>
        </section>

        {sel && <FichaVisita key={`${sel.folio}-${sel.h}`} folio={sel.folio} h={sel.h} onCambio={cargarHoy} />}
      </div>

      <section className="card recepcion-hoy" aria-labelledby="hoy-titulo">
        <div className="hoy-head">
          <h2 id="hoy-titulo">Visitas de hoy</h2>
          <p className="muted small">{enSitio} en sitio, {pendientes} por llegar</p>
        </div>
        {!hoy.length && <p className="vacio">No hay visitas registradas para hoy.</p>}
        <ul className="hoy-lista">
          {hoy.map((v) => (
            <li key={v.folio}>
              <button type="button" className="hoy-item" aria-current={sel?.folio === v.folio} onClick={() => setSel({ folio: v.folio, h: null })}>
                <span className="hoy-hora">{fmtHora.format(new Date(v.entrada))}</span>
                <span className="hoy-datos"><strong>{v.nombre_completo}</strong><span className="muted small">{v.empresa}, visita a {v.persona_visita}</span></span>
                <Estado {...estadoVisita(v)} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
