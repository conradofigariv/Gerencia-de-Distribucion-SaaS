"use client";

// Límite de errores de cada sección del dashboard. Sin esto, un error al
// dibujar una sección (por ejemplo el diagrama SIC o el mapa de Stock por zona
// que no pudieron cargar su código después de un redespliegue) lo atrapa el
// GlobalError de Next y reemplaza TODA la página por «Application error».
// Con esto falla solo la sección, con un mensaje entendible y un botón.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { esErrorDeVersion, avisarVersionNueva, recargarPagina, MENSAJE_VERSION_NUEVA } from "@/lib/versionNueva";

interface Props { children: ReactNode }
interface State { error: Error | null }

export class LimiteSeccion extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (esErrorDeVersion(error)) avisarVersionNueva();
    else console.error("[sección] error al dibujar:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const version = esErrorDeVersion(error);
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-xl border border-border bg-card p-6 text-sm">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-5 w-5 shrink-0 text-accent-amber" />
          <h2 className="text-base font-semibold text-foreground">
            {version ? "Hay una versión nueva de la app" : "Esta sección tuvo un error"}
          </h2>
        </div>
        <p className="mt-3 leading-relaxed text-muted-foreground" style={{ overflowWrap: "anywhere" }}>
          {version ? MENSAJE_VERSION_NUEVA : error.message || "Error desconocido."}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="accent" onClick={recargarPagina}>
            <RefreshCw className="h-4 w-4" />Recargar página
          </Button>
          {/* Reintentar no sirve si es de versión: el código viejo queda cacheado hasta recargar. */}
          {!version && (
            <Button variant="outline" onClick={() => this.setState({ error: null })}>
              <RotateCcw className="h-4 w-4" />Reintentar
            </Button>
          )}
        </div>
      </div>
    );
  }
}
