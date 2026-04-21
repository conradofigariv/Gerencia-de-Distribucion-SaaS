import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

// ─── Constants ────────────────────────────────────────────────────────────────

const POT_13 = [5,10,16,25,50,63,80,100,125,160,200,250,315,500,630,800,1000];
const POT_33 = [25,63,160,315,500,630];

// ─── XLSX helpers ─────────────────────────────────────────────────────────────

function n(ws: XLSX.WorkSheet, addr: string): number {
  const c = ws[addr];
  if (!c || c.v === undefined || c.v === null || c.v === "") return 0;
  return typeof c.v === "number" ? c.v : (Number(c.v) || 0);
}

function s(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr];
  return c ? String(c.v ?? "").trim() : "";
}

function findCell(ws: XLSX.WorkSheet, text: string): { r: number; c: number } | null {
  const ref = ws["!ref"];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && String(cell.v ?? "").toUpperCase().includes(text.toUpperCase())) {
        return { r, c };
      }
    }
  }
  return null;
}

function textBlock(ws: XLSX.WorkSheet, r0: number, c0: number, rows = 10, cols = 10): string {
  const parts: string[] = [];
  for (let r = r0; r < r0 + rows; r++) {
    for (let c = c0; c < c0 + cols; c++) {
      const v = s(ws, XLSX.utils.encode_cell({ r, c }));
      if (v) parts.push(v);
    }
  }
  return parts.join(" ").trim();
}

// ─── Excel parser ─────────────────────────────────────────────────────────────

function parseExcelPlanilla(buffer: Buffer): Record<string, unknown> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = ws["!ref"];
  if (!ref) throw new Error("Hoja vacía");

  const range = XLSX.utils.decode_range(ref);
  let dataRow = -1;
  for (let r = range.s.r; r <= range.s.r + 20; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell && Number(cell.v) === 5) { dataRow = r + 1; break; }
  }
  if (dataRow === -1) throw new Error("No se encontró la fila de datos (KVA=5). Verificá el formato del Excel.");

  let autoCol = "N";
  const autoPos = findCell(ws, "Autoriz");
  if (autoPos) autoCol = XLSX.utils.encode_col(autoPos.c);

  let tipoTallerCol = "F";
  const tipoPos = findCell(ws, "TIPO");
  if (tipoPos) tipoTallerCol = XLSX.utils.encode_col(tipoPos.c);

  const terceros: Record<string, { t: number; m: number; ct: number }> = {};
  const taller:   Record<string, { tipo: string; t: number; m: number; ct: number }> = {};
  const autorizados: Record<string, number> = {};

  for (let i = 0; i < POT_13.length; i++) {
    const kva = POT_13[i];
    const row = dataRow + i;
    terceros[String(kva)] = { t: n(ws, `B${row}`), m: n(ws, `C${row}`), ct: n(ws, `D${row}`) };
    taller[String(kva)]   = { tipo: s(ws, `${tipoTallerCol}${row}`), t: n(ws, `H${row}`), m: n(ws, `I${row}`), ct: n(ws, `J${row}`) };
    autorizados[String(kva)] = n(ws, `${autoCol}${row}`);
  }

  const rel33: Record<string, { tN: number; mN: number; tR: number; mR: number }> = {};
  const rel33Header = findCell(ws, "RELAC");
  if (rel33Header) {
    for (let r = rel33Header.r + 1; r <= rel33Header.r + 12; r++) {
      const kvaCell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
      if (!kvaCell) continue;
      const kva = Number(kvaCell.v);
      if (POT_33.includes(kva)) {
        rel33[String(kva)] = {
          tN: n(ws, XLSX.utils.encode_cell({ r, c: 1 })),
          mN: n(ws, XLSX.utils.encode_cell({ r, c: 2 })),
          tR: n(ws, XLSX.utils.encode_cell({ r, c: 3 })),
          mR: n(ws, XLSX.utils.encode_cell({ r, c: 4 })),
        };
      }
    }
  }
  for (const kva of POT_33) {
    if (!rel33[String(kva)]) rel33[String(kva)] = { tN: 0, mN: 0, tR: 0, mR: 0 };
  }

  let obs = "", pend = "";
  const obsPos  = findCell(ws, "OBSERVACIONES");
  const pendPos = findCell(ws, "PENDIENTES");
  if (obsPos)  obs  = textBlock(ws, obsPos.r,  obsPos.c,  8, 8);
  if (pendPos) pend = textBlock(ws, pendPos.r, pendPos.c, 8, 8);
  obs  = obs.replace(/^OBSERVACIONES[^:]*[:]/i, "").trim();
  pend = pend.replace(/^PENDIENTES[^:]*[:]/i, "").trim();

  return { terceros, taller, autorizados, rel33, obs, pend };
}

// ─── PDF parser ───────────────────────────────────────────────────────────────

const EMPTY_PLANILLA = (): Record<string, unknown> => ({
  terceros:    Object.fromEntries(POT_13.map(k => [k, { t: 0, m: 0, ct: 0 }])),
  taller:      Object.fromEntries(POT_13.map(k => [k, { tipo: "", t: 0, m: 0, ct: 0 }])),
  autorizados: Object.fromEntries(POT_13.map(k => [k, 0])),
  rel33:       Object.fromEntries(POT_33.map(k => [k, { tN: 0, mN: 0, tR: 0, mR: 0 }])),
  obs: "", pend: "",
});

async function parsePdfPlanilla(buffer: Buffer): Promise<Record<string, unknown>> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY no configurada");

  const prompt = `Sos un extractor de datos de planillas de transformadores eléctricos argentinas.
Del siguiente texto extraído de un PDF, devolvé ÚNICAMENTE un JSON válido con esta estructura exacta:

{
  "terceros": { "5":{"t":0,"m":0,"ct":0}, "10":{"t":0,"m":0,"ct":0}, "16":{"t":0,"m":0,"ct":0}, "25":{"t":0,"m":0,"ct":0}, "50":{"t":0,"m":0,"ct":0}, "63":{"t":0,"m":0,"ct":0}, "80":{"t":0,"m":0,"ct":0}, "100":{"t":0,"m":0,"ct":0}, "125":{"t":0,"m":0,"ct":0}, "160":{"t":0,"m":0,"ct":0}, "200":{"t":0,"m":0,"ct":0}, "250":{"t":0,"m":0,"ct":0}, "315":{"t":0,"m":0,"ct":0}, "500":{"t":0,"m":0,"ct":0}, "630":{"t":0,"m":0,"ct":0}, "800":{"t":0,"m":0,"ct":0}, "1000":{"t":0,"m":0,"ct":0} },
  "taller": { "5":{"tipo":"","t":0,"m":0,"ct":0}, "10":{"tipo":"","t":0,"m":0,"ct":0}, "16":{"tipo":"","t":0,"m":0,"ct":0}, "25":{"tipo":"","t":0,"m":0,"ct":0}, "50":{"tipo":"","t":0,"m":0,"ct":0}, "63":{"tipo":"","t":0,"m":0,"ct":0}, "80":{"tipo":"","t":0,"m":0,"ct":0}, "100":{"tipo":"","t":0,"m":0,"ct":0}, "125":{"tipo":"","t":0,"m":0,"ct":0}, "160":{"tipo":"","t":0,"m":0,"ct":0}, "200":{"tipo":"","t":0,"m":0,"ct":0}, "250":{"tipo":"","t":0,"m":0,"ct":0}, "315":{"tipo":"","t":0,"m":0,"ct":0}, "500":{"tipo":"","t":0,"m":0,"ct":0}, "630":{"tipo":"","t":0,"m":0,"ct":0}, "800":{"tipo":"","t":0,"m":0,"ct":0}, "1000":{"tipo":"","t":0,"m":0,"ct":0} },
  "autorizados": { "5":0,"10":0,"16":0,"25":0,"50":0,"63":0,"80":0,"100":0,"125":0,"160":0,"200":0,"250":0,"315":0,"500":0,"630":0,"800":0,"1000":0 },
  "rel33": { "25":{"tN":0,"mN":0,"tR":0,"mR":0}, "63":{"tN":0,"mN":0,"tR":0,"mR":0}, "160":{"tN":0,"mN":0,"tR":0,"mR":0}, "315":{"tN":0,"mN":0,"tR":0,"mR":0}, "500":{"tN":0,"mN":0,"tR":0,"mR":0}, "630":{"tN":0,"mN":0,"tR":0,"mR":0} },
  "obs": "",
  "pend": ""
}

Reglas:
- terceros: sección "NUEVOS Y REPARADOS POR TERCEROS". t=nuevos, m=reparados, ct=C/T tanque.
- taller: sección "REPARADOS POR TALLER". tipo=RURAL/SUBEST/SUBESTACION/etc, t=nuevos, m=reparados, ct=C/T tanque.
- autorizados: columna "AUTORIZADOS" de la sección "TOTAL DE TRANSFORMADORES".
- rel33: sección "RELACION 33/0.4 KV". tN=trafo nuevo, mN=motor nuevo, tR=trafo reparado, mR=motor reparado.
- obs: contenido de OBSERVACIONES (sin el encabezado).
- pend: contenido de PENDIENTES DE ENTREGA (sin el encabezado).
- Todos los valores numéricos son enteros >= 0. Solo devolvé el JSON, sin texto extra.

TEXTO DEL PDF:
${text.slice(0, 8000)}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-flash-1.5",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter error: ${res.status}`);
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? "";

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error("La IA no devolvió JSON válido. Intentá con el archivo Excel.");
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const isPdf = file.name.toLowerCase().endsWith(".pdf") ||
      file.type === "application/pdf";
    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel";

    if (!isExcel && !isPdf) {
      return NextResponse.json(
        { error: "Formato no soportado. Subí un archivo Excel (.xlsx / .xls) o PDF (.pdf)." },
        { status: 400 }
      );
    }

    const datos = isPdf
      ? await parsePdfPlanilla(buffer)
      : parseExcelPlanilla(buffer);

    return NextResponse.json({ datos });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
