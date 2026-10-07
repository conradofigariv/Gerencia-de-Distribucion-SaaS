// Exportar el mapa de Stock por Zona a PDF: una captura del panel tal como se
// ve (zonas, stock, obra, recorrido y tarjetas) + los datos del momento en
// texto, para que el PDF se pueda leer y buscar aunque la imagen no alcance.
// Las librerías se cargan recién al exportar (no pesan en la carga del mapa).

export interface PdfMatricula { codigo: string; descripcion: string; total: number; udm: string }
export interface PdfFila {
  zona: string;
  delegacion: string;
  /** Cantidad por matrícula, en el mismo orden que `matriculas`. */
  cantidades: number[];
  /** Distancia del depósito de la zona a la obra (si hay obra). */
  km: number | null;
  /** «por ruta · 2 h 20 min», «en línea recta», «desde Laboulaye»… */
  nota: string;
}
export interface DatosPdf {
  generado: Date;
  matriculas: PdfMatricula[];
  obra: { nombre: string; detalle: string } | null;
  filas: PdfFila[];
  recorrido: { desde: string; tramos: { nombre: string; km: number }[] } | null;
  /** Fecha de carga del stock de cada zona. */
  cargas: { zona: string; fecha: string }[];
}

const fmtNum = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
const fmtKm = (n: number) => n.toFixed(1).replace(".", ",") + " km";
const fmtFecha = (d: Date) => d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

/** Captura del panel como PNG. Sin fuentes embebidas si falla la primera vez (CORS de una fuente). */
async function capturar(panel: HTMLElement, fondo: string, excluir: string[]): Promise<{ url: string; w: number; h: number }> {
  const { toPng } = await import("html-to-image");
  const filter = (n: HTMLElement) => !(n.classList && excluir.some((c) => n.classList.contains(c)));
  const opts = { pixelRatio: 2, backgroundColor: fondo, filter, cacheBust: true };
  let url: string;
  try {
    url = await toPng(panel, opts);
  } catch {
    url = await toPng(panel, { ...opts, skipFonts: true });
  }
  return { url, w: panel.clientWidth, h: panel.clientHeight };
}

/** Arma el PDF (no lo descarga: primero se muestra la vista previa). */
export async function generarMapaPdf(
  panel: HTMLElement,
  datos: DatosPdf,
  opts: { fondo: string; excluir: string[] },
): Promise<Blob> {
  const [img, { jsPDF }] = await Promise.all([capturar(panel, opts.fondo, opts.excluir), import("jspdf")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const H = 210;
  const M = 10;
  const gris = (v: number) => pdf.setTextColor(v, v, v);

  // ── Hoja 1: encabezado + captura ──
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  gris(20);
  pdf.text("Stock por Zona - Mapa", M, M + 5);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  gris(110);
  pdf.text(`Generado ${fmtFecha(datos.generado)}`, W - M, M + 5, { align: "right" });

  const lineas: string[] = [];
  if (datos.matriculas.length === 1) {
    const m = datos.matriculas[0];
    lineas.push(`Matrícula ${m.codigo} · ${m.descripcion} · ${fmtNum(m.total)} ${m.udm} en total`);
  } else if (datos.matriculas.length > 1) {
    lineas.push(`${datos.matriculas.length} matrículas: ${datos.matriculas.map((m) => m.codigo).join(", ")}`);
  } else {
    lineas.push("Sin matrícula elegida (zonas y delegaciones)");
  }
  if (datos.obra) lineas.push(`Obra: ${datos.obra.nombre} · ${datos.obra.detalle}`);
  pdf.setFontSize(9.5);
  gris(50);
  let y = M + 11;
  for (const l of lineas) {
    pdf.text(pdf.splitTextToSize(l, W - 2 * M)[0] as string, M, y);
    y += 5;
  }

  const altoLibre = H - y - M;
  const escala = Math.min((W - 2 * M) / img.w, altoLibre / img.h);
  const iw = img.w * escala;
  const ih = img.h * escala;
  pdf.addImage(img.url, "PNG", (W - iw) / 2, y + 1, iw, ih, undefined, "FAST");

  // ── Hoja 2: los datos en texto ──
  if (datos.matriculas.length > 0 && datos.filas.length > 0) {
    pdf.addPage();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    gris(20);
    pdf.text("Stock por zona", M, M + 5);
    if (datos.obra) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      gris(110);
      pdf.text(`Distancias desde el depósito de cada zona a ${datos.obra.nombre}`, M, M + 10);
    }

    // Columnas: zona, delegación, una por matrícula (hasta 6; más, cobertura k/n), distancia, nota.
    const porMat = datos.matriculas.length <= 6;
    const cols: { t: string; w: number; der?: boolean }[] = [
      { t: "Zona", w: 18 },
      { t: "Delegación", w: 46 },
      ...(porMat
        ? datos.matriculas.map((m) => ({ t: datos.matriculas.length === 1 ? `Stock (${m.udm || "u."})` : m.codigo, w: 26, der: true }))
        : [{ t: "Matrículas con stock", w: 34, der: true }]),
      ...(datos.obra ? [{ t: "Distancia", w: 24, der: true }, { t: "", w: 0 }] : [{ t: "", w: 0 }]),
    ];
    const usado = cols.reduce((s, c) => s + c.w, 0);
    cols[cols.length - 1].w = W - 2 * M - usado; // la nota ocupa lo que queda

    let ty = M + 16;
    const fila = (celdas: string[], negrita: boolean, fondo?: number) => {
      if (ty > H - M - 8) { pdf.addPage(); ty = M + 6; }
      if (fondo !== undefined) { pdf.setFillColor(fondo, fondo, fondo); pdf.rect(M, ty - 4.6, W - 2 * M, 6.6, "F"); }
      pdf.setFont("helvetica", negrita ? "bold" : "normal");
      pdf.setFontSize(9);
      let x = M + 1.5;
      celdas.forEach((c, i) => {
        const col = cols[i];
        const txt = (pdf.splitTextToSize(c, Math.max(4, col.w - 3)) as string[])[0] ?? "";
        if (col.der) pdf.text(txt, x + col.w - 3, ty, { align: "right" });
        else pdf.text(txt, x, ty);
        x += col.w;
      });
      ty += 6.6;
    };
    gris(60);
    fila(cols.map((c) => c.t), true, 235);
    datos.filas.forEach((f, i) => {
      const conStock = f.cantidades.some((q) => q > 0);
      gris(conStock ? 25 : 140);
      const stock = porMat
        ? f.cantidades.map((q) => (q > 0 ? fmtNum(q) : "-"))
        : [`${f.cantidades.filter((q) => q > 0).length}/${datos.matriculas.length}`];
      fila([f.zona, f.delegacion, ...stock, ...(datos.obra ? [f.km !== null ? fmtKm(f.km) : "-"] : []), f.nota], false, i % 2 ? 248 : undefined);
    });

    if (datos.recorrido && datos.recorrido.tramos.length) {
      ty += 4;
      gris(20);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text(`Recorrido desde ${datos.recorrido.desde}`, M, ty);
      ty += 5.5;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      gris(50);
      const txt = datos.recorrido.tramos.map((t) => `${t.nombre} (${fmtKm(t.km)})`).join("  >  ");
      for (const l of pdf.splitTextToSize(txt, W - 2 * M) as string[]) { pdf.text(l, M, ty); ty += 4.6; }
    }

    if (datos.cargas.length) {
      ty += 4;
      pdf.setFontSize(8);
      gris(120);
      const txt = "Stock cargado: " + datos.cargas.map((c) => `${c.zona} ${c.fecha}`).join(" · ");
      for (const l of pdf.splitTextToSize(txt, W - 2 * M) as string[]) { pdf.text(l, M, ty); ty += 4; }
    }
  }

  return pdf.output("blob");
}

/** Descarga un PDF ya generado. */
export function descargarPdf(blob: Blob, archivo: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Hojas del PDF como imágenes, para la vista previa. Se dibujan con pdf.js en
 * vez de mostrar el PDF en un <iframe>: los navegadores del celular no muestran
 * PDFs embebidos (o solo la primera hoja).
 */
export async function hojasComoImagen(blob: Blob, anchoPx: number): Promise<string[]> {
  // Mismo truco que lib/parse-consumo-pdf.ts: con el worker ya cargado en
  // globalThis, pdf.js no intenta resolver la ruta del worker en runtime.
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const tarea = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const doc = await tarea.promise;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (anchoPx / base.width) * dpr });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    out.push(canvas.toDataURL("image/png"));
  }
  await tarea.destroy();
  return out;
}
