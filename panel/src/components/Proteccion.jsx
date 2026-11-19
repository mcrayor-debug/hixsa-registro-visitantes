import { Component } from 'react';

/** Si una sección falla al dibujarse, muestra un aviso en lugar de dejar todo el panel en blanco. */
export default class Proteccion extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Error en la sección', this.props.nombre ?? '', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="card proteccion" role="alert">
        <h2>No se pudo mostrar esta sección</h2>
        <p className="muted">El resto del panel sigue funcionando. Recarga la página; si vuelve a pasar, avisa al administrador.</p>
        <p className="small muted mono">{String(this.state.error?.message ?? this.state.error).slice(0, 160)}</p>
        <button type="button" className="btn btn-compact" onClick={() => location.reload()}>Recargar</button>
      </section>
    );
  }
}
