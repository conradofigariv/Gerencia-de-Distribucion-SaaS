import { NextRequest, NextResponse } from "next/server";

const PROMPT = `Extract all numeric data from this transformer reservation planilla table.

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
    "5":    { "t": 0, "m": 0, "ct": 0 },
    "10":   { "t": 0, "m": 0, "ct": 0 },
    "16":   { "t": 0, "m": 0, "ct": 0 },
    "25":   { "t": 0, "m": 0, "ct": 0 },
    "50":   { "t": 0, "m": 0, "ct": 0 },
    "63":   { "t": 0, "m": 0, "ct": 0 },
    "80":   { "t": 0, "m": 0, "ct": 0 },
    "100":  { "t": 0, "m": 0, "ct": 0 },
    "125":  { "t": 0, "m": 0, "ct": 0 },
    "160":  { "t": 0, "m": 0, "ct": 0 },
    "200":  { "t": 0, "m": 0, "ct": 0 },
    "250":  { "t": 0, "m": 0, "ct": 0 },
    "315":  { "t": 0, "m": 0, "ct": 0 },
    "500":  { "t": 0, "m": 0, "ct": 0 },
    "630":  { "t": 0, "m": 0, "ct": 0 },
    "800":  { "t": 0, "m": 0, "ct": 0 },
    "1000": { "t": 0, "m": 0, "ct": 0 }
  },
  "taller": {
    "5":    { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "10":   { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "16":   { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "25":   { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "50":   { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "63":   { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "80":   { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "100":  { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "125":  { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "160":  { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "200":  { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "250":  { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "315":  { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "500":  { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "630":  { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "800":  { "tipo": "", "t": 0, "m": 0, "ct": 0 },
    "1000": { "tipo": "", "t": 0, "m": 0, "ct": 0 }
  },
  "autorizados": {
    "5": 0, "10": 0, "16": 0, "25": 0, "50": 0, "63": 0, "80": 0,
    "100": 0, "125": 0, "160": 0, "200": 0, "250": 0, "315": 0,
    "500": 0, "630": 0, "800": 0, "1000": 0
  },
  "rel33": {
    "25":  { "tN": 0, "mN": 0, "tR": 0, "mR": 0 },
    "63":  { "tN": 0, "mN": 0, "tR": 0, "mR": 0 },
    "160": { "tN": 0, "mN": 0, "tR": 0, "mR": 0 },
    "315": { "tN": 0, "mN": 0, "tR": 0, "mR": 0 },
    "500": { "tN": 0, "mN": 0, "tR": 0, "mR": 0 },
    "630": { "tN": 0, "mN": 0, "tR": 0, "mR": 0 }
  },
  "obs":  "",
  "pend": ""
}

OBSERVACIONES section → obs field
PENDIENTES DE ENTREGAS section → pend field`;

// Qwen2.5-VL is trained for document/table understanding; Gemini as fallback
const MODELS = [
  "qwen/qwen2.5-vl-72b-instruct",
  "google/gemini-2.5-flash",
];

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY no configurada en .env.local" },
      { status: 500 }
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    }

    const bytes   = await file.arrayBuffer();
    const base64  = Buffer.from(bytes).toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    const errors: string[] = [];
    let text = "";

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
                // Prompt before image so model knows what to look for first
                { type: "text", text: PROMPT },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            }],
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          errors.push(`[${model}] ${JSON.stringify(json.error ?? json).slice(0, 120)}`);
          continue;
        }

        text = json.choices?.[0]?.message?.content ?? "";
        if (text) break;
      } catch (e: unknown) {
        errors.push(`[${model}] ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!text) {
      return NextResponse.json(
        { error: "No se pudo analizar. Errores:\n" + errors.map(e => `• ${e}`).join("\n") },
        { status: 500 }
      );
    }

    const start = text.indexOf("{");
    const end   = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return NextResponse.json({ error: "No se encontró JSON en la respuesta" }, { status: 500 });
    }
    const datos = JSON.parse(text.slice(start, end + 1));

    return NextResponse.json({ datos });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
