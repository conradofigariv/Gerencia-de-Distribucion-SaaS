"use client";

import React, { useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { UploadCloud, FileText, X, Loader2, CheckCircle2, Sparkles } from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const POT_13 = [5, 10, 16, 25, 50, 63, 80, 100, 125, 160, 200, 250, 315, 500, 630, 800, 1000];
const POT_33 = [25, 63, 160, 250, 315, 500, 630];
const RURAL_KVA = new Set([5, 10, 16, 25]);

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
function init13Total() { return Object.fromEntries(POT_13.map(p => [p, 0])) as Record<number, number>; }
function init13Auto()   { return Object.fromEntries(POT_13.map(p => [p, 0])) as Record<number, number>; }
function init33()       { return Object.fromEntries(POT_33.map(p => [p, { tN: 0, mN: 0, tR: 0, mR: 0 }])) as Record<number, Rel33Row>; }

// ─── Micro-components ─────────────────────────────────────────────────────────

function NI({ val, onChange }: { val: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-1 mx-auto bg-slate-900 border border-slate-700 rounded w-fit">
      <button
        onClick={() => onChange(Math.max(0, val - 1))}
        className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
      >
        −
      </button>
      <span className="w-7 text-center text-xs text-slate-200 select-none">{val || "0"}</span>
      <button
        onClick={() => onChange(val + 1)}
        className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
      >
        +
      </button>
    </div>
  );
}

function TH({ c, rs, cs, children }: { c?: string; rs?: number; cs?: number; children: React.ReactNode }) {
  return (
    <th rowSpan={rs} colSpan={cs}
      className={`px-0.5 py-1 text-[8px] font-bold text-slate-300 border border-slate-700 bg-slate-700/50 uppercase tracking-wide leading-tight ${c ?? ""}`}>
      {children}
    </th>
  );
}

function TD({ c, children }: { c?: string; children: React.ReactNode }) {
  return (
    <td className={`px-0.5 py-1 text-[10px] border border-slate-700 text-center text-slate-300 ${c ?? ""}`}>
      {children}
    </td>
  );
}

function TotalRow({ label, span, values }: { label: string; span?: number; values: (string | number | React.ReactNode)[] }) {
  return (
    <tr className="bg-slate-700/50 font-bold">
      <td colSpan={span ?? 1} className="px-1 py-1 border border-slate-700 text-[10px] font-bold text-slate-300 text-center">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-1 py-1 border border-slate-700 text-xs text-center text-blue-400 font-bold">{v || "—"}</td>
      ))}
    </tr>
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
  // Everything after the date and a separator (–, -, space) until .pdf
  const m = name.match(/\d{2}[-/]\d{2}[-/]\d{2,4}\s*[–\-]\s*(.+?)(?:\.[^.]+)?$/i);
  return m ? m[1].trim() : "";
}

export function TransformadoresCargaSection() {
  const [fecha, setFecha]           = useState<string>(new Date().toISOString().split("T")[0]);
  const [deposito, setDeposito]     = useState<string>("");
  const [archivo, setArchivo]       = useState<File | null>(null);
  const [dragging, setDragging]     = useState(false);
  const [terceros, setTerceros]     = useState<Record<number, TrafoRow>>(init13Trafo);
  const [taller, setTaller]         = useState<Record<number, TallerRow>>(init13Taller);
  const [autorizados, setAutorizados] = useState<Record<number, number>>(init13Auto);
  const [totales, setTotales]       = useState<Record<number, number>>(init13Total);
  const [rel33, setRel33]           = useState<Record<number, Rel33Row>>(init33);
  const [obs, setObs]               = useState("");
  const [pend, setPend]             = useState("");
  const [saving, setSaving]         = useState(false);
  const [analyzing, setAnalyzing]   = useState(false);
  const [fechaDuplicada, setFechaDuplicada] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── File selection + auto-analyze ───────────────────────────────────────────

  const handleFileChange = async (file: File) => {
    setArchivo(file);
    const f = extractDateFromFilename(file.name);
    setFecha(f);
    setDeposito(extractDepositoFromFilename(file.name));
    const { data } = await supabase.from("planillas_reserva").select("id").eq("fecha", f).limit(1);
    setFechaDuplicada(!!(data && data.length > 0));
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
      // Totales: compute from extracted terceros + taller
      if (d.terceros || d.taller) {
        setTotales(prev => {
          const next = { ...prev };
          for (const p of POT_13) {
            const t3 = d.terceros?.[p] ?? d.terceros?.[String(p)];
            const ta = d.taller?.[p]   ?? d.taller?.[String(p)];
            const t3sum = t3 ? (Number(t3.t ?? 0) + Number(t3.m ?? 0)) : 0;
            const tasum = ta ? (Number(ta.t ?? 0) + Number(ta.m ?? 0)) : 0;
            if (t3sum + tasum > 0) next[p] = t3sum + tasum;
          }
          return next;
        });
      }
      if (d.rel33)       setRel33(prev => mergeMap(prev, d.rel33, POT_33));
      if (d.obs)        setObs(d.obs);
      if (d.pend)       setPend(d.pend);

      toast.success("Planilla cargada y datos procesados", { duration: 1000 });
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "No se pudo analizar el archivo");
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Updaters ────────────────────────────────────────────────────────────────

  const setT = (p: number, f: keyof TrafoRow, v: number) =>
    setTerceros(prev => ({ ...prev, [p]: { ...prev[p], [f]: v } }));

  const setTANum = (p: number, f: keyof TallerRow, v: number) =>
    setTaller(prev => ({ ...prev, [p]: { ...prev[p], [f]: v } }));

  const setTot = (p: number, v: number) =>
    setTotales(prev => ({ ...prev, [p]: v }));

  const setAuto = (p: number, v: number) =>
    setAutorizados(prev => ({ ...prev, [p]: v }));

  const setR = (p: number, f: keyof Rel33Row, v: number) =>
    setRel33(prev => ({ ...prev, [p]: { ...prev[p], [f]: v } }));

  // ── Computed totals ─────────────────────────────────────────────────────────

  const totGeneral  = POT_13.reduce((s, p) => s + totales[p], 0);
  const totAuto     = POT_13.reduce((s, p) => s + autorizados[p], 0);
  const totDisp     = totGeneral - totAuto;
  const tot33N      = POT_33.reduce((s, p) => s + rel33[p].tN + rel33[p].mN, 0);
  const tot33R      = POT_33.reduce((s, p) => s + rel33[p].tR + rel33[p].mR, 0);

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      const datos = { terceros, taller, totales, autorizados, rel33, obs, pend, deposito };
      const { error } = await supabase
        .from("planillas_reserva")
        .insert([{ fecha, datos }]);
      if (error) throw error;
      toast.success("Planilla guardada correctamente", { duration: 1000 });
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Drop zone ── */}
      {archivo ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl px-5 py-3 shadow-sm flex items-center gap-3">
          {analyzing
            ? <Loader2 className="w-5 h-5 text-accent shrink-0 animate-spin" />
            : <FileText className="w-5 h-5 text-accent shrink-0" />
          }
          <span className="flex-1 text-sm text-foreground truncate">{archivo.name}</span>
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
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFileChange(f);
          }}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 flex flex-col items-center gap-3 transition-colors ${
            dragging ? "border-accent bg-accent/10" : "border-border hover:border-accent hover:bg-accent/5"
          }`}
        >
          <UploadCloud className={`w-10 h-10 transition-colors ${dragging ? "text-accent" : "text-muted-foreground"}`} />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              {dragging ? "Soltá el archivo aquí" : "Arrastrá el archivo o hacé clic para seleccionarlo"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Excel (.xlsx) o PDF (.pdf)</p>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }} />

      {/* ── Planilla ── */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl shadow-sm overflow-hidden">

        {/* Title */}
        <div className="border-b border-slate-700 bg-slate-700/30 px-4 py-3 text-center">
          <p className="text-xs font-bold text-slate-300 tracking-wide">
            RESERVA DE TRANSFORMADORES DE DISTRIBUCIÓN (RELAC: 13,2/0,4 — 33/0,4 KV)
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            ÁREA TÉCNICA — DPTO. TRANSFORMADORES — GCIA. TRANSMISIÓN
          </p>
        </div>

        <div className="p-4 space-y-5">

          {/* ── Row 1: Terceros + Taller + Resumen ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

            {/* Table A: Nuevos y Reparados por Terceros */}
            <div className="flex-1">
              <p className="text-[9px] font-bold text-center text-slate-300 mb-1 uppercase tracking-wider">
                Nuevos y Reparados por Terceros
              </p>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <TH>Pot. KVA</TH>
                    <TH>T</TH><TH>M</TH><TH c="leading-[1.1]">C/<br/>Tanque</TH>
                    <TH>Total</TH>
                  </tr>
                </thead>
                <tbody>
                  {POT_13.map(p => {
                    const r = terceros[p]; const tot = sum(r);
                    return (
                      <tr key={p} className={`hover:bg-blue-600/10 transition-colors ${tot > 0 ? "bg-blue-600/5" : ""}`}>
                        <TD c="font-semibold text-foreground">{p}</TD>
                        <TD><NI val={r.t}  onChange={v => setT(p, "t",  v)} /></TD>
                        <TD><NI val={r.m}  onChange={v => setT(p, "m",  v)} /></TD>
                        <TD><NI val={r.ct} onChange={v => setT(p, "ct", v)} /></TD>
                        <TD c={tot > 0 ? "font-bold text-accent" : "text-muted-foreground"}>
                          {tot || "—"}
                        </TD>
                      </tr>
                    );
                  })}
                  <TotalRow label="TOTAL" span={4} values={[POT_13.reduce((s,p)=>s+sum(terceros[p]),0)]} />
                </tbody>
              </table>
            </div>

            {/* Table B: Reparados por Taller */}
            <div className="flex-1">
              <p className="text-[9px] font-bold text-center text-slate-300 mb-1 uppercase tracking-wider">
                Reparados por Taller de Transformadores
              </p>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <TH>Tipo</TH><TH>Pot. KVA</TH>
                    <TH>T</TH><TH>M</TH><TH c="leading-[1.1]">C/<br/>Tanque</TH>
                    <TH>Total</TH>
                  </tr>
                </thead>
                <tbody>
                  {POT_13.map(p => {
                    const r = taller[p]; const tot = sum(r);
                    return (
                      <tr key={p} className={`hover:bg-blue-600/10 transition-colors ${tot > 0 ? "bg-blue-600/5" : ""}`}>
                        {RURAL_KVA.has(p)
                          ? <TD c="text-[9px] text-slate-400">RURAL</TD>
                          : <td className="px-0.5 py-1 text-[10px] text-center text-slate-300" />}
                        <TD c="font-semibold text-foreground">{p}</TD>
                        <TD><NI val={r.t}  onChange={v => setTANum(p, "t",  v)} /></TD>
                        <TD><NI val={r.m}  onChange={v => setTANum(p, "m",  v)} /></TD>
                        <TD><NI val={r.ct} onChange={v => setTANum(p, "ct", v)} /></TD>
                        <TD c={tot > 0 ? "font-bold text-accent" : "text-muted-foreground"}>
                          {tot || "—"}
                        </TD>
                      </tr>
                    );
                  })}
                  <TotalRow label="TOTAL" span={5} values={[POT_13.reduce((s,p)=>s+sum(taller[p]),0)]} />
                </tbody>
              </table>
            </div>

            {/* Table C: Resumen */}
            <div>
              <p className="text-[9px] font-bold text-center text-slate-300 mb-1 uppercase tracking-wider">
                Total de Transformadores
              </p>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <TH>Tipo</TH>
                    <TH c="leading-[1.1]">Total<br/>Trafos</TH>
                    <TH c="leading-[1.1]">Autorizados<br/>p/Retiro</TH>
                    <TH c="leading-[1.1]">Disponibles<br/>p/Retiro</TH>
                  </tr>
                </thead>
                <tbody>
                  {POT_13.map(p => {
                    const tot  = totales[p];
                    const auto = autorizados[p];
                    const disp = Math.max(0, tot - auto);
                    return (
                      <tr key={p} className="hover:bg-slate-700/30 transition-colors">
                        {RURAL_KVA.has(p)
                          ? <TD c="text-[9px] text-slate-400">RURAL</TD>
                          : <td className="px-0.5 py-1 text-[10px] text-center text-slate-300" />}
                        <TD><NI val={tot} onChange={v => setTot(p, v)} /></TD>
                        <TD><NI val={auto} onChange={v => setAuto(p, v)} /></TD>
                        <TD c={disp > 0 ? "text-green-400 font-bold" : "text-muted-foreground"}>
                          {disp || "—"}
                        </TD>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-700/50 font-bold">
                    <td className="px-1 py-1 border border-border text-[9px] font-bold text-foreground text-center">TOTAL</td>
                    <td className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{totGeneral || "—"}</td>
                    <td className="px-1 py-1 border border-border text-xs text-center text-amber-400 font-bold">{totAuto || "—"}</td>
                    <td className="px-1 py-1 border border-border text-xs text-center text-green-400 font-bold">{totDisp || "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Row 2: Relación 33 + Observaciones + Pendientes ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

            {/* Table D: Relación 33/0,4 kV */}
            <div>
              <p className="text-[9px] font-bold text-center text-slate-300 mb-1 uppercase tracking-wider">
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
                      <tr key={p} className="hover:bg-slate-700/30 transition-colors">
                        <TD c="font-semibold text-foreground">{p}</TD>
                        <TD><NI val={r.tN} onChange={v => setR(p, "tN", v)} /></TD>
                        <TD><NI val={r.mN} onChange={v => setR(p, "mN", v)} /></TD>
                        <TD><NI val={r.tR} onChange={v => setR(p, "tR", v)} /></TD>
                        <TD><NI val={r.mR} onChange={v => setR(p, "mR", v)} /></TD>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-700/50 font-bold">
                    <td className="px-1 py-1 border border-border text-[9px] font-bold text-foreground text-center">TOTAL</td>
                    <td colSpan={2} className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{tot33N || "—"}</td>
                    <td colSpan={2} className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{tot33R || "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Observaciones + Pendientes */}
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <p className="text-[9px] font-bold text-slate-300 uppercase tracking-wider">
                  Observaciones (13,2/0,4 KV)
                </p>
                <textarea
                  value={obs}
                  onChange={e => setObs(e.target.value)}
                  placeholder="Ingrese observaciones…"
                  className="flex-1 min-h-[120px] rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-[9px] font-bold text-slate-300 uppercase tracking-wider">
                  Pendientes de Entregas
                </p>
                <textarea
                  value={pend}
                  onChange={e => setPend(e.target.value)}
                  placeholder="Ingrese pendientes…"
                  className="flex-1 min-h-[120px] rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 px-5 py-3 flex items-center justify-between bg-slate-700/30">
          <div className="flex items-center gap-4 text-xs text-slate-300">
            <span>Total: <strong className="text-blue-400">{totGeneral}</strong></span>
            <span>Autorizados: <strong className="text-amber-400">{totAuto}</strong></span>
            <span>Disponibles: <strong className="text-green-400">{totDisp}</strong></span>
            <span className="flex items-center gap-1.5">
              Fecha:
              <input
                type="date"
                value={fecha}
                onChange={e => setFecha(e.target.value)}
                className="bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-blue-400"
              />
              {fechaDuplicada && (
                <span className="text-amber-400 font-semibold">⚠ Ya existe un informe para esta fecha</span>
              )}
            </span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</>
              : <><CheckCircle2 className="w-4 h-4" /> Guardar planilla</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
