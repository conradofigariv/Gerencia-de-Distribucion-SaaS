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

    if (!isExcel) {
      return NextResponse.json(
        { error: "Por favor subí un archivo Excel (.xlsx o .xls). Las imágenes y PDFs no están soportadas." },
        { status: 400 }
      );
    }

    const datos = parseExcelPlanilla(Buffer.from(bytes));
    return NextResponse.json({ datos });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
