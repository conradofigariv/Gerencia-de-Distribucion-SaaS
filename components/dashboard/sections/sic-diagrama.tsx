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
  BaseEdge,
  EdgeLabelRenderer,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
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
  color?: string;
}

// ─── Color palette ────────────────────────────────────────────────────────────

const NODE_COLORS = [
  "#3b82f6","#22c55e","#f59e0b","#9333ea",
  "#0ea5e9","#14b8a6","#ef4444","#ec4899",
  "#f97316","#6366f1","#64748b","#e2e8f0",
];

// ─── Shapes configuration ─────────────────────────────────────────────────────

interface ShapeConfig {
  type: "process" | "startend" | "decision" | "document" | "parallelogram" | "hexagon";
  label: string;
  icon: ReactNode;
  defaultWidth: number;
  defaultHeight: number;
  defaultColor: string;
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
    defaultColor: "#3b82f6",
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
    defaultColor: "#22c55e",
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
    defaultColor: "#f59e0b",
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
    defaultColor: "#9333ea",
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
    defaultColor: "#0ea5e9",
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
    defaultColor: "#14b8a6",
  },
];

// ─── Node components ──────────────────────────────────────────────────────────

function NodeHandles({ color }: { color: string }) {
  const s = { background: color, width: 8, height: 8, border: "none" };
  return (<>
    <Handle type="source" position={Position.Left}   id="left"   style={s} />
    <Handle type="source" position={Position.Right}  id="right"  style={s} />
    <Handle type="source" position={Position.Top}    id="top"    style={s} />
    <Handle type="source" position={Position.Bottom} id="bot"    style={s} />
  </>);
}

function NodeContent({ d, color, days }: { d: PasoData; color: string; days: string | null }) {
  return (<>
    <p className="text-[11px] font-semibold leading-tight text-center w-full" style={{ color }}>{d.label}</p>
    {d.responsables && d.responsables.length > 0 && (
      <div className="mt-0.5 flex items-center gap-1">
        <Users className="w-2.5 h-2.5 shrink-0" style={{ color }}/>
        <span className="text-[8px] truncate" style={{ color }}>{d.responsables.join(", ")}</span>
      </div>
    )}
    {days && <span className="text-[8px] mt-0.5" style={{ color, opacity: 0.6 }}>{days}</span>}
  </>);
}

function ProcessNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const color = d.color ?? "#3b82f6";
  const days = useDays(d.createdAt);
  return (<>
    <NodeResizer minWidth={80} minHeight={40} isVisible={selected} color={color}
      lineStyle={{ borderColor: color, borderWidth: 1.5 }}
      handleStyle={{ background: color, border: "none", width: 8, height: 8, borderRadius: 2 }} />
    <NodeHandles color={color} />
    <div className="w-full h-full rounded border-2 bg-transparent flex flex-col items-center justify-center px-2 py-1 text-center"
      style={{ borderColor: color, boxShadow: selected ? `0 0 0 1px ${color}` : undefined }}>
      <NodeContent d={d} color={color} days={days} />
    </div>
  </>);
}

function StartEndNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const color = d.color ?? "#22c55e";
  const days = useDays(d.createdAt);
  return (<>
    <NodeResizer minWidth={80} minHeight={36} isVisible={selected} color={color}
      lineStyle={{ borderColor: color, borderWidth: 1.5 }}
      handleStyle={{ background: color, border: "none", width: 8, height: 8, borderRadius: 2 }} />
    <NodeHandles color={color} />
    <div className="w-full h-full rounded-full border-2 bg-transparent flex flex-col items-center justify-center px-3 py-1"
      style={{ borderColor: color, boxShadow: selected ? `0 0 0 1px ${color}` : undefined }}>
      <NodeContent d={d} color={color} days={days} />
    </div>
  </>);
}

function DecisionNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const color = d.color ?? "#f59e0b";
  const days = useDays(d.createdAt);
  return (<>
    <NodeResizer minWidth={70} minHeight={44} isVisible={selected} color={color}
      lineStyle={{ borderColor: color, borderWidth: 1.5 }}
      handleStyle={{ background: color, border: "none", width: 8, height: 8, borderRadius: 2 }} />
    <NodeHandles color={color} />
    <div className="w-full h-full relative flex items-center justify-center"
      style={{ filter: selected ? `drop-shadow(0 0 4px ${color})` : undefined }}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon points="50,2 98,50 50,98 2,50" fill="transparent" stroke={color} strokeWidth="2.5"/>
      </svg>
      <div className="relative z-10 flex flex-col items-center gap-0.5 px-6">
        <NodeContent d={d} color={color} days={days} />
      </div>
    </div>
  </>);
}

function DocumentNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const color = d.color ?? "#9333ea";
  const days = useDays(d.createdAt);
  return (<>
    <NodeResizer minWidth={90} minHeight={44} isVisible={selected} color={color}
      lineStyle={{ borderColor: color, borderWidth: 1.5 }}
      handleStyle={{ background: color, border: "none", width: 8, height: 8, borderRadius: 2 }} />
    <NodeHandles color={color} />
    <div className="w-full h-full relative flex items-center justify-center"
      style={{ filter: selected ? `drop-shadow(0 0 4px ${color})` : undefined }}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M2,2 L78,2 L98,22 L98,98 L2,98 Z" fill="transparent" stroke={color} strokeWidth="2.5"/>
        <polyline points="78,2 78,22 98,22" fill="transparent" stroke={color} strokeWidth="2"/>
      </svg>
      <div className="relative z-10 flex flex-col items-center gap-0.5 px-3">
        <NodeContent d={d} color={color} days={days} />
      </div>
    </div>
  </>);
}

function ParallelogramNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const color = d.color ?? "#0ea5e9";
  const days = useDays(d.createdAt);
  return (<>
    <NodeResizer minWidth={80} minHeight={40} isVisible={selected} color={color}
      lineStyle={{ borderColor: color, borderWidth: 1.5 }}
      handleStyle={{ background: color, border: "none", width: 8, height: 8, borderRadius: 2 }} />
    <NodeHandles color={color} />
    <div className="w-full h-full relative flex items-center justify-center"
      style={{ filter: selected ? `drop-shadow(0 0 4px ${color})` : undefined }}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon points="18,2 98,2 82,98 2,98" fill="transparent" stroke={color} strokeWidth="2.5"/>
      </svg>
      <div className="relative z-10 flex flex-col items-center gap-0.5 px-4">
        <NodeContent d={d} color={color} days={days} />
      </div>
    </div>
  </>);
}

function HexagonNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  const color = d.color ?? "#14b8a6";
  const days = useDays(d.createdAt);
  return (<>
    <NodeResizer minWidth={80} minHeight={50} isVisible={selected} color={color}
      lineStyle={{ borderColor: color, borderWidth: 1.5 }}
      handleStyle={{ background: color, border: "none", width: 8, height: 8, borderRadius: 2 }} />
    <NodeHandles color={color} />
    <div className="w-full h-full relative flex items-center justify-center"
      style={{ filter: selected ? `drop-shadow(0 0 4px ${color})` : undefined }}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon points="25,2 75,2 98,50 75,98 25,98 2,50" fill="transparent" stroke={color} strokeWidth="2.5"/>
      </svg>
      <div className="relative z-10 flex flex-col items-center gap-0.5 px-6">
        <NodeContent d={d} color={color} days={days} />
      </div>
    </div>
  </>);
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
    data: { label: label || shapeConfig.label, createdAt: new Date().toISOString(), color: shapeConfig.defaultColor },
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
  initialColor: string;
  onSave: (id: string, label: string, responsables: string[], color: string) => void;
  onClose: () => void;
}

function NodeEditModal({ nodeId, initialLabel, initialResponsables, initialColor, onSave, onClose }: NodeEditModalProps) {
  const [label, setLabel] = useState(initialLabel);
  const [responsables, setResponsables] = useState<string[]>(initialResponsables);
  const [input, setInput] = useState("");
  const [color, setColor] = useState(initialColor);

  const add = () => {
    const v = input.trim();
    if (!v || responsables.includes(v)) return;
    setResponsables(r => [...r, v]);
    setInput("");
  };

  const rem = (i: number) => setResponsables(r => r.filter((_, j) => j !== i));

  const save = () => {
    if (!label.trim()) return;
    onSave(nodeId, label.trim(), responsables, color);
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

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Color</p>
          <div className="flex flex-wrap gap-2">
            {NODE_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)}
                className="w-6 h-6 rounded-full transition-all"
                style={{
                  backgroundColor: c,
                  outline: color === c ? `2px solid white` : "2px solid transparent",
                  outlineOffset: "2px",
                  opacity: color === c ? 1 : 0.55,
                }}
              />
            ))}
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

// ─── Edge edit modal ──────────────────────────────────────────────────────────

interface EdgeEditModalProps {
  edgeId: string;
  initialType: string;
  initialLabel: string;
  onSave: (id: string, type: string, label: string) => void;
  onClose: () => void;
}

function EdgeEditModal({ edgeId, initialType, initialLabel, onSave, onClose }: EdgeEditModalProps) {
  const [type, setType]   = useState(initialType || "bezier");
  const [label, setLabel] = useState(initialLabel);

  const save = () => { onSave(edgeId, type, label.trim()); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-xs p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Editar flecha</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4"/></button>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Tipo de línea</p>
          <div className="flex gap-2">
            {[{ value: "bezier", label: "Curva" }, { value: "step", label: "Escalonada" }].map(opt => (
              <button key={opt.value} onClick={() => setType(opt.value)}
                className={cn("flex-1 px-3 py-2 rounded-lg text-xs border transition-colors",
                  type === opt.value
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-muted-foreground hover:border-accent/50 hover:text-foreground"
                )}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium">Etiqueta (opcional)</p>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
            placeholder="Ej: Sí, No, Aprobado..."
            className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
          />
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

// ─── Bendable edge (draggable midpoint handle) ───────────────────────────────

function BendableEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data, selected, label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius }: EdgeProps) {
  const { setEdges, screenToFlowPosition } = useReactFlow();

  const lineStyle = (data?.lineStyle as string | undefined) ?? "bezier";
  const isStep     = lineStyle === "step" || lineStyle === "smoothstep";
  const isStraight = lineStyle === "straight";

  // bezier control point (free 2D)
  const cpX = (data?.cpX as number | undefined) ?? (sourceX + targetX) / 2;
  const cpY = (data?.cpY as number | undefined) ?? (sourceY + targetY) / 2;

  // step: vertical from source → horizontal bridge at bridgeY → vertical to target
  const bridgeY = (data?.bridgeY as number | undefined) ?? (sourceY + targetY) / 2;

  const edgePath = isStep
    ? `M${sourceX},${sourceY} L${sourceX},${bridgeY} L${targetX},${bridgeY} L${targetX},${targetY}`
    : isStraight
    ? `M${sourceX},${sourceY} L${targetX},${targetY}`
    : `M${sourceX},${sourceY} Q${cpX},${cpY} ${targetX},${targetY}`;

  // Label midpoint
  const labelX = isStep ? (sourceX + targetX) / 2 : isStraight ? (sourceX + targetX) / 2 : 0.25 * sourceX + 0.5 * cpX + 0.25 * targetX;
  const labelY = isStep ? bridgeY : isStraight ? (sourceY + targetY) / 2 : 0.25 * sourceY + 0.5 * cpY + 0.25 * targetY;

  const startDrag = useCallback((update: (x: number, y: number) => Record<string, unknown>) => (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    const move = (mv: MouseEvent) => {
      const p = screenToFlowPosition({ x: mv.clientX, y: mv.clientY });
      setEdges(es => es.map(edge => edge.id !== id ? edge : {
        ...edge, data: { ...(edge.data as Record<string, unknown> ?? {}), ...update(p.x, p.y) }
      }));
    };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }, [id, screenToFlowPosition, setEdges]);

  const onBezierDrag = startDrag((x, y) => ({ cpX: x, cpY: y }));
  // step handle: only vertical (Y) matters; X is ignored
  const onBridgeDrag = startDrag((_, y) => ({ bridgeY: y }));

  const dot = (hx: number, hy: number, handler: (e: React.MouseEvent) => void) => (
    <div key={`${hx}-${hy}`}
      style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${hx}px,${hy}px)`, pointerEvents: "all" }}
      className="nodrag nopan" onMouseDown={handler}>
      <div className="w-3 h-3 rounded-full bg-slate-500/80 border border-slate-300/50 cursor-ns-resize hover:bg-slate-300 hover:scale-125 transition-all" />
    </div>
  );

  return (
    <>
      <BaseEdge path={edgePath} style={style} markerEnd={markerEnd}
        label={label} labelX={labelX} labelY={labelY}
        labelStyle={labelStyle} labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding} labelBgBorderRadius={labelBgBorderRadius}
        labelShowBg={!!label}
      />
      {selected && !isStraight && (
        <EdgeLabelRenderer>
          {isStep
            // single handle at center of horizontal bridge — drag up/down
            ? dot((sourceX + targetX) / 2, bridgeY, onBridgeDrag)
            : dot(cpX, cpY, onBezierDrag)
          }
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const EDGE_TYPES_MAP = { default: BendableEdge, smoothstep: BendableEdge, step: BendableEdge, straight: BendableEdge };

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<{ id: string; label: string; responsables: string[]; color: string } | null>(null);
  const [editingEdge, setEditingEdge] = useState<{ id: string; type: string; label: string } | null>(null);
  const [saved, setSaved]       = useState(true);
  const [saving, setSaving]     = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes({}));
  const [edges, setEdges, onEdgesChange] = useEdgesState(DEFAULT_EDGES);

  // Load saved layout + responsables from Supabase
  useEffect(() => {
    (async () => {
      try {
      const [layoutRes, respRes] = await Promise.all([
        supabase.from("sic_diagrama_layout").select("nodes,edges").eq("id","main").single(),
        supabase.from("sic_paso_responsables").select("paso_id,responsables"),
      ]);

      if (layoutRes.error) {
        const code = layoutRes.error.code ?? "";
        const msg  = layoutRes.error.message ?? "";
        if (code === "PGRST116") {
          // No rows — diagram was never saved, show empty canvas
        } else if (msg.includes("Invalid api key") || msg.includes("Invalid API key")) {
          setLoadError("Supabase no está configurado. Verificá las variables de entorno NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.");
        } else {
          setLoadError(`No se pudo cargar el diagrama guardado: ${msg}${code ? ` (${code})` : ""}`);
        }
        setLoading(false);
        return;
      }

      const respMap: Record<string,string[]> = {};
      respRes.data?.forEach(r => { respMap[r.paso_id] = r.responsables ?? []; });
      setResponsables(respMap);

      console.log("[SIC load] data", layoutRes.data);
      if (layoutRes.data?.nodes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const savedNodes: any[] = layoutRes.data.nodes;
        const merged = buildNodes(respMap).map(n => {
          const sv = savedNodes.find((s: { id: string }) => s.id === n.id);
          return sv ? { ...n, position: sv.position, width: sv.width, height: sv.height, style: sv.style } : n;
        });
        const extra = savedNodes.filter((s: { id: string }) => !merged.find(n => n.id === s.id));
        console.log("[SIC load] aplicando", { saved: savedNodes.length, merged: merged.length, extra: extra.length });
        setNodes([...merged, ...extra]);
        if (layoutRes.data.edges) setEdges(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          layoutRes.data.edges.map((e: any) => ({
            ...e,
            markerEnd: { ...(typeof e.markerEnd === "object" ? e.markerEnd : {}), type: MarkerType.ArrowClosed, width: 14, height: 14 },
          }))
        );
      } else {
        console.log("[SIC load] sin nodos guardados");
        setNodes(buildNodes(respMap));
      }
      setLoading(false);
      } catch (err) {
        setLoadError(`Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
      }
    })();
  }, []);

  // Mark unsaved whenever nodes or edges change after initial load
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!initialLoadDone.current) { initialLoadDone.current = true; return; }
    setSaved(false);
  }, [nodes, edges, loading]);

  const handleManualSave = useCallback(async () => {
    setSaving(true);
    const payload = {
      nodes: nodes.map(n => ({ id:n.id, position:n.position, width:n.width, height:n.height, style:n.style, type:n.type, data:n.data })),
      edges: edges.map(e => ({ id:e.id, source:e.source, target:e.target, sourceHandle:e.sourceHandle, targetHandle:e.targetHandle, type:e.type, label:e.label, labelStyle:e.labelStyle, labelBgStyle:e.labelBgStyle, labelBgPadding:e.labelBgPadding, style:e.style, data:e.data, markerEnd:e.markerEnd })),
    };
    console.log("[SIC save] enviando", { nodes: payload.nodes.length, edges: payload.edges.length });
    const { data, error } = await supabase
      .from("sic_diagrama_layout")
      .upsert({ id:"main", ...payload, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .select();
    setSaving(false);
    if (error) {
      console.error("[SIC save] error", error);
      toast.error(`Error al guardar: ${error.message}${error.code ? ` (${error.code})` : ""}`);
      setSaved(false);
      return;
    }
    console.log("[SIC save] OK", data);
    toast.success(`Guardado ${payload.nodes.length} objeto${payload.nodes.length === 1 ? "" : "s"}`);
    setSaved(true);
  }, [nodes, edges]);

  // Add edge on connect — keep it minimal; defaultEdgeOptions handles styling
  const onConnect = useCallback((connection: Connection) => {
    setEdges(es => addEdge({ ...connection, id: `e-${Date.now()}` }, es));
  }, [setEdges]);

  // Double-click node → open unified edit modal
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    const d = node.data as unknown as PasoData;
    setEditingNode({ id: node.id, label: d.label ?? "", responsables: d.responsables ?? [], color: d.color ?? "" });
  }, []);

  // Double-click edge → open edge editor
  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const d = edge.data as Record<string, unknown> | undefined;
    const lineStyle = (d?.lineStyle as string | undefined) ?? "bezier";
    const label = (edge.label as string | undefined) ?? "";
    setEditingEdge({ id: edge.id, type: lineStyle, label });
  }, []);

  const handleSaveEdge = useCallback((id: string, lineStyle: string, label: string) => {
    setEdges(es => es.map(e => e.id !== id ? e : {
      ...e,
      type: lineStyle,
      label: label || undefined,
      labelStyle: { fill: "#94a3b8", fontSize: 13, fontWeight: 600 },
      labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.85 },
      labelBgPadding: [4, 2] as [number, number],
      data: { ...(e.data as Record<string, unknown> ?? {}), lineStyle },
    }));
  }, [setEdges]);

  // Save label + responsables + color for any node
  const handleSaveNode = useCallback((id: string, newLabel: string, newResponsables: string[], color: string) => {
    updateNodeData(id, { label: newLabel, responsables: newResponsables, color });
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
          <button
            onClick={handleManualSave}
            disabled={saving || loading}
            className={cn("flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50",
              saved
                ? "text-muted-foreground border-border hover:text-foreground hover:bg-secondary"
                : "text-accent border-accent/40 bg-accent/10 hover:bg-accent/20"
            )}>
            {saving
              ? <><Loader2 className="w-3 h-3 animate-spin"/>Guardando...</>
              : saved
              ? <><Check className="w-3 h-3"/>Guardado</>
              : <><Save className="w-3 h-3"/>Guardar</>
            }
          </button>
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
          className="flex-1 bg-card border border-border rounded-xl overflow-hidden relative"
          style={{
            height: 580,
            "--xy-edge-stroke": "#94a3b8",
            "--xy-edge-stroke-width": "1.5",
            "--xy-controls-button-background-color": "transparent",
            "--xy-controls-button-background-color-hover": "rgba(255,255,255,0.1)",
            "--xy-controls-button-border-color": "transparent",
            "--xy-controls-button-color": "white",
            "--xy-controls-background-color": "transparent",
            "--xy-controls-box-shadow": "none",
          } as React.CSSProperties}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin"/>Cargando...
          </div>
        ) : (
          <>
          {loadError && (
            <div className="absolute top-3 left-3 right-3 z-10 bg-red-950/80 border border-red-700/60 rounded-lg px-4 py-2.5 text-xs text-red-300 backdrop-blur-sm">
              <span className="font-semibold text-red-200">Error al cargar diagrama: </span>{loadError}
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={onNodeDoubleClick}
            onEdgeDoubleClick={onEdgeDoubleClick}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES_MAP}
            connectionMode={ConnectionMode.Loose}
            defaultEdgeOptions={{
              style: { stroke: "#6b7280", strokeWidth: 1.5 },
              markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 14, height: 14 },
            }}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            deleteKeyCode={["Backspace","Delete"]}
            proOptions={{ hideAttribution: true }}
            style={{ background: "hsl(var(--card))" }}
          >
            <Background color="#6b7280" gap={24} size={1}/>
            <Controls showInteractive={false}/>
          </ReactFlow>
          </>
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

      {editingEdge && (
        <EdgeEditModal
          edgeId={editingEdge.id}
          initialType={editingEdge.type}
          initialLabel={editingEdge.label}
          onSave={handleSaveEdge}
          onClose={() => setEditingEdge(null)}
        />
      )}

      {editingNode && (
        <NodeEditModal
          nodeId={editingNode.id}
          initialLabel={editingNode.label}
          initialResponsables={editingNode.responsables}
          initialColor={editingNode.color}
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
