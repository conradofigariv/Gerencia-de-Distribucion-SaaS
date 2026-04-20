import { NextRequest, NextResponse } from "next/server";

const SYSTEM = `Eres un extractor de tablas de imágenes. Tu metodología es:
1. Identificar visualmente la posición horizontal de cada encabezado de columna.
2. Para cada celda con valor, trazar una línea vertical hacia arriba y confirmar bajo qué encabezado cae.
3. Nunca asumir que el primer valor de una fila va en la primera columna — verificar siempre la alineación.
4. Una celda vacía es 0.`;

const PROMPT = `Analizá esta planilla de reserva de transformadores en dos pasos.

PASO 1 — ESCANEO POR COLUMNA (escribilo antes del JSON):
Para la tabla "NUEVOS Y REPARADOS POR TERCEROS", listá:
- Columna T: qué filas (KVA) tienen valor no-cero y cuál es ese valor
- Columna M: qué filas (KVA) tienen valor no-cero y cuál es ese valor
- Columna CON TANQUE: qué filas (KVA) tienen valor no-cero y cuál es ese valor

Repetí el mismo escaneo para "REPARADOS POR TALLER DE TRANSFORMADORES".

PASO 2 — JSON:
Usando el escaneo anterior, completá el siguiente JSON (escribilo al final, precedido por la línea "###JSON###"):

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

Tabla "TOTAL DE TRANSFORMADORES": columna "Autorizados Pendiente de Retiro" → autorizados
Tabla "RELACIÓN 33/0,4 KV": TRAFOS NUEVOS T/M → tN/mN; TRAFOS REPARADOS T/M → tR/mR
Sección OBSERVACIONES → obs; sección PENDIENTES DE ENTREGAS → pend`;

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
            messages: [
              { role: "system", content: SYSTEM },
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: dataUrl } },
                  { type: "text", text: PROMPT },
                ],
              },
            ],
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

    // Extract JSON after ###JSON### marker, or fall back to last {...} block
    const markerIdx = text.lastIndexOf("###JSON###");
    const jsonStr = markerIdx !== -1 ? text.slice(markerIdx + 10) : text;
    const start = jsonStr.indexOf("{");
    const end   = jsonStr.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return NextResponse.json({ error: "No se encontró JSON en la respuesta del modelo" }, { status: 500 });
    }
    const datos = JSON.parse(jsonStr.slice(start, end + 1));

    return NextResponse.json({ datos });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
