import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// Collect all non-empty string values in a rectangular area
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

  // Find data start: first row where col A = 5 (KVA)
  const range = XLSX.utils.decode_range(ref);
  let dataRow = -1;
  for (let r = range.s.r; r <= range.s.r + 20; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell && Number(cell.v) === 5) { dataRow = r + 1; break; } // +1 = 1-indexed for cell addr
  }
  if (dataRow === -1) throw new Error("No se encontró la fila de datos (KVA=5). Verificá el formato del Excel.");

  // Dynamically find AUTORIZADOS column (yellow header)
  let autoCol = "N"; // default
  const autoPos = findCell(ws, "Autoriz");
  if (autoPos) autoCol = XLSX.utils.encode_col(autoPos.c);

  // Dynamically find TIPO col for TALLER (between TERCEROS and TALLER sections)
  // It's the first col with "TIPO" header in row before dataRow
  let tipoTallerCol = "F"; // default
  const tipoPos = findCell(ws, "TIPO");
  if (tipoPos) tipoTallerCol = XLSX.utils.encode_col(tipoPos.c);

  // Build terceros, taller, autorizados
  const terceros: Record<string, { t: number; m: number; ct: number }> = {};
  const taller:   Record<string, { tipo: string; t: number; m: number; ct: number }> = {};
  const autorizados: Record<string, number> = {};

  for (let i = 0; i < POT_13.length; i++) {
    const kva = POT_13[i];
    const row = dataRow + i;
    terceros[String(kva)] = {
      t:  n(ws, `B${row}`),
      m:  n(ws, `C${row}`),
      ct: n(ws, `D${row}`),
    };
    taller[String(kva)] = {
      tipo: s(ws, `${tipoTallerCol}${row}`),
      t:    n(ws, `H${row}`),
      m:    n(ws, `I${row}`),
      ct:   n(ws, `J${row}`),
    };
    autorizados[String(kva)] = n(ws, `${autoCol}${row}`);
  }

  // REL33: find section header then scan rows for matching KVA values
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

  // OBS and PEND: find headers then grab surrounding text
  let obs = "", pend = "";
  const obsPos  = findCell(ws, "OBSERVACIONES");
  const pendPos = findCell(ws, "PENDIENTES");
  if (obsPos)  obs  = textBlock(ws, obsPos.r,  obsPos.c,  8, 8);
  if (pendPos) pend = textBlock(ws, pendPos.r, pendPos.c, 8, 8);

  // Strip the header words themselves from the extracted text
  obs  = obs.replace(/^OBSERVACIONES[^:]*[:]/i, "").trim();
  pend = pend.replace(/^PENDIENTES[^:]*[:]/i, "").trim();

  return { terceros, taller, autorizados, rel33, obs, pend };
}

// ─── AI fallback (images / PDFs) ──────────────────────────────────────────────

const AI_PROMPT = `Extract all numeric data from this transformer reservation planilla table.

Tables in the image:
1. "NUEVOS Y REPARADOS POR TERCEROS" (left) — columns in order: POTENCIA KVA | T | M | CON TANQUE | TOTAL
2. "REPARADOS POR TALLER DE TRANSFORMADORES" (center) — columns: TIPO | POTENCIA KVA | T | M | CON TANQUE | TOTAL
3. "TOTAL DE TRANSFORMADORES" (right) — read "Autorizados Pendiente de Retiro" column
4. "RELACIÓN 33/0,4 KV" (bottom left) — TRAFOS NUEVOS (T, M) and TRAFOS REPARADOS (T, M)

Column reading rules:
- T = first numeric column after KVA
- M = second numeric column after KVA (to the RIGHT of T)
- CON TANQUE = third numeric column
- A blank/empty cell = 0. Do NOT shift a value left to fill an empty column.

Return ONLY valid JSON, no markdown, no extra text:

{
  "terceros": {
    "5":{"t":0,"m":0,"ct":0},"10":{"t":0,"m":0,"ct":0},"16":{"t":0,"m":0,"ct":0},
    "25":{"t":0,"m":0,"ct":0},"50":{"t":0,"m":0,"ct":0},"63":{"t":0,"m":0,"ct":0},
    "80":{"t":0,"m":0,"ct":0},"100":{"t":0,"m":0,"ct":0},"125":{"t":0,"m":0,"ct":0},
    "160":{"t":0,"m":0,"ct":0},"200":{"t":0,"m":0,"ct":0},"250":{"t":0,"m":0,"ct":0},
    "315":{"t":0,"m":0,"ct":0},"500":{"t":0,"m":0,"ct":0},"630":{"t":0,"m":0,"ct":0},
    "800":{"t":0,"m":0,"ct":0},"1000":{"t":0,"m":0,"ct":0}
  },
  "taller": {
    "5":{"tipo":"","t":0,"m":0,"ct":0},"10":{"tipo":"","t":0,"m":0,"ct":0},
    "16":{"tipo":"","t":0,"m":0,"ct":0},"25":{"tipo":"","t":0,"m":0,"ct":0},
    "50":{"tipo":"","t":0,"m":0,"ct":0},"63":{"tipo":"","t":0,"m":0,"ct":0},
    "80":{"tipo":"","t":0,"m":0,"ct":0},"100":{"tipo":"","t":0,"m":0,"ct":0},
    "125":{"tipo":"","t":0,"m":0,"ct":0},"160":{"tipo":"","t":0,"m":0,"ct":0},
    "200":{"tipo":"","t":0,"m":0,"ct":0},"250":{"tipo":"","t":0,"m":0,"ct":0},
    "315":{"tipo":"","t":0,"m":0,"ct":0},"500":{"tipo":"","t":0,"m":0,"ct":0},
    "630":{"tipo":"","t":0,"m":0,"ct":0},"800":{"tipo":"","t":0,"m":0,"ct":0},
    "1000":{"tipo":"","t":0,"m":0,"ct":0}
  },
  "autorizados":{"5":0,"10":0,"16":0,"25":0,"50":0,"63":0,"80":0,"100":0,"125":0,"160":0,"200":0,"250":0,"315":0,"500":0,"630":0,"800":0,"1000":0},
  "rel33":{
    "25":{"tN":0,"mN":0,"tR":0,"mR":0},"63":{"tN":0,"mN":0,"tR":0,"mR":0},
    "160":{"tN":0,"mN":0,"tR":0,"mR":0},"315":{"tN":0,"mN":0,"tR":0,"mR":0},
    "500":{"tN":0,"mN":0,"tR":0,"mR":0},"630":{"tN":0,"mN":0,"tR":0,"mR":0}
  },
  "obs":"","pend":""
}

OBSERVACIONES section → obs; PENDIENTES DE ENTREGAS section → pend`;

const MODELS = [
  "qwen/qwen2.5-vl-72b-instruct",
  "google/gemini-2.5-flash",
];

async function analyzeWithAI(dataUrl: string): Promise<Record<string, unknown>> {
  const errors: string[] = [];
  for (const model of MODELS) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Gerencia Distribucion SaaS",
        },
        body: JSON.stringify({
          model,
          max_tokens: 8000,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: AI_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          }],
        }),
      });
      const json = await res.json();
      if (!res.ok) { errors.push(`[${model}] ${JSON.stringify(json.error ?? json).slice(0, 120)}`); continue; }
      const text = json.choices?.[0]?.message?.content ?? "";
      if (!text) continue;
      const start = text.indexOf("{"), end = text.lastIndexOf("}");
      if (start === -1 || end === -1) continue;
      return JSON.parse(text.slice(start, end + 1));
    } catch (e: unknown) {
      errors.push(`[${model}] ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error("No se pudo analizar. Errores:\n" + errors.map(e => `• ${e}`).join("\n"));
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });

    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel";

    const bytes = await file.arrayBuffer();

    if (isExcel) {
      const datos = parseExcelPlanilla(Buffer.from(bytes));
      return NextResponse.json({ datos });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: "OPENROUTER_API_KEY no configurada en .env.local" }, { status: 500 });
    }
    const base64  = Buffer.from(bytes).toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;
    const datos   = await analyzeWithAI(dataUrl);
    return NextResponse.json({ datos });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
