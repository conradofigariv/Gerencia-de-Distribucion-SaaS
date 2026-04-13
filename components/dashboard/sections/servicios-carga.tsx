"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ManualRow {
  id:        string;
  op:        string;
  opMadre:   string;
  linea:     string;
  matricula: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid       = () => Math.random().toString(36).slice(2);
const splitCol  = (t: string) => t.split(/\r?\n/).map(v => v.trim()).filter(v => v !== "");

const EMPTY_FORM = { op: "", opMadre: "", linea: "1", matricula: "" };

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ServiciosCargaSection() {
  const [rows, setRows]       = useState<ManualRow[]>([]);
  const [mode, setMode]       = useState<"single" | "bulk">("single");
  const [form, setForm]       = useState(EMPTY_FORM);
  const [errors, setErrors]   = useState<Partial<typeof EMPTY_FORM>>({});
  const [bulk, setBulk]       = useState({ op: "", opMadre: "", linea: "", matricula: "" });
  const [bulkErr, setBulkErr] = useState("");
  const [adding, setAdding]   = useState(false);

  // Cargar filas guardadas al montar
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("seguimiento")
        .select("id, op, op_madre, linea, matricula")
        .is("estado_de_plazo", null)
        .order("created_at", { ascending: true });
      if (error) { toast.error(`Error al cargar filas: ${error.message}`); return; }
      if (data && data.length > 0) {
        setRows(data.map(r => ({
          id:        r.id as string,
          op:        String(r.op ?? ""),
          opMadre:   String(r.op_madre ?? ""),
          linea:     String(r.linea ?? ""),
          matricula: String(r.matricula ?? ""),
        })));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Validación single
  const validate = () => {
    const e: Partial<typeof EMPTY_FORM> = {};
    if (!form.op.trim())        e.op        = "Requerido";
    if (!form.opMadre.trim())   e.opMadre   = "Requerido";
    if (!form.linea.trim())     e.linea     = "Requerido";
    if (!form.matricula.trim()) e.matricula = "Requerido";
    return e;
  };

  const handleAdd = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setAdding(true);
    try {
      const { data, error } = await supabase
        .from("seguimiento")
        .insert({ op: form.op.trim(), op_madre: form.opMadre.trim(), linea: form.linea.trim(), matricula: form.matricula.trim() })
        .select("id")
        .single();
      if (error) { toast.error(`Error: ${error.message}`); return; }
      setRows(prev => [...prev, { id: data.id as string, op: form.op.trim(), opMadre: form.opMadre.trim(), linea: form.linea.trim(), matricula: form.matricula.trim() }]);
      setForm(EMPTY_FORM);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("seguimiento").delete().eq("id", id);
    if (error) { toast.error(`Error: ${error.message}`); return; }
    setRows(prev => prev.filter(r => r.id !== id));
  };

  // ── Bulk paste
  const handleBulkAdd = async () => {
    setBulkErr("");
    const ops        = splitCol(bulk.op);
    const opMadres   = splitCol(bulk.opMadre);
    const lineas     = splitCol(bulk.linea);
    const matriculas = splitCol(bulk.matricula);

    if (!ops.length)        { setBulkErr("La columna OP está vacía.");        return; }
    if (!opMadres.length)   { setBulkErr("La columna OP MADRE está vacía.");  return; }
    if (!matriculas.length) { setBulkErr("La columna MATRÍCULA está vacía."); return; }
    const n = ops.length;
    if (opMadres.length !== n || matriculas.length !== n) {
      setBulkErr(`Columnas con distinto número de filas — OP: ${n}, OP MADRE: ${opMadres.length}, MATRÍCULA: ${matriculas.length}`);
      return;
    }
    const lineaFinal = lineas.length === n ? lineas : Array(n).fill("1");
    const newRows = ops.map((op, i) => ({ op, op_madre: opMadres[i], linea: lineaFinal[i], matricula: matriculas[i] }));

    setAdding(true);
    try {
      const { data, error } = await supabase.from("seguimiento").insert(newRows).select("id, op, op_madre, linea, matricula");
      if (error) { toast.error(`Error: ${error.message}`); return; }
      setRows(prev => [...prev, ...(data ?? []).map((r: { id: string; op: string; op_madre: string; linea: string; matricula: string }) => ({
        id: r.id, op: String(r.op ?? ""), opMadre: String(r.op_madre ?? ""), linea: String(r.linea ?? ""), matricula: String(r.matricula ?? ""),
      }))]);
      setBulk({ op: "", opMadre: "", linea: "", matricula: "" });
      setMode("single");
      toast.success(`${newRows.length} filas agregadas`);
    } finally {
      setAdding(false);
    }
  };

  const colCount = (t: string) => { const n = splitCol(t).length; return n > 0 ? `${n} fila${n !== 1 ? "s" : ""}` : ""; };

  const inputCls = (err?: string) => cn(
    "h-9 px-3 rounded-lg bg-secondary border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all",
    err ? "border-destructive" : "border-border focus:border-accent"
  );

  return (
    <div className="space-y-5">

      {/* Encabezado + toggle */}
      <div className="flex items-center gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Crear seguimiento</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{rows.length} fila{rows.length !== 1 ? "s" : ""} cargada{rows.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 ml-auto">
          {(["single", "bulk"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {m === "single" ? "Fila individual" : "Pegar columnas"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Single form ── */}
      {mode === "single" && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="grid grid-cols-4 gap-4 mb-4">
            {(["op", "opMadre", "linea", "matricula"] as const).map(key => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">
                  {key === "op" ? "OP" : key === "opMadre" ? "OP MADRE" : key === "linea" ? "LÍNEA" : "MATRÍCULA"}
                </label>
                <input
                  type="text"
                  value={form[key]}
                  onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                  placeholder={key === "linea" ? "1" : ""}
                  className={inputCls(errors[key])}
                />
                {errors[key] && <p className="text-[11px] text-destructive">{errors[key]}</p>}
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={handleAdd} disabled={adding}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all disabled:opacity-50">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {adding ? "Guardando..." : "Agregar fila"}
            </button>
          </div>
        </div>
      )}

      {/* ── Bulk paste ── */}
      {mode === "bulk" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <p className="text-xs text-muted-foreground">Copiá una columna de Excel y pegala en el campo. LÍNEA es opcional (default 1).</p>
          <div className="grid grid-cols-4 gap-4">
            {([
              { key: "op",        label: "OP" },
              { key: "opMadre",   label: "OP MADRE" },
              { key: "linea",     label: "LÍNEA" },
              { key: "matricula", label: "MATRÍCULA" },
            ] as const).map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground">{label}</label>
                  {bulk[key] && <span className="text-[11px] text-accent font-medium">{colCount(bulk[key])}</span>}
                </div>
                <textarea
                  value={bulk[key]}
                  onChange={e => { setBulk(p => ({ ...p, [key]: e.target.value })); setBulkErr(""); }}
                  placeholder={`Columna ${label}…`}
                  rows={8}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent resize-none transition-all font-mono"
                />
              </div>
            ))}
          </div>
          {bulkErr && <p className="text-xs text-destructive">{bulkErr}</p>}
          <div className="flex justify-end">
            <button onClick={handleBulkAdd} disabled={adding}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all disabled:opacity-50">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {adding ? "Guardando..." : "Agregar filas"}
            </button>
          </div>
        </div>
      )}

      {/* ── Tabla de filas ── */}
      {rows.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-secondary/50 border-b border-border">
              <tr>
                {["#", "OP", "OP MADRE", "LÍNEA", "MATRÍCULA", ""].map(h => (
                  <th key={h} className="py-2 px-3 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                  <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 px-3 text-foreground">{row.op}</td>
                  <td className="py-2 px-3 text-foreground">{row.opMadre}</td>
                  <td className="py-2 px-3 text-foreground">{row.linea}</td>
                  <td className="py-2 px-3 text-foreground">{row.matricula}</td>
                  <td className="py-2 px-3">
                    <button onClick={() => handleDelete(row.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
