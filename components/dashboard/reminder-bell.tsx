"use client";

import { useEffect, useState, useRef } from "react";
import { Bell, X, RefreshCw, Cake } from "lucide-react";
import { fetchReminders, computeOverdue, type OverdueReminder } from "@/lib/reminders";
import { fetchUpcomingBirthdays, birthdayLabel, type BirthdayNotice } from "@/lib/birthdays";

const ALL_REMINDER_KEYS = [
  { key: "planillas-OP",         label: "OP — Órdenes de compra",              section: "Carga de datos" },
  { key: "planillas-SIC",        label: "SICs del Ing. Soler",                  section: "Carga de datos" },
  { key: "planillas-MATRICULAS", label: "MATRICULAS — Catálogo de materiales",  section: "Carga de datos" },
  { key: "servicios-carga",          label: "Crear seguimiento",                    section: "Control de Servicios" },
  { key: "transformadores-carga",    label: "Carga de datos — Transformadores",      section: "Transformadores" },
];

function daysLabel(days: number): string {
  if (!isFinite(days)) return "sin carga registrada";
  if (days === 0) return "hoy";
  if (days === 1) return "hace 1 día";
  return `hace ${days} días`;
}

// Ventana de aviso de cumpleaños (días de anticipación, incluye el día)
const BIRTHDAY_WINDOW_DAYS = 7;

export function ReminderBell() {
  const [overdue, setOverdue] = useState<OverdueReminder[]>([]);
  const [birthdays, setBirthdays] = useState<BirthdayNotice[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    const [remRes, bdayRes] = await Promise.allSettled([
      fetchReminders(ALL_REMINDER_KEYS.map(k => k.key)),
      fetchUpcomingBirthdays(BIRTHDAY_WINDOW_DAYS),
    ]);
    // silent on error — no Supabase table yet or network error
    setOverdue(
      remRes.status === "fulfilled"
        ? computeOverdue(remRes.value, ALL_REMINDER_KEYS)
        : []
    );
    setBirthdays(bdayRes.status === "fulfilled" ? bdayRes.value : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const visible = overdue.filter(r => !dismissed.has(r.section_id));
  const visibleBirthdays = birthdays.filter(b => !dismissed.has(`bday:${b.id}`));
  const count = visible.length + visibleBirthdays.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
        title="Recordatorios"
      >
        <Bell className="w-5 h-5" />
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
            <span className="text-sm font-semibold text-foreground">Recordatorios</span>
            <div className="flex items-center gap-1">
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
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Cargando...</div>
          ) : count === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm font-medium text-foreground">Todo al día</p>
              <p className="text-xs text-muted-foreground mt-0.5">No hay cargas pendientes</p>
            </div>
          ) : (
            <ul className="divide-y divide-border max-h-72 overflow-y-auto">
              {visibleBirthdays.map(b => (
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
                    onClick={() => setDismissed(prev => new Set([...prev, `bday:${b.id}`]))}
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-secondary transition-all"
                    title="Descartar"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
              {visible.map(r => (
                <li key={r.section_id} className="px-4 py-3 flex items-start gap-3 group">
                  <span className="mt-1 w-2 h-2 rounded-full bg-destructive flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{r.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.section} · {daysLabel(r.days_overdue)}
                    </p>
                  </div>
                  <button
                    onClick={() => setDismissed(prev => new Set([...prev, r.section_id]))}
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-secondary transition-all"
                    title="Descartar"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
