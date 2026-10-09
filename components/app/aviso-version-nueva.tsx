"use client";

// Escucha los errores que nadie atrapó (un import() bajo demanda que falló
// dentro de un evento, un next/dynamic que reportó su error) y, si son de una
// versión vieja de la app, muestra el aviso «Recargar». Ver lib/versionNueva.ts.

import { useEffect } from "react";
import { manejarErrorDeVersion } from "@/lib/versionNueva";

export function AvisoVersionNueva() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => { manejarErrorDeVersion(ev.error ?? ev.message); };
    const onRechazo = (ev: PromiseRejectionEvent) => { manejarErrorDeVersion(ev.reason); };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRechazo);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRechazo);
    };
  }, []);
  return null;
}
