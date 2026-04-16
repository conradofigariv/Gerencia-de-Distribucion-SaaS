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
    icon: <div className="w-14 h-7 border-2 border-blue-400 rounded bg-blue-400/10" />,
    defaultWidth: 120,
    defaultHeight: 70,
  },
  {
    type: "startend",
    label: "Inicio/Fin",
    icon: <div className="w-14 h-7 border-2 border-green-400 rounded-full bg-green-400/10" />,
    defaultWidth: 110,
    defaultHeight: 48,
  },
  {
    type: "decision",
    label: "Decisión",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20">
        <polygon points="10,2 18,10 10,18 2,10" fill="amber-400/10" stroke="currentColor" strokeWidth="1.5" className="text-amber-400" />
      </svg>
    ),
    defaultWidth: 80,
    defaultHeight: 50,
  },
  {
    type: "document",
    label: "Documento",
    icon: (
      <svg width="18" height="20" viewBox="0 0 18 20">
        <path d="M2,0 L14,0 L18,4 L18,18 Q18,20 16,20 L2,20 Q0,20 0,18 L0,2 Q0,0 2,0" fill="purple/10" stroke="currentColor" strokeWidth="1.5" className="text-purple-400" />
      </svg>
    ),
    defaultWidth: 120,
    defaultHeight: 65,
  },
  {
    type: "parallelogram",
    label: "Entrada/Salida",
    icon: (
      <svg width="18" height="14" viewBox="0 0 18 14">
        <polygon points="4,0 18,0 14,14 0,14" fill="blue/10" stroke="currentColor" strokeWidth="1.5" className="text-blue-500" />
      </svg>
    ),
    defaultWidth: 120,
    defaultHeight: 60,
  },
  {
    type: "hexagon",
    label: "Preparación",
    icon: (
      <svg width="18" height="16" viewBox="0 0 18 16">
        <polygon points="5,0 13,0 18,8 13,16 5,16 0,8" fill="teal/10" stroke="currentColor" strokeWidth="1.5" className="text-teal-400" />
      </svg>
    ),
    defaultWidth: 110,
    defaultHeight: 70,
  },
];

// ─── Node components ──────────────────────────────────────────────────────────

function ProcessNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  return (
    <>
      <NodeResizer minWidth={80} minHeight={40} isVisible={selected}
        color="#3b82f6"
        lineStyle={{ borderColor: "#3b82f6", borderWidth: 2 }}
        handleStyle={{ background: "#3b82f6", border: "none", width: 8, height: 8, borderRadius: 2 }}
      />
      <Handle type="source" position={Position.Left}   id="left" className="!bg-blue-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Right}  id="right" className="!bg-blue-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Top}    id="top" className="!bg-blue-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Bottom} id="bot" className="!bg-blue-500 !w-2.5 !h-2.5" />
      <div className="w-full h-full rounded-lg border-4 border-blue-500 bg-blue-50 flex flex-col items-center justify-center px-2 py-1.5 text-center cursor-pointer overflow-hidden"
        style={{ boxShadow: selected ? "0 0 0 2px #3b82f6" : "none" }}>
        <p className="text-[11px] font-bold text-slate-900 leading-tight">{d.label}</p>
        {d.sublabel  && <p className="text-[9px] text-slate-600 mt-0.5 leading-tight">{d.sublabel}</p>}
      </div>
    </>
  );
}

function StartEndNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  return (
    <>
      <NodeResizer minWidth={80} minHeight={36} isVisible={selected}
        color="#22c55e"
        lineStyle={{ borderColor: "#22c55e", borderWidth: 2 }}
        handleStyle={{ background: "#22c55e", border: "none", width: 8, height: 8, borderRadius: 2 }}
      />
      <Handle type="source" position={Position.Right} id="right" className="!bg-green-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Left}  id="left"  className="!bg-green-500 !w-2.5 !h-2.5" />
      <div className="w-full h-full rounded-full border-4 border-green-500 bg-green-50 flex items-center justify-center px-3 py-1 overflow-hidden"
        style={{ boxShadow: selected ? "0 0 0 2px #22c55e" : "none" }}>
        <p className="text-[10px] font-bold text-green-900 leading-tight text-center">{d.label}</p>
      </div>
    </>
  );
}

function DecisionNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  return (
    <>
      <NodeResizer minWidth={70} minHeight={44} isVisible={selected}
        color="#f59e0b"
        lineStyle={{ borderColor: "#f59e0b", borderWidth: 2 }}
        handleStyle={{ background: "#f59e0b", border: "none", width: 8, height: 8, borderRadius: 2 }}
      />
      <Handle type="source" position={Position.Left}   id="left"  className="!bg-amber-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Right}  id="right" className="!bg-amber-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Bottom} id="bot"   className="!bg-amber-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Top}    id="top"   className="!bg-amber-500 !w-2.5 !h-2.5" />
      <div className="w-full h-full flex items-center justify-center overflow-hidden" style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)", backgroundColor: "#fef3c7", border: "3px solid #f59e0b", boxShadow: selected ? "0 0 0 2px #f59e0b" : "none" }}>
        <p className="text-[10px] font-bold text-amber-900 text-center leading-tight px-3">{d.label}</p>
      </div>
    </>
  );
}

function DocumentNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  return (
    <>
      <NodeResizer minWidth={90} minHeight={44} isVisible={selected}
        color="#9333ea"
        lineStyle={{ borderColor: "#9333ea", borderWidth: 2 }}
        handleStyle={{ background: "#9333ea", border: "none", width: 8, height: 8, borderRadius: 2 }}
      />
      <Handle type="source" position={Position.Top}    id="top"   className="!bg-purple-600 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Bottom} id="bot"   className="!bg-purple-600 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Left}   id="left"  className="!bg-purple-600 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Right}  id="right" className="!bg-purple-600 !w-2.5 !h-2.5" />
      <div className="w-full h-full border-4 border-purple-500 rounded-tl-lg bg-purple-50 flex items-center justify-center px-2 py-1 overflow-hidden relative"
        style={{ boxShadow: selected ? "0 0 0 2px #9333ea" : "none" }}>
        <div className="absolute top-0 right-0 w-3 h-3 border-l-4 border-b-4 border-purple-500" />
        <p className="text-[10px] font-bold text-purple-900 text-center leading-tight">{d.label}</p>
      </div>
    </>
  );
}

function ParallelogramNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  return (
    <>
      <NodeResizer minWidth={80} minHeight={40} isVisible={selected}
        color="#0ea5e9"
        lineStyle={{ borderColor: "#0ea5e9", borderWidth: 2 }}
        handleStyle={{ background: "#0ea5e9", border: "none", width: 8, height: 8, borderRadius: 2 }}
      />
      <Handle type="source" position={Position.Left}   id="left"  className="!bg-cyan-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Right}  id="right" className="!bg-cyan-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Top}    id="top"   className="!bg-cyan-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Bottom} id="bot"   className="!bg-cyan-500 !w-2.5 !h-2.5" />
      <div className="w-full h-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: "#cffafe", border: "3px solid #0ea5e9", transform: "skewX(-10deg)", boxShadow: selected ? "0 0 0 2px #0ea5e9" : "none" }}>
        <p className="text-[10px] font-bold text-cyan-900 text-center leading-tight px-3" style={{ transform: "skewX(10deg)" }}>{d.label}</p>
      </div>
    </>
  );
}

function HexagonNode({ data, selected }: NodeProps) {
  const d = data as unknown as PasoData;
  return (
    <>
      <NodeResizer minWidth={80} minHeight={50} isVisible={selected}
        color="#14b8a6"
        lineStyle={{ borderColor: "#14b8a6", borderWidth: 2 }}
        handleStyle={{ background: "#14b8a6", border: "none", width: 8, height: 8, borderRadius: 2 }}
      />
      <Handle type="source" position={Position.Left}   id="left"  className="!bg-teal-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Right}  id="right" className="!bg-teal-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Top}    id="top"   className="!bg-teal-500 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Bottom} id="bot"   className="!bg-teal-500 !w-2.5 !h-2.5" />
      <div className="w-full h-full flex items-center justify-center overflow-hidden" style={{ clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)", backgroundColor: "#ccfbf1", border: "3px solid #14b8a6", boxShadow: selected ? "0 0 0 2px #14b8a6" : "none" }}>
        <p className="text-[10px] font-bold text-teal-900 text-center leading-tight px-3">{d.label}</p>
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
    data: { label: label || shapeConfig.label },
  };
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
    <div className="flex flex-col gap-2">
      {SHAPES.map((shape) => (
        <div
          key={shape.type}
          draggable
          onDragStart={(e) => onDragStart(e, shape.type)}
          className="flex flex-col items-center gap-2 p-2 rounded-lg border border-border bg-secondary/40 hover:bg-secondary/70 hover:border-accent/50 cursor-move transition-all"
          title={`Arrastra para agregar ${shape.label}`}
        >
          <div className="flex items-center justify-center h-10">
            {shape.icon}
          </div>
          <span className="text-[11px] text-muted-foreground text-center leading-tight">{shape.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Label edit modal ────────────────────────────────────────────────────────

interface LabelEditModalProps {
  nodeId: string;
  initialLabel: string;
  isPaso: boolean;
  onSave: (id: string, label: string) => void;
  onClose: () => void;
  onEditResponsables?: () => void;
}

function LabelEditModal({ nodeId, initialLabel, isPaso, onSave, onClose, onEditResponsables }: LabelEditModalProps) {
  const [label, setLabel] = useState(initialLabel);

  const save = () => {
    if (!label.trim()) return;
    onSave(nodeId, label.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Editar nombre del objeto</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4"/></button>
        </div>
        <input
          autoFocus
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
          className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
        />
        <div className="flex items-center justify-between">
          {isPaso && onEditResponsables ? (
            <button onClick={onEditResponsables} className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors">
              <Users className="w-3.5 h-3.5"/>Editar responsables
            </button>
          ) : <span/>}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">Cancelar</button>
            <button onClick={save} className="px-4 py-2 rounded-lg text-sm bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 transition-colors">
              <Check className="w-3.5 h-3.5"/>Guardar
            </button>
          </div>
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
  const { screenToFlowPosition } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const [responsables, setResponsables] = useState<Record<string,string[]>>({});
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState<string|null>(null);
  const [editingLabel, setEditingLabel] = useState<{ id: string; label: string } | null>(null);
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

  // Double-click node → open label editor (for all nodes)
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    const d = node.data as unknown as PasoData;
    setEditingLabel({ id: node.id, label: d.label ?? "" });
  }, []);

  // Save label changes directly in node data
  const handleSaveLabel = useCallback((id: string, newLabel: string) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, label: newLabel } } : n));
  }, [setNodes]);

  const handleSaveResp = useCallback((id: string, list: string[]) => {
    const next = { ...responsables, [id]: list };
    setResponsables(next);
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, responsables: list } } : n));
  }, [responsables]);

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
        <div className="w-32 bg-card border border-border rounded-xl px-3 py-4 overflow-y-auto max-h-[600px]">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">Agregar forma</p>
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
              className="[&>button]:bg-secondary [&>button]:border-border [&>button]:text-foreground [&>button:hover]:bg-secondary/80"/>
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

      {editingLabel && (
        <LabelEditModal
          nodeId={editingLabel.id}
          initialLabel={editingLabel.label}
          isPaso={PASO_IDS.includes(editingLabel.id)}
          onSave={handleSaveLabel}
          onClose={() => setEditingLabel(null)}
          onEditResponsables={PASO_IDS.includes(editingLabel.id) ? () => {
            const id = editingLabel.id;
            setEditingLabel(null);
            setEditing(id);
          } : undefined}
        />
      )}

      {editing && (
        <EditModal pasoId={editing} initial={responsables[editing]??[]} onSave={handleSaveResp} onClose={()=>setEditing(null)}/>
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
