"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Pencil, X, Plus, Trash2, Check, Loader2, Users } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PasoData {
  label: string;
  sublabel?: string;
  sublabel2?: string;
  active?: boolean;
  type: "start" | "end" | "process" | "decision" | "document";
  responsables?: string[];
}

// ─── Custom node components ────────────────────────────────────────────────────

function ProcessNode({ data, id }: NodeProps) {
  const d = data as unknown as PasoData;
  return (
    <div
      className={cn(
        "rounded-lg border-2 px-3 py-2 min-w-[110px] text-center cursor-pointer transition-all duration-200",
        d.active
          ? "border-orange-400 bg-orange-400/10 shadow-[0_0_12px_2px_oklch(0.75_0.18_50/0.4)]"
          : "border-border bg-card hover:border-accent/60"
      )}
      style={{ width: 120 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-border !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-border !w-2 !h-2" />
      <Handle type="target" position={Position.Top} id="top" className="!bg-border !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} id="bot" className="!bg-border !w-2 !h-2" />
      <p className={cn("text-[11px] font-semibold leading-tight", d.active ? "text-orange-300" : "text-foreground")}>
        {d.label}
      </p>
      {d.sublabel && <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{d.sublabel}</p>}
      {d.sublabel2 && <p className="text-[9px] text-muted-foreground leading-tight">{d.sublabel2}</p>}
      {d.responsables && d.responsables.length > 0 && (
        <div className="mt-1 flex items-center justify-center gap-1">
          <Users className="w-2.5 h-2.5 text-accent" />
          <span className="text-[8px] text-accent">{d.responsables.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function StartEndNode({ data }: NodeProps) {
  const d = data as unknown as PasoData;
  return (
    <div
      className="rounded-full border-2 border-green-500 bg-green-500/15 px-4 py-2 text-center"
      style={{ minWidth: 90 }}
    >
      <Handle type="source" position={Position.Right} className="!bg-green-500 !w-2 !h-2" />
      <Handle type="target" position={Position.Left} className="!bg-green-500 !w-2 !h-2" />
      <p className="text-[10px] font-semibold text-green-400 leading-tight">{d.label}</p>
      {d.sublabel && <p className="text-[8px] text-green-500/80 leading-tight">{d.sublabel}</p>}
    </div>
  );
}

function DecisionNode({ data }: NodeProps) {
  const d = data as unknown as PasoData;
  return (
    <div className="relative" style={{ width: 80, height: 50 }}>
      <Handle type="target" position={Position.Left} className="!bg-border !w-2 !h-2" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-border !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} id="bot" className="!bg-border !w-2 !h-2" />
      <Handle type="target" position={Position.Top} id="top" className="!bg-border !w-2 !h-2" />
      <svg width="80" height="50" className="absolute inset-0">
        <polygon points="40,2 78,25 40,48 2,25" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="1.5" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="text-[10px] font-semibold text-foreground text-center leading-tight px-3">{d.label}</p>
      </div>
    </div>
  );
}

function DocumentNode({ data }: NodeProps) {
  const d = data as unknown as PasoData;
  return (
    <div
      className="border border-border/60 bg-card/80 rounded px-2 py-1.5 text-center cursor-pointer hover:border-accent/60 transition-colors"
      style={{ width: 110 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2" />
      <Handle type="source" position={Position.Top} id="top" className="!bg-border !w-2 !h-2" />
      <Handle type="target" position={Position.Left} className="!bg-border !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-border !w-2 !h-2" />
      <div className="flex items-start gap-1">
        <div className="shrink-0 mt-0.5 text-muted-foreground">
          <svg width="10" height="12" viewBox="0 0 10 12"><path d="M1 1h6l2 2v8H1V1z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M7 1v2h2" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
        </div>
        <div>
          <p className="text-[9px] font-semibold text-foreground leading-tight text-left">{d.label}</p>
          {d.sublabel && <p className="text-[8px] text-muted-foreground leading-tight text-left mt-0.5">{d.sublabel}</p>}
          {d.responsables && d.responsables.length > 0 && (
            <p className="text-[8px] text-accent mt-0.5">{d.responsables.join(", ")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const NODE_TYPES = {
  process:  ProcessNode,
  startend: StartEndNode,
  decision: DecisionNode,
  document: DocumentNode,
};

// ─── Static node/edge definitions ─────────────────────────────────────────────

const PASO_IDS = [
  "generacion", "revision_ur", "presupuesto", "remite_compras",
  "comprador", "revision_urp", "aprobacion_gf",
  "pliego_tecnico", "solicitud_autorizacion", "pliego_condiciones", "aprobacion_sic",
];

function buildNodes(responsables: Record<string, string[]>): Node[] {
  const r = (id: string) => responsables[id] ?? [];
  return [
    // ── Main flow
    { id: "inicio",           type: "startend", position: { x: 0,    y: 120 }, data: { label: "Inicio del Proceso SIC" } },
    { id: "generacion",       type: "process",  position: { x: 120,  y: 100 }, data: { label: "Generación", sublabel: "Unidad Requirente", sublabel2: r("generacion")[0] || "Preparador", responsables: r("generacion"), type: "process" } },
    { id: "revision_ur",      type: "process",  position: { x: 270,  y: 100 }, data: { label: "Revisión Unidad Requirente", sublabel: r("revision_ur")[0] || "Subgerente", responsables: r("revision_ur"), type: "process" } },
    { id: "decision_ok1",     type: "decision", position: { x: 420,  y: 110 }, data: { label: "¿Ok?" } },
    { id: "presupuesto",      type: "process",  position: { x: 530,  y: 100 }, data: { label: "Presupuesto PC", sublabel: "Depto. Presupuesto", responsables: r("presupuesto"), type: "process" } },
    { id: "verificacion",     type: "decision", position: { x: 680,  y: 110 }, data: { label: "Verificación PC" } },
    { id: "remite_compras",   type: "process",  position: { x: 790,  y: 100 }, data: { label: "Remite a Compras", responsables: r("remite_compras"), type: "process" } },
    { id: "comprador",        type: "process",  position: { x: 940,  y: 100 }, data: { label: "Comprador", active: true, responsables: r("comprador"), type: "process" } },
    { id: "revision_urp",     type: "process",  position: { x: 1090, y: 100 }, data: { label: "Revisión Unidad Revisora de Pliegos", responsables: r("revision_urp"), type: "process" } },
    { id: "decision_correcto",type: "decision", position: { x: 1245, y: 110 }, data: { label: "¿Correcto?" } },
    { id: "aprobacion_gf",    type: "process",  position: { x: 1360, y: 100 }, data: { label: "Aprobación Gerente de Finanzas", responsables: r("aprobacion_gf"), type: "process" } },
    { id: "decision_ok2",     type: "decision", position: { x: 1510, y: 110 }, data: { label: "¿Ok?" } },
    { id: "fin",              type: "startend", position: { x: 1620, y: 105 }, data: { label: "Fin del Proceso SIC Generada y Reservada" } },

    // ── Documents / side nodes
    { id: "pliego_tecnico",        type: "document", position: { x: 115,  y: 280 }, data: { label: "Pliego Técnico Solicitud Interna de Contratación", responsables: r("pliego_tecnico") } },
    { id: "solicitud_autorizacion",type: "document", position: { x: 655,  y: 280 }, data: { label: "Solicitud de Autorización", sublabel: "Gerencia General", responsables: r("solicitud_autorizacion") } },
    { id: "pliego_condiciones",    type: "document", position: { x: 920,  y: 280 }, data: { label: "Pliego Particular de Condiciones", responsables: r("pliego_condiciones") } },
    { id: "decision_obs",          type: "decision", position: { x: 1245, y: 290 }, data: { label: "¿Obs. Técnica o Legal?" } },
    { id: "tecnica_renv",          type: "process",  position: { x: 1120, y: 390 }, data: { label: "Reenvia a Unidad Requirente", responsables: r("tecnica_renv"), type: "process" } },
    { id: "legal_renv",            type: "process",  position: { x: 1245, y: 460 }, data: { label: "Reenvia a Compras", responsables: r("legal_renv"), type: "process" } },
    { id: "aprobacion_sic",        type: "document", position: { x: 1350, y: -90  }, data: { label: "Aprobación de la SIC", sublabel: "Puesta en Reserva", responsables: r("aprobacion_sic") } },
  ];
}

const EDGE_STYLE_BASE = { stroke: "hsl(var(--border))", strokeWidth: 1.5 };
const EDGE_POS  = { ...EDGE_STYLE_BASE, stroke: "hsl(var(--success))" };
const EDGE_NEG  = { ...EDGE_STYLE_BASE, stroke: "hsl(var(--destructive))" };

const STATIC_EDGES: Edge[] = [
  // Main flow
  { id: "e-ini-gen",   source: "inicio",       target: "generacion",       style: EDGE_STYLE_BASE, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" } },
  { id: "e-gen-rev",   source: "generacion",   target: "revision_ur",      style: EDGE_STYLE_BASE, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" } },
  { id: "e-rev-d1",    source: "revision_ur",  target: "decision_ok1",     style: EDGE_STYLE_BASE, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" } },
  { id: "e-d1-pre",    source: "decision_ok1", target: "presupuesto",      label: "SI", style: EDGE_POS,  markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--success))" }, labelStyle: { fill: "hsl(var(--success))", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },
  { id: "e-pre-ver",   source: "presupuesto",  target: "verificacion",     style: EDGE_STYLE_BASE, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" } },
  { id: "e-ver-rem",   source: "verificacion", target: "remite_compras",   sourceHandle: "right", label: "CORRECTO", style: EDGE_POS, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--success))" }, labelStyle: { fill: "hsl(var(--success))", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },
  { id: "e-rem-com",   source: "remite_compras",target: "comprador",       label: "ASIGNA", style: EDGE_STYLE_BASE, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" }, labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },
  { id: "e-com-rurp",  source: "comprador",    target: "revision_urp",     style: EDGE_STYLE_BASE, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" } },
  { id: "e-rurp-dc",   source: "revision_urp", target: "decision_correcto",style: EDGE_STYLE_BASE, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" } },
  { id: "e-dc-agf",    source: "decision_correcto", target: "aprobacion_gf", sourceHandle: "right", label: "SI", style: EDGE_POS, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--success))" }, labelStyle: { fill: "hsl(var(--success))", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },
  { id: "e-agf-d2",    source: "aprobacion_gf",target: "decision_ok2",    style: EDGE_STYLE_BASE, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" } },
  { id: "e-d2-fin",    source: "decision_ok2", target: "fin",              label: "SI", style: EDGE_POS,  markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--success))" }, labelStyle: { fill: "hsl(var(--success))", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },

  // Rejection loop - decision_ok1 NO back to generacion (curved up)
  { id: "e-d1-no",   source: "decision_ok1", target: "generacion", sourceHandle: "top",
    label: "NO · RECHAZADO", style: EDGE_NEG, type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--destructive))" },
    labelStyle: { fill: "hsl(var(--destructive))", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },

  // decision_ok2 NO rejected
  { id: "e-d2-no",   source: "decision_ok2", target: "aprobacion_gf", sourceHandle: "bot",
    label: "NO · RECHAZADO", style: EDGE_NEG, type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--destructive))" },
    labelStyle: { fill: "hsl(var(--destructive))", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },

  // INCORRECTO branch
  { id: "e-ver-sa",  source: "verificacion",      target: "solicitud_autorizacion", sourceHandle: "bot",
    label: "INCORRECTO", style: EDGE_NEG, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--destructive))" },
    labelStyle: { fill: "hsl(var(--destructive))", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },
  { id: "e-sa-ur",   source: "solicitud_autorizacion", target: "revision_ur", type: "smoothstep",
    label: "REENVIADO A UR", style: { ...EDGE_NEG, strokeDasharray: "4 3" }, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--destructive))" },
    labelStyle: { fill: "hsl(var(--destructive))", fontSize: 8 }, labelBgStyle: { fill: "transparent" } },

  // decision_correcto NO → decision_obs
  { id: "e-dc-obs",  source: "decision_correcto", target: "decision_obs", sourceHandle: "bot",
    label: "NO", style: EDGE_NEG, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--destructive))" },
    labelStyle: { fill: "hsl(var(--destructive))", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },
  { id: "e-obs-tec", source: "decision_obs", target: "tecnica_renv",
    label: "TÉCNICA", style: { ...EDGE_STYLE_BASE, stroke: "#818cf8" }, markerEnd: { type: MarkerType.ArrowClosed, color: "#818cf8" },
    labelStyle: { fill: "#818cf8", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },
  { id: "e-obs-leg", source: "decision_obs", target: "legal_renv", sourceHandle: "bot",
    label: "LEGAL/CONTRACTUAL", style: { ...EDGE_STYLE_BASE, stroke: "#818cf8" }, markerEnd: { type: MarkerType.ArrowClosed, color: "#818cf8" },
    labelStyle: { fill: "#818cf8", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },

  // Reenvia loops back
  { id: "e-tec-ur",  source: "tecnica_renv",  target: "revision_ur",  type: "smoothstep",
    style: { ...EDGE_NEG, strokeDasharray: "4 3" }, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--destructive))" } },
  { id: "e-leg-com", source: "legal_renv",    target: "comprador",    type: "smoothstep",
    style: { ...EDGE_NEG, strokeDasharray: "4 3" }, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--destructive))" } },

  // Side documents
  { id: "e-gen-pt",  source: "generacion",   target: "pliego_tecnico",  sourceHandle: "bot",
    style: { ...EDGE_STYLE_BASE, strokeDasharray: "3 2" }, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" } },
  { id: "e-com-pc",  source: "comprador",    target: "pliego_condiciones", sourceHandle: "bot",
    style: { ...EDGE_STYLE_BASE, strokeDasharray: "3 2" }, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" } },
  { id: "e-sic-agf", source: "aprobacion_sic", target: "aprobacion_gf", targetHandle: "top",
    style: { ...EDGE_STYLE_BASE, strokeDasharray: "3 2" }, markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" } },

  // OBSERVADO edge (aprobacion_gf observed → goes back, shown with label)
  { id: "e-agf-obs", source: "aprobacion_gf", target: "revision_urp", type: "smoothstep",
    label: "OBSERVADO", style: { ...EDGE_NEG, strokeDasharray: "4 3" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--destructive))" },
    labelStyle: { fill: "hsl(var(--destructive))", fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } },
];

// ─── Edit modal ────────────────────────────────────────────────────────────────

const PASO_LABELS: Record<string, string> = {
  generacion: "Generación — Unidad Requirente",
  revision_ur: "Revisión Unidad Requirente",
  presupuesto: "Presupuesto PC",
  remite_compras: "Remite a Compras",
  comprador: "Comprador",
  revision_urp: "Revisión Unidad Revisora de Pliegos",
  aprobacion_gf: "Aprobación Gerente de Finanzas",
  pliego_tecnico: "Pliego Técnico",
  solicitud_autorizacion: "Solicitud de Autorización",
  pliego_condiciones: "Pliego Particular de Condiciones",
  aprobacion_sic: "Aprobación de la SIC",
  tecnica_renv: "Reenvia a Unidad Requirente",
  legal_renv: "Reenvia a Compras",
};

interface EditModalProps {
  pasoId: string;
  initial: string[];
  onSave: (id: string, list: string[]) => void;
  onClose: () => void;
}

function EditModal({ pasoId, initial, onSave, onClose }: EditModalProps) {
  const [list, setList] = useState<string[]>(initial);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const add = () => {
    const v = input.trim();
    if (!v || list.includes(v)) return;
    setList(l => [...l, v]);
    setInput("");
  };

  const remove = (i: number) => setList(l => l.filter((_, j) => j !== i));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("sic_paso_responsables")
      .upsert({ paso_id: pasoId, responsables: list, updated_at: new Date().toISOString() });
    if (error) toast.error(`Error al guardar: ${error.message}`);
    else { toast.success("Guardado"); onSave(pasoId, list); onClose(); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">{PASO_LABELS[pasoId] ?? pasoId}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Responsables del paso</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          {list.map((p, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary text-sm">
              <span className="text-foreground">{p}</span>
              <button onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {list.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">Sin responsables asignados</p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && add()}
            placeholder="Nombre del responsable"
            className="flex-1 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
          />
          <button onClick={add} className="h-9 w-9 rounded-lg bg-accent/15 hover:bg-accent/25 flex items-center justify-center text-accent transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-60 flex items-center gap-2 transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main section ──────────────────────────────────────────────────────────────

export function SicDiagramaSection() {
  const [responsables, setResponsables] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes({}));
  const [edges, , onEdgesChange] = useEdgesState(STATIC_EDGES);

  // Load responsables from Supabase
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("sic_paso_responsables").select("paso_id, responsables");
      if (data) {
        const map: Record<string, string[]> = {};
        data.forEach(r => { map[r.paso_id] = r.responsables ?? []; });
        setResponsables(map);
        setNodes(buildNodes(map));
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = useCallback((id: string, list: string[]) => {
    const next = { ...responsables, [id]: list };
    setResponsables(next);
    setNodes(buildNodes(next));
  }, [responsables]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (PASO_IDS.includes(node.id)) setEditing(node.id);
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Diagrama de flujo</h2>
          <p className="text-sm text-muted-foreground mt-1">Proceso SIC - SIGA · hacé clic en un paso para editar responsables</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-lg px-3 py-2">
          <Pencil className="w-3.5 h-3.5 text-accent" />
          Clic en nodo para editar
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-card border border-border rounded-xl px-5 py-3 grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">SIC</p><p className="text-base font-bold text-foreground mt-0.5">—</p></div>
        <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Estado actual</p><p className="text-sm font-medium text-orange-400 mt-0.5">— · —</p></div>
        <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Responsable</p><p className="text-sm font-medium text-foreground mt-0.5">—</p></div>
        <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tiempo en paso</p><p className="text-sm font-medium text-foreground mt-0.5">—</p></div>
        <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tiempo total</p><p className="text-sm font-medium text-foreground mt-0.5">—</p></div>
      </div>

      {/* Diagram */}
      <div className="bg-card border border-border rounded-xl overflow-hidden" style={{ height: 560 }}>
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            proOptions={{ hideAttribution: true }}
            style={{ background: "hsl(var(--card))" }}
          >
            <Background color="hsl(var(--border))" gap={24} size={1} />
            <Controls showInteractive={false} className="[&>button]:bg-secondary [&>button]:border-border [&>button]:text-foreground" />
          </ReactFlow>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-5 px-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><div className="w-5 h-5 rounded-full border-2 border-green-500 bg-green-500/15" />Inicio / Fin</div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-4 rounded border-2 border-border bg-card" />Actividad</div>
        <div className="flex items-center gap-1.5">
          <svg width="18" height="14"><polygon points="9,1 17,7 9,13 1,7" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="1.5"/></svg>
          Decisión
        </div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-green-500" />Resultado positivo</div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-destructive" />Resultado negativo</div>
        <div className="flex items-center gap-1.5"><div className="flex items-start gap-1"><svg width="10" height="12" viewBox="0 0 10 12"><path d="M1 1h6l2 2v8H1V1z" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1"/></svg></div>Documento</div>
        <div className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-accent" />Responsables asignados</div>
      </div>

      {/* Edit modal */}
      {editing && (
        <EditModal
          pasoId={editing}
          initial={responsables[editing] ?? []}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
