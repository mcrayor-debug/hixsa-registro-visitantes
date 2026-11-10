// PDF con la identidad de HIXSA (jsPDF + autotable, cargados solo al exportar).
const AZUL = [0, 71, 186], CIAN = [0, 169, 224], NARANJA = [243, 138, 0], AMARILLO = [255, 205, 0], TINTA = [28, 42, 58], GRIS = [91, 107, 127];

async function logoDataUrl() {
  try {
    const r = await fetch('/img/logo-hixsa.png');
    const b = await r.blob();
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  } catch { return null; }
}

/**
 * Crea el PDF. secciones: [{ titulo, columnas, filas, barras?: [{etiqueta, valor}] }]
 * Devuelve { descargar(nombre), base64() }.
 */
export async function crearPdf({ titulo, subtitulo, kpis = [], secciones = [], pie = '' }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const logo = await logoDataUrl();

  const franjas = () => {
    const anchos = [0.46, 0.18, 0.18, 0.18]; let x = 0;
    [AZUL, CIAN, NARANJA, AMARILLO].forEach((c, i) => { doc.setFillColor(...c); doc.rect(x, 0, W * anchos[i], 5, 'F'); x += W * anchos[i]; });
  };
  franjas();
  if (logo) doc.addImage(logo, 'PNG', M, 22, 120, 32, 'logo', 'FAST');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...AZUL);
  doc.text(titulo, M, 80);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRIS);
  if (subtitulo) doc.text(subtitulo, M, 96);
  let y = 112;

  if (kpis.length) {
    const ancho = (W - 2 * M - (kpis.length - 1) * 8) / kpis.length;
    kpis.forEach(([t, v], i) => {
      const x = M + i * (ancho + 8);
      doc.setFillColor(244, 247, 250); doc.rect(x, y, ancho, 50, 'F');
      doc.setFillColor(...AZUL); doc.rect(x, y, ancho, 3, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...AZUL); doc.text(String(v), x + ancho / 2, y + 26, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS); doc.text(String(t), x + ancho / 2, y + 41, { align: 'center' });
    });
    y += 66;
  }

  for (const s of secciones) {
    if (y > H - 120) { doc.addPage(); franjas(); y = 40; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...AZUL); doc.text(s.titulo, M, y);
    y += 8;
    if (s.barras?.length) {
      const max = Math.max(1, ...s.barras.map((b) => b.valor));
      for (const b of s.barras) {
        if (y > H - 50) { doc.addPage(); franjas(); y = 40; }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...TINTA); doc.text(String(b.etiqueta).slice(0, 34), M, y + 9);
        const ancho = ((W - 2 * M - 190) * b.valor) / max;
        doc.setFillColor(...(b.color ?? AZUL)); doc.rect(M + 150, y + 1, Math.max(ancho, 1), 10, 'F');
        doc.text(String(b.valor), M + 158 + ancho, y + 9);
        y += 15;
      }
      y += 12;
    }
    if (s.columnas?.length) {
      autoTable(doc, {
        startY: y, head: [s.columnas], body: s.filas.length ? s.filas : [[{ content: 'Sin datos', colSpan: s.columnas.length }]],
        margin: { left: M, right: M }, styles: { font: 'helvetica', fontSize: 8, cellPadding: 4, textColor: TINTA },
        headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [238, 243, 251] },
        didDrawPage: () => franjas(),
      });
      y = doc.lastAutoTable.finalY + 22;
    }
  }
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(`HIXSA | Registro de visitas${pie ? ` | ${pie}` : ''}`, M, H - 20);
    doc.text(`Página ${i} de ${paginas}`, W - M, H - 20, { align: 'right' });
  }
  return {
    descargar: (nombre) => doc.save(nombre),
    base64: () => doc.output('datauristring').split(',')[1],
  };
}
