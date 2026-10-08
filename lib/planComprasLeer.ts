import type { ImportacionPlan } from "@/lib/planComprasImport";

// Lee el .xlsx del Plan de Compras en un Web Worker (lib/planComprasImport.worker.ts).
// Si el navegador no puede levantar el worker, cae a leerlo en el hilo
// principal: la pantalla se congela unos segundos, pero la importación sale.

/** El archivo se leyó pero no tiene la estructura de «Global». */
export class ErrorEstructuraPlan extends Error {}

class FalloWorker extends Error {}

function leerEnWorker(buffer: ArrayBuffer, archivo: string): Promise<ImportacionPlan> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL("./planComprasImport.worker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      reject(new FalloWorker(e instanceof Error ? e.message : String(e)));
      return;
    }
    w.onmessage = (ev: MessageEvent<{ ok: boolean; resultado?: ImportacionPlan; estructura?: boolean; error?: string }>) => {
      w.terminate();
      const d = ev.data;
      if (d.ok && d.resultado) resolve(d.resultado);
      else if (d.estructura) reject(new ErrorEstructuraPlan(d.error ?? "Estructura inválida"));
      else reject(new Error(`No se pudo leer el archivo: ${d.error ?? "error desconocido"}`));
    };
    w.onerror = (ev) => {
      w.terminate();
      reject(new FalloWorker(ev.message || "el worker no arrancó"));
    };
    // Se transfiere (no se copia): son ~12 MB.
    w.postMessage({ buffer, archivo }, [buffer]);
  });
}

export async function leerExcelPlan(file: File): Promise<ImportacionPlan> {
  if (typeof Worker !== "undefined") {
    try {
      return await leerEnWorker(await file.arrayBuffer(), file.name);
    } catch (e) {
      if (!(e instanceof FalloWorker)) throw e;
      console.warn("[plan-compras] worker no disponible, se lee en el hilo principal:", e.message);
    }
  }
  const { leerLibroPlan, ErrorImportacion } = await import("@/lib/planComprasImport");
  try {
    return leerLibroPlan(await file.arrayBuffer(), file.name);
  } catch (e) {
    if (e instanceof ErrorImportacion) throw new ErrorEstructuraPlan(e.message);
    throw new Error(`No se pudo leer el archivo: ${e instanceof Error ? e.message : String(e)}`);
  }
}
