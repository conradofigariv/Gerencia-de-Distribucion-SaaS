"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { X, Loader2, Check, BellRing } from "lucide-react";
import {
  fetchReglas, fetchUltimasCargas, guardarReglaCarga, reglasDeCargaCompletas,
  CARGAS_VIGILABLES,
} from "@/lib/notificaciones";

/** Atajos de frecuencia. El usuario igual puede escribir cualquier número. */
const PRESETS = [1, 3, 7, 15, 30];

interface FilaCfg {
  section_id:      string;
  frecuencia_dias: number;
  hora:            string | null;
  activa:          boolean;
}

const fmtUltima = (iso: string | null) => {
  if (!iso) return "sin carga registrada";
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias === 0) return "cargada hoy";
  if (dias === 1) return "cargada hace 1 día";
  return `cargada hace ${dias} días`;
};

/**
 * Configuración de los recordatorios de carga — POR USUARIO.
 *
 * Cada uno elige qué cargas quiere vigilar y cada cuánto. La fecha de última
 * carga que se muestra al lado es compartida (es un hecho de la oficina: si
 * alguien subió la planilla, se subió para todos).
 */
export function DialogRecordatorios({
  userId, onClose, onGuardado,
}: {
  userId: string; onClose: () => void; onGuardado: () => void;
}) {
  const [filas,     setFilas]     = useState<FilaCfg[]>([]);
  const [ultimas,   setUltimas]   = useState<Map<string, string | null>>(new Map());
  const [cargando,  setCargando]  = useState(true);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [reglas, cargas] = await Promise.all([fetchReglas(userId), fetchUltimasCargas()]);
        setFilas(reglasDeCargaCompletas(reglas));
        setUltimas(new Map(cargas.map((c) => [c.section_id, c.last_updated_at])));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setCargando(false);
      }
    })();
  }, [userId]);

  const patch = (sectionId: string, cambio: Partial<FilaCfg>) =>
    setFilas((prev) => prev.map((f) => (f.section_id === sectionId ? { ...f, ...cambio } : f)));

  const guardar = async () => {
    setGuardando(true);
    try {
      // Se guardan TODAS, incluidas las desactivadas: la fila con activa=false
      // es la que recuerda que el usuario no quiere ese aviso (si no se
      // guardara, volvería al default en la próxima apertura).
      await Promise.all(
        filas.map((f) =>
          guardarReglaCarga(userId, f.section_id, f.frecuencia_dias, f.hora, f.activa)
        )
      );
      toast.success("Recordatorios guardados.");
      onGuardado();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  // Agrupadas como en el sidebar, para que se encuentren donde se esperan.
  const grupos = [...new Set(CARGAS_VIGILABLES.map((c) => c.grupo))];

  return createPortal(
    <div
      className="fixed inset-0 z-[200] grid place-items-center p-4 bg-black/65"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-hairline bg-panel overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="grid place-items-center w-8 h-8 rounded-lg bg-accent/15 text-accent">
              <BellRing className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Recordatorios de carga</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Elegí qué cargas vigilar y cada cuánto avisarte
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {cargando ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
            </p>
          ) : (
            grupos.map((grupo) => (
              <div key={grupo}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {grupo}
                </p>
                <div className="space-y-2">
                  {CARGAS_VIGILABLES.filter((c) => c.grupo === grupo).map((c) => {
                    const f = filas.find((x) => x.section_id === c.key);
                    if (!f) return null;
                    return (
                      <div
                        key={c.key}
                        className={cn(
                          "rounded-xl border p-3 transition-colors",
                          f.activa ? "border-accent/30 bg-panel-2" : "border-hairline"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => patch(c.key, { activa: !f.activa })}
                            className={cn(
                              "mt-0.5 shrink-0 grid place-items-center w-4 h-4 rounded border transition-colors",
                              f.activa
                                ? "bg-accent-green/20 border-accent-green/50 text-accent-green"
                                : "border-hairline hover:border-accent/40"
                            )}
                          >
                            {f.activa && <Check className="w-3 h-3" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-foreground">{c.label}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {fmtUltima(ultimas.get(c.key) ?? null)}
                            </p>

                            {f.activa && (
                              <div className="mt-2.5 space-y-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[11px] text-muted-foreground mr-0.5">
                                    Avisar cada
                                  </span>
                                  {PRESETS.map((d) => (
                                    <button
                                      key={d}
                                      onClick={() => patch(c.key, { frecuencia_dias: d })}
                                      className={cn(
                                        "h-6 px-2 rounded-md text-[11px] font-medium border transition-colors",
                                        f.frecuencia_dias === d
                                          ? "bg-accent/15 text-foreground border-accent/40"
                                          : "text-muted-foreground border-hairline hover:bg-panel-2"
                                      )}
                                    >
                                      {d === 1 ? "1 día" : `${d} días`}
                                    </button>
                                  ))}
                                  <input
                                    type="number"
                                    min={1}
                                    value={f.frecuencia_dias}
                                    onChange={(e) =>
                                      patch(c.key, { frecuencia_dias: Math.max(1, Number(e.target.value) || 1) })
                                    }
                                    className="w-14 h-6 px-1.5 rounded-md bg-panel-2 border border-hairline text-[11px] text-center text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                                    title="Cantidad de días personalizada"
                                  />
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-muted-foreground">
                                    No molestar antes de
                                  </span>
                                  <input
                                    type="time"
                                    value={f.hora ?? ""}
                                    onChange={(e) => patch(c.key, { hora: e.target.value || null })}
                                    className="h-6 px-1.5 rounded-md bg-panel-2 border border-hairline text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                                    style={{ colorScheme: "dark" }}
                                  />
                                  {f.hora && (
                                    <button
                                      onClick={() => patch(c.key, { hora: null })}
                                      className="text-[11px] text-muted-foreground hover:text-foreground"
                                    >
                                      quitar
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-hairline shrink-0">
          <p className="text-[11px] text-muted-foreground">
            Solo tuyo — no cambia los avisos de los demás
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="h-9 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-panel-2 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando || cargando}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold text-accent-green bg-accent-green/10 hover:bg-accent-green/20 border border-accent-green/30 transition-colors disabled:opacity-50"
            >
              {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
