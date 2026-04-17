import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

const PROMPT = `Analiza esta planilla de reserva de transformadores y extrae todos los datos numéricos.
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

Reglas:
- Tabla izquierda "NUEVOS Y REPARADOS POR TERCEROS": columnas T, M, CON TANQUE → campos t, m, ct
- Tabla central "REPARADOS POR TALLER": columna TIPO (RURAL o vacío), T, M, CON TANQUE → tipo, t, m, ct
- Tabla derecha resumen: columna "Autorizados Pendiente de Retiro" → autorizados
- Tabla inferior izquierda "RELACIÓN 33/0,4 KV": TRAFOS NUEVOS T/M → tN/mN; TRAFOS REPARADOS T/M → tR/mR
- Sección OBSERVACIONES → obs; sección PENDIENTES → pend
- Valores en blanco o ilegibles = 0
- Devuelve SOLO el JSON puro, sin bloques de código`;

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY no configurada en .env.local" },
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

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const contents = [{
      role: "user",
      parts: [
        { inlineData: { data: base64, mimeType: file.type } },
        { text: PROMPT },
      ],
    }];

    // Only gemini-2.5-flash has free-tier quota (5 RPM). Retry up to 3x on 503.
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await ai.models.generateContent({ model: "gemini-2.5-flash", contents });
        break;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "";
        const isOverload = msg.includes("503") || msg.includes("UNAVAILABLE");
        if (isOverload && attempt < 3) {
          await new Promise(r => setTimeout(r, attempt * 3000));
          continue;
        }
        if (msg.includes("429") || msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED")) {
          throw new Error("Cuota de Gemini agotada. Intentá en unos minutos o activá billing en Google Cloud.");
        }
        throw e;
      }
    }
    if (!result) throw new Error("El servidor de Gemini está saturado, intentá en unos minutos.");

    const text  = result?.text ?? "";
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const datos = JSON.parse(clean);

    return NextResponse.json({ datos });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
