import { NextRequest, NextResponse } from "next/server";
import { parseConsumoExcel } from "@/lib/parse-consumo-excel";
import { parseConsumoPdf } from "@/lib/parse-consumo-pdf";

// pdfjs necesita APIs de Node, así que la ruta no puede correr en el runtime edge.
export const runtime = "nodejs";

function esPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const { mes, datos, avisos } = esPdf(file)
      ? await parseConsumoPdf(buf)
      : parseConsumoExcel(buf);

    return NextResponse.json({ mes, datos, avisos });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? "No se pudo analizar el archivo";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
