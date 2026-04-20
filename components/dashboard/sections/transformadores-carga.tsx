"use client";

import React, { useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { UploadCloud, FileText, X, Loader2, CheckCircle2, Sparkles } from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const POT_13 = [5, 10, 16, 25, 50, 63, 80, 100, 125, 160, 200, 250, 315, 500, 630, 800, 1000];
const POT_33 = [25, 63, 160, 315, 500, 630];

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrafoRow  { t: number; m: number; ct: number }          // ct = con tanque
interface TallerRow { tipo: string; t: number; m: number; ct: number }
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
  extracted: Record<string, Partial<TallerRow>>,
  keys: number[]
): Record<number, TallerRow> {
  const next = { ...prev };
  for (const p of keys) {
    const val = extracted[p] ?? extracted[String(p)];
    if (val !== undefined) next[p] = { ...prev[p], ...val };
  }
  return next;
}

function init13Trafo()  { return Object.fromEntries(POT_13.map(p => [p, { t: 0, m: 0, ct: 0  }])) as Record<number, TrafoRow>; }
function init13Taller() { return Object.fromEntries(POT_13.map(p => [p, { tipo: "", t: 0, m: 0, ct: 0 }])) as Record<number, TallerRow>; }
function init13Auto()   { return Object.fromEntries(POT_13.map(p => [p, 0])) as Record<number, number>; }
function init33()       { return Object.fromEntries(POT_33.map(p => [p, { tN: 0, mN: 0, tR: 0, mR: 0 }])) as Record<number, Rel33Row>; }

// ─── Micro-components ─────────────────────────────────────────────────────────

function NI({ val, onChange }: { val: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number" min={0}
      value={val === 0 ? "" : val}
      placeholder="—"
      onChange={e => onChange(Math.max(0, parseInt(e.target.value) || 0))}
      className="w-11 h-6 text-center rounded border border-border bg-background text-xs text-foreground focus:outline-none focus:border-accent transition-colors"
    />
  );
}

function TH({ c, rs, cs, children }: { c?: string; rs?: number; cs?: number; children: React.ReactNode }) {
  return (
    <th rowSpan={rs} colSpan={cs}
      className={`px-1 py-1.5 text-[9px] font-bold text-muted-foreground border border-border bg-secondary/60 uppercase tracking-wide leading-tight ${c ?? ""}`}>
      {children}
    </th>
  );
}

function TD({ c, children }: { c?: string; children: React.ReactNode }) {
  return (
    <td className={`px-1 py-[3px] text-xs border border-border text-center ${c ?? ""}`}>
      {children}
    </td>
  );
}

function TotalRow({ label, span, values }: { label: string; span?: number; values: (string | number | React.ReactNode)[] }) {
  return (
    <tr className="bg-secondary/60 font-bold">
      <td colSpan={span ?? 1} className="px-1 py-1 border border-border text-[10px] font-bold text-foreground text-center">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{v || "—"}</td>
      ))}
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TransformadoresCargaSection() {
  const fecha                       = new Date().toISOString().split("T")[0];
  const [archivo, setArchivo]       = useState<File | null>(null);
  const [dragging, setDragging]     = useState(false);
  const [terceros, setTerceros]     = useState<Record<number, TrafoRow>>(init13Trafo);
  const [taller, setTaller]         = useState<Record<number, TallerRow>>(init13Taller);
  const [autorizados, setAutorizados] = useState<Record<number, number>>(init13Auto);
  const [rel33, setRel33]           = useState<Record<number, Rel33Row>>(init33);
  const [obs, setObs]               = useState("");
  const [pend, setPend]             = useState("");
  const [saving, setSaving]         = useState(false);
  const [analyzing, setAnalyzing]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── File selection + auto-analyze ───────────────────────────────────────────

  const handleFileChange = async (file: File) => {
    setArchivo(file);
    await analyzeFile(file);
  };

  const analyzeFile = async (file: File) => {
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/analizar-planilla", { method: "POST", body: fd });
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

      toast.success("Excel cargado y datos procesados");
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "No se pudo analizar el archivo");
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Updaters ────────────────────────────────────────────────────────────────

  const setT = (p: number, f: keyof TrafoRow, v: number) =>
    setTerceros(prev => ({ ...prev, [p]: { ...prev[p], [f]: v } }));

  const setTAStr = (p: number, v: string) =>
    setTaller(prev => ({ ...prev, [p]: { ...prev[p], tipo: v } }));

  const setTANum = (p: number, f: keyof Omit<TallerRow, "tipo">, v: number) =>
    setTaller(prev => ({ ...prev, [p]: { ...prev[p], [f]: v } }));

  const setAuto = (p: number, v: number) =>
    setAutorizados(prev => ({ ...prev, [p]: v }));

  const setR = (p: number, f: keyof Rel33Row, v: number) =>
    setRel33(prev => ({ ...prev, [p]: { ...prev[p], [f]: v } }));

  // ── Computed totals ─────────────────────────────────────────────────────────

  const totTerceros = POT_13.reduce((s, p) => s + sum(terceros[p]), 0);
  const totTaller   = POT_13.reduce((s, p) => s + sum(taller[p]), 0);
  const totGeneral  = totTerceros + totTaller;
  const totAuto     = POT_13.reduce((s, p) => s + autorizados[p], 0);
  const totDisp     = totGeneral - totAuto;
  const tot33N      = POT_33.reduce((s, p) => s + rel33[p].tN + rel33[p].mN, 0);
  const tot33R      = POT_33.reduce((s, p) => s + rel33[p].tR + rel33[p].mR, 0);

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      let archivo_url: string | null = null;
      if (archivo) {
        const ext = archivo.name.split(".").pop();
        const path = `planillas/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("imagenes")
          .upload(path, archivo, { upsert: true });
        if (upErr) throw upErr;
        archivo_url = supabase.storage.from("imagenes").getPublicUrl(path).data.publicUrl;
      }
      const datos = { terceros, taller, autorizados, rel33, obs, pend };
      const { error } = await supabase
        .from("planillas_reserva")
        .insert([{ fecha, archivo_url, datos }]);
      if (error) throw error;
      toast.success("Planilla guardada correctamente");
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
        <div className="bg-card border border-border rounded-xl px-5 py-3 shadow-sm flex items-center gap-3">
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
              {dragging ? "Soltá el Excel aquí" : "Arrastrá el Excel o hacé clic para seleccionarlo"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Archivo Excel (.xlsx)</p>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }} />

      {/* ── Planilla ── */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">

        {/* Title */}
        <div className="border-b border-border bg-secondary/40 px-4 py-3 text-center">
          <p className="text-xs font-bold text-foreground tracking-wide">
            RESERVA DE TRANSFORMADORES DE DISTRIBUCIÓN (RELAC: 13,2/0,4 — 33/0,4 KV)
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            ÁREA TÉCNICA — DPTO. TRANSFORMADORES — GCIA. TRANSMISIÓN
          </p>
        </div>

        <div className="p-4 space-y-5 overflow-x-auto">

          {/* ── Row 1: Terceros + Taller + Resumen ── */}
          <div className="flex gap-3 min-w-[800px]">

            {/* Table A: Nuevos y Reparados por Terceros */}
            <div className="flex-1">
              <p className="text-[9px] font-bold text-center text-muted-foreground mb-1 uppercase tracking-wider">
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
                      <tr key={p} className={`hover:bg-secondary/20 transition-colors ${tot > 0 ? "bg-accent/5" : ""}`}>
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
                  <TotalRow label="TOTAL" span={4} values={[totTerceros]} />
                </tbody>
              </table>
            </div>

            {/* Table B: Reparados por Taller */}
            <div className="flex-1">
              <p className="text-[9px] font-bold text-center text-muted-foreground mb-1 uppercase tracking-wider">
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
                      <tr key={p} className={`hover:bg-secondary/20 transition-colors ${tot > 0 ? "bg-accent/5" : ""}`}>
                        <TD>
                          <select value={r.tipo} onChange={e => setTAStr(p, e.target.value)}
                            className="w-14 h-6 rounded border border-border bg-background text-[9px] text-foreground focus:outline-none focus:border-accent transition-colors">
                            <option value="">—</option>
                            <option value="RURAL">RURAL</option>
                          </select>
                        </TD>
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
                  <TotalRow label="TOTAL" span={5} values={[totTaller]} />
                </tbody>
              </table>
            </div>

            {/* Table C: Resumen */}
            <div className="w-[210px] shrink-0">
              <p className="text-[9px] font-bold text-center text-muted-foreground mb-1 uppercase tracking-wider">
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
                    const tot  = sum(terceros[p]) + sum(taller[p]);
                    const auto = autorizados[p];
                    const disp = Math.max(0, tot - auto);
                    return (
                      <tr key={p} className="hover:bg-secondary/20 transition-colors">
                        <TD c="text-[9px]">{taller[p].tipo || "—"}</TD>
                        <TD c={tot > 0 ? "text-foreground font-semibold" : "text-muted-foreground"}>
                          {tot || "—"}
                        </TD>
                        <TD>
                          <NI val={auto} onChange={v => setAuto(p, v)} />
                        </TD>
                        <TD c={disp > 0 ? "text-green-400 font-bold" : "text-muted-foreground"}>
                          {disp || "—"}
                        </TD>
                      </tr>
                    );
                  })}
                  <tr className="bg-secondary/60 font-bold">
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
          <div className="flex gap-5 min-w-[800px]">

            {/* Table D: Relación 33/0,4 kV */}
            <div className="w-[300px] shrink-0">
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
                      <tr key={p} className="hover:bg-secondary/20 transition-colors">
                        <TD c="font-semibold text-foreground">{p}</TD>
                        <TD><NI val={r.tN} onChange={v => setR(p, "tN", v)} /></TD>
                        <TD><NI val={r.mN} onChange={v => setR(p, "mN", v)} /></TD>
                        <TD><NI val={r.tR} onChange={v => setR(p, "tR", v)} /></TD>
                        <TD><NI val={r.mR} onChange={v => setR(p, "mR", v)} /></TD>
                      </tr>
                    );
                  })}
                  <tr className="bg-secondary/60 font-bold">
                    <td className="px-1 py-1 border border-border text-[9px] font-bold text-foreground text-center">TOTAL</td>
                    <td colSpan={2} className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{tot33N || "—"}</td>
                    <td colSpan={2} className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{tot33R || "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Observaciones + Pendientes */}
            <div className="flex-1 grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                  Observaciones (13,2/0,4 KV)
                </p>
                <textarea
                  value={obs}
                  onChange={e => setObs(e.target.value)}
                  placeholder="Ingrese observaciones…"
                  className="flex-1 min-h-[120px] rounded-lg bg-secondary border border-border px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent resize-none transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                  Pendientes de Entregas
                </p>
                <textarea
                  value={pend}
                  onChange={e => setPend(e.target.value)}
                  placeholder="Ingrese pendientes…"
                  className="flex-1 min-h-[120px] rounded-lg bg-secondary border border-border px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent resize-none transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3 flex items-center justify-between bg-secondary/20">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Total: <strong className="text-accent">{totGeneral}</strong></span>
            <span>Autorizados: <strong className="text-amber-400">{totAuto}</strong></span>
            <span>Disponibles: <strong className="text-green-400">{totDisp}</strong></span>
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
