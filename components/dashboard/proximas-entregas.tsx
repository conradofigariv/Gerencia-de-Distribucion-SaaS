"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { CalendarClock, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { getPreference, setPreference } from "@/lib/userPreferences";
import { fechaMs } from "@/lib/busqueda";
import { fetchTabs, fetchFilasMarcadas, type BuscadorTab, type FilaMarcada } from "@/lib/buscadorTabs";

// ─── Próximas Entregas ───────────────────────────────────────────────────────
// Tarjeta alimentada por una pestaña del Buscador: muestra las filas que el
// usuario mandó con «Enviar a Tarjeta», agrupadas por horizonte temporal.
//
// El marcado es por fila y a mano — no hay regla automática de "qué es una
// próxima entrega". Es deliberado: qué merece seguimiento depende del contexto
// de cada OP, y una heurística por fecha traería ruido de OPs cerradas o
// irrelevantes que igual tienen fecha pactada futura.
//
// El grano es el ENVÍO, no la OP: una OP no llega junta, llega en cuotas, y
// «próxima entrega» se refiere a la cuota. Por eso cada línea muestra «env. 1/2»
// y la misma matrícula puede aparecer más de una vez con fechas distintas.

/** Dónde se recuerda qué pestaña alimenta la tarjeta (por usuario). */
const TAB_PREF_KEY = "transformadores_proximas_entregas_tab";
/** Qué secciones quedaron plegadas. Se guardan las CERRADAS, igual que en el
 *  Buscador: una sección nueva nace abierta sin que nadie la agregue a nada. */
const PLEGADOS_PREF_KEY = "transformadores_proximas_entregas_plegados";

const HOY_MS = () => {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

/**
 * Fecha que manda para esta fila. `fecha_pactada` es la comprometida con el
 * proveedor y es la buena; cuando no está (las fuentes `transaccion` y
 * `catalogo` no salen de la planilla OP y no la traen) se cae a la F. revisión
 * que el usuario carga a mano, para que esas filas no queden fuera del radar.
 */
function fechaEfectiva(f: FilaMarcada): { valor: string | null; esRespaldo: boolean } {
  if (!Number.isNaN(fechaMs(f.fechaPactada))) return { valor: f.fechaPactada, esRespaldo: false };
  if (!Number.isNaN(fechaMs(f.fechaRevision))) return { valor: f.fechaRevision, esRespaldo: true };
  return { valor: null, esRespaldo: false };
}

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

function textoPlazo(dias: number | null): string {
  if (dias == null)  return "";
  if (dias < 0)      return `hace ${Math.abs(dias)} d`;
  if (dias === 0)    return "hoy";
  if (dias === 1)    return "mañana";
  return `en ${dias} d`;
}

/**
 * Resumen legible de un transformador a partir de su descripción cruda, que es
 * inusable de largo: «TRAFO DE DISTRIBUCION TRIFASICO/1000KVA/DY11/(13.200/
 * 400-231V)/AISLACION ACEITE/INTEMPERIE» → «1000 kVA · Trifásico». La completa
 * sigue disponible en el `title` de la línea.
 *
 * Si no se reconoce el patrón se devuelve la descripción tal cual: la tarjeta
 * puede apuntar a una pestaña que no sea de transformadores, y ahí inventar un
 * resumen sería peor que mostrar el texto original.
 */
function resumenArticulo(descripcion: string | null, articulo: string | null): string {
  const d = descripcion ?? "";
  const kva  = /(\d+(?:[.,]\d+)?)\s*KVA/i.exec(d);
  const fase = /\b(TRIFASICO|MONOFASICO)\b/i.exec(d);
  if (!kva) return d || articulo || "—";
  const potencia = `${kva[1].replace(",", ".")} kVA`;
  if (!fase) return potencia;
  const f = fase[1].toUpperCase() === "TRIFASICO" ? "Trifásico" : "Monofásico";
  return `${potencia} · ${f}`;
}

// ─── Horizontes ──────────────────────────────────────────────────────────────
// El orden del array ES el orden en que se muestran las secciones.

type HorizonteId = "vencidas" | "semana" | "mes" | "adelante" | "sinFecha";

const HORIZONTES: { id: HorizonteId; titulo: string; tono: string; hasta: number | null }[] = [
  { id: "vencidas",  titulo: "Vencidas",      tono: "text-accent-red",         hasta: -1   },
  { id: "semana",    titulo: "Esta semana",   tono: "text-accent-amber",       hasta: 7    },
  { id: "mes",       titulo: "Este mes",      tono: "text-accent-green",       hasta: 30   },
  { id: "adelante",  titulo: "Más adelante",  tono: "text-muted-foreground",   hasta: null },
  { id: "sinFecha",  titulo: "Sin fecha",     tono: "text-muted-foreground",   hasta: null },
];

function horizonteDe(dias: number | null): HorizonteId {
  if (dias == null) return "sinFecha";
  if (dias < 0)     return "vencidas";
  if (dias <= 7)    return "semana";
  if (dias <= 30)   return "mes";
  return "adelante";
}

type FilaVista = FilaMarcada & { dias: number | null; fecha: string | null; esRespaldo: boolean };

/**
 * Un dato con su rótulo debajo, con la misma forma que la cantidad pendiente.
 * Se omite entero cuando no hay valor: un rótulo suelto sobre un guión ocupa
 * lugar para no decir nada.
 */
function Campo({ label, valor, crece = false }: { label: string; valor: string | null; crece?: boolean }) {
  if (!valor) return null;
  return (
    <div className={cn("min-w-0", crece ? "flex-1" : "shrink-0")}>
      <div className="text-[12px] tabular-nums truncate leading-tight" title={valor}>{valor}</div>
      <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
    </div>
  );
}

export function ProximasEntregas() {
  const [userId, setUserId]     = useState<string | null>(null);
  const [tabs, setTabs]         = useState<BuscadorTab[]>([]);
  const [tabId, setTabId]       = useState<string | null>(null);
  const [filas, setFilas]       = useState<FilaMarcada[]>([]);
  const [cargando, setCargando] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // «Sin fecha» arranca plegada: son filas a las que les falta el dato, no
  // entregas próximas, y arriba solo estorbarían.
  const [plegados, setPlegados] = useState<Set<HorizonteId>>(new Set(["sinFecha"]));
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

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

    getPreference<HorizonteId[]>(userId, PLEGADOS_PREF_KEY)
      .then((p) => { if (p) setPlegados(new Set(p)); })
      .catch(() => { /* vale el default: solo «Sin fecha» plegada */ });
  }, [userId]);

  useEffect(() => {
    if (!tabId) { setFilas([]); return; }
    let vigente = true;
    setCargando(true);
    fetchFilasMarcadas(tabId)
      .then((f) => { if (vigente) setFilas(f); })
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

  const grupos = useMemo(() => {
    const vistas: FilaVista[] = filas.map((f) => {
      const { valor, esRespaldo } = fechaEfectiva(f);
      return { ...f, fecha: valor, esRespaldo, dias: diasHasta(valor) };
    });
    const porHorizonte = new Map<HorizonteId, FilaVista[]>();
    for (const v of vistas) {
      const h = horizonteDe(v.dias);
      if (!porHorizonte.has(h)) porHorizonte.set(h, []);
      porHorizonte.get(h)!.push(v);
    }
    for (const lista of porHorizonte.values()) {
      lista.sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0));
    }
    return porHorizonte;
  }, [filas]);

  const totalVencidas = grupos.get("vencidas")?.length ?? 0;
  const totalPronto   = (grupos.get("semana")?.length ?? 0) + (grupos.get("mes")?.length ?? 0);
  const totalPend     = filas.reduce((n, f) => n + (f.pendiente ?? 0), 0);

  const tabActiva = tabs.find((t) => t.id === tabId) ?? null;

  const togglePlegado = (h: HorizonteId) => setPlegados((prev) => {
    const s = new Set(prev);
    if (s.has(h)) s.delete(h); else s.add(h);
    if (userId) setPreference(userId, PLEGADOS_PREF_KEY, [...s]);
    return s;
  });

  return (
    <div className="rounded-[10px] bg-panel border border-hairline overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 bg-panel-header border-b border-hairline">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 shrink-0 text-accent-green" />
            <h3 className="text-sm font-semibold truncate">Próximas Entregas</h3>
          </div>
          {/* Resumen de cabecera: la pregunta «¿tengo algo encima?» se contesta
              acá, sin tener que leer la lista entera. */}
          {filas.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
              {totalVencidas > 0 && (
                <span className="text-accent-red font-semibold">{totalVencidas} vencida{totalVencidas === 1 ? "" : "s"}</span>
              )}
              {totalVencidas > 0 && totalPronto > 0 && <span>·</span>}
              {totalPronto > 0 && <span>{totalPronto} en 30 días</span>}
              {totalPend > 0 && <><span>·</span><span>{totalPend.toLocaleString("es-AR")} u pendientes</span></>}
            </p>
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

      <div className="max-h-[420px] overflow-y-auto">
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
            Ninguna fila de <span className="text-foreground">{tabActiva?.nombre}</span> está en la tarjeta.
            <br />
            <span className="text-xs">Seleccioná filas en el Buscador y usá «Enviar a Tarjeta».</span>
          </p>
        ) : (
          // Dos columnas en pantallas anchas: las secciones son bloques
          // independientes, así que puestas de a pares la tarjeta ocupa la
          // mitad de alto sin perder nada. `items-start` evita que la sección
          // corta se estire para igualar a la larga.
          <div className="grid grid-cols-1 lg:grid-cols-2 items-start gap-3 p-3">
          {HORIZONTES.map((h) => {
            const lista = grupos.get(h.id);
            if (!lista?.length) return null;
            const plegado = plegados.has(h.id);
            return (
              // Cada horizonte es una sub-tarjeta con su propio borde: en dos
              // columnas, sin marco propio no se leería dónde termina una
              // sección y empieza la otra.
              <div key={h.id} className="rounded-[8px] border border-hairline bg-panel-2 overflow-hidden">
                <button
                  onClick={() => togglePlegado(h.id)}
                  className={cn(
                    "w-full flex items-center gap-1.5 px-3 py-1.5 bg-panel-header hover:bg-panel-input transition-colors",
                    !plegado && "border-b border-hairline"
                  )}
                >
                  {plegado
                    ? <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" />
                    : <ChevronDown  className="w-3.5 h-3.5 shrink-0 opacity-60" />}
                  <span className={cn("text-[11px] font-semibold uppercase tracking-wide", h.tono)}>
                    {h.titulo}
                  </span>
                  <span className="text-[11px] text-muted-foreground">({lista.length})</span>
                </button>

                {!plegado && (
                  <ul className="divide-y divide-hairline">
                    {lista.map((f) => (
                      <li
                        key={f.id}
                        className="px-3 py-2.5 hover:bg-panel-input transition-colors"
                        title={f.descripcion ?? undefined}
                      >
                        <div className="flex items-start gap-3">
                          {/* Fecha al frente: es el dato que organiza la tarjeta. */}
                          <div className="w-[72px] shrink-0">
                            <div className="font-mono text-[12.5px] tabular-nums">
                              {fmtFecha(f.fecha)}
                              {/* La fecha no siempre es la pactada — si salió
                                  del respaldo hay que decirlo, o miente. */}
                              {f.esRespaldo && (
                                <span className="ml-1 text-[9px] text-accent-amber align-top" title="Sin fecha pactada — se usa la F. revisión que cargaste">rev</span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground">{textoPlazo(f.dias)}</div>
                          </div>
                          <div className="flex-1 min-w-0 text-[13px] font-medium truncate">
                            {resumenArticulo(f.descripcion, f.articulo)}
                          </div>
                        </div>

                        {/* Los datos de la fila, repartidos como campos con
                            rótulo (igual que la cantidad) en vez de una línea
                            de texto separada por puntos: ocupan el ancho que ya
                            estaba libre y cada valor se ubica de un vistazo. */}
                        <div className="mt-1.5 flex items-end gap-3 pl-[84px]">
                          <Campo label="OP"        valor={f.numeroOp} />
                          <Campo label="Línea"     valor={f.linea} />
                          <Campo
                            label="Envío"
                            valor={f.envio ? `${f.envio}${f.enviosLinea ? `/${f.enviosLinea}` : ""}` : null}
                          />
                          <Campo label="Proveedor" valor={f.proveedor} crece />
                          {f.pendiente != null && f.pendiente > 0 && (
                            <div className="shrink-0 text-right">
                              <div className="text-[12.5px] font-semibold tabular-nums leading-tight">
                                {f.pendiente.toLocaleString("es-AR")}
                              </div>
                              <div className="text-[10px] text-muted-foreground leading-tight">pend.</div>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
}
