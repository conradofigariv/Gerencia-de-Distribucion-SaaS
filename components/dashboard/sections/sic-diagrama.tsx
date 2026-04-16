"use client";

import { useCallback, useEffect, useRef, useState, DragEvent, ReactNode } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  NodeResizer,
  ConnectionMode,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { X, Plus, Trash2, Check, Loader2, Users, Save, RotateCcw } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PasoData {
  label: string;
  sublabel?: string;
  sublabel2?: string;
  active?: boolean;
  responsables?: string[];
  createdAt?: string;
}

// ─── Shapes configuration ─────────────────────────────────────────────────────

interface ShapeConfig {
  type: "process" | "startend" | "decision" | "document" | "parallelogram" | "hexagon";
  label: string;
  icon: ReactNode;
  defaultWidth: number;
  defaultHeight: number;
}

const SHAPES: ShapeConfig[] = [
  {
    type: "process",
    label: "Actividad",
    icon: (
      <div className="w-full h-10 rounded border-2 border-blue-500 flex items-center justify-center">
        <span className="text-[10px] font-semibold text-blue-400">Actividad</span>
      </div>
    ),
    defaultWidth: 120,
    defaultHeight: 70,
  },
  {
    type: "startend",
    label: "Inicio / Fin",
    icon: (
      <div className="w-full h-10 rounded-full border-2 border-green-500 flex items-center justify-center">
        <span className="text-[10px] font-semibold text-green-400">Inicio/Fin</span>
      </div>
    ),
    defaultWidth: 110,
    defaultHeight: 48,
  },
  {
    type: "decision",
    label: "Decisión",
    icon: (
      <div className="w-full h-12 relative flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 80" preserveAspectRatio="none">
          <polygon points="50,2 98,40 50,78 2,40" fill="transparent" stroke="#f59e0b" strokeWidth="3"/>
        </svg>
        <span className="relative text-[10px] font-semibold text-amber-400 z-10">Decisión</span>
      </div>
    ),
    defaultWidth: 80,
    defaultHeight: 50,
  },
  {
    type: "document",
    label: "Documento",
    icon: (
      <div className="w-full h-12 relative flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M2,2 L78,2 L98,22 L98,98 L2,98 Z" fill="transparent" stroke="#9333ea" strokeWidth="3"/>
          <polyline points="78,2 78,22 98,22" fill="transparent" stroke="#9333ea" strokeWidth="2.5"/>
        </svg>
        <span className="relative text-[10px] font-semibold text-purple-400 z-10">Documento</span>
      </div>
    ),
    defaultWidth: 120,
    defaultHeight: 65,
  },
  {
    type: "parallelogram",
    label: "Entrada / Salida",
    icon: (
      <div className="w-full h-10 relative flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 60" preserveAspectRatio="none">
          <polygon points="18,2 98,2 82,58 2,58" fill="transparent" stroke="#0ea5e9" strokeWidth="3"/>
        </svg>
        <span className="relative text-[10px] font-semibold text-cyan-400 z-10">E / S</span>
      </div>
    ),
    defaultWidth: 120,
    defaultHeight: 60,
  },
  {
    type: "hexagon",
    label: "Preparación",
    icon: (
      <div className="w-full h-12 relative flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 80" preserveAspectRatio="none">
          <polygon points="25,2 75,2 98,40 75,78 25,78 2,40" fill="transparent" stroke="#14b8a6" strokeWidth="3"/>
        </svg>
        <span className="relative text-[10px] font-semibold text-teal-400 z-10">Preparación</span>
      </div>
    ),
    defaultWidth: 110,
    defaultHeight: 70,
  },
];

// ─── Node components ──────────────────────────────────────────────────────────

function ProcessNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const days = useDays(d.createdAt);
  return (
    <>
      <NodeResizer minWidth={80} minHeight={40} isVisible={selected}
        color="#3b82f6" lineStyle={{ borderColor: "#3b82f6", borderWidth: 1.5 }}
        handleStyle={{ background: "#3b82f6", border: "none", width: 8, height: 8, borderRadius: 2 }} />
      <Handle type="source" position={Position.Left}   id="left"   className="!bg-blue-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right}  id="right"  className="!bg-blue-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Top}    id="top"    className="!bg-blue-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} id="bot"    className="!bg-blue-500 !w-2 !h-2 !border-0" />
      <div className="w-full h-full rounded border-2 border-blue-500 bg-transparent flex flex-col items-center justify-center px-2 py-1 text-center"
        style={{ boxShadow: selected ? "0 0 0 1px #3b82f6" : undefined }}>
        <p className="text-[11px] font-semibold text-blue-300 leading-tight">{d.label}</p>
        {d.sublabel && <p className="text-[9px] text-blue-400/70 mt-0.5 leading-tight">{d.sublabel}</p>}
        {d.responsables && d.responsables.length > 0 && (
          <div className="mt-0.5 flex items-center gap-1">
            <Users className="w-2.5 h-2.5 text-blue-400 shrink-0" />
            <span className="text-[8px] text-blue-400 truncate">{d.responsables.join(", ")}</span>
          </div>
        )}
        {days && <span className="text-[8px] text-blue-500/60 mt-0.5">{days}</span>}
      </div>
    </>
  );
}

function StartEndNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const days = useDays(d.createdAt);
  return (
    <>
      <NodeResizer minWidth={80} minHeight={36} isVisible={selected}
        color="#22c55e" lineStyle={{ borderColor: "#22c55e", borderWidth: 1.5 }}
        handleStyle={{ background: "#22c55e", border: "none", width: 8, height: 8, borderRadius: 2 }} />
      <Handle type="source" position={Position.Right} id="right" className="!bg-green-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Left}  id="left"  className="!bg-green-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Top}   id="top"   className="!bg-green-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} id="bot"  className="!bg-green-500 !w-2 !h-2 !border-0" />
      <div className="w-full h-full rounded-full border-2 border-green-500 bg-transparent flex flex-col items-center justify-center px-3 py-1"
        style={{ boxShadow: selected ? "0 0 0 1px #22c55e" : undefined }}>
        <p className="text-[10px] font-semibold text-green-400 leading-tight text-center">{d.label}</p>
        {d.responsables && d.responsables.length > 0 && (
          <div className="flex items-center gap-1 mt-0.5"><Users className="w-2.5 h-2.5 text-green-500 shrink-0"/><span className="text-[8px] text-green-500 truncate">{d.responsables.join(", ")}</span></div>
        )}
        {days && <span className="text-[8px] text-green-500/60 mt-0.5">{days}</span>}
      </div>
    </>
  );
}

function DecisionNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const days = useDays(d.createdAt);
  return (
    <>
      <NodeResizer minWidth={70} minHeight={44} isVisible={selected}
        color="#f59e0b" lineStyle={{ borderColor: "#f59e0b", borderWidth: 1.5 }}
        handleStyle={{ background: "#f59e0b", border: "none", width: 8, height: 8, borderRadius: 2 }} />
      <Handle type="source" position={Position.Left}   id="left"  className="!bg-amber-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right}  id="right" className="!bg-amber-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} id="bot"   className="!bg-amber-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Top}    id="top"   className="!bg-amber-500 !w-2 !h-2 !border-0" />
      <div className="w-full h-full relative flex items-center justify-center"
        style={{ filter: selected ? "drop-shadow(0 0 4px #f59e0b)" : undefined }}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="50,2 98,50 50,98 2,50" fill="transparent" stroke="#f59e0b" strokeWidth="2.5"/>
        </svg>
        <div className="relative z-10 flex flex-col items-center gap-0.5">
          <p className="text-[10px] font-semibold text-amber-400 text-center leading-tight px-6">{d.label}</p>
          {d.responsables && d.responsables.length > 0 && (
            <div className="flex items-center gap-1"><Users className="w-2.5 h-2.5 text-amber-500 shrink-0"/><span className="text-[8px] text-amber-500 truncate">{d.responsables.join(", ")}</span></div>
          )}
          {days && <span className="text-[8px] text-amber-500/60">{days}</span>}
        </div>
      </div>
    </>
  );
}

function DocumentNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const days = useDays(d.createdAt);
  return (
    <>
      <NodeResizer minWidth={90} minHeight={44} isVisible={selected}
        color="#9333ea" lineStyle={{ borderColor: "#9333ea", borderWidth: 1.5 }}
        handleStyle={{ background: "#9333ea", border: "none", width: 8, height: 8, borderRadius: 2 }} />
      <Handle type="source" position={Position.Top}    id="top"   className="!bg-purple-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} id="bot"   className="!bg-purple-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Left}   id="left"  className="!bg-purple-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right}  id="right" className="!bg-purple-500 !w-2 !h-2 !border-0" />
      <div className="w-full h-full relative flex items-center justify-center"
        style={{ filter: selected ? "drop-shadow(0 0 4px #9333ea)" : undefined }}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M2,2 L78,2 L98,22 L98,98 L2,98 Z" fill="transparent" stroke="#9333ea" strokeWidth="2.5"/>
          <polyline points="78,2 78,22 98,22" fill="transparent" stroke="#9333ea" strokeWidth="2"/>
        </svg>
        <div className="relative z-10 flex flex-col items-center gap-0.5">
          <p className="text-[10px] font-semibold text-purple-300 text-center leading-tight px-3">{d.label}</p>
          {d.responsables && d.responsables.length > 0 && (
            <div className="flex items-center gap-1"><Users className="w-2.5 h-2.5 text-purple-400 shrink-0"/><span className="text-[8px] text-purple-400 truncate">{d.responsables.join(", ")}</span></div>
          )}
          {days && <span className="text-[8px] text-purple-400/60">{days}</span>}
        </div>
      </div>
    </>
  );
}

function ParallelogramNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const days = useDays(d.createdAt);
  return (
    <>
      <NodeResizer minWidth={80} minHeight={40} isVisible={selected}
        color="#0ea5e9" lineStyle={{ borderColor: "#0ea5e9", borderWidth: 1.5 }}
        handleStyle={{ background: "#0ea5e9", border: "none", width: 8, height: 8, borderRadius: 2 }} />
      <Handle type="source" position={Position.Left}   id="left"  className="!bg-cyan-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right}  id="right" className="!bg-cyan-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Top}    id="top"   className="!bg-cyan-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} id="bot"   className="!bg-cyan-500 !w-2 !h-2 !border-0" />
      <div className="w-full h-full relative flex items-center justify-center"
        style={{ filter: selected ? "drop-shadow(0 0 4px #0ea5e9)" : undefined }}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="18,2 98,2 82,98 2,98" fill="transparent" stroke="#0ea5e9" strokeWidth="2.5"/>
        </svg>
        <div className="relative z-10 flex flex-col items-center gap-0.5">
          <p className="text-[10px] font-semibold text-cyan-400 text-center leading-tight px-4">{d.label}</p>
          {d.responsables && d.responsables.length > 0 && (
            <div className="flex items-center gap-1"><Users className="w-2.5 h-2.5 text-cyan-500 shrink-0"/><span className="text-[8px] text-cyan-500 truncate">{d.responsables.join(", ")}</span></div>
          )}
          {days && <span className="text-[8px] text-cyan-500/60">{days}</span>}
        </div>
      </div>
    </>
  );
}

function HexagonNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const days = useDays(d.createdAt);
  return (
    <>
      <NodeResizer minWidth={80} minHeight={50} isVisible={selected}
        color="#14b8a6" lineStyle={{ borderColor: "#14b8a6", borderWidth: 1.5 }}
        handleStyle={{ background: "#14b8a6", border: "none", width: 8, height: 8, borderRadius: 2 }} />
      <Handle type="source" position={Position.Left}   id="left"  className="!bg-teal-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right}  id="right" className="!bg-teal-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Top}    id="top"   className="!bg-teal-500 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} id="bot"   className="!bg-teal-500 !w-2 !h-2 !border-0" />
      <div className="w-full h-full relative flex items-center justify-center"
        style={{ filter: selected ? "drop-shadow(0 0 4px #14b8a6)" : undefined }}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="25,2 75,2 98,50 75,98 25,98 2,50" fill="transparent" stroke="#14b8a6" strokeWidth="2.5"/>
        </svg>
        <div className="relative z-10 flex flex-col items-center gap-0.5">
          <p className="text-[10px] font-semibold text-teal-400 text-center leading-tight px-6">{d.label}</p>
          {d.responsables && d.responsables.length > 0 && (
            <div className="flex items-center gap-1"><Users className="w-2.5 h-2.5 text-teal-500 shrink-0"/><span className="text-[8px] text-teal-500 truncate">{d.responsables.join(", ")}</span></div>
          )}
          {days && <span className="text-[8px] text-teal-500/60">{days}</span>}
        </div>
      </div>
    </>
  );
}

const NODE_TYPES = { process: ProcessNode, startend: StartEndNode, decision: DecisionNode, document: DocumentNode, parallelogram: ParallelogramNode, hexagon: HexagonNode };

// ─── Default nodes / edges ────────────────────────────────────────────────────

const PASO_IDS = [
  "generacion","revision_ur","presupuesto","remite_compras",
  "comprador","revision_urp","aprobacion_gf",
  "pliego_tecnico","solicitud_autorizacion","pliego_condiciones","aprobacion_sic",
  "tecnica_renv","legal_renv",
];

function createNewNode(type: string, x: number, y: number, label: string = ""): Node {
  const shapeConfig = SHAPES.find(s => s.type === type);
  if (!shapeConfig) return { id: "", type: "process", position: { x, y }, data: {} };

  const nodeId = `${type}-${Date.now()}`;
  return {
    id: nodeId,
    type,
    position: { x, y },
    width: shapeConfig.defaultWidth,
    height: shapeConfig.defaultHeight,
    data: { label: label || shapeConfig.label, createdAt: new Date().toISOString() },
  };
}

function useDays(createdAt?: string): string | null {
  if (!createdAt) return null;
  const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (diff === 0) return "Hoy";
  return diff === 1 ? "1 día" : `${diff} días`;
}

function buildNodes(responsables: Record<string, string[]>): Node[] {
  return [];
}

const E = (id: string, source: string, target: string, opts: Partial<Edge> = {}): Edge => ({
  id, source, target,
  markerEnd: { type: MarkerType.ArrowClosed, color: opts.style?.stroke as string ?? "#6b7280" },
  style: { stroke: "#6b7280", strokeWidth: 1.5 },
  ...opts,
});
const POS = { style: { stroke: "hsl(var(--success))",     strokeWidth: 1.5 } };
const NEG = { style: { stroke: "hsl(var(--destructive))", strokeWidth: 1.5 } };
const VIO = { style: { stroke: "#818cf8",                 strokeWidth: 1.5 } };
const DASH = (s: object) => ({ ...s, style: { ...(s as Edge).style, strokeDasharray: "4 3" } });
const LBL  = (label: string, color: string) => ({ label, labelStyle: { fill: color, fontSize: 9, fontWeight: 700 }, labelBgStyle: { fill: "transparent" } });

const DEFAULT_EDGES: Edge[] = [];

// ─── Shape palette component ─────────────────────────────────────────────────

function ShapePalette() {
  const onDragStart = (event: DragEvent<HTMLDivElement>, shapeType: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/reactflow", shapeType);
  };

  return (
    <div className="flex flex-col gap-3">
      {SHAPES.map((shape) => (
        <div
          key={shape.type}
          draggable
          onDragStart={(e) => onDragStart(e, shape.type)}
          className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border/60 hover:border-accent/60 hover:bg-accent/5 cursor-grab active:cursor-grabbing transition-all select-none"
          title={`Arrastra para agregar ${shape.label}`}
        >
          <div className="w-full h-12 flex items-center justify-center">
            {shape.icon}
          </div>
          <span className="text-[10px] font-medium text-muted-foreground text-center leading-tight">{shape.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Node edit modal (label + encargados) ────────────────────────────────────

interface NodeEditModalProps {
  nodeId: string;
  initialLabel: string;
  initialResponsables: string[];
  onSave: (id: string, label: string, responsables: string[]) => void;
  onClose: () => void;
}

function NodeEditModal({ nodeId, initialLabel, initialResponsables, onSave, onClose }: NodeEditModalProps) {
  const [label, setLabel] = useState(initialLabel);
  const [responsables, setResponsables] = useState<string[]>(initialResponsables);
  const [input, setInput] = useState("");

  const add = () => {
    const v = input.trim();
    if (!v || responsables.includes(v)) return;
    setResponsables(r => [...r, v]);
    setInput("");
  };

  const rem = (i: number) => setResponsables(r => r.filter((_, j) => j !== i));

  const save = () => {
    if (!label.trim()) return;
    onSave(nodeId, label.trim(), responsables);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Editar objeto</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4"/></button>
        </div>

        {/* Label */}
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium">Título</p>
          <input
            autoFocus
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") onClose(); }}
            className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
          />
        </div>

        {/* Encargados */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5"/>Encargados
          </p>
          {responsables.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-1.5">Sin encargados asignados</p>
          )}
          {responsables.map((p, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-secondary text-sm">
              <span className="text-foreground">{p}</span>
              <button onClick={() => rem(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="w-3.5 h-3.5"/>
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && add()}
              placeholder="Nombre del encargado"
              className="flex-1 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
            />
            <button onClick={add} className="h-9 w-9 rounded-lg bg-accent/15 hover:bg-accent/25 flex items-center justify-center text-accent transition-colors">
              <Plus className="w-4 h-4"/>
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">Cancelar</button>
          <button onClick={save} className="px-4 py-2 rounded-lg text-sm bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 transition-colors">
            <Check className="w-3.5 h-3.5"/>Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit responsables modal ──────────────────────────────────────────────────

const PASO_LABELS: Record<string, string> = {
  generacion:"Generación — Unidad Requirente", revision_ur:"Revisión Unidad Requirente",
  presupuesto:"Presupuesto PC", remite_compras:"Remite a Compras", comprador:"Comprador",
  revision_urp:"Revisión Unidad Revisora de Pliegos", aprobacion_gf:"Aprobación Gerente de Finanzas",
  pliego_tecnico:"Pliego Técnico", solicitud_autorizacion:"Solicitud de Autorización",
  pliego_condiciones:"Pliego Particular de Condiciones", aprobacion_sic:"Aprobación de la SIC",
  tecnica_renv:"Reenvia a Unidad Requirente", legal_renv:"Reenvia a Compras",
};

interface EditModalProps { pasoId:string; initial:string[]; onSave:(id:string,list:string[])=>void; onClose:()=>void; }

function EditModal({ pasoId, initial, onSave, onClose }: EditModalProps) {
  const [list, setList]   = useState<string[]>(initial);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const add = () => { const v=input.trim(); if(!v||list.includes(v))return; setList(l=>[...l,v]); setInput(""); };
  const rem = (i: number) => setList(l => l.filter((_,j)=>j!==i));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("sic_paso_responsables")
      .upsert({ paso_id: pasoId, responsables: list, updated_at: new Date().toISOString() });
    if (error) toast.error(`Error: ${error.message}`);
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
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4"/></button>
        </div>
        <div className="space-y-2">
          {list.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Sin responsables asignados</p>}
          {list.map((p,i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary text-sm">
              <span className="text-foreground">{p}</span>
              <button onClick={()=>rem(i)} className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()}
            placeholder="Nombre del responsable"
            className="flex-1 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"/>
          <button onClick={add} className="h-9 w-9 rounded-lg bg-accent/15 hover:bg-accent/25 flex items-center justify-center text-accent transition-colors"><Plus className="w-4 h-4"/></button>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">Cancelar</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-60 flex items-center gap-2 transition-colors">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Check className="w-3.5 h-3.5"/>}Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function SicDiagramaInner() {
  const { screenToFlowPosition, updateNodeData } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const [responsables, setResponsables] = useState<Record<string,string[]>>({});
  const [loading, setLoading]   = useState(true);
  const [editingNode, setEditingNode] = useState<{ id: string; label: string; responsables: string[] } | null>(null);
  const [saved, setSaved]       = useState(true);

  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes({}));
  const [edges, setEdges, onEdgesChange] = useEdgesState(DEFAULT_EDGES);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load saved layout + responsables from Supabase
  useEffect(() => {
    (async () => {
      const [layoutRes, respRes] = await Promise.all([
        supabase.from("sic_diagrama_layout").select("nodes,edges").eq("id","main").single(),
        supabase.from("sic_paso_responsables").select("paso_id,responsables"),
      ]);

      const respMap: Record<string,string[]> = {};
      respRes.data?.forEach(r => { respMap[r.paso_id] = r.responsables ?? []; });
      setResponsables(respMap);

      if (layoutRes.data?.nodes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const savedNodes: any[] = layoutRes.data.nodes;
        const merged = buildNodes(respMap).map(n => {
          const sv = savedNodes.find((s: { id: string }) => s.id === n.id);
          return sv ? { ...n, position: sv.position, width: sv.width, height: sv.height, style: sv.style } : n;
        });
        const extra = savedNodes.filter((s: { id: string }) => !merged.find(n => n.id === s.id));
        setNodes([...merged, ...extra]);
        if (layoutRes.data.edges) setEdges(layoutRes.data.edges);
      } else {
        setNodes(buildNodes(respMap));
      }
      setLoading(false);
    })();
  }, []);

  // Auto-save whenever nodes or edges change (skip during initial load)
  useEffect(() => {
    if (loading) return;
    setSaved(false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = {
        nodes: nodes.map(n => ({ id:n.id, position:n.position, width:n.width, height:n.height, style:n.style, type:n.type, data:n.data })),
        edges,
      };
      await supabase.from("sic_diagrama_layout").upsert({ id:"main", ...payload, updated_at: new Date().toISOString() });
      setSaved(true);
    }, 1500);
  }, [nodes, edges, loading]);

  // Add edge on connect — keep it minimal; defaultEdgeOptions handles styling
  const onConnect = useCallback((connection: Connection) => {
    setEdges(es => addEdge({ ...connection, id: `e-${Date.now()}` }, es));
  }, [setEdges]);

  // Double-click node → open unified edit modal
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    const d = node.data as unknown as PasoData;
    setEditingNode({ id: node.id, label: d.label ?? "", responsables: d.responsables ?? [] });
  }, []);

  // Save label + responsables for any node
  const handleSaveNode = useCallback((id: string, newLabel: string, newResponsables: string[]) => {
    updateNodeData(id, { label: newLabel, responsables: newResponsables });
  }, [updateNodeData]);


  const resetLayout = () => {
    setNodes(buildNodes(responsables));
    setEdges(DEFAULT_EDGES);
  };

  // Drag-and-drop handlers
  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const shapeType = event.dataTransfer.getData("application/reactflow");
    if (!shapeType || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - containerRect.left;
    const y = event.clientY - containerRect.top;
    const flowPosition = screenToFlowPosition({ x, y });

    const newNode = createNewNode(shapeType, flowPosition.x, flowPosition.y);
    setNodes(ns => [...ns, newNode]);
  }, [screenToFlowPosition, setNodes]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Diagrama de flujo</h2>
          <p className="text-sm text-muted-foreground mt-1">Proceso SIC - SIGA · doble clic en un objeto para editar su nombre</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn("flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors",
            saved ? "text-muted-foreground border-border" : "text-orange-400 border-orange-400/30 bg-orange-400/5")}>
            {saved ? <><Check className="w-3 h-3"/>Guardado</> : <><Save className="w-3 h-3"/>Guardando...</>}
          </div>
          <button onClick={resetLayout} title="Restablecer layout"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <RotateCcw className="w-3 h-3"/>Reset
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-card border border-border rounded-xl px-5 py-3 grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
        {[["SIC","—"],["Estado actual","—"],["Responsable","—"],["Tiempo en paso","—"],["Tiempo total","—"]].map(([k,v])=>(
          <div key={k}><p className="text-[10px] text-muted-foreground uppercase tracking-wider">{k}</p>
            <p className="font-medium text-foreground mt-0.5">{v}</p></div>
        ))}
      </div>

      {/* Diagram with sidebar */}
      <div className="flex gap-4">
        {/* Shapes sidebar */}
        <div className="w-44 shrink-0 bg-card border border-border rounded-xl px-4 py-4 overflow-y-auto max-h-[580px] [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-4">Formas</p>
          <ShapePalette />
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 bg-card border border-border rounded-xl overflow-hidden"
          style={{ height: 580, "--xy-edge-stroke": "#94a3b8", "--xy-edge-stroke-width": "1.5" } as React.CSSProperties}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin"/>Cargando...
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={NODE_TYPES}
            connectionMode={ConnectionMode.Loose}
            defaultEdgeOptions={{
              style: { stroke: "#6b7280", strokeWidth: 1.5 },
              markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" },
            }}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            deleteKeyCode={["Backspace","Delete"]}
            proOptions={{ hideAttribution: true }}
            style={{ background: "hsl(var(--card))" }}
          >
            <Background color="#6b7280" gap={24} size={1}/>
            <Controls showInteractive={false}
              className="[&>button]:bg-transparent [&>button]:border-transparent [&>button]:text-white [&>button]:shadow-none [&>button:hover]:bg-white/10 [&>button_svg]:fill-white [&>button_path]:fill-white [&>button_rect]:fill-white [&]:bg-transparent [&]:border-transparent [&]:shadow-none"/>
          </ReactFlow>
        )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-5 px-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><div className="w-5 h-5 rounded-full border-2 border-green-500 bg-green-500/15"/>Inicio / Fin</div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-4 rounded border-2 border-border bg-card"/>Actividad</div>
        <div className="flex items-center gap-1.5">
          <svg width="18" height="14"><polygon points="9,1 17,7 9,13 1,7" fill="hsl(var(--card))" stroke="#6b7280" strokeWidth="1.5"/></svg>
          Decisión
        </div>
        <div className="flex items-center gap-1.5"><div className="w-4 h-0.5 bg-green-500"/>Resultado positivo</div>
        <div className="flex items-center gap-1.5"><div className="w-4 h-0.5 bg-destructive"/>Resultado negativo</div>
        <div className="flex items-center gap-1.5 text-[11px] bg-secondary/50 border border-border rounded px-2 py-1">
          Arrastrar nodo = mover · Borde del nodo = redimensionar · Arrastrar desde handle = conectar · Supr = eliminar
        </div>
      </div>

      {editingNode && (
        <NodeEditModal
          nodeId={editingNode.id}
          initialLabel={editingNode.label}
          initialResponsables={editingNode.responsables}
          onSave={handleSaveNode}
          onClose={() => setEditingNode(null)}
        />
      )}
    </div>
  );
}

// ─── Wrapper with ReactFlowProvider ──────────────────────────────────────────

export function SicDiagramaSection() {
  return (
    <ReactFlowProvider>
      <SicDiagramaInner />
    </ReactFlowProvider>
  );
}
