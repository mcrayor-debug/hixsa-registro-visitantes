import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { EMAIL_RE } from '../lib/formato.js';
import { Mensaje } from './ui.jsx';

export default function Login({ error: errorInicial, onEntrar }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setError('');
    if (!EMAIL_RE.test(email.trim()) || !password) return setError('Escribe tu correo y tu contraseña.');
    setEnviando(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setEnviando(false);
    if (err) {
      return setError(/invalid/i.test(err.message) ? 'Correo o contraseña incorrectos.'
        : /banned/i.test(err.message) ? 'Tu cuenta está desactivada.' : 'No se pudo iniciar sesión. Intenta de nuevo.');
    }
    setPassword('');
    onEntrar(data.user);
  }

  return (
    <section className="login" aria-labelledby="login-titulo">
      <form className="card login-card" onSubmit={entrar} noValidate>
        <h1 id="login-titulo">Acceso para personal</h1>
        <p className="muted">Recepción, tablero, consultas y administración de visitas.</p>
        <div className="field"><label htmlFor="login-email">Correo</label>
          <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="login-password">Contraseña</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <Mensaje>{error || errorInicial}</Mensaje>
        <button className="btn" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        <a className="back-link" href="/">Volver al registro de visitantes</a>
      </form>
    </section>
  );
}
