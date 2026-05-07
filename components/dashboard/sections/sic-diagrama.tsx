"use client";

import {
  useCallback, useEffect, useRef, useState,
  DragEvent, ReactNode, Component,
} from "react";
import {
  ReactFlow, Background, BackgroundVariant, Controls,
  useNodesState, useEdgesState, addEdge,
  NodeResizer, ConnectionMode, ReactFlowProvider, useReactFlow,
  EdgeLabelRenderer,
  type Node, type Edge, type NodeProps, type EdgeProps, type Connection,
  Handle, Position, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { X, Plus, Trash2, Check, Loader2, Users, Save, RotateCcw, Upload, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SICHighlight {
  sicNumero: string;
  sec: number;
  fecha: string;
  nota: string;
  person: string;
}

interface PasoData {
  label: string;
  sublabel?: string;
  active?: boolean;
  responsables?: string[];
  createdAt?: string;
  color?: string;
  sec?: number;
  nota?: string;
  highlighted?: SICHighlight;
}

// ─── Color palette ────────────────────────────────────────────────────────────

const NODE_COLORS = [
  "#2dd4bf","#34d399","#f59e0b","#22d3ee",
  "#60a5fa","#c084fc","#ef4444","#ec4899",
  "#f97316","#6366f1","#64748b","#e2e8f0",
];

function getGlow(color: string): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return "rgba(52,211,153,.45)";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},.45)`;
}

function hexToRgba(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return `rgba(52,211,153,${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getDays(createdAt?: string): string | null {
  if (!createdAt) return null;
  const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (diff === 0) return "Hoy";
  return diff === 1 ? "1 día" : `${diff} días`;
}

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
    type: "process", label: "Actividad", defaultWidth: 160, defaultHeight: 90, defaultColor: "#60a5fa",
    icon: (
      <div className="w-full h-12 relative flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 60" preserveAspectRatio="none" style={{ filter: "drop-shadow(0 0 6px rgba(96,165,250,.5))", overflow: "visible" }}>
          <rect x="4" y="4" width="92" height="52" rx="10" fill="rgba(96,165,250,.07)" stroke="#60a5fa" strokeWidth="1.5"/>
        </svg>
        <span className="relative z-10 text-[10px] font-semibold" style={{ color: "#60a5fa" }}>Actividad</span>
      </div>
    ),
  },
  {
    type: "startend", label: "Inicio / Fin", defaultWidth: 150, defaultHeight: 70, defaultColor: "#34d399",
    icon: (
      <div className="w-full h-12 relative flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 60" preserveAspectRatio="none" style={{ filter: "drop-shadow(0 0 6px rgba(52,211,153,.5))", overflow: "visible" }}>
          <rect x="4" y="4" width="92" height="52" rx="26" fill="rgba(52,211,153,.07)" stroke="#34d399" strokeWidth="1.5"/>
        </svg>
        <span className="relative z-10 text-[10px] font-semibold" style={{ color: "#34d399" }}>Inicio/Fin</span>
      </div>
    ),
  },
  {
    type: "decision", label: "Decisión", defaultWidth: 150, defaultHeight: 90, defaultColor: "#f59e0b",
    icon: (
      <div className="w-full h-12 relative flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 60" preserveAspectRatio="none" style={{ filter: "drop-shadow(0 0 6px rgba(245,158,11,.5))", overflow: "visible" }}>
          <polygon points="50,4 96,30 50,56 4,30" fill="rgba(245,158,11,.07)" stroke="#f59e0b" strokeWidth="1.5"/>
        </svg>
        <span className="relative z-10 text-[10px] font-semibold" style={{ color: "#f59e0b" }}>Decisión</span>
      </div>
    ),
  },
  {
    type: "document", label: "Documento", defaultWidth: 155, defaultHeight: 95, defaultColor: "#c084fc",
    icon: (
      <div className="w-full h-12 relative flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 70" preserveAspectRatio="none" style={{ filter: "drop-shadow(0 0 6px rgba(192,132,252,.5))", overflow: "visible" }}>
          <path d="M4,4 L70,4 L96,26 L96,66 Q50,78 4,66 Z" fill="rgba(192,132,252,.07)" stroke="#c084fc" strokeWidth="1.5"/>
          <path d="M70,4 L70,26 L96,26" style={{ fill: "none" }} stroke="#c084fc" strokeWidth="1.5"/>
        </svg>
        <span className="relative z-10 text-[10px] font-semibold" style={{ color: "#c084fc" }}>Documento</span>
      </div>
    ),
  },
  {
    type: "parallelogram", label: "Entrada / Salida", defaultWidth: 160, defaultHeight: 80, defaultColor: "#22d3ee",
    icon: (
      <div className="w-full h-12 relative flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 60" preserveAspectRatio="none" style={{ filter: "drop-shadow(0 0 6px rgba(34,211,238,.5))", overflow: "visible" }}>
          <polygon points="20,4 96,4 80,56 4,56" fill="rgba(34,211,238,.07)" stroke="#22d3ee" strokeWidth="1.5"/>
        </svg>
        <span className="relative z-10 text-[10px] font-semibold" style={{ color: "#22d3ee" }}>E / S</span>
      </div>
    ),
  },
  {
    type: "hexagon", label: "Preparación", defaultWidth: 165, defaultHeight: 100, defaultColor: "#2dd4bf",
    icon: (
      <div className="w-full h-12 relative flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 60" preserveAspectRatio="none" style={{ filter: "drop-shadow(0 0 6px rgba(45,212,191,.5))", overflow: "visible" }}>
          <polygon points="22,4 78,4 96,30 78,56 22,56 4,30" fill="rgba(45,212,191,.07)" stroke="#2dd4bf" strokeWidth="1.5"/>
        </svg>
        <span className="relative z-10 text-[10px] font-semibold" style={{ color: "#2dd4bf" }}>Preparación</span>
      </div>
    ),
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildNodes(_responsables: Record<string, string[]>): Node[] { return []; }

function createNewNode(type: string, x: number, y: number): Node {
  const cfg = SHAPES.find(s => s.type === type);
  if (!cfg) return { id: "", type: "process", position: { x, y }, data: {} };
  return {
    id: `${type}-${Date.now()}`,
    type,
    position: { x, y },
    width: cfg.defaultWidth,
    height: cfg.defaultHeight,
    data: { label: cfg.label, createdAt: new Date().toISOString(), color: cfg.defaultColor },
  };
}

// ─── Neon handle component ────────────────────────────────────────────────────

function NeonHandles({ color }: { color: string }) {
  const glow = getGlow(color);
  const s: React.CSSProperties = {
    background: color,
    width: 11, height: 11,
    borderRadius: "50%",
    border: "none",
    boxShadow: `0 0 0 3px #070912, 0 0 14px ${glow}`,
    color,
  };
  return (<>
    <Handle type="source" position={Position.Left}   id="left"   style={s} className="sic-handle-ring" />
    <Handle type="source" position={Position.Right}  id="right"  style={s} className="sic-handle-ring" />
    <Handle type="source" position={Position.Top}    id="top"    style={s} className="sic-handle-ring" />
    <Handle type="source" position={Position.Bottom} id="bot"    style={s} className="sic-handle-ring" />
  </>);
}

// ─── Shared neon node base ────────────────────────────────────────────────────

interface NeonNodeBaseProps {
  data: PasoData;
  selected: boolean;
  defaultColor: string;
  minWidth?: number;
  minHeight?: number;
  shapeSvg: ReactNode;
  shapeViewBox?: string;
  iconSvg: ReactNode;
}

function NeonNodeBase({ data: d, selected, defaultColor, minWidth = 80, minHeight = 50, shapeSvg, shapeViewBox = "0 0 100 100", iconSvg }: NeonNodeBaseProps) {
  const color   = d.color ?? defaultColor;
  const glow    = getGlow(color);
  const fill    = hexToRgba(color, 0.06);
  const fillHov = hexToRgba(color, 0.12);
  const owner   = d.responsables?.[0];
  const initials = owner ? owner.split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase() : null;

  return (<>
    <NodeResizer
      minWidth={minWidth} minHeight={minHeight} isVisible={selected} color={color}
      lineStyle={{ borderColor: color, borderWidth: 1.5 }}
      handleStyle={{ background: color, border: "none", width: 8, height: 8, borderRadius: 2 }}
    />
    <NeonHandles color={color} />
    <div
      className={cn("sic-node w-full h-full relative flex flex-col items-center justify-center", d.highlighted && "sic-node-active")}
      style={{
        "--node-c": color,
        "--node-glow": glow,
        "--node-fill": fill,
        "--node-fill-hover": fillHov,
      } as React.CSSProperties}
    >
      {/* Shape SVG */}
      <svg
        className="sic-node-svg absolute inset-0 w-full h-full"
        viewBox={shapeViewBox}
        preserveAspectRatio="none"
      >
        {shapeSvg}
      </svg>

      {/* Inner top sheen */}
      <div
        className="absolute pointer-events-none z-[1]"
        style={{ inset: 1, borderRadius: "inherit", background: "linear-gradient(180deg,rgba(255,255,255,.04),transparent 30%)" }}
      />

      {/* Icon badge */}
      <div
        className="absolute top-0 left-3 z-20 w-[22px] h-[22px] rounded-[7px] flex items-center justify-center -translate-y-1/2"
        style={{
          background: "rgba(7,9,18,.95)",
          border: `1px solid ${color}`,
          color,
          boxShadow: `0 0 16px ${glow}, inset 0 1px 0 rgba(255,255,255,.06)`,
        }}
      >
        {iconSvg}
      </div>

      {/* Content */}
      <div className="relative z-20 flex flex-col items-center gap-1 px-4 text-center w-full mt-1">
        <span
          className="text-[12px] font-semibold leading-tight"
          style={{ color, textShadow: `0 0 16px ${glow}` }}
        >
          {d.label}
        </span>

        {owner && (
          <div
            className="inline-flex items-center gap-1 mt-0.5 rounded-full text-[9px] font-medium"
            style={{
              padding: "2px 6px 2px 3px",
              background: "rgba(255,255,255,.04)",
              border: "1px solid rgba(255,255,255,.10)",
              color: "#c8cad6",
            }}
          >
            <div style={{ width: 14, height: 14, borderRadius: "50%", background: `linear-gradient(135deg, ${color}, ${hexToRgba(color, 0.4)})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#0b0e1a", flexShrink: 0 }}>
              {initials}
            </div>
            <span className="truncate max-w-[80px]">{owner}</span>
          </div>
        )}

        {d.nota && (
          <div className="text-[8px] italic leading-tight text-center mt-0.5 px-2 w-full" style={{ color, opacity: 0.55 }}>
            {d.nota.length > 50 ? d.nota.slice(0, 47) + "…" : d.nota}
          </div>
        )}
      </div>

      {/* Sec number badge (top-right) */}
      {d.sec != null && (
        <div
          className="absolute top-0 right-3 z-20 w-[22px] h-[22px] rounded-[7px] flex items-center justify-center text-[9px] font-bold -translate-y-1/2"
          style={{ background: "rgba(7,9,18,.95)", border: `1px solid ${color}`, color, boxShadow: `0 0 8px ${glow}` }}
        >
          {d.sec}
        </div>
      )}
    </div>
  </>);
}

// ─── Node type components ─────────────────────────────────────────────────────

function ProcessNode({ data, selected }: NodeProps) {
  return (
    <NeonNodeBase data={data as unknown as PasoData} selected={!!selected} defaultColor="#60a5fa" minWidth={100} minHeight={55}
      shapeSvg={<rect x="4" y="4" width="92" height="92" rx="12" />}
      iconSvg={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width={11} height={11}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>}
    />
  );
}

function StartEndNode({ data, selected }: NodeProps) {
  return (
    <NeonNodeBase data={data as unknown as PasoData} selected={!!selected} defaultColor="#34d399" minWidth={100} minHeight={48}
      shapeSvg={<rect x="4" y="4" width="92" height="92" rx="46" />}
      iconSvg={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width={11} height={11}><polygon points="6 4 20 12 6 20 6 4"/></svg>}
    />
  );
}

function DecisionNode({ data, selected }: NodeProps) {
  return (
    <NeonNodeBase data={data as unknown as PasoData} selected={!!selected} defaultColor="#f59e0b" minWidth={90} minHeight={56}
      shapeSvg={<polygon points="50,4 96,50 50,96 4,50" />}
      iconSvg={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width={11} height={11}><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><circle cx="12" cy="12" r="3"/></svg>}
    />
  );
}

function DocumentNode({ data, selected }: NodeProps) {
  return (
    <NeonNodeBase data={data as unknown as PasoData} selected={!!selected} defaultColor="#c084fc" minWidth={100} minHeight={55} shapeViewBox="0 0 100 110"
      shapeSvg={<>
        <path d="M4,4 L70,4 L96,26 L96,92 Q50,106 4,92 Z" />
        <path d="M70,4 L70,26 L96,26" style={{ fill: "none" }} />
      </>}
      iconSvg={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width={11} height={11}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
    />
  );
}

function ParallelogramNode({ data, selected }: NodeProps) {
  return (
    <NeonNodeBase data={data as unknown as PasoData} selected={!!selected} defaultColor="#22d3ee" minWidth={100} minHeight={50}
      shapeSvg={<polygon points="20,4 96,4 80,96 4,96" />}
      iconSvg={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width={11} height={11}><path d="M3 7h13l5 5-5 5H3"/><path d="M3 12h11"/></svg>}
    />
  );
}

function HexagonNode({ data, selected }: NodeProps) {
  return (
    <NeonNodeBase data={data as unknown as PasoData} selected={!!selected} defaultColor="#2dd4bf" minWidth={100} minHeight={60}
      shapeSvg={<polygon points="26,4 74,4 97,50 74,96 26,96 3,50" />}
      iconSvg={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width={11} height={11}><path d="M12 2 4 6v6c0 5 3.5 9.4 8 10 4.5-.6 8-5 8-10V6l-8-4Z"/></svg>}
    />
  );
}

const NODE_TYPES = {
  process: ProcessNode, startend: StartEndNode, decision: DecisionNode,
  document: DocumentNode, parallelogram: ParallelogramNode, hexagon: HexagonNode,
};

// ─── Default edges ────────────────────────────────────────────────────────────

const DEFAULT_EDGES: Edge[] = [];

// ─── Neon edge (gradient + animated dot + bendable) ───────────────────────────

function NeonEdge({ id, sourceX, sourceY, targetX, targetY, data, selected, label }: EdgeProps) {
  const { setEdges, screenToFlowPosition } = useReactFlow();
  const d = data as Record<string, unknown> | undefined;

  const lineStyle  = (d?.lineStyle  as string | undefined) ?? "bezier";
  const isStep     = lineStyle === "step";
  const isStraight = lineStyle === "straight";
  const srcColor   = (d?.sourceColor as string | undefined) ?? "#34d399";
  const tgtColor   = (d?.targetColor as string | undefined) ?? "#34d399";

  const cpX     = (d?.cpX     as number | undefined) ?? (sourceX + targetX) / 2;
  const cpY     = (d?.cpY     as number | undefined) ?? (sourceY + targetY) / 2;
  const bridgeY = (d?.bridgeY as number | undefined) ?? (sourceY + targetY) / 2;

  const edgePath = isStep
    ? `M${sourceX},${sourceY} L${sourceX},${bridgeY} L${targetX},${bridgeY} L${targetX},${targetY}`
    : isStraight
    ? `M${sourceX},${sourceY} L${targetX},${targetY}`
    : `M${sourceX},${sourceY} Q${cpX},${cpY} ${targetX},${targetY}`;

  const labelX = isStep ? (sourceX + targetX) / 2
    : isStraight ? (sourceX + targetX) / 2
    : 0.25 * sourceX + 0.5 * cpX + 0.25 * targetX;
  const labelY = isStep ? bridgeY
    : isStraight ? (sourceY + targetY) / 2
    : 0.25 * sourceY + 0.5 * cpY + 0.25 * targetY;

  const gradId = `sicg-${id}`;
  const pathId = `sicp-${id}`;
  const markId = `sicm-${id}`;

  const startDrag = useCallback(
    (update: (x: number, y: number) => Record<string, unknown>) =>
    (e: React.MouseEvent) => {
      e.stopPropagation(); e.preventDefault();
      const move = (mv: MouseEvent) => {
        const p = screenToFlowPosition({ x: mv.clientX, y: mv.clientY });
        setEdges(es => es.map(edge => edge.id !== id ? edge : {
          ...edge, data: { ...(edge.data as Record<string, unknown> ?? {}), ...update(p.x, p.y) },
        }));
      };
      const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [id, screenToFlowPosition, setEdges],
  );

  const onBezierDrag = startDrag((x, y) => ({ cpX: x, cpY: y }));
  const onBridgeDrag = startDrag((_, y) => ({ bridgeY: y }));

  const bendDot = (hx: number, hy: number, handler: (e: React.MouseEvent) => void, square?: boolean) => (
    <div
      style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${hx}px,${hy}px)`, pointerEvents: "all" }}
      className="nodrag nopan" onMouseDown={handler}
    >
      <div
        className="w-3 h-3 cursor-grab hover:scale-125 transition-all"
        style={{
          background: "#0b0e1a",
          border: square ? "1.5px solid #93c5fd" : "1.5px solid #fbbf24",
          borderRadius: square ? 3 : "50%",
          transform: square ? "rotate(45deg)" : undefined,
          boxShadow: square ? "0 0 10px rgba(147,197,253,.5)" : "0 0 10px rgba(251,191,36,.5)",
        }}
      />
    </div>
  );

  return (
    <>
      <defs>
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor={srcColor} />
          <stop offset="100%" stopColor={tgtColor} />
        </linearGradient>
        <marker id={markId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={tgtColor} />
        </marker>
      </defs>

      {/* Edge path */}
      <path
        id={pathId}
        d={edgePath}
        className="react-flow__edge-path sic-edge-flow"
        style={{
          stroke: `url(#${gradId})`,
          strokeWidth: selected ? 3 : 2,
          fill: "none",
          strokeDasharray: "6 6",
          markerEnd: `url(#${markId})`,
          ...(selected ? { filter: `drop-shadow(0 0 6px ${srcColor})` } : {}),
        }}
      />

      {/* Animated travelling dot */}
      <circle r="3" fill="white" style={{ filter: "drop-shadow(0 0 5px rgba(255,255,255,.8))" }}>
        {/* @ts-expect-error animateMotion / mpath SMIL elements */}
        <animateMotion dur="2s" repeatCount="indefinite" calcMode="linear">
          <mpath href={`#${pathId}`} />
        </animateMotion>
      </circle>

      {/* Bend handle when selected */}
      {selected && !isStraight && (
        <EdgeLabelRenderer>
          {isStep
            ? bendDot((sourceX + targetX) / 2, bridgeY, onBridgeDrag, true)
            : bendDot(cpX, cpY, onBezierDrag, false)
          }
        </EdgeLabelRenderer>
      )}

      {/* Label */}
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              background: "rgba(11,14,26,.85)",
              border: "1px solid rgba(255,255,255,.15)",
              color: "#c8cad6",
              backdropFilter: "blur(8px)",
            }}
          >
            {label as string}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const EDGE_TYPES_MAP = {
  default: NeonEdge, bezier: NeonEdge, smoothstep: NeonEdge,
  step: NeonEdge, straight: NeonEdge,
};

// ─── Shape palette ────────────────────────────────────────────────────────────

function ShapePalette() {
  const onDragStart = (e: DragEvent<HTMLDivElement>, shapeType: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/reactflow", shapeType);
  };

  return (
    <div className="flex flex-col gap-2">
      {SHAPES.map((shape) => (
        <div
          key={shape.type}
          draggable
          onDragStart={(e) => onDragStart(e, shape.type)}
          className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg cursor-grab active:cursor-grabbing transition-all select-none"
          style={{
            border: "1px solid rgba(255,255,255,.07)",
            background: "rgba(255,255,255,.02)",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.border = `1px solid ${shape.defaultColor}50`;
            (e.currentTarget as HTMLElement).style.background = `${hexToRgba(shape.defaultColor, 0.06)}`;
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.border = "1px solid rgba(255,255,255,.07)";
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.02)";
          }}
          title={`Arrastra para agregar ${shape.label}`}
        >
          <div className="w-full h-12 flex items-center justify-center">
            {shape.icon}
          </div>
          <span className="text-[9px] font-medium text-center leading-tight" style={{ color: shape.defaultColor, opacity: 0.8 }}>
            {shape.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Node edit modal ──────────────────────────────────────────────────────────

interface NodeEditModalProps {
  nodeId: string;
  initialLabel: string;
  initialResponsables: string[];
  initialColor: string;
  onSave: (id: string, label: string, responsables: string[], color: string) => void;
  onClose: () => void;
}

function NodeEditModal({ nodeId, initialLabel, initialResponsables, initialColor, onSave, onClose }: NodeEditModalProps) {
  const [label, setLabel]           = useState(initialLabel);
  const [responsables, setResp]     = useState<string[]>(initialResponsables);
  const [input, setInput]           = useState("");
  const [color, setColor]           = useState(initialColor);

  const add = () => {
    const v = input.trim();
    if (!v || responsables.includes(v)) return;
    setResp(r => [...r, v]);
    setInput("");
  };

  const save = () => {
    if (!label.trim()) return;
    onSave(nodeId, label.trim(), responsables, color);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Editar objeto</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4"/></button>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium">Título</p>
          <input autoFocus value={label} onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
            className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5"/>Encargados
          </p>
          {responsables.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-1.5">Sin encargados</p>
          )}
          {responsables.map((p, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-secondary text-sm">
              <span className="text-foreground">{p}</span>
              <button onClick={() => setResp(r => r.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="w-3.5 h-3.5"/>
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
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
                style={{ backgroundColor: c, outline: color === c ? "2px solid white" : "2px solid transparent", outlineOffset: 2, opacity: color === c ? 1 : 0.55, boxShadow: color === c ? `0 0 10px ${c}` : undefined }}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
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
          <input value={label} onChange={e => setLabel(e.target.value)}
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

// ─── SIC text parser ─────────────────────────────────────────────────────────
// Formato: Realizado Por \t\t Sec \t Fecha \t Rev \t Acción \t Nota

interface SICRow { person: string; sec: number; fecha: string; accion: string; nota: string }

interface SICRecord {
  sicNumero: string;
  steps: SICRow[];
  stepIndex: number;
  updatedAt?: string;
}

const SIC_SELECTION_KEY = "sic-diagrama-selected";

function parseFechaSIC(s: string): string {
  // "dd/mm/yyyy hh:mm:ss" → ISO
  const [datePart, timePart = "00:00:00"] = s.trim().split(" ");
  const [d, m, y] = datePart.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${timePart}`;
}

function parseSICText(text: string): SICRow[] {
  return text
    .trim()
    .split("\n")
    .map(l => l.split("\t"))
    .filter(c => {
      const name = c[0]?.trim();
      const sec  = parseInt(c[2]?.trim() ?? "");
      return name && name !== "Realizado Por" && !isNaN(sec);
    })
    .map(c => ({
      person: c[0].trim(),
      sec:    parseInt(c[2].trim()),
      fecha:  c[3]?.trim() ?? "",
      accion: c[5]?.trim() ?? "",
      nota:   c[6]?.trim() ?? "",
    }))
    .sort((a, b) => a.sec - b.sec);
}

function getActionColor(accion: string): string {
  switch (accion.toLowerCase()) {
    case "ejecutar": return "#60a5fa";
    case "aprobar":  return "#34d399";
    case "reenviar": return "#f59e0b";
    case "reserva":  return "#2dd4bf";
    default:         return "#8a8fa6";
  }
}

function findNodeForPerson(nodes: Node[], person: string): { id: string; label: string } | null {
  for (const n of nodes) {
    const d = n.data as PasoData | undefined;
    if (d?.responsables?.includes(person)) {
      return { id: n.id, label: d.label ?? "" };
    }
  }
  return null;
}

// ─── SIC Import modal ─────────────────────────────────────────────────────────

function SICImportModal({ nodes, onImport, onClose }: {
  nodes: Node[];
  onImport: (rows: SICRow[], sicNumero: string) => void;
  onClose: () => void;
}) {
  const [text, setText]     = useState("");
  const [sicNumero, setNum] = useState("");
  const [parsed, setParsed] = useState<SICRow[] | null>(null);
  const [error, setError]   = useState("");

  const lastRow   = parsed && parsed.length > 0 ? parsed[parsed.length - 1] : null;
  const lastMatch = lastRow ? findNodeForPerson(nodes, lastRow.person) : null;
  const found     = lastMatch != null;

  const parse = () => {
    try {
      const rows = parseSICText(text);
      if (!rows.length) { setError("No se encontraron pasos válidos. Verificá el formato."); return; }
      setParsed(rows);
      setError("");
    } catch (e) {
      setError(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const confirm = () => {
    if (!parsed) return;
    onImport(parsed, sicNumero.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Ubicar SIC en diagrama</p>
            <p className="text-xs text-muted-foreground mt-0.5">Copiá la tabla de seguimiento desde SIGA</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4"/></button>
        </div>

        {!parsed ? (
          <>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">Número de SIC</p>
              <input
                autoFocus
                value={sicNumero}
                onChange={e => setNum(e.target.value)}
                placeholder="Ej: SIC-2026-0042"
                className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">Texto de la tabla SIGA</p>
              <textarea
                value={text}
                onChange={e => { setText(e.target.value); setError(""); setParsed(null); }}
                placeholder={"Realizado Por\t\tSec\tFecha\tRev\tAcción\tNota\nCalandri, Roman Oscar\t\t12\t15/04/2026 11:59:58\t\tReserva\t\n..."}
                rows={7}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 font-mono focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent resize-none"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              onClick={parse}
              disabled={!text.trim()}
              className="w-full py-2 rounded-lg text-sm bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              <Check className="w-3.5 h-3.5"/>Analizar
            </button>
          </>
        ) : (
          <>
            {sicNumero && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(45,212,191,.08)", border: "1px solid rgba(45,212,191,.25)" }}>
                <span className="text-xs text-muted-foreground">SIC</span>
                <span className="text-sm font-semibold" style={{ color: "#2dd4bf" }}>{sicNumero}</span>
              </div>
            )}

            <div className="rounded-lg border p-4 space-y-2" style={{
              borderColor: found ? "rgba(52,211,153,.3)" : "rgba(245,158,11,.3)",
              background:  found ? "rgba(52,211,153,.05)" : "rgba(245,158,11,.05)",
            }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: found ? "#34d399" : "#f59e0b" }}>
                  {found ? "Nodo encontrado en el último paso" : "Último paso sin nodo asignado"}
                </span>
                <span className="text-[10px] text-muted-foreground">{parsed.length} paso{parsed.length === 1 ? "" : "s"}</span>
              </div>
              {lastRow && (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mt-2">
                    <div>
                      <p className="text-muted-foreground">Responsable</p>
                      <p className="font-medium text-foreground mt-0.5">{lastRow.person}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Sec.</p>
                      <p className="font-medium text-foreground mt-0.5">{lastRow.sec}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Fecha</p>
                      <p className="font-medium text-foreground mt-0.5">{lastRow.fecha.split(" ")[0]}</p>
                    </div>
                    {lastRow.accion && (
                      <div>
                        <p className="text-muted-foreground">Acción</p>
                        <p className="font-medium mt-0.5" style={{ color: getActionColor(lastRow.accion) }}>{lastRow.accion}</p>
                      </div>
                    )}
                  </div>
                  {lastRow.nota && (
                    <p className="text-[10px] text-muted-foreground italic border-t border-border/50 pt-2">{lastRow.nota}</p>
                  )}
                  {found && (
                    <p className="text-[10px] mt-1" style={{ color: "#34d399" }}>
                      → Nodo: <span className="font-semibold">{lastMatch!.label}</span>
                    </p>
                  )}
                  {!found && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Ningún nodo tiene <span className="font-medium text-foreground">{lastRow.person}</span> como encargado. Se importará igual; usá los botones prev/next para revisar paso a paso.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="rounded-lg border border-border max-h-32 overflow-y-auto">
              {parsed.map((row, i) => {
                const c = getActionColor(row.accion);
                const matched = findNodeForPerson(nodes, row.person) != null;
                return (
                  <div key={row.sec} className="grid grid-cols-[24px_1fr_60px_14px] items-center gap-2 px-2 py-1 border-b border-border/40 last:border-0 text-[11px]">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0" style={{ background: hexToRgba(c, 0.15), color: c, border: `1px solid ${hexToRgba(c, 0.4)}` }}>{row.sec}</span>
                    <span className="truncate text-muted-foreground">{row.person}</span>
                    <span className="font-medium truncate" style={{ color: c }}>{row.accion}</span>
                    <span title={matched ? "Match" : "Sin nodo"} className="text-[10px]" style={{ color: matched ? "#34d399" : "#64748b" }}>{matched ? "●" : "○"}</span>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setParsed(null)} className="flex-1 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                ← Editar texto
              </button>
              <button
                onClick={confirm}
                className="flex-1 py-2 rounded-lg text-sm bg-accent text-accent-foreground hover:bg-accent/90 flex items-center justify-center gap-2 transition-colors"
              >
                <Upload className="w-3.5 h-3.5"/>Importar SIC
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function SicDiagramaInner() {
  const { screenToFlowPosition, updateNodeData } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<{ id: string; label: string; responsables: string[]; color: string } | null>(null);
  const [editingEdge, setEditingEdge] = useState<{ id: string; type: string; label: string } | null>(null);
  const [saved, setSaved]         = useState(true);
  const [saving, setSaving]       = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sicList, setSicList] = useState<SICRecord[]>([]);
  const [selectedSicNumero, setSelectedSicNumero] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes({}));
  const [edges, setEdges, onEdgesChange] = useEdgesState(DEFAULT_EDGES);

  // Load saved layout + SICs from Supabase
  useEffect(() => {
    (async () => {
      try {
        const [layoutRes, sicsRes] = await Promise.all([
          supabase.from("sic_diagrama_layout").select("*").eq("id", "main").single(),
          supabase.from("sic_diagrama_active").select("*").order("updated_at", { ascending: false }),
        ]);

        if (layoutRes.error) {
          const code = layoutRes.error.code ?? "";
          const msg  = layoutRes.error.message ?? "";
          if (code === "PGRST116") {
            // no rows — empty canvas
          } else if (msg.includes("Invalid api key") || msg.includes("Invalid API key")) {
            setLoadError("Supabase no configurado. Verificá NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.");
          } else {
            setLoadError(`No se pudo cargar: ${msg}${code ? ` (${code})` : ""}`);
          }
          setLoading(false);
          return;
        }

        if (layoutRes.data?.nodes) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const savedNodes: any[] = layoutRes.data.nodes;
          const validPos = (p: unknown) => p != null && typeof (p as { x?: unknown }).x === "number" && typeof (p as { y?: unknown }).y === "number";
          // Strip transient `highlighted` from saved data (cleanup of older saves)
          const cleaned = savedNodes
            .filter((s: unknown) => validPos((s as { position?: unknown }).position))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((n: any) => {
              const data = { ...(n.data ?? {}) };
              delete data.highlighted;
              return { ...n, data };
            });
          setNodes(cleaned);
          if (layoutRes.data.edges) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setEdges(layoutRes.data.edges.map((e: any) => ({ ...e })));
          }
        }

        // Load SICs (table may not exist yet — ignore that error)
        if (!sicsRes.error && Array.isArray(sicsRes.data)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const records: SICRecord[] = (sicsRes.data as any[]).map(r => ({
            sicNumero: r.sic_numero,
            steps:     Array.isArray(r.steps) ? r.steps : [],
            stepIndex: typeof r.step_index === "number" ? r.step_index : 0,
            updatedAt: r.updated_at,
          }));
          setSicList(records);

          // Restore previous selection from localStorage if it still exists
          try {
            const sel = localStorage.getItem(SIC_SELECTION_KEY);
            if (sel && records.some(r => r.sicNumero === sel)) setSelectedSicNumero(sel);
          } catch { /* ignore */ }
        } else if (sicsRes.error && sicsRes.error.code !== "42P01") {
          // 42P01 = relation does not exist; silently ignore so the diagram still works
          toast.error(`No se pudieron cargar las SICs: ${sicsRes.error.message}`);
        }

        setLoading(false);
      } catch (err) {
        setLoadError(`Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
      }
    })();
  }, []);

  // Persist current selection to localStorage
  useEffect(() => {
    if (loading) return;
    try {
      if (selectedSicNumero) localStorage.setItem(SIC_SELECTION_KEY, selectedSicNumero);
      else localStorage.removeItem(SIC_SELECTION_KEY);
    } catch { /* ignore */ }
  }, [selectedSicNumero, loading]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Mark unsaved on changes after initial load
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!initialLoadDone.current) { initialLoadDone.current = true; return; }
    setSaved(false);
  }, [nodes, edges, loading]);

  const handleManualSave = useCallback(async () => {
    setSaving(true);
    const payload = {
      nodes: nodes.map(n => {
        // Strip the transient `highlighted` overlay before persisting
        const data = { ...(n.data ?? {}) };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (data as any).highlighted;
        return { id: n.id, position: n.position, width: n.width, height: n.height, style: n.style, type: n.type, data };
      }),
      edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, type: e.type, label: e.label, style: e.style, data: e.data })),
    };
    const { error } = await supabase
      .from("sic_diagrama_layout")
      .upsert({ id: "main", ...payload, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .select();
    setSaving(false);
    if (error) {
      toast.error(`Error al guardar: ${error.message}`);
      setSaved(false);
      return;
    }
    toast.success(`Guardado — ${payload.nodes.length} objeto${payload.nodes.length === 1 ? "" : "s"}`);
    setSaved(true);
  }, [nodes, edges]);

  const onConnect = useCallback((connection: Connection) => {
    const srcNode  = nodes.find(n => n.id === connection.source);
    const tgtNode  = nodes.find(n => n.id === connection.target);
    const srcColor = (srcNode?.data as PasoData | undefined)?.color ?? "#34d399";
    const tgtColor = (tgtNode?.data as PasoData | undefined)?.color ?? "#34d399";
    setEdges(es => addEdge({ ...connection, id: `e-${Date.now()}`, data: { sourceColor: srcColor, targetColor: tgtColor } }, es));
  }, [setEdges, nodes]);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    const d = node.data as unknown as PasoData;
    setEditingNode({ id: node.id, label: d.label ?? "", responsables: d.responsables ?? [], color: d.color ?? "" });
  }, []);

  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const d = edge.data as Record<string, unknown> | undefined;
    setEditingEdge({ id: edge.id, type: (d?.lineStyle as string | undefined) ?? "bezier", label: (edge.label as string | undefined) ?? "" });
  }, []);

  const handleSaveEdge = useCallback((id: string, lineStyle: string, label: string) => {
    setEdges(es => es.map(e => e.id !== id ? e : {
      ...e, type: lineStyle, label: label || undefined,
      data: { ...(e.data as Record<string, unknown> ?? {}), lineStyle },
    }));
  }, [setEdges]);

  const handleSaveNode = useCallback((id: string, newLabel: string, newResp: string[], color: string) => {
    updateNodeData(id, { label: newLabel, responsables: newResp, color });
    // Update connected edge gradient colors
    setEdges(es => es.map(e => {
      const ed = e.data as Record<string, unknown> ?? {};
      if (e.source === id) return { ...e, data: { ...ed, sourceColor: color } };
      if (e.target === id) return { ...e, data: { ...ed, targetColor: color } };
      return e;
    }));
  }, [updateNodeData, setEdges]);

  const resetLayout = () => { setNodes([]); setEdges([]); };

  const handleSICImport = useCallback(async (rows: SICRow[], numero: string) => {
    if (!numero) {
      toast.error("Agregá un número de SIC para guardarla");
      return;
    }
    const lastIdx = Math.max(0, rows.length - 1);
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("sic_diagrama_active")
      .upsert({
        sic_numero: numero,
        steps:      rows,
        step_index: lastIdx,
        updated_at: now,
      }, { onConflict: "sic_numero" });

    if (error) {
      if (error.code === "42P01") {
        toast.error("Falta crear la tabla sic_diagrama_active en Supabase");
      } else {
        toast.error(`No se pudo guardar la SIC: ${error.message}`);
      }
      return;
    }

    setSicList(prev => {
      const filtered = prev.filter(s => s.sicNumero !== numero);
      return [{ sicNumero: numero, steps: rows, stepIndex: lastIdx, updatedAt: now }, ...filtered];
    });
    setSelectedSicNumero(numero);
    toast.success(`SIC ${numero} importada — ${rows.length} paso${rows.length === 1 ? "" : "s"}`);
  }, []);

  const goToStep = useCallback(async (idx: number) => {
    if (!selectedSicNumero) return;
    const sic = sicList.find(s => s.sicNumero === selectedSicNumero);
    if (!sic) return;
    if (idx < 0 || idx >= sic.steps.length) return;

    // Optimistic UI update
    setSicList(prev => prev.map(s => s.sicNumero === selectedSicNumero ? { ...s, stepIndex: idx } : s));

    const { error } = await supabase
      .from("sic_diagrama_active")
      .update({ step_index: idx, updated_at: new Date().toISOString() })
      .eq("sic_numero", selectedSicNumero);

    if (error) toast.error(`No se pudo guardar el paso: ${error.message}`);
  }, [selectedSicNumero, sicList]);

  const deleteSIC = useCallback(async (numero: string) => {
    if (!confirm(`¿Eliminar la SIC ${numero}? Esta acción no se puede deshacer.`)) return;

    const { error } = await supabase
      .from("sic_diagrama_active")
      .delete()
      .eq("sic_numero", numero);

    if (error) {
      toast.error(`No se pudo eliminar: ${error.message}`);
      return;
    }

    setSicList(prev => prev.filter(s => s.sicNumero !== numero));
    if (selectedSicNumero === numero) setSelectedSicNumero(null);
    toast.success(`SIC ${numero} eliminada`);
  }, [selectedSicNumero]);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const shapeType = event.dataTransfer.getData("application/reactflow");
    if (!shapeType || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const flowPosition = screenToFlowPosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    setNodes(ns => [...ns, createNewNode(shapeType, flowPosition.x, flowPosition.y)]);
  }, [screenToFlowPosition, setNodes]);

  const currentSic   = sicList.find(s => s.sicNumero === selectedSicNumero) ?? null;
  const currentStep  = currentSic ? currentSic.steps[currentSic.stepIndex] ?? null : null;
  const stepColor    = currentStep ? getActionColor(currentStep.accion) : null;
  const matchedNode  = currentStep ? findNodeForPerson(nodes, currentStep.person) : null;
  const hasMatch     = matchedNode != null;
  const matchedLabel = matchedNode?.label ?? null;

  // Inject transient `highlighted` overlay into the node passed to ReactFlow,
  // without mutating the canonical `nodes` state (so layout stays "saved")
  const renderedNodes = currentStep && matchedNode
    ? nodes.map(n => n.id === matchedNode.id
        ? { ...n, data: { ...n.data, highlighted: {
            sicNumero: selectedSicNumero!,
            sec:    currentStep.sec,
            fecha:  currentStep.fecha,
            nota:   currentStep.nota,
            person: currentStep.person,
          } } }
        : n)
    : nodes;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-foreground">Diagrama de flujo</h2>
            {currentSic && (
              <span className="px-2 py-0.5 rounded-md text-xs font-semibold" style={{ background: "rgba(45,212,191,.12)", color: "#2dd4bf", border: "1px solid rgba(45,212,191,.3)" }}>
                {currentSic.sicNumero}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">Proceso SIC – SIGA · doble clic para editar un objeto</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* SIC selector dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-secondary transition-colors min-w-[160px] justify-between"
            >
              <span className="truncate">
                {currentSic ? `SIC ${currentSic.sicNumero}` : sicList.length > 0 ? "Seleccionar SIC..." : "Sin SICs cargadas"}
              </span>
              <ChevronDown className={cn("w-3 h-3 transition-transform shrink-0", dropdownOpen && "rotate-180")}/>
            </button>
            {dropdownOpen && (
              <div className="absolute top-full mt-1 right-0 w-72 bg-card border border-border rounded-lg shadow-2xl z-50 p-1 max-h-80 overflow-y-auto">
                {sicList.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground text-center">
                    No hay SICs cargadas. Importá una con el botón &quot;Importar SIC&quot;.
                  </p>
                ) : (
                  <>
                    {selectedSicNumero && (
                      <>
                        <button
                          onClick={() => { setSelectedSicNumero(null); setDropdownOpen(false); }}
                          className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors"
                        >
                          Deseleccionar SIC actual
                        </button>
                        <div className="my-1 border-t border-border/50"/>
                      </>
                    )}
                    {sicList.map(sic => {
                      const isSelected = sic.sicNumero === selectedSicNumero;
                      const stepCur = sic.steps[sic.stepIndex];
                      const c = stepCur ? getActionColor(stepCur.accion) : "#8a8fa6";
                      return (
                        <div
                          key={sic.sicNumero}
                          className={cn("flex items-center group rounded transition-colors", isSelected ? "bg-secondary" : "hover:bg-secondary/60")}
                        >
                          <button
                            onClick={() => { setSelectedSicNumero(sic.sicNumero); setDropdownOpen(false); }}
                            className="flex-1 text-left px-2 py-1.5 min-w-0"
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c, boxShadow: `0 0 6px ${c}` }}/>
                              <span className="text-sm font-semibold text-foreground truncate">{sic.sicNumero}</span>
                              {isSelected && <Check className="w-3 h-3 text-accent shrink-0"/>}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                              Paso {sic.stepIndex + 1}/{sic.steps.length} · {stepCur?.accion ?? "—"} · {stepCur?.person ?? "—"}
                            </p>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteSIC(sic.sicNumero); }}
                            title={`Eliminar SIC ${sic.sicNumero}`}
                            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5"/>
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Prev/Next when a SIC is selected */}
          {currentSic && (
            <div
              className="flex items-center gap-1 rounded-lg border px-1 py-0.5"
              style={{
                borderColor: stepColor ? hexToRgba(stepColor, 0.4) : "rgba(255,255,255,.10)",
                background:  stepColor ? hexToRgba(stepColor, 0.08) : "transparent",
              }}
            >
              <button
                onClick={() => goToStep(currentSic.stepIndex - 1)}
                disabled={currentSic.stepIndex === 0}
                title="Paso anterior"
                className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5"/>
              </button>
              <div className="flex flex-col items-center px-1.5 min-w-[58px]">
                <span className="text-[9px] uppercase tracking-wider" style={{ color: stepColor ?? "#8a8fa6" }}>
                  Sec {currentStep?.sec ?? "—"}
                </span>
                <span className="text-[10px] font-semibold leading-tight" style={{ color: hasMatch ? "#34d399" : "#8a8fa6" }}>
                  {currentSic.stepIndex + 1} / {currentSic.steps.length}
                </span>
              </div>
              <button
                onClick={() => goToStep(currentSic.stepIndex + 1)}
                disabled={currentSic.stepIndex >= currentSic.steps.length - 1}
                title="Paso siguiente"
                className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5"/>
              </button>
            </div>
          )}

          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Upload className="w-3 h-3"/>Importar SIC
          </button>
          <button
            onClick={handleManualSave}
            disabled={saving || loading}
            className={cn("flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50",
              saved
                ? "text-muted-foreground border-border hover:text-foreground hover:bg-secondary"
                : "text-accent border-accent/40 bg-accent/10 hover:bg-accent/20"
            )}>
            {saving ? <><Loader2 className="w-3 h-3 animate-spin"/>Guardando...</>
              : saved ? <><Check className="w-3 h-3"/>Guardado</>
              : <><Save className="w-3 h-3"/>Guardar</>}
          </button>
          <button onClick={resetLayout} title="Limpiar canvas"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <RotateCcw className="w-3 h-3"/>Reset
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-card border border-border rounded-xl px-5 py-3 grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">SIC</p>
          <p className="font-medium text-foreground mt-0.5 truncate">{currentSic?.sicNumero ?? "—"}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Estado actual</p>
          <p className="font-medium mt-0.5 truncate" style={{ color: hasMatch ? "#fff" : (stepColor ?? "#fff") }}>
            {hasMatch
              ? matchedLabel
              : currentStep
                ? <span className="italic opacity-80">{currentStep.accion} (sin nodo asignado)</span>
                : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Responsable</p>
          <p className="font-medium text-foreground mt-0.5 truncate">{currentStep?.person ?? "—"}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sec.</p>
          <p className="font-medium mt-0.5" style={{ color: stepColor ?? undefined }}>
            {currentStep ? String(currentStep.sec) : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Nota</p>
          <p className="font-medium text-foreground mt-0.5 truncate" title={currentStep?.nota ?? ""}>
            {currentStep?.nota || "—"}
          </p>
        </div>
      </div>

      {/* Diagram + sidebar */}
      <div className="flex gap-4">
        {/* Shape sidebar */}
        <div
          className="w-40 shrink-0 overflow-y-auto px-3 py-3 rounded-xl [&::-webkit-scrollbar]:hidden"
          style={{
            height: "calc(100vh - 220px)",
            scrollbarWidth: "none",
            background: "#070912",
            border: "1px solid rgba(255,255,255,.08)",
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: "#5b6079" }}>Formas</p>
          <ShapePalette />
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 rounded-xl overflow-hidden relative"
          style={{
            height: "calc(100vh - 220px)",
            background: "#070912",
            border: "1px solid rgba(255,255,255,.08)",
            "--xy-edge-stroke": "#34d399",
            "--xy-edge-stroke-width": "2",
            "--xy-controls-button-background-color": "rgba(11,14,26,.85)",
            "--xy-controls-button-background-color-hover": "rgba(255,255,255,.06)",
            "--xy-controls-button-border-color": "rgba(255,255,255,.10)",
            "--xy-controls-button-color": "#c8cad6",
            "--xy-controls-background-color": "rgba(11,14,26,.9)",
            "--xy-controls-box-shadow": "0 8px 24px rgba(0,0,0,.5)",
          } as React.CSSProperties}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {/* Nebula layer */}
          <div
            className="absolute inset-0 pointer-events-none z-0"
            style={{
              background: `
                radial-gradient(50% 40% at 80% 10%, rgba(139,92,246,.15), transparent 60%),
                radial-gradient(40% 35% at 10% 90%, rgba(16,185,129,.10), transparent 60%)
              `,
            }}
          />

          {loading ? (
            <div className="flex items-center justify-center h-full gap-2 text-sm" style={{ color: "#8a8fa6" }}>
              <Loader2 className="w-4 h-4 animate-spin"/>Cargando...
            </div>
          ) : (
            <>
              {loadError && (
                <div className="absolute top-3 left-3 right-3 z-10 bg-red-950/80 border border-red-700/60 rounded-lg px-4 py-2.5 text-xs text-red-300 backdrop-blur-sm">
                  <span className="font-semibold text-red-200">Error: </span>{loadError}
                </div>
              )}
              <ReactFlow
                nodes={renderedNodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDoubleClick={onNodeDoubleClick}
                onEdgeDoubleClick={onEdgeDoubleClick}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES_MAP}
                connectionMode={ConnectionMode.Loose}
                defaultEdgeOptions={{ data: { sourceColor: "#34d399", targetColor: "#34d399" } }}
                fitView
                fitViewOptions={{ padding: 0.12 }}
                deleteKeyCode={["Backspace", "Delete"]}
                proOptions={{ hideAttribution: true }}
                style={{ background: "transparent", zIndex: 1, position: "relative" }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  color="rgba(255,255,255,.05)"
                  gap={24}
                  size={1.5}
                />
                <Controls showInteractive={false} />
              </ReactFlow>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-1 text-xs">
        {[
          { color: "#2dd4bf", label: "Preparación" },
          { color: "#34d399", label: "Inicio / Fin" },
          { color: "#f59e0b", label: "Decisión" },
          { color: "#60a5fa", label: "Actividad" },
          { color: "#22d3ee", label: "I/O" },
          { color: "#c084fc", label: "Documento" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5" style={{ color: "#8a8fa6" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}`, display: "inline-block" }} />
            {label}
          </div>
        ))}
        <div className="text-[10px] ml-auto" style={{ color: "#5b6079" }}>
          Arrastrar = mover · Borde = redimensionar · Handle = conectar · Supr = eliminar · Doble clic = editar
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

      {importOpen && (
        <SICImportModal
          nodes={nodes}
          onImport={handleSICImport}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Error boundary + wrapper ─────────────────────────────────────────────────

class SicErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 rounded-xl border border-destructive/40 bg-destructive/10 text-sm space-y-2">
          <p className="font-semibold text-destructive">Error en el diagrama</p>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">{this.state.error.message}</pre>
          <pre className="text-xs text-muted-foreground/60 whitespace-pre-wrap break-all">{this.state.error.stack?.split("\n").slice(0, 5).join("\n")}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export function SicDiagramaSection() {
  return (
    <SicErrorBoundary>
      <ReactFlowProvider>
        <SicDiagramaInner />
      </ReactFlowProvider>
    </SicErrorBoundary>
  );
}
