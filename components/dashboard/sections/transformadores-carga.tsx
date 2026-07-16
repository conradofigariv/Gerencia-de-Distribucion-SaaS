"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { FileText, X, Loader2, CheckCircle2, Sparkles, BellRing, Upload, Eraser } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { markUpdated, fetchReminders, upsertConfig } from "@/lib/reminders";

// ─── Constants ────────────────────────────────────────────────────────────────

const POT_13 = [5, 10, 16, 25, 50, 63, 80, 100, 125, 160, 200, 250, 315, 500, 630, 800, 1000];
const POT_33 = [25, 63, 160, 250, 315, 500, 630];
const ZONAS  = ["Villa Revol", "Alta Gracia Norte"];

// Grilla unificada: KVA | Terceros (T/M/CT/Total) | sep | Taller (T/M/CT/Total) | sep | Totales
const GRID_COLS = "70px repeat(4,minmax(0,1fr)) 12px repeat(4,minmax(0,1fr)) 12px repeat(3,minmax(0,1fr))";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrafoRow  { t: number; m: number; ct: number }
interface TallerRow { t: number; m: number; ct: number }
interface Rel33Row  { tN: number; mN: number; tR: number; mR: number }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sum = (r: TrafoRow) => r.t + r.m; // ct = subconjunto de t/m, no suma al total

// Merge extracted data (keyed by string) back into state (keyed by number)
function mergeMap<T>(prev: Record<number, T>, extracted: Record<string, T>, keys: number[]): Record<number, T> {
  const next = { ...prev };
  for (const p of keys) {
    const val = extracted[p] ?? extracted[String(p)];
    if (val !== undefined) next[p] = { ...prev[p], ...val } as T;
  }
  return next;
}
function mergeTaller(
  prev: Record<number, TallerRow>,
  extracted: Record<string, Partial<TallerRow & { tipo?: string }>>,
  keys: number[]
): Record<number, TallerRow> {
  const next = { ...prev };
  for (const p of keys) {
    const val = extracted[p] ?? extracted[String(p)];
    if (val !== undefined) {
      const { tipo: _tipo, ...rest } = val as TallerRow & { tipo?: string };
      next[p] = { ...prev[p], ...rest };
    }
  }
  return next;
}

function init13Trafo()  { return Object.fromEntries(POT_13.map(p => [p, { t: 0, m: 0, ct: 0  }])) as Record<number, TrafoRow>; }
function init13Taller() { return Object.fromEntries(POT_13.map(p => [p, { t: 0, m: 0, ct: 0 }])) as Record<number, TallerRow>; }
function init13Auto()   { return Object.fromEntries(POT_13.map(p => [p, 0])) as Record<number, number>; }
function init33()       { return Object.fromEntries(POT_33.map(p => [p, { tN: 0, mN: 0, tR: 0, mR: 0 }])) as Record<number, Rel33Row>; }

// ─── Micro-components ─────────────────────────────────────────────────────────

// Celda editable tipo Excel: commit al salir o con Enter, selecciona todo al focar.
function EInput({ val, onChange, valueClass }: { val: number; onChange: (v: number) => void; valueClass?: string }) {
  const [text, setText] = useState(String(val || 0));

  useEffect(() => { setText(String(val || 0)); }, [val]);

  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isNaN(n) || n < 0) { setText(String(val || 0)); return; }
    onChange(n);
    setText(String(n));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={e => setText(e.target.value.replace(/[^\d]/g, ""))}
      onFocus={e => e.target.select()}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={cn(
        "w-full text-center text-xs font-semibold rounded-md bg-panel-input border border-border py-1.5 text-foreground",
        "focus:outline-none focus:border-accent focus:bg-accent/10 transition-colors",
        valueClass
      )}
    />
  );
}

function TH({ c, rs, cs, children }: { c?: string; rs?: number; cs?: number; children: React.ReactNode }) {
  return (
    <th rowSpan={rs} colSpan={cs}
      className={`px-0.5 py-1 text-[8px] font-bold text-muted-foreground border border-border bg-panel-header uppercase tracking-wide leading-tight ${c ?? ""}`}>
      {children}
    </th>
  );
}

function TD({ c, children }: { c?: string; children: React.ReactNode }) {
  return (
    <td className={`px-0.5 py-1 text-[10px] border border-border text-center text-muted-foreground ${c ?? ""}`}>
      {children}
    </td>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function extractDateFromFilename(name: string): string {
  // DD-MM-YYYY or DD/MM/YYYY (4-digit year)
  let m = name.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // YYYY-MM-DD or YYYY/MM/DD
  m = name.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD-MM-YY or DD/MM/YY (2-digit year → 20YY)
  m = name.match(/(\d{2})[-/](\d{2})[-/](\d{2})(?!\d)/);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  // DDMMYYYY (8 digits, day first)
  m = name.match(/(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // YYYYMMDD
  m = name.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return new Date().toISOString().split("T")[0];
}

function extractDepositoFromFilename(name: string): string {
  return /ALTA\s*GRACIA\s*NORTE/i.test(name) ? "Alta Gracia Norte" : "Villa Revol";
}

const REMINDER_KEY  = "transformadores-carga";
const REMINDER_NAME = "Carga de datos — Transformadores";

export function TransformadoresCargaSection() {
  const [fecha, setFecha]           = useState<string>(new Date().toISOString().split("T")[0]);
  const [deposito, setDeposito]     = useState<string>("Villa Revol");
  const [archivo, setArchivo]       = useState<File | null>(null);
  const [dragging, setDragging]     = useState(false);
  const [terceros, setTerceros]     = useState<Record<number, TrafoRow>>(init13Trafo);
  const [taller, setTaller]         = useState<Record<number, TallerRow>>(init13Taller);
  const [autorizados, setAutorizados] = useState<Record<number, number>>(init13Auto);
  const [rel33, setRel33]           = useState<Record<number, Rel33Row>>(init33);
  const [obs, setObs]               = useState("");
  const [pend, setPend]             = useState("");
  const [hideZeros, setHideZeros]   = useState(true);
  const [dirty, setDirty]           = useState(false);
  const [saving, setSaving]         = useState(false);
  const [analyzing, setAnalyzing]   = useState(false);
  const [fechaDuplicada, setFechaDuplicada] = useState(false);
  const savingRef = useRef(false);
  const [overwriteInfo, setOverwriteInfo] = useState<{ ids: number[]; datos: Record<string, unknown>; count: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auth / role
  const [userId,    setUserId]    = useState<string | null>(null);
  const [, setCanConfig] = useState(true);

  // Reminder config
  const [configOpen,      setConfigOpen]      = useState(false);
  const [loadingConfig,   setLoadingConfig]   = useState(false);
  const [savingConfig,    setSavingConfig]    = useState(false);
  const [reminderFreq,    setReminderFreq]    = useState(7);
  const [reminderTime,    setReminderTime]    = useState("09:00");
  const [reminderLastUpd, setReminderLastUpd] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data: profile } = await supabase
        .from("profiles").select("nivel_acceso").eq("id", user.id).single();
      if (profile?.nivel_acceso === "visualizador") setCanConfig(false);
    })();
  }, []);

  useEffect(() => {
    if (!configOpen) return;
    setLoadingConfig(true);
    fetchReminders([REMINDER_KEY])
      .then(cfgs => {
        const cfg = cfgs[0];
        if (cfg) {
          setReminderFreq(cfg.frequency_days);
          setReminderLastUpd(cfg.last_updated_at);
          if (cfg.reminder_time) setReminderTime(cfg.reminder_time.substring(0, 5));
        }
      })
      .catch(e => toast.error(`Error al cargar recordatorio: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setLoadingConfig(false));
  }, [configOpen]);

  const saveConfig = async () => {
    if (!userId) return;
    setSavingConfig(true);
    upsertConfig(REMINDER_KEY, REMINDER_NAME, reminderFreq, reminderTime, userId)
      .then(() => { toast.success("Recordatorio guardado"); setConfigOpen(false); })
      .catch(e => toast.error(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setSavingConfig(false));
  };

  // ── File selection + auto-analyze ───────────────────────────────────────────

  const handleFileChange = async (file: File) => {
    setArchivo(file);
    const f = extractDateFromFilename(file.name);
    const dep = extractDepositoFromFilename(file.name);
    setFecha(f);
    setDeposito(dep);
    const { data } = await supabase.from("planillas_reserva").select("id, datos").eq("fecha", f);
    const duplicate = (data ?? []).some(p => (p.datos?.deposito ?? "") === dep);
    setFechaDuplicada(duplicate);
    await analyzeFile(file);
  };

  const analyzeFile = async (file: File) => {
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
      const endpoint = isPdf ? "/api/analizar-pdf" : "/api/analizar-planilla";
      const res = await fetch(endpoint, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al analizar");

      const d = json.datos;
      // Merge into state — keep existing structure, overwrite with extracted values
      if (d.terceros)    setTerceros(prev => mergeMap(prev, d.terceros, POT_13));
      if (d.taller)      setTaller(prev => mergeTaller(prev, d.taller, POT_13));
      if (d.autorizados) setAutorizados(prev => {
        const next = { ...prev };
        for (const p of POT_13) {
          const val = d.autorizados[p] ?? d.autorizados[String(p)];
          if (typeof val === "number") next[p] = val;
        }
        return next;
      });
      if (d.rel33)       setRel33(prev => mergeMap(prev, d.rel33, POT_33));
      if (d.obs)        setObs(d.obs);
      if (d.pend)       setPend(d.pend);

      setDirty(true);
      toast.success("Planilla cargada y datos procesados", { duration: 1000 });
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "No se pudo analizar el archivo");
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Updaters (marcan dirty para habilitar "Guardar cambios") ────────────────

  const setT = (p: number, f: keyof TrafoRow, v: number) => {
    setTerceros(prev => ({ ...prev, [p]: { ...prev[p], [f]: v } }));
    setDirty(true);
  };

  const setTANum = (p: number, f: keyof TallerRow, v: number) => {
    setTaller(prev => ({ ...prev, [p]: { ...prev[p], [f]: v } }));
    setDirty(true);
  };

  const setAuto = (p: number, v: number) => {
    setAutorizados(prev => ({ ...prev, [p]: v }));
    setDirty(true);
  };

  const setR = (p: number, f: keyof Rel33Row, v: number) => {
    setRel33(prev => ({ ...prev, [p]: { ...prev[p], [f]: v } }));
    setDirty(true);
  };

  // ── Computed (todos los totales son derivados en vivo) ─────────────────────

  const trafosOf = (p: number) => sum(terceros[p]) + sum(taller[p]);
  const dispOf   = (p: number) => Math.max(0, trafosOf(p) - autorizados[p]);

  const totGeneral  = POT_13.reduce((s, p) => s + trafosOf(p), 0);
  const totAuto     = POT_13.reduce((s, p) => s + autorizados[p], 0);
  const totDisp     = totGeneral - totAuto;
  const tot33N      = POT_33.reduce((s, p) => s + rel33[p].tN + rel33[p].mN, 0);
  const tot33R      = POT_33.reduce((s, p) => s + rel33[p].tR + rel33[p].mR, 0);

  // Toggle "Ocultar filas en 0": oculta filas sin trafos ni autorizados
  const visibleRows = hideZeros ? POT_13.filter(p => trafosOf(p) > 0 || autorizados[p] > 0) : POT_13;
  const hiddenCount = POT_13.length - visibleRows.length;

  // ── Clear form ──────────────────────────────────────────────────────────────

  const handleClear = () => {
    if (!confirm("¿Limpiar todos los valores de la planilla?")) return;
    setTerceros(init13Trafo());
    setTaller(init13Taller());
    setAutorizados(init13Auto());
    setRel33(init33());
    setObs("");
    setPend("");
    setArchivo(null);
    if (fileRef.current) fileRef.current.value = "";
    setDirty(false);
  };

  // ── Save ────────────────────────────────────────────────────────────────────

  // El campo `totales` se persiste derivado (terceros + taller) para mantener
  // compatibilidad con el Resumen, que lo lee de datos.totales.
  const buildDatos = (): Record<string, unknown> => ({
    terceros,
    taller,
    totales: Object.fromEntries(POT_13.map(p => [p, trafosOf(p)])),
    autorizados,
    rel33,
    obs,
    pend,
    deposito,
  });

  // Inserta (opcionalmente borrando filas previas para sobreescribir) y resetea flags.
  const persistInsert = async (datos: Record<string, unknown>, deleteIds?: number[]) => {
    try {
      if (deleteIds && deleteIds.length) {
        const { error: delErr } = await supabase.from("planillas_reserva").delete().in("id", deleteIds);
        if (delErr) throw delErr;
      }
      const { error } = await supabase.from("planillas_reserva").insert([{ fecha, datos }]);
      if (error) throw error;
      toast.success(deleteIds?.length ? "Informe sobreescrito correctamente" : "Planilla guardada correctamente", { duration: 1500 });
      setFechaDuplicada(false);
      setDirty(false);
      if (userId) await markUpdated(REMINDER_KEY, REMINDER_NAME, userId).catch(() => {});
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Error al guardar");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const handleSave = async () => {
    // Guard síncrono: evita el doble guardado por doble click (la condición
    // disabled del botón se aplica recién en el próximo render).
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    const datos = buildDatos();
    try {
      // ¿Ya existe un informe para esta fecha + zona?
      const { data: existentes, error: qErr } = await supabase
        .from("planillas_reserva")
        .select("id, datos")
        .eq("fecha", fecha);
      if (qErr) throw qErr;
      const mismos = (existentes ?? []).filter(p => (p.datos?.deposito ?? "") === deposito);
      if (mismos.length > 0) {
        // Pedir confirmación: sobreescribir o descartar.
        setOverwriteInfo({ ids: mismos.map(p => p.id as number), datos, count: mismos.length });
        setSaving(false);
        savingRef.current = false;
        return;
      }
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Error al verificar duplicados");
      setSaving(false);
      savingRef.current = false;
      return;
    }

    await persistInsert(datos);
  };

  const handleOverwrite = async () => {
    if (!overwriteInfo) return;
    const { ids, datos } = overwriteInfo;
    setOverwriteInfo(null);
    savingRef.current = true;
    setSaving(true);
    await persistInsert(datos, ids);
  };

  const handleCancelOverwrite = () => setOverwriteInfo(null);

  // ── Render ──────────────────────────────────────────────────────────────────

  const groupHeaderCls = "text-center text-[9.5px] font-bold tracking-[.08em] uppercase pb-1.5 border-b-2";
  const colHeaderCls   = "text-center text-[9px] font-bold tracking-[.06em] uppercase text-muted-foreground";

  return (
    <div className="space-y-4">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => setConfigOpen(true)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
        >
          <BellRing className="w-3.5 h-3.5" /> Recordatorio
        </button>
      </div>

      {fechaDuplicada && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-2.5 text-sm text-amber-300">
          <span>⚠</span>
          <span>Ya existe un informe guardado para esta fecha y zona. Al guardar vas a poder sobreescribirlo.</span>
        </div>
      )}

      {/* ── Card: grilla unificada editable (el card entero acepta drop de archivos) ── */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFileChange(f);
        }}
        className={cn(
          "bg-secondary/30 border rounded-[10px] shadow-sm overflow-hidden transition-colors",
          dragging ? "border-accent" : "border-border"
        )}
      >

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <p className="text-[13px] font-bold tracking-wide text-foreground">
              RESERVA DE TRANSFORMADORES DE DISTRIBUCIÓN{" "}
              <span className="text-muted-foreground font-medium">(13,2/0,4 — 33/0,4 KV)</span>
            </p>
            <div className="text-[10.5px] text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
              <span>ÁREA TÉCNICA — DPTO. TRANSFORMADORES —</span>
              <input
                type="date"
                value={fecha}
                onChange={e => { setFecha(e.target.value); setDirty(true); }}
                className="bg-panel-input border border-border rounded px-1.5 py-0.5 text-[10.5px] text-foreground focus:outline-none focus:border-accent"
              />
              <span>—</span>
              <select
                value={deposito}
                onChange={e => { setDeposito(e.target.value); setDirty(true); }}
                className="bg-panel-input border border-border rounded px-1.5 py-0.5 text-[10.5px] text-foreground focus:outline-none focus:border-accent"
              >
                {ZONAS.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <span>· TIPO: RURAL</span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer select-none">
              <Switch
                checked={hideZeros}
                onCheckedChange={setHideZeros}
                className="data-[state=checked]:bg-accent"
              />
              Ocultar filas en 0
              {hideZeros && <span className="text-[10px] text-muted-foreground/60">({hiddenCount} ocultas)</span>}
            </label>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={analyzing}
              className="flex items-center gap-1.5 px-3.5 py-[7px] rounded-[7px] bg-accent/10 border border-accent/40 text-accent-green text-[11.5px] font-semibold hover:bg-accent/20 disabled:opacity-50 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" /> Importar Excel
            </button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }} />

        {/* Archivo cargado (flujo de importación existente) */}
        {archivo && (
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-secondary/40">
            {analyzing
              ? <Loader2 className="w-4 h-4 text-accent shrink-0 animate-spin" />
              : <FileText className="w-4 h-4 text-accent shrink-0" />
            }
            <span className="flex-1 text-xs text-foreground truncate">{archivo.name}</span>
            {analyzing
              ? <span className="text-xs text-accent whitespace-nowrap">Procesando…</span>
              : <>
                  <button
                    onClick={() => analyzeFile(archivo)}
                    className="flex items-center gap-1.5 text-xs text-accent hover:underline whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Procesar de nuevo
                  </button>
                  <button onClick={() => { setArchivo(null); if (fileRef.current) fileRef.current.value = ""; }}
                    className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </>
            }
          </div>
        )}

        {/* Contenido con scroll horizontal en pantallas chicas */}
        <div className="overflow-x-auto">
        <div className="min-w-[1080px]">

        {/* Encabezado de grupos */}
        <div className="grid px-5 mt-4" style={{ gridTemplateColumns: GRID_COLS }}>
          <div />
          <div className={cn(groupHeaderCls, "text-muted-foreground border-foreground/15")} style={{ gridColumn: "2/6" }}>
            Nuevos y Rep. por Terceros
          </div>
          <div />
          <div className={cn(groupHeaderCls, "text-muted-foreground border-foreground/15")} style={{ gridColumn: "7/11" }}>
            Reparados por Taller
          </div>
          <div />
          <div className={cn(groupHeaderCls, "text-accent-green border-accent/40")} style={{ gridColumn: "12/15" }}>
            Totales
          </div>
        </div>

        {/* Encabezado de columnas */}
        <div className="grid px-5 pt-2 pb-1" style={{ gridTemplateColumns: GRID_COLS }}>
          <div className={cn(colHeaderCls, "text-left")}>Pot. KVA</div>
          <div className={colHeaderCls}>T</div>
          <div className={colHeaderCls}>M</div>
          <div className={colHeaderCls}>C/Tanque</div>
          <div className={colHeaderCls}>Total</div>
          <div />
          <div className={colHeaderCls}>T</div>
          <div className={colHeaderCls}>M</div>
          <div className={colHeaderCls}>C/Tanque</div>
          <div className={colHeaderCls}>Total</div>
          <div />
          <div className={colHeaderCls}>Trafos</div>
          <div className={colHeaderCls}>Aut. p/Retiro</div>
          <div className={colHeaderCls}>Disponibles</div>
        </div>

        {/* Filas de datos */}
        {visibleRows.length === 0 && (
          <div className="px-5 py-8 text-center text-xs text-muted-foreground border-t border-hairline">
            Todas las filas están en 0 — desactivá &quot;Ocultar filas en 0&quot; para editarlas o importá un Excel.
          </div>
        )}
        {visibleRows.map(p => {
          const r3     = terceros[p];
          const ta     = taller[p];
          const terc   = sum(r3);
          const tall   = sum(ta);
          const trafos = terc + tall;
          const aut    = autorizados[p];
          const disp   = Math.max(0, trafos - aut);

          return (
            <div
              key={p}
              className={cn("grid items-center px-5 py-[3px] border-t border-hairline", disp > 0 && "bg-accent/5")}
              style={{ gridTemplateColumns: GRID_COLS }}
            >
              <div className="text-xs font-bold text-foreground">{p}</div>

              <div className="px-1.5 py-[3px]"><EInput val={r3.t}  onChange={v => setT(p, "t",  v)} /></div>
              <div className="px-1.5 py-[3px]"><EInput val={r3.m}  onChange={v => setT(p, "m",  v)} /></div>
              <div className="px-1.5 py-[3px]"><EInput val={r3.ct} onChange={v => setT(p, "ct", v)} /></div>
              <div className="text-center text-xs text-muted-foreground">{terc || "–"}</div>
              <div />

              <div className="px-1.5 py-[3px]"><EInput val={ta.t}  onChange={v => setTANum(p, "t",  v)} /></div>
              <div className="px-1.5 py-[3px]"><EInput val={ta.m}  onChange={v => setTANum(p, "m",  v)} /></div>
              <div className="px-1.5 py-[3px]"><EInput val={ta.ct} onChange={v => setTANum(p, "ct", v)} /></div>
              <div className="text-center text-xs text-muted-foreground">{tall || "–"}</div>
              <div />

              <div className="text-center text-[12.5px] font-extrabold text-foreground">{trafos || "–"}</div>
              <div className="px-1.5 py-[3px]">
                <EInput val={aut} onChange={v => setAuto(p, v)} valueClass={aut > 0 ? "text-accent-amber" : "text-muted-foreground/60"} />
              </div>
              <div className="flex justify-center">
                <span className={cn(
                  "min-w-[34px] text-center text-xs font-extrabold px-2 py-1 rounded-md",
                  disp > 0 ? "bg-accent/15 text-accent-green" : "bg-secondary/40 text-muted-foreground/50"
                )}>
                  {disp || "–"}
                </span>
              </div>
            </div>
          );
        })}

        {/* ── Relación 33 + Observaciones + Pendientes ── */}
        <div className="grid grid-cols-[440px_1fr] gap-5 px-5 pt-6 pb-4 border-t border-hairline mt-3">

          {/* Relación 33/0,4 kV */}
          <div>
            <p className="text-[9px] font-bold text-center text-muted-foreground mb-1 uppercase tracking-wider">
              Relación 33/0,4 KV
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <TH rs={2}>Pot. KVA</TH>
                  <TH cs={2}>Trafos Nuevos</TH>
                  <TH cs={2}>Trafos Reparados</TH>
                </tr>
                <tr>
                  <TH>T</TH><TH>M</TH>
                  <TH>T</TH><TH>M</TH>
                </tr>
              </thead>
              <tbody>
                {POT_33.map(p => {
                  const r = rel33[p];
                  return (
                    <tr key={p} className="hover:bg-secondary/40 transition-colors">
                      <TD c="font-semibold text-foreground">{p}</TD>
                      <TD><EInput val={r.tN} onChange={v => setR(p, "tN", v)} /></TD>
                      <TD><EInput val={r.mN} onChange={v => setR(p, "mN", v)} /></TD>
                      <TD><EInput val={r.tR} onChange={v => setR(p, "tR", v)} /></TD>
                      <TD><EInput val={r.mR} onChange={v => setR(p, "mR", v)} /></TD>
                    </tr>
                  );
                })}
                <tr className="bg-panel-header font-bold">
                  <td className="px-1 py-1 border border-border text-[9px] font-bold text-foreground text-center">TOTAL</td>
                  <td colSpan={2} className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{tot33N || "—"}</td>
                  <td colSpan={2} className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{tot33R || "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Observaciones + Pendientes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                Observaciones (13,2/0,4 KV)
              </p>
              <textarea
                value={obs}
                onChange={e => { setObs(e.target.value); setDirty(true); }}
                placeholder="Ingrese observaciones…"
                className="flex-1 min-h-[120px] rounded-lg bg-panel-input border border-border px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent resize-none transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                Pendientes de Entregas
              </p>
              <textarea
                value={pend}
                onChange={e => { setPend(e.target.value); setDirty(true); }}
                placeholder="Ingrese pendientes…"
                className="flex-1 min-h-[120px] rounded-lg bg-panel-input border border-border px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent resize-none transition-colors"
              />
            </div>
          </div>
        </div>

        </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border">
          <div className="flex items-center gap-[22px] text-xs text-muted-foreground">
            <span>Total: <strong className="text-foreground">{totGeneral}</strong></span>
            <span>Autorizados: <strong className="text-accent-amber">{totAuto}</strong></span>
            <span>Disponibles: <strong className="text-accent-green">{totDisp}</strong></span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[7px] border border-destructive/40 text-accent-red text-[11.5px] font-semibold hover:bg-destructive/10 transition-colors"
            >
              <Eraser className="w-3.5 h-3.5" /> Limpiar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="flex items-center gap-2 px-[18px] py-2 rounded-[7px] bg-accent text-accent-foreground text-[11.5px] font-bold hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {saving
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando…</>
                : <><CheckCircle2 className="w-3.5 h-3.5" /> Guardar cambios</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* ── Confirmación de sobreescritura (portal) ── */}
      {overwriteInfo && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleCancelOverwrite} />
          <div className="relative bg-popover border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="grid place-items-center w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 text-accent-amber shrink-0">
                <span className="text-lg font-bold">!</span>
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">Ya existe un informe para esta fecha</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Hay {overwriteInfo.count > 1 ? `${overwriteInfo.count} informes` : "un informe"} guardado{overwriteInfo.count > 1 ? "s" : ""} para
                  el <span className="text-foreground font-medium">{fecha.split("-").reverse().join("/")}</span>
                  {deposito && <> en <span className="text-foreground font-medium">{deposito}</span></>}.
                  ¿Querés sobreescribir{overwriteInfo.count > 1 ? "los" : "lo"} o descartar este guardado?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={handleCancelOverwrite}
                className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground border border-border hover:bg-secondary transition-colors"
              >
                Descartar
              </button>
              <button
                onClick={handleOverwrite}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" /> Sobreescribir
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Reminder config dialog (portal) ── */}
      {configOpen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfigOpen(false)} />
          <div className="relative bg-popover border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">Recordatorio · Transformadores</h3>
              <button onClick={() => setConfigOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingConfig ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Cargando…</div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Frecuencia de actualización</p>
                  <div className="flex gap-2 flex-wrap">
                    {[1, 7, 14, 30].map(d => (
                      <button key={d} onClick={() => setReminderFreq(d)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${reminderFreq === d ? "bg-accent text-accent-foreground border-accent" : "bg-secondary border-border text-muted-foreground hover:text-foreground"}`}>
                        {d === 1 ? "Diario" : d === 7 ? "Semanal" : d === 14 ? "Quincenal" : "Mensual"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => setReminderFreq(v => Math.max(1, v - 1))}
                      className="w-7 h-7 rounded-md bg-secondary border border-border text-sm text-muted-foreground hover:text-foreground flex items-center justify-center">−</button>
                    <span className="text-sm text-foreground w-24 text-center">
                      {reminderFreq === 1 ? "Cada 1 día" : `Cada ${reminderFreq} días`}
                    </span>
                    <button onClick={() => setReminderFreq(v => v + 1)}
                      className="w-7 h-7 rounded-md bg-secondary border border-border text-sm text-muted-foreground hover:text-foreground flex items-center justify-center">+</button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hora del recordatorio</p>
                  <input type="time" value={reminderTime} onChange={e => setReminderTime(e.target.value)}
                    className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent w-full" />
                </div>

                {reminderLastUpd && (
                  <p className="text-xs text-muted-foreground">
                    Última carga: {new Date(reminderLastUpd).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                )}

                <button onClick={saveConfig} disabled={savingConfig}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
                  {savingConfig ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</> : "Guardar recordatorio"}
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
