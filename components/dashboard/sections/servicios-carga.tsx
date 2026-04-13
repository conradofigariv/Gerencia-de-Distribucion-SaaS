"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FilaManual {
  id:        string;
  op:        number;
  op_madre:  number;
  linea:     number;
  matricula: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const splitCol = (t: string) => t.split(/\r?\n/).map(v => v.trim()).filter(Boolean);

const EMPTY = { op: "", op_madre: "", linea: "1", matricula: "" };

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ServiciosCargaSection() {
  const [filas, setFilas]     = useState<FilaManual[]>([]);
  const [mode, setMode]       = useState<"single" | "bulk">("single");
  const [form, setForm]       = useState(EMPTY);
  const [errors, setErrors]   = useState<Partial<typeof EMPTY>>({});
  const [bulk, setBulk]       = useState({ op: "", op_madre: "", linea: "", matricula: "" });
  const [bulkErr, setBulkErr] = useState("");
  const [adding, setAdding]   = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Cargar filas existentes al montar
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("filas_manuales")
        .select("id, op, op_madre, linea, matricula")
        .order("created_at", { ascending: true });
      if (error) { toast.error(`Error al cargar filas: ${error.message}`); }
      else setFilas((data ?? []) as FilaManual[]);
      setLoading(false);
    })();
  }, []);

  // ── Validación
  const validate = () => {
    const e: Partial<typeof EMPTY> = {};
    if (!form.op.trim()       || isNaN(Number(form.op)))       e.op       = "Debe ser un número";
    if (!form.op_madre.trim() || isNaN(Number(form.op_madre))) e.op_madre = "Debe ser un número";
    if (!form.linea.trim()    || isNaN(Number(form.linea)))    e.linea    = "Debe ser un número";
    if (!form.matricula.trim())                                 e.matricula = "Requerido";
    return e;
  };

  // ── Agregar fila individual
  const handleAdd = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setAdding(true);
    try {
      const payload = {
        op:        Number(form.op),
        op_madre:  Number(form.op_madre),
        linea:     Number(form.linea),
        matricula: form.matricula.trim(),
      };
      const { data, error } = await supabase
        .from("filas_manuales")
        .insert(payload)
        .select("id, op, op_madre, linea, matricula")
        .single();
      if (error) { toast.error(`Error: ${error.message}`); return; }
      setFilas(prev => [...prev, data as FilaManual]);
      setForm(EMPTY);
    } finally {
      setAdding(false);
    }
  };

  // ── Eliminar fila
  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("filas_manuales").delete().eq("id", id);
    if (error) { toast.error(`Error: ${error.message}`); return; }
    setFilas(prev => prev.filter(f => f.id !== id));
  };

  // ── Agregar múltiples filas (pegar columnas)
  const handleBulkAdd = async () => {
    setBulkErr("");
    const ops      = splitCol(bulk.op);
    const madres   = splitCol(bulk.op_madre);
    const lineas   = splitCol(bulk.linea);
    const mats     = splitCol(bulk.matricula);

    if (!ops.length)    { setBulkErr("La columna OP está vacía.");        return; }
    if (!madres.length) { setBulkErr("La columna OP MADRE está vacía.");  return; }
    if (!mats.length)   { setBulkErr("La columna MATRÍCULA está vacía."); return; }

    const n = ops.length;
    if (madres.length !== n || mats.length !== n) {
      setBulkErr(`Columnas con distinto número de filas — OP: ${n}, OP MADRE: ${madres.length}, MATRÍCULA: ${mats.length}`);
      return;
    }

    const lineaFinal = lineas.length === n ? lineas : Array(n).fill("1");
    const errs: string[] = [];
    for (let i = 0; i < n; i++) {
      if (isNaN(Number(ops[i])))        errs.push(`Fila ${i + 1}: OP "${ops[i]}" no es número`);
      if (isNaN(Number(madres[i])))     errs.push(`Fila ${i + 1}: OP MADRE "${madres[i]}" no es número`);
      if (isNaN(Number(lineaFinal[i]))) errs.push(`Fila ${i + 1}: LÍNEA "${lineaFinal[i]}" no es número`);
      if (!mats[i])                     errs.push(`Fila ${i + 1}: MATRÍCULA vacía`);
    }
    if (errs.length) { setBulkErr(errs.slice(0, 5).join(" · ")); return; }

    const payload = ops.map((op, i) => ({
      op:        Number(op),
      op_madre:  Number(madres[i]),
      linea:     Number(lineaFinal[i]),
      matricula: mats[i],
    }));

    setAdding(true);
    try {
      const { data, error } = await supabase
        .from("filas_manuales")
        .insert(payload)
        .select("id, op, op_madre, linea, matricula");
      if (error) { toast.error(`Error: ${error.message}`); return; }
      setFilas(prev => [...prev, ...((data ?? []) as FilaManual[])]);
      setBulk({ op: "", op_madre: "", linea: "", matricula: "" });
      setMode("single");
      toast.success(`${payload.length} filas agregadas`);
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
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading ? "Cargando..." : `${filas.length} fila${filas.length !== 1 ? "s" : ""} cargada${filas.length !== 1 ? "s" : ""}`}
          </p>
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

      {/* ── Formulario individual ── */}
      {mode === "single" && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="grid grid-cols-4 gap-4 mb-4">
            {([
              { key: "op",        label: "OP",        placeholder: "ej. 4500012345", type: "number" },
              { key: "op_madre",  label: "OP MADRE",  placeholder: "ej. 4500099999", type: "number" },
              { key: "linea",     label: "LÍNEA",     placeholder: "1",              type: "number" },
              { key: "matricula", label: "MATRÍCULA", placeholder: "ej. 00702632.0", type: "text"   },
            ] as const).map(({ key, label, placeholder, type }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">{label}</label>
                <input
                  type={type}
                  value={form[key]}
                  onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                  placeholder={placeholder}
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

      {/* ── Pegar columnas ── */}
      {mode === "bulk" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <p className="text-xs text-muted-foreground">Copiá una columna de Excel y pegala en el campo. LÍNEA es opcional (default 1).</p>
          <div className="grid grid-cols-4 gap-4">
            {([
              { key: "op",        label: "OP"        },
              { key: "op_madre",  label: "OP MADRE"  },
              { key: "linea",     label: "LÍNEA"     },
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
      {!loading && filas.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-secondary/50 border-b border-border">
              <tr>
                {["#", "OP", "OP MADRE", "LÍNEA", "MATRÍCULA", ""].map((h, i) => (
                  <th key={i} className="py-2 px-3 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                <tr key={fila.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                  <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 px-3 text-foreground font-mono">{fila.op}</td>
                  <td className="py-2 px-3 text-foreground font-mono">{fila.op_madre}</td>
                  <td className="py-2 px-3 text-foreground">{fila.linea}</td>
                  <td className="py-2 px-3 text-foreground font-mono">{fila.matricula}</td>
                  <td className="py-2 px-3">
                    <button onClick={() => handleDelete(fila.id)}
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
