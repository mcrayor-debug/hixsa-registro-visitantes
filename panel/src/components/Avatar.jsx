import { useEffect, useState } from 'react';
import { urlFotoUsuario } from '../lib/usuarios.js';

/** Foto del usuario (enlace firmado) o sus iniciales. */
export default function Avatar({ usuario, tamano = 32, className = '' }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let vivo = true; urlFotoUsuario(usuario?.foto_path).then((u) => vivo && setUrl(u)); return () => { vivo = false; }; }, [usuario?.foto_path]);
  const iniciales = String(usuario?.nombre ?? '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const estilo = { width: tamano, height: tamano, fontSize: Math.round(tamano * 0.38) };
  return url
    ? <img className={`avatar-usuario ${className}`} src={url} alt="" style={estilo} />
    : <span className={`avatar-usuario avatar-usuario-texto ${className}`} style={estilo} aria-hidden="true">{iniciales}</span>;
}
