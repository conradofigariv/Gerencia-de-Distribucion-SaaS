"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CalendarClock, ChevronDown, Loader2, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { getPreference, setPreference } from "@/lib/userPreferences";
import { fechaMs } from "@/lib/busqueda";
import { fetchTabs, fetchFilasMarcadas, type BuscadorTab, type FilaMarcada } from "@/lib/buscadorTabs";

// ─── Próximas Entregas ───────────────────────────────────────────────────────
// Tarjeta alimentada por una pestaña del Buscador: muestra las filas que el
// usuario marcó con «En tarjeta» (`_en_tarjeta`), ordenadas por fecha pactada.
//
// El marcado es por fila y a mano — no hay regla automática de "qué es una
// próxima entrega". Es deliberado: qué merece seguimiento depende del contexto
// de cada OP, y una heurística por fecha traería ruido de OPs cerradas o
// irrelevantes que igual tienen fecha pactada futura.

/** Dónde se recuerda qué pestaña alimenta la tarjeta (por usuario). */
const TAB_PREF_KEY = "transformadores_proximas_entregas_tab";

/** Umbral de "urgente" en días. Por debajo de 0 ya está vencida. */
const DIAS_URGENTE = 7;

const HOY_MS = () => {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

function diasHasta(fecha: string | null): number | null {
  const ms = fechaMs(fecha);
  if (Number.isNaN(ms)) return null;
  return Math.round((ms - HOY_MS()) / 86_400_000);
}

function fmtFecha(fecha: string | null): string {
  const ms = fechaMs(fecha);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" });
}

/** Etiqueta legible del plazo, que es el dato que más rápido se lee de la fila. */
function textoPlazo(dias: number | null): string {
  if (dias == null) return "sin fecha";
  if (dias < 0)  return `vencida hace ${Math.abs(dias)} d`;
  if (dias === 0) return "hoy";
  if (dias === 1) return "mañana";
  return `en ${dias} d`;
}

function PlazoBadge({ dias }: { dias: number | null }) {
  const tono =
    dias == null      ? "text-muted-foreground"
    : dias < 0        ? "text-accent-red"
    : dias <= DIAS_URGENTE ? "text-accent-amber"
    : "text-accent-green";
  return (
    <span className={cn("text-[11px] font-semibold whitespace-nowrap tabular-nums", tono)}>
      {textoPlazo(dias)}
    </span>
  );
}

export function ProximasEntregas() {
  const [userId, setUserId]   = useState<string | null>(null);
  const [tabs, setTabs]       = useState<BuscadorTab[]>([]);
  const [tabId, setTabId]     = useState<string | null>(null);
  const [filas, setFilas]     = useState<FilaMarcada[]>([]);
  const [cargando, setCargando] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Pestañas disponibles + la que quedó elegida la última vez.
  useEffect(() => {
    if (!userId) return;
    fetchTabs(userId)
      .then(async (t) => {
        setTabs(t);
        const guardada = await getPreference<string>(userId, TAB_PREF_KEY);
        // La pestaña guardada puede haberse borrado o dejado de compartir: si ya
        // no está entre las visibles, se descarta en vez de pedir filas de algo
        // que no se puede leer.
        setTabId(guardada && t.some((x) => x.id === guardada) ? guardada : null);
      })
      .catch(() => { /* sin pestañas, la tarjeta lo dice sola */ });
  }, [userId]);

  useEffect(() => {
    if (!tabId) { setFilas([]); return; }
    let vigente = true;
    setCargando(true);
    fetchFilasMarcadas(tabId)
      .then((f) => {
        if (!vigente) return;
        // Sin fecha al final; el resto por fecha pactada ascendente (lo más
        // vencido primero, que es lo que hay que mirar).
        setFilas([...f].sort((a, b) => {
          const ma = fechaMs(a.fechaPactada), mb = fechaMs(b.fechaPactada);
          const na = Number.isNaN(ma), nb = Number.isNaN(mb);
          if (na && nb) return 0;
          if (na) return 1;
          if (nb) return -1;
          return ma - mb;
        }));
      })
      .catch(() => { if (vigente) setFilas([]); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [tabId]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  const elegirTab = useCallback((id: string | null) => {
    setTabId(id);
    setMenuOpen(false);
    if (userId) setPreference(userId, TAB_PREF_KEY, id);
  }, [userId]);

  const tabActiva = tabs.find((t) => t.id === tabId) ?? null;
  const vencidas  = filas.filter((f) => { const d = diasHasta(f.fechaPactada); return d != null && d < 0; }).length;

  return (
    <div className="rounded-[10px] bg-panel border border-hairline overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-panel-header border-b border-hairline">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarClock className="w-4 h-4 shrink-0 text-accent-green" />
          <h3 className="text-sm font-semibold truncate">Próximas Entregas</h3>
          {vencidas > 0 && (
            <span className="text-[11px] font-semibold text-accent-red whitespace-nowrap">
              {vencidas} vencida{vencidas === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {/* Selector de pestaña — mismo patrón que el filtro por pestaña del
            Resumen de Servicios, para que se opere igual en las dos pantallas. */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-panel-input px-2.5 py-1 text-xs hover:bg-panel-2 transition-colors max-w-[180px]"
          >
            <span className="truncate">{tabActiva ? tabActiva.nombre : "Elegir pestaña…"}</span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[200px] rounded-md border border-hairline bg-panel-2 p-1 shadow-lg">
              {tabs.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No tenés pestañas todavía.</p>
              )}
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => elegirTab(t.id)}
                  className={cn(
                    "block w-full truncate rounded-[5px] px-2 py-1.5 text-left text-xs hover:bg-panel-input transition-colors",
                    t.id === tabId && "text-accent-green font-medium"
                  )}
                >
                  {t.nombre}
                </button>
              ))}
              {tabId && (
                <button
                  onClick={() => elegirTab(null)}
                  className="mt-1 block w-full rounded-[5px] px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-panel-input transition-colors border-t border-hairline"
                >
                  Quitar selección
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-h-[340px] overflow-y-auto">
        {cargando ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : !tabId ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Elegí una pestaña del Buscador para alimentar esta tarjeta.
          </p>
        ) : filas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Ninguna fila de <span className="text-foreground">{tabActiva?.nombre}</span> está marcada.
            <br />
            <span className="text-xs">Tildá «En tarjeta» en el Buscador para que aparezcan acá.</span>
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {filas.map((f) => {
              const dias = diasHasta(f.fechaPactada);
              return (
                <li key={f.id} className="px-4 py-2.5 hover:bg-panel-2 transition-colors">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium truncate">
                      {f.descripcion ?? f.articulo ?? "—"}
                    </span>
                    <PlazoBadge dias={dias} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                    <span className="font-mono tabular-nums">{fmtFecha(f.fechaPactada)}</span>
                    {f.numeroOp && <span>· OP {f.numeroOp}</span>}
                    {f.zona && <span>· {f.zona}</span>}
                    {f.pendiente != null && (
                      <span className="inline-flex items-center gap-1">
                        · <Package className="w-3 h-3" /> {f.pendiente.toLocaleString("es-AR")} pend.
                      </span>
                    )}
                    {f.responsable && <span>· {f.responsable}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
