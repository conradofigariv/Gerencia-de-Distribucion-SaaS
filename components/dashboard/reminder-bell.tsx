"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Bell, X, RefreshCw, Cake, Settings2, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchReglas, fetchUltimasCargas, fetchDescartes, fetchServicios, descartar, evaluar,
  type Notificacion,
} from "@/lib/notificaciones";
import { avisarInicioDelDia, fetchSonidoUrl } from "@/lib/notificacionSonido";
import { fetchUpcomingBirthdays, birthdayLabel, type BirthdayNotice } from "@/lib/birthdays";
import { DialogRecordatorios } from "@/components/dashboard/dialog-recordatorios";

// Ventana de aviso de cumpleaños (días de anticipación, incluye el día).
const BIRTHDAY_WINDOW_DAYS = 7;

const COLOR_SEVERIDAD = {
  alta:  "bg-destructive",
  media: "bg-amber-500",
  baja:  "bg-muted-foreground",
} as const;

export function ReminderBell() {
  const [userId,    setUserId]    = useState<string | null>(null);
  const [notifs,    setNotifs]    = useState<Notificacion[]>([]);
  const [birthdays, setBirthdays] = useState<BirthdayNotice[]>([]);
  // Los cumpleaños siguen descartándose solo en memoria: son efímeros por
  // naturaleza (se van solos cuando pasa la fecha), no vale la pena una fila.
  const [bdayDismissed, setBdayDismissed] = useState<Set<string>>(new Set());
  const [open,      setOpen]      = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [reglasRes, cargasRes, descartesRes, serviciosRes, bdayRes, sonidoRes] = await Promise.allSettled([
      userId ? fetchReglas(userId)    : Promise.resolve([]),
      fetchUltimasCargas(),
      userId ? fetchDescartes(userId) : Promise.resolve([]),
      fetchServicios(),
      fetchUpcomingBirthdays(BIRTHDAY_WINDOW_DAYS),
      userId ? fetchSonidoUrl(userId) : Promise.resolve(null),
    ]);

    // Silencioso ante errores: la campana es accesoria, no puede romper el
    // header si Supabase está caído o si falta correr la migración.
    const reglas    = reglasRes.status    === "fulfilled" ? reglasRes.value    : [];
    const cargas    = cargasRes.status    === "fulfilled" ? cargasRes.value    : [];
    const descartes = descartesRes.status === "fulfilled" ? descartesRes.value : [];
    const servicios = serviciosRes.status === "fulfilled" ? serviciosRes.value : [];

    const pendientes = evaluar(reglas, descartes, {
      ultimasCargas: cargas, servicios, ahora: new Date(),
    });
    setNotifs(pendientes);
    setBirthdays(bdayRes.status === "fulfilled" ? bdayRes.value : []);
    setLoading(false);

    // Aviso sonoro del comienzo del día: una sola vez por día, solo si hay
    // algo pendiente, con el audio propio del usuario si subió uno (ver
    // lib/notificacionSonido.ts).
    const sonidoUrl = sonidoRes.status === "fulfilled" ? sonidoRes.value : null;
    avisarInicioDelDia(pendientes.length > 0, sonidoUrl);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /** Descarta y saca la fila al instante: esperar el round-trip se siente roto. */
  const handleDescartar = async (n: Notificacion) => {
    setNotifs((prev) => prev.filter((x) => x.clave !== n.clave));
    if (!userId) return;
    try { await descartar(userId, n.clave, n.huella); }
    catch { load(); }   // no se pudo guardar: que vuelva a aparecer, no mentir
  };

  const visibleBirthdays = birthdays.filter((b) => !bdayDismissed.has(b.id));
  const count = notifs.length + visibleBirthdays.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
        title="Notificaciones"
      >
        <Bell className="w-4 h-4" />
        {!loading && count > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-0.5 bg-destructive rounded-full text-[10px] font-bold text-destructive-foreground flex items-center justify-center leading-none">
            {count > 9 ? "9+" : count}
          </span>
        )}
        {!loading && count === 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">Notificaciones</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setConfigOpen(true); setOpen(false); }}
                title="Configurar recordatorios"
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={load}
                title="Actualizar"
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="px-4 py-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…
            </div>
          ) : count === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm font-medium text-foreground">Todo al día</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                No hay avisos pendientes
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border max-h-72 overflow-y-auto">
              {visibleBirthdays.map((b) => (
                <li key={`bday:${b.id}`} className="px-4 py-3 flex items-start gap-3 group">
                  <Cake className="mt-0.5 w-4 h-4 text-pink-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      🎂 Cumpleaños de {b.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {String(b.day).padStart(2, "0")}/{String(b.month).padStart(2, "0")} · {birthdayLabel(b.daysUntil)}
                    </p>
                  </div>
                  <button
                    onClick={() => setBdayDismissed((prev) => new Set([...prev, b.id]))}
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-secondary transition-all"
                    title="Descartar"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
              {notifs.map((n) => (
                <li key={n.clave} className="px-4 py-3 flex items-start gap-3 group">
                  <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${COLOR_SEVERIDAD[n.severidad]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{n.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.detalle}</p>
                  </div>
                  <button
                    onClick={() => handleDescartar(n)}
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-secondary transition-all"
                    title="Descartar hasta que cambie"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {configOpen && userId && (
        <DialogRecordatorios
          userId={userId}
          onClose={() => setConfigOpen(false)}
          onGuardado={load}
        />
      )}
    </div>
  );
}
