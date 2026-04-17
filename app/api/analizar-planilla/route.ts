import Anthropic from "@anthropic-ai/sdk";
import type { ImageBlockParam, Base64PDFSource } from "@anthropic-ai/sdk/resources/messages";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres un asistente experto en extracción de datos de planillas de transformadores eléctricos.
Cuando recibas una imagen o PDF de una planilla "RESERVA DE TRANSFORMADORES DE DISTRIBUCIÓN",
extrae todos los valores numéricos y devuelve ÚNICAMENTE un JSON válido, sin texto adicional, con exactamente esta estructura:

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
- "t" = columna T (trifásico), "m" = columna M (monofásico), "ct" = columna "CON TANQUE"
- "tipo" en taller = "RURAL" si corresponde, o "" si está vacío
- "tN"/"mN" = trafos nuevos T/M en relación 33kV; "tR"/"mR" = reparados T/M
- "autorizados" = columna "Autorizados Pendiente de Retiro" del resumen
- Todos los valores faltantes o ilegibles = 0
- "obs" y "pend" = texto de las secciones Observaciones y Pendientes
- Devuelve SOLO el JSON, sin markdown, sin explicaciones`;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY no configurada en .env.local" },
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
    const isPdf   = file.type === "application/pdf";

    // Build content block depending on file type
    const VALID_IMG = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
    type ValidImg = (typeof VALID_IMG)[number];

    const fileBlock = isPdf
      ? ({
          type:   "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 } as Base64PDFSource,
        } as const)
      : ({
          type:   "image",
          source: {
            type:       "base64",
            media_type: (VALID_IMG.includes(file.type as ValidImg) ? file.type : "image/jpeg") as ValidImg,
            data:       base64,
          },
        } satisfies ImageBlockParam);

    const response = await client.messages.create({
      model:      "claude-opus-4-7",
      max_tokens: 2048,
      system:     SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Extrae todos los datos de esta planilla y devuelve el JSON." },
        ],
      }],
    });

    const text = response.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("");

    // Strip possible markdown code fences
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const datos = JSON.parse(clean);

    return NextResponse.json({ datos });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
