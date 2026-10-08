// Web Worker que lee el Excel del Plan de Compras fuera del hilo principal.
// La hoja «Global» pesa ~80 MB descomprimida: leída en el hilo de la UI
// congela la pantalla varios segundos. Ver lib/planComprasLeer.ts.

import { leerLibroPlan, ErrorImportacion } from "./planComprasImport";

interface Pedido {
  buffer:  ArrayBuffer;
  archivo: string;
}

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<Pedido>) => void) | null;
  postMessage: (msg: unknown) => void;
};

ctx.onmessage = (ev) => {
  try {
    const resultado = leerLibroPlan(ev.data.buffer, ev.data.archivo);
    ctx.postMessage({ ok: true, resultado });
  } catch (e) {
    ctx.postMessage({
      ok: false,
      // Un error de estructura (falta una columna) se muestra tal cual; uno
      // inesperado del lector se reporta como archivo ilegible.
      estructura: e instanceof ErrorImportacion,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
