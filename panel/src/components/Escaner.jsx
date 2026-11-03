import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/** Lector de QR con la cámara del dispositivo (funciona en celulares y laptops vía HTTPS). */
export default function Escaner({ onLeer }) {
  const video = useRef();
  const canvas = useRef();
  const [error, setError] = useState('');

  useEffect(() => {
    let stream;
    let frame;
    let vivo = true;
    async function iniciar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador no permite usar la cámara. Escribe el folio abajo.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!vivo) return stream.getTracks().forEach((t) => t.stop());
        video.current.srcObject = stream;
        await video.current.play();
        leer();
      } catch (e) {
        setError(e?.name === 'NotAllowedError'
          ? 'Permite el acceso a la cámara en tu navegador para escanear, o escribe el folio abajo.'
          : 'No se encontró una cámara disponible. Escribe el folio abajo.');
      }
    }
    function leer() {
      if (!vivo) return;
      const v = video.current;
      if (v.readyState >= 2 && v.videoWidth) {
        const escala = Math.min(1, 720 / v.videoWidth);
        const w = Math.round(v.videoWidth * escala), h = Math.round(v.videoHeight * escala);
        const c = canvas.current;
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, w, h);
        const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (r?.data) {
          vivo = false;
          stream?.getTracks().forEach((t) => t.stop());
          onLeer(r.data);
          return;
        }
      }
      frame = requestAnimationFrame(leer);
    }
    iniciar();
    return () => {
      vivo = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onLeer]);

  return (
    <div className="escaner">
      {error ? <p className="escaner-error">{error}</p> : (
        <>
          <video ref={video} playsInline muted aria-label="Vista de la cámara para escanear el pase" />
          <div className="escaner-marco" aria-hidden="true" />
          <p className="escaner-ayuda">Apunta la cámara al código QR del pase</p>
        </>
      )}
      <canvas ref={canvas} hidden />
    </div>
  );
}
