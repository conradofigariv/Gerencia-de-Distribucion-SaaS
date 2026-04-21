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

// Extracts all integers from a string (ignores the KVA prefix itself)
function numsFromLine(line: string): number[] {
  return (line.match(/\d+/g) ?? []).map(Number);
}

// Returns the word token (MONO/TRI/etc.) if present in a line, else ""
function tipoFromLine(line: string): string {
  const m = line.match(/\b(MONO|TRI|TRIFASICO|MONOFASICO)\b/i);
  return m ? m[1].toUpperCase() : "";
}

async function parsePdfPlanilla(buffer: Buffer): Promise<Record<string, unknown>> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });

  // Normalize: collapse multiple spaces, split into lines
  const lines = text
    .split("\n")
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const terceros: Record<string, { t: number; m: number; ct: number }> = {};
  const taller:   Record<string, { tipo: string; t: number; m: number; ct: number }> = {};
  const autorizados: Record<string, number> = {};
  const rel33: Record<string, { tN: number; mN: number; tR: number; mR: number }> = {};

  // Determine where the REL33 section starts
  let rel33StartIdx = lines.findIndex(l => /RELAC/i.test(l));
  if (rel33StartIdx === -1) rel33StartIdx = lines.length;

  // ── Main table (POT_13): lines before REL33 section ──────────────────────────
  const mainLines = lines.slice(0, rel33StartIdx);

  for (const kva of POT_13) {
    // Find a line whose first token matches this KVA exactly
    const line = mainLines.find(l => {
      const firstToken = l.split(" ")[0];
      return Number(firstToken) === kva;
    });

    if (line) {
      const nums = numsFromLine(line); // first element is KVA itself
      // Expected order: KVA, T_terceros, M_terceros, CT_terceros, [T_taller, M_taller, CT_taller,] autorizados
      // If 8+ numbers: [0]=KVA, [1]=tT, [2]=mT, [3]=ctT, [4]=tTa, [5]=mTa, [6]=ctTa, [7]=auto
      // If 5 numbers:  [0]=KVA, [1]=tT, [2]=mT, [3]=ctT, [4]=auto (taller cols merged/missing)
      const tipo = tipoFromLine(line);
      if (nums.length >= 8) {
        terceros[String(kva)]    = { t: nums[1], m: nums[2], ct: nums[3] };
        taller[String(kva)]      = { tipo, t: nums[4], m: nums[5], ct: nums[6] };
        autorizados[String(kva)] = nums[7];
      } else if (nums.length >= 5) {
        terceros[String(kva)]    = { t: nums[1], m: nums[2], ct: nums[3] };
        taller[String(kva)]      = { tipo, t: 0, m: 0, ct: 0 };
        autorizados[String(kva)] = nums[4];
      } else {
        terceros[String(kva)]    = { t: nums[1] ?? 0, m: nums[2] ?? 0, ct: nums[3] ?? 0 };
        taller[String(kva)]      = { tipo, t: 0, m: 0, ct: 0 };
        autorizados[String(kva)] = 0;
      }
    } else {
      terceros[String(kva)]    = { t: 0, m: 0, ct: 0 };
      taller[String(kva)]      = { tipo: "", t: 0, m: 0, ct: 0 };
      autorizados[String(kva)] = 0;
    }
  }

  // ── REL33 section: lines after the RELAC header ───────────────────────────────
  const rel33Lines = lines.slice(rel33StartIdx);

  for (const kva of POT_33) {
    const line = rel33Lines.find(l => {
      const firstToken = l.split(" ")[0];
      return Number(firstToken) === kva;
    });

    if (line) {
      const nums = numsFromLine(line);
      // Expected: KVA, tN, mN, tR, mR
      rel33[String(kva)] = {
        tN: nums[1] ?? 0,
        mN: nums[2] ?? 0,
        tR: nums[3] ?? 0,
        mR: nums[4] ?? 0,
      };
    } else {
      rel33[String(kva)] = { tN: 0, mN: 0, tR: 0, mR: 0 };
    }
  }

  // ── OBS and PEND: find headers and grab following text ─────────────────────────
  let obs = "", pend = "";

  const obsIdx  = lines.findIndex(l => /OBSERVACIONES/i.test(l));
  const pendIdx = lines.findIndex(l => /PENDIENTES/i.test(l));

  if (obsIdx !== -1) {
    const end = pendIdx > obsIdx ? pendIdx : Math.min(obsIdx + 10, lines.length);
    obs = lines.slice(obsIdx, end).join(" ").replace(/^OBSERVACIONES[^:]*[:]/i, "").trim();
  }
  if (pendIdx !== -1) {
    pend = lines.slice(pendIdx, Math.min(pendIdx + 10, lines.length))
      .join(" ")
      .replace(/^PENDIENTES[^:]*[:]/i, "").trim();
  }

  return { terceros, taller, autorizados, rel33, obs, pend };
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
