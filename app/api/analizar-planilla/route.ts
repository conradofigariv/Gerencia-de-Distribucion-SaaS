import { NextRequest, NextResponse } from "next/server";

const PROMPT = `Eres un extractor de datos de tablas. Analizá esta planilla de reserva de transformadores.

METODOLOGÍA OBLIGATORIA para cada fila de cada tabla:
1. Identificá los encabezados de columna y su posición horizontal exacta en píxeles.
2. Para cada número visible en la fila, trazá una línea vertical hacia arriba y determiná a qué encabezado corresponde.
3. VALIDACIÓN: T + M debe ser igual al valor de la columna TOTAL visible en esa fila. Si no coincide, revisá la asignación.
4. Solo si la celda está visiblemente vacía, asignale 0.

ESTRUCTURA DE CADA TABLA:
- "NUEVOS Y REPARADOS POR TERCEROS": columnas → POTENCIA KVA | T | M | CON TANQUE | TOTAL
- "REPARADOS POR TALLER": columnas → TIPO | POTENCIA KVA | T | M | CON TANQUE | TOTAL
- "TOTAL DE TRANSFORMADORES": usá la columna "Autorizados Pendiente de Retiro" para autorizados
- "RELACIÓN 33/0,4 KV": TRAFOS NUEVOS (T=tN, M=mN) | TRAFOS REPARADOS (T=tR, M=mR)

Devuelve ÚNICAMENTE un JSON válido, sin texto adicional ni markdown, con exactamente esta estructura:

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

Sección OBSERVACIONES → obs; sección PENDIENTES DE ENTREGAS → pend
Devuelve SOLO el JSON puro, sin bloques de código`;

const MODELS = ["google/gemini-2.5-flash"];

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

    const bytes  = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
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
                { type: "image_url", image_url: { url: dataUrl } },
                { type: "text", text: PROMPT },
              ],
            }],
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          errors.push(`[${model}] ${JSON.stringify(json.error ?? json).slice(0, 100)}`);
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

    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const datos = JSON.parse(clean);

    return NextResponse.json({ datos });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
