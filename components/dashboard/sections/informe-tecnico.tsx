"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Gavel, Loader2, ChevronDown, ChevronRight, FileText, Layers, Users, Tag, ClipboardCheck, Trophy, Check, Pencil, Trash2, X, GripVertical, Copy, RefreshCw, HelpCircle, ChevronLeft, AlertTriangle, Lightbulb, ListChecks, ArrowRight } from "lucide-react";
import {
  listLicitaciones,
  createLicitacion,
  updateLicitacion,
  listRenglonesConItems,
  createRenglon,
  updateRenglon,
  deleteRenglon,
  createItem,
  updateItem,
  deleteItem,
  lookupMatricula,
  listOferentes,
  createOferente,
  deleteOferente,
  listOfertas,
  upsertOferta,
  deleteOferta,
  listEvaluaciones,
  upsertEvaluacion,
  listAdjudicaciones,
  upsertAdjudicacion,
  deleteAdjudicacion,
  type Licitacion,
  type Renglon,
  type Item,
  type RenglonConItems,
  type Oferente,
  type Divisa,
  deleteEvaluacion,
  type EvaluacionTecnica,
  type Adjudicacion,
} from "@/lib/informeTecnico";
import { toast } from "sonner";

type WizardTab = "datos" | "renglones" | "oferentes" | "ofertas" | "evaluacion" | "adjudicacion";

const TABS: { id: WizardTab; label: string; icon: React.ElementType }[] = [
  { id: "datos",         label: "Datos generales", icon: FileText },
  { id: "renglones",     label: "Renglones e Ítems", icon: Layers },
  { id: "oferentes",     label: "Oferentes", icon: Users },
  { id: "ofertas",       label: "Ofertas", icon: Tag },
  { id: "evaluacion",    label: "Evaluación técnica", icon: ClipboardCheck },
  { id: "adjudicacion",  label: "Adjudicación", icon: Trophy },
];

export function InformeTecnicoSection() {
  const [licitaciones, setLicitaciones] = useState<Licitacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [tab, setTab] = useState<WizardTab>("datos");

  const refresh = async () => {
    setLoading(true);
    try {
      const rows = await listLicitaciones();
      setLicitaciones(rows);
      if (!selectedId && rows.length > 0) setSelectedId(rows[0].id);
    } catch (e) {
      console.error(e);
      toast.error("No se pudieron cargar las licitaciones");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const selected = licitaciones.find((l) => l.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando licitaciones...
      </div>
    );
  }

  const activeTab = TABS.find((t) => t.id === tab);
  const ActiveIcon = activeTab?.icon ?? FileText;

  return (
    <div className="space-y-6">
      {/* Header bar: title + selector + actions */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div
            className="grid place-items-center mt-0.5"
            style={{
              width: 36, height: 36, borderRadius: 9,
              background: "oklch(0.30 0.10 155 / 0.45)",
              border: "1px solid oklch(0.55 0.15 155 / 0.5)",
              color: "#86efac",
            }}
          >
            <FileText className="w-[18px] h-[18px]" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.4, margin: 0 }}>
              Informe Técnico
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: "oklch(0.55 0 0)" }}>
              Análisis de ofertas y adjudicación por renglón.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {licitaciones.length > 0 && (
            <LicitacionSelector
              licitaciones={licitaciones}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
          <button
            onClick={() => setShowHelp(true)}
            style={{
              height: 38, padding: "0 13px", borderRadius: 9,
              background: "oklch(0.22 0.005 270)",
              border: "1px solid oklch(1 0 0 / 0.08)",
              color: "oklch(0.65 0 0)", fontSize: 13, fontWeight: 500,
              cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7,
              transition: "color .15s, border-color .15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.90 0 0)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "oklch(1 0 0 / 0.18)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.65 0 0)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "oklch(1 0 0 / 0.08)"; }}
          >
            <HelpCircle className="w-4 h-4" />
            Ayuda
          </button>
          <BeastPrimaryButton onClick={() => setShowCreate(true)} icon={<Plus className="w-3.5 h-3.5" strokeWidth={2.4} />}>
            Nueva licitación
          </BeastPrimaryButton>
        </div>
      </div>

      {/* Empty state */}
      {licitaciones.length === 0 && (
        <div
          className="flex flex-col items-center text-center gap-3 py-14 px-6 rounded-[14px]"
          style={{
            background: "oklch(0.235 0.005 270)",
            border: "1px dashed oklch(1 0 0 / 0.07)",
          }}
        >
          <div
            className="grid place-items-center mb-1"
            style={{
              width: 48, height: 48, borderRadius: 12,
              background: "oklch(0.27 0.005 270)",
              color: "oklch(0.70 0 0)",
            }}
          >
            <Gavel className="w-5 h-5" />
          </div>
          <div className="text-[15px] font-semibold text-foreground">No hay licitaciones cargadas</div>
          <div className="text-[13px] max-w-md leading-relaxed" style={{ color: "oklch(0.50 0 0)" }}>
            Creá una nueva licitación para empezar a cargar renglones, oferentes y ofertas.
          </div>
          <BeastPrimaryButton onClick={() => setShowCreate(true)} icon={<Plus className="w-3.5 h-3.5" strokeWidth={2.4} />} className="mt-2">
            Crear primera licitación
          </BeastPrimaryButton>
        </div>
      )}

      {/* Wizard */}
      {selected && (
        <>
          {/* Tabs — beast pure pill bar */}
          <div
            style={{
              display: "inline-flex", gap: 4, padding: 4,
              background: "oklch(0.235 0.005 270)", borderRadius: 12,
              flexWrap: "wrap", maxWidth: "100%",
            }}
          >
            {TABS.map((t, idx) => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <React.Fragment key={t.id}>
                  {idx > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", color: "oklch(0.38 0 0)", fontSize: 13, userSelect: "none", pointerEvents: "none" }}>
                      →
                    </span>
                  )}
                  <button
                    onClick={() => setTab(t.id)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 7,
                      padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                      background: isActive ? "oklch(0.27 0.005 270)" : "transparent",
                      color: isActive ? "oklch(0.97 0 0)" : "oklch(0.65 0 0)",
                      fontSize: 13, fontWeight: isActive ? 500 : 400,
                      transition: "background .15s, color .15s",
                      boxShadow: isActive ? "0 1px 0 oklch(1 0 0 / 0.06) inset" : "none",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.90 0 0)"; }}
                    onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.65 0 0)"; }}
                  >
                    <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                    {t.label}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {/* Content card */}
          <div
            className="px-4 py-6 sm:px-6 overflow-hidden"
            style={{
              background: "oklch(0.235 0.005 270)",
              border: "1px solid oklch(1 0 0 / 0.07)",
              borderRadius: 14,
            }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className="grid place-items-center"
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: "oklch(0.30 0.10 155 / 0.45)",
                  border: "1px solid oklch(0.55 0.15 155 / 0.5)",
                  color: "#86efac",
                }}
              >
                <ActiveIcon className="w-4 h-4" strokeWidth={2} />
              </div>
              <h2 className="text-[20px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.3, margin: 0 }}>
                {activeTab?.label}
              </h2>
            </div>
            <p className="ml-[42px] mb-7 text-[14.5px]" style={{ color: "oklch(0.58 0 0)" }}>
              Licitación SIC <span className="font-mono" style={{ color: "#86efac" }}>{selected.numero_sic}</span> — {selected.titulo}
            </p>

            {tab === "datos" ? (
              <DatosGeneralesTab
                licitacion={selected}
                onUpdated={(updated) => {
                  setLicitaciones((prev) =>
                    prev.map((l) => (l.id === updated.id ? updated : l)),
                  );
                }}
              />
            ) : tab === "renglones" ? (
              <RenglonesTab
                licitacionId={selected.id}
                licitacion={selected}
                onUpdated={(updated) => {
                  setLicitaciones((prev) =>
                    prev.map((l) => (l.id === updated.id ? updated : l)),
                  );
                }}
              />
            ) : tab === "oferentes" ? (
              <OferentesTab licitacionId={selected.id} />
            ) : tab === "ofertas" ? (
              <OfertasTab
                licitacion={selected}
                onUpdated={(updated) => {
                  setLicitaciones((prev) =>
                    prev.map((l) => (l.id === updated.id ? updated : l)),
                  );
                }}
              />
            ) : tab === "evaluacion" ? (
              <EvaluacionTab licitacionId={selected.id} />
            ) : tab === "adjudicacion" ? (
              <AdjudicacionTab licitacion={selected} />
            ) : (
              <PlaceholderTab tab={tab} />
            )}
          </div>
        </>
      )}

      {/* Modal de ayuda */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {/* Modal de creación */}
      {showCreate && (
        <CreateLicitacionModal
          loading={creating}
          onClose={() => setShowCreate(false)}
          onSubmit={async (numero_sic, titulo) => {
            setCreating(true);
            try {
              const nueva = await createLicitacion({ numero_sic, titulo });
              toast.success("Licitación creada");
              setLicitaciones((prev) => [nueva, ...prev]);
              setSelectedId(nueva.id);
              setShowCreate(false);
              setTab("datos");
            } catch (e) {
              console.error(e);
              toast.error("No se pudo crear la licitación");
            } finally {
              setCreating(false);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Beast primary button (purple with glow) ─────────────────────────

function BeastPrimaryButton({
  children, onClick, icon, disabled, className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 ${className}`}
      style={{
        padding: "9px 14px", borderRadius: 9, border: "none",
        background: disabled ? "oklch(0.27 0.005 270)" : "#8B5CF6",
        color: disabled ? "oklch(0.50 0 0)" : "#fff",
        fontSize: 13, fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : "0 1px 0 oklch(1 0 0 / 0.1) inset, 0 8px 16px -10px rgba(139,92,246,0.6)",
        transition: "filter .15s",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.1)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = "none"; }}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Selector de licitación ──────────────────────────────────────────

function LicitacionSelector({
  licitaciones, selectedId, onSelect,
}: {
  licitaciones: Licitacion[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = licitaciones.find((l) => l.id === selectedId);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2"
        style={{
          height: 38, padding: "0 12px", borderRadius: 9, minWidth: 260,
          background: "oklch(0.16 0.005 270)",
          border: `1px solid ${open ? "oklch(0.55 0.20 295 / 0.55)" : "oklch(1 0 0 / 0.07)"}`,
          color: "oklch(0.97 0 0)", fontSize: 13,
          transition: "border-color .15s, box-shadow .15s",
          boxShadow: open ? "0 0 0 3px oklch(0.55 0.20 295 / 0.15)" : "none",
        }}
      >
        <span className="truncate flex-1 text-left flex items-center gap-2">
          {selected ? (
            <>
              <span
                className="font-mono"
                style={{
                  padding: "2px 7px", borderRadius: 6, fontSize: 11.5, fontWeight: 600,
                  background: "oklch(0.30 0.10 155 / 0.45)",
                  border: "1px solid oklch(0.55 0.15 155 / 0.5)",
                  color: "#86efac", letterSpacing: 0.3,
                }}
              >
                SIC {selected.numero_sic}
              </span>
              <span className="truncate" style={{ color: "oklch(0.85 0 0)" }}>{selected.titulo}</span>
            </>
          ) : (
            <span style={{ color: "oklch(0.50 0 0)" }}>Seleccionar licitación</span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          style={{ color: "oklch(0.55 0 0)" }}
        />
      </button>
      {open && (
        <div
          className="absolute z-50 top-[calc(100%+6px)] right-0 min-w-[340px] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
          style={{
            background: "oklch(0.205 0.005 270)",
            border: "1px solid oklch(1 0 0 / 0.07)",
            borderRadius: 10,
            boxShadow: "0 14px 32px -16px rgba(0,0,0,0.6), 0 0 0 1px oklch(1 0 0 / 0.02) inset",
            padding: 4,
          }}
        >
          {licitaciones.map((l) => {
            const isActive = l.id === selectedId;
            return (
              <button
                key={l.id}
                onClick={() => { onSelect(l.id); setOpen(false); }}
                className="w-full text-left flex items-start gap-2.5 transition-colors"
                style={{
                  padding: "8px 10px", borderRadius: 7, border: "none", background: isActive ? "oklch(0.27 0.005 270)" : "transparent", cursor: "pointer",
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.25 0.005 270)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <span
                  className="font-mono shrink-0 mt-0.5"
                  style={{
                    padding: "2px 7px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: "oklch(0.30 0.10 155 / 0.45)",
                    border: "1px solid oklch(0.55 0.15 155 / 0.5)",
                    color: "#86efac", letterSpacing: 0.3,
                  }}
                >
                  SIC {l.numero_sic}
                </span>
                <span className="flex-1 truncate text-[13px]" style={{ color: isActive ? "oklch(0.97 0 0)" : "oklch(0.80 0 0)", fontWeight: isActive ? 500 : 400 }}>
                  {l.titulo}
                </span>
                {isActive && <Check className="w-3.5 h-3.5 shrink-0 mt-1" style={{ color: "#8B5CF6" }} strokeWidth={2.6} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Modal: crear licitación ──────────────────────────────────────────────

function CreateLicitacionModal({
  loading, onClose, onSubmit,
}: {
  loading: boolean;
  onClose: () => void;
  onSubmit: (numero_sic: string, titulo: string) => void;
}) {
  const [numeroSic, setNumeroSic] = useState("");
  const [titulo, setTitulo] = useState("");

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Nueva licitación</CardTitle>
          <CardDescription>
            Solo necesitás un número de SIC y un título. El resto de los datos
            los cargás en las pestañas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Número SIC</span>
            <input
              type="text"
              value={numeroSic}
              onChange={(e) => setNumeroSic(e.target.value)}
              placeholder="Ej: 21441"
              className="mt-1 w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Título / objeto</span>
            <input
              type="text"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej: Adquisición de RTU para teleoperación"
              className="mt-1 w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={loading}>Cancelar</Button>
            <Button
              onClick={() => onSubmit(numeroSic.trim(), titulo.trim())}
              disabled={loading || !numeroSic.trim() || !titulo.trim()}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Crear"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab: Datos generales ────────────────────────────────────

function DatosGeneralesTab({
  licitacion, onUpdated,
}: {
  licitacion: Licitacion;
  onUpdated: (l: Licitacion) => void;
}) {
  const [numeroSic,       setNumeroSic]       = useState(licitacion.numero_sic);
  const [titulo,          setTitulo]          = useState(licitacion.titulo);
  const [fdSicFecha,      setFdSicFecha]      = useState(licitacion.fd_sic_fecha ?? "");
  const [fdSicValor,      setFdSicValor]      = useState<string>(licitacion.fd_sic_valor?.toString() ?? "");
  const [fdOpFecha,       setFdOpFecha]       = useState(licitacion.fd_op_fecha ?? "");
  const [fdOpValor,       setFdOpValor]       = useState<string>(licitacion.fd_op_valor?.toString() ?? "");
  const [umbral,          setUmbral]          = useState<string>(licitacion.umbral_economico_pct?.toString() ?? "50");
  const [saving,          setSaving]          = useState(false);

  useEffect(() => {
    setNumeroSic(licitacion.numero_sic);
    setTitulo(licitacion.titulo);
    setFdSicFecha(licitacion.fd_sic_fecha ?? "");
    setFdSicValor(licitacion.fd_sic_valor?.toString() ?? "");
    setFdOpFecha(licitacion.fd_op_fecha ?? "");
    setFdOpValor(licitacion.fd_op_valor?.toString() ?? "");
    setUmbral(licitacion.umbral_economico_pct?.toString() ?? "50");
  }, [licitacion.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    numeroSic     !== licitacion.numero_sic ||
    titulo        !== licitacion.titulo ||
    fdSicFecha    !== (licitacion.fd_sic_fecha ?? "") ||
    fdSicValor    !== (licitacion.fd_sic_valor?.toString() ?? "") ||
    fdOpFecha     !== (licitacion.fd_op_fecha ?? "") ||
    fdOpValor     !== (licitacion.fd_op_valor?.toString() ?? "") ||
    umbral        !== (licitacion.umbral_economico_pct?.toString() ?? "50");

  const parseNum = (s: string): number | null => {
    if (!s.trim()) return null;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const [fetchingOp, setFetchingOp] = useState(false);

  const lastWeekday = (dateStr: string): string => {
    const d = new Date(dateStr + "T12:00:00");
    const dow = d.getDay(); // 0=sun,6=sat
    if (dow === 0) d.setDate(d.getDate() - 2);
    else if (dow === 6) d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  const fetchDolarBCRA = async (dateStr: string): Promise<number | null> => {
    const d = lastWeekday(dateStr);
    const url = `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechaDesde=${d}&fechaHasta=${d}&limit=10`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BCRA ${res.status}`);
    const json = await res.json();
    // Response: { results: [{ cotizaciones: [{ codigoMoneda, descripcion, tipoPase, tipoCotizacion }] }] }
    // or flat array [{d, v}] depending on version
    const results = json?.results ?? json;
    if (Array.isArray(results) && results.length > 0) {
      const row = results[0];
      // flat format: {d, v}
      if (typeof row.v === "number") return row.v;
      // nested format: {fecha, detalle: [{tipoPase, tipoCotizacion}]}
      const detalle = row.detalle ?? row.cotizaciones ?? [];
      const usd = detalle.find((x: { codigoMoneda?: string }) => x.codigoMoneda === "USD" || !x.codigoMoneda);
      if (usd?.tipoCotizacion) return usd.tipoCotizacion;
    }
    return null;
  };

  const handleFetchOp = async () => {
    if (!fdOpFecha) { toast.error("Ingresá primero la Fecha de la OP"); return; }
    setFetchingOp(true);
    try {
      const d = new Date(fdOpFecha + "T12:00:00");
      d.setDate(d.getDate() - 1);
      const prevDay = d.toISOString().slice(0, 10);
      const [v] = await Promise.all([
        fetchDolarBCRA(prevDay),
        new Promise<void>((r) => setTimeout(r, 1500)),
      ]);
      if (v !== null) { setFdOpValor(v.toString()); toast.success(`Dólar OP: $${v}`); }
      else toast.error("No se encontró cotización para esa fecha");
    } catch { toast.error("Error al consultar el BCRA"); }
    finally { setFetchingOp(false); }
  };

  const handleSave = async () => {
    if (!numeroSic.trim() || !titulo.trim()) {
      toast.error("Número SIC y título son obligatorios");
      return;
    }
    const umbralNum = parseNum(umbral);
    if (umbralNum === null || umbralNum < 0) {
      toast.error("Umbral económico inválido");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateLicitacion(licitacion.id, {
        numero_sic:     numeroSic.trim(),
        titulo:         titulo.trim(),

        fd_sic_fecha:   fdSicFecha || null,
        fd_sic_valor:   parseNum(fdSicValor),
        fd_op_fecha:    fdOpFecha || null,
        fd_op_valor:    parseNum(fdOpValor),
        umbral_economico_pct: umbralNum,
      });
      onUpdated(updated);
      toast.success("Datos guardados");
    } catch (e) {
      console.error(e);
      toast.error("No se pudieron guardar los datos");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <FormSection title="Identificación">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FormField label="Número SIC">
            <input type="text" value={numeroSic} onChange={(e) => setNumeroSic(e.target.value)} className="ti-input" />
          </FormField>
          <FormField label="Título / objeto" className="md:col-span-2">
            <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} className="ti-input" />
          </FormField>
        </div>
      </FormSection>

      <FormSection
        title="Fechas y valor del dólar"
        description="Dólar de la SIC: tipo de cambio usado para normalizar los precios del pliego. Dólar de la OP: tipo de cambio del día del Acta de Apertura. Valores en pesos argentinos por USD."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          <FormField label="Fecha de la SIC">
            <input type="date" value={fdSicFecha} onChange={(e) => setFdSicFecha(e.target.value)} className="ti-input" />
          </FormField>
          <FormField label="Dólar de la SIC (ARS por USD)">
            <input type="number" step="0.01" inputMode="decimal" value={fdSicValor} onChange={(e) => setFdSicValor(e.target.value)} placeholder="Ej: 1399.5" className="ti-input" style={{ appearance: "textfield", MozAppearance: "textfield" } as React.CSSProperties} />
          </FormField>

          <FormField label="Fecha de la OP (Fecha del Acta de Apertura)">
            <input type="date" value={fdOpFecha} onChange={(e) => setFdOpFecha(e.target.value)} className="ti-input" />
          </FormField>
          <FormField label="Dólar de la OP (ARS por USD)">
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" step="0.01" inputMode="decimal" value={fdOpValor} onChange={(e) => setFdOpValor(e.target.value)} placeholder="Ej: 1398" className="ti-input" style={{ flex: 1, appearance: "textfield", MozAppearance: "textfield" } as React.CSSProperties} />
              <button onClick={handleFetchOp} disabled={fetchingOp || !fdOpFecha} title="Buscar cotización BCRA para la fecha de la OP"
                style={{ height: 44, padding: "0 14px", borderRadius: 9, border: "1px solid oklch(1 0 0 / 0.10)", background: "oklch(0.20 0.005 270)", color: fetchingOp ? "oklch(0.50 0 0)" : "#86efac", cursor: fetchingOp || !fdOpFecha ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5, opacity: !fdOpFecha ? 0.45 : 1 }}>
                {fetchingOp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                BCRA
              </button>
            </div>
          </FormField>
        </div>
      </FormSection>

      <FormSection
        title="Configuración"
        description="Umbral máximo de sobreprecio aceptable respecto al precio SIC en USD. Default: 50%."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FormField label="Umbral económico (%)">
            <input type="number" step="0.1" inputMode="decimal" value={umbral} onChange={(e) => setUmbral(e.target.value)} className="ti-input" style={{ appearance: "textfield", MozAppearance: "textfield" } as React.CSSProperties} />
          </FormField>
        </div>
      </FormSection>

      <div
        className="flex items-center gap-2.5 pt-4 mt-2"
        style={{ borderTop: "1px solid oklch(1 0 0 / 0.04)" }}
      >
        <div className="flex-1 text-[12px]" style={{ color: dirty ? "#fcd34d" : "oklch(0.45 0 0)" }}>
          {dirty
            ? "● Cambios sin guardar"
            : "Los cambios se aplican al análisis de todos los renglones de esta licitación."}
        </div>
        <button
          onClick={() => {
            setNumeroSic(licitacion.numero_sic);
            setTitulo(licitacion.titulo);
            setFdSicFecha(licitacion.fd_sic_fecha ?? "");
            setFdSicValor(licitacion.fd_sic_valor?.toString() ?? "");
            setFdOpFecha(licitacion.fd_op_fecha ?? "");
            setFdOpValor(licitacion.fd_op_valor?.toString() ?? "");
            setUmbral(licitacion.umbral_economico_pct?.toString() ?? "50");
          }}
          disabled={!dirty || saving}
          style={{
            padding: "9px 14px", borderRadius: 9,
            background: "transparent", border: "1px solid oklch(1 0 0 / 0.07)",
            color: "oklch(0.70 0 0)", fontSize: 13, fontWeight: 500,
            cursor: (!dirty || saving) ? "not-allowed" : "pointer",
            opacity: (!dirty || saving) ? 0.4 : 1,
          }}
        >
          Descartar
        </button>
        <BeastPrimaryButton
          onClick={handleSave}
          disabled={!dirty || saving}
          icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" strokeWidth={2.4} />}
        >
          Guardar cambios
        </BeastPrimaryButton>
      </div>

      <style jsx global>{`
        .ti-input {
          width: 100%;
          height: 44px;
          padding: 0 13px;
          border-radius: 9px;
          background-color: oklch(0.16 0.005 270);
          border: 1px solid oklch(1 0 0 / 0.07);
          font-size: 15px;
          color: oklch(0.97 0 0);
          transition: border-color .15s, box-shadow .15s;
        }
        .ti-input::placeholder { color: oklch(0.40 0 0); }
        .ti-input:focus {
          outline: none;
          border-color: oklch(0.55 0.20 295 / 0.55);
          box-shadow: 0 0 0 3px oklch(0.55 0.20 295 / 0.15);
        }
        .ti-input[type="number"],
        .ti-input[type="date"] {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 15.5px;
          font-weight: 500;
          letter-spacing: 0.3px;
        }
        .ti-input[type="date"]::-webkit-calendar-picker-indicator {
          filter: invert(0.7);
          opacity: 0.6;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 600, letterSpacing: -0.1, color: "oklch(0.97 0 0)" }}>{title}</h3>
      {description && (
        <p style={{ margin: "5px 0 16px", fontSize: 13.5, color: "oklch(0.52 0 0)", lineHeight: 1.55, maxWidth: 760 }}>
          {description}
        </p>
      )}
      {!description && <div style={{ height: 14 }} />}
      {children}
    </section>
  );
}

function FormField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[13px] font-medium" style={{ color: "oklch(0.62 0 0)" }}>{label}</span>
      {children}
    </label>
  );
}

// ─── Tab: Evaluación técnica ─────────────────────────────────────

function EvaluacionTab({ licitacionId }: { licitacionId: string }) {
  const [loading, setLoading] = useState(true);
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [oferentes, setOferentes] = useState<Oferente[]>([]);
  const [evals, setEvals] = useState<Map<string, EvaluacionTecnica>>(new Map());
  const [saving, setSaving] = useState<Set<string>>(new Set());

  const cellKey = (renglonId: string, oferenteId: string) => `${renglonId}|${oferenteId}`;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [reng, ofer, evs] = await Promise.all([
          listRenglonesConItems(licitacionId),
          listOferentes(licitacionId),
          listEvaluaciones(licitacionId),
        ]);
        if (cancelled) return;
        setRenglones(reng);
        setOferentes(ofer);
        const map = new Map<string, EvaluacionTecnica>();
        for (const ev of evs) map.set(cellKey(ev.renglon_id, ev.oferente_id), ev);
        setEvals(map);
      } catch (e) {
        console.error(e);
        toast.error("No se pudo cargar la evaluación técnica");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [licitacionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSave = async (
    renglonId: string,
    oferenteId: string,
    cumple: boolean | null,
    observaciones: string | null,
  ) => {
    const key = cellKey(renglonId, oferenteId);
    setSaving((prev) => new Set(prev).add(key));
    try {
      const result = await upsertEvaluacion({ oferente_id: oferenteId, renglon_id: renglonId, cumple, observaciones });
      setEvals((prev) => new Map(prev).set(key, result));
    } catch (e) {
      console.error(e);
      toast.error("No se pudo guardar la evaluación");
    } finally {
      setSaving((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  const handleToggle = (renglonId: string, oferenteId: string, value: boolean) => {
    const key = cellKey(renglonId, oferenteId);
    const current = evals.get(key);
    // If already set to this value, clear the record entirely
    if (current?.cumple === value) {
      setEvals((prev) => { const n = new Map(prev); n.delete(key); return n; });
      setSaving((prev) => new Set(prev).add(key));
      deleteEvaluacion(oferenteId, renglonId)
        .catch((e) => { console.error(e); toast.error("No se pudo guardar"); })
        .finally(() => setSaving((prev) => { const n = new Set(prev); n.delete(key); return n; }));
      return;
    }
    setEvals((prev) =>
      new Map(prev).set(key, { id: current?.id ?? "", oferente_id: oferenteId, renglon_id: renglonId, cumple: value, observaciones: current?.observaciones ?? null }),
    );
    doSave(renglonId, oferenteId, value, current?.observaciones ?? null);
  };

  const handlePendiente = (renglonId: string, oferenteId: string) => {
    const key = cellKey(renglonId, oferenteId);
    const current = evals.get(key);
    // If already pending (record exists with cumple=null), clear it
    if (evals.has(key) && current?.cumple === null) {
      setEvals((prev) => { const n = new Map(prev); n.delete(key); return n; });
      setSaving((prev) => new Set(prev).add(key));
      deleteEvaluacion(oferenteId, renglonId)
        .catch((e) => { console.error(e); toast.error("No se pudo guardar"); })
        .finally(() => setSaving((prev) => { const n = new Set(prev); n.delete(key); return n; }));
      return;
    }
    setEvals((prev) =>
      new Map(prev).set(key, { id: current?.id ?? "", oferente_id: oferenteId, renglon_id: renglonId, cumple: null, observaciones: current?.observaciones ?? null }),
    );
    doSave(renglonId, oferenteId, null, current?.observaciones ?? null);
  };

  const handleObsChange = (renglonId: string, oferenteId: string, obs: string) => {
    const key = cellKey(renglonId, oferenteId);
    const current = evals.get(key);
    setEvals((prev) =>
      new Map(prev).set(key, {
        id: current?.id ?? "",
        oferente_id: oferenteId,
        renglon_id: renglonId,
        cumple: current?.cumple ?? null,
        observaciones: obs || null,
      }),
    );
  };

  const handleObsBlur = (renglonId: string, oferenteId: string) => {
    const key = cellKey(renglonId, oferenteId);
    const current = evals.get(key);
    doSave(renglonId, oferenteId, current?.cumple ?? null, current?.observaciones ?? null);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando evaluación técnica...
      </div>
    );
  }

  if (renglones.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        No hay renglones cargados. Volvé a la pestaña <strong>Renglones e Ítems</strong> para agregarlos.
      </div>
    );
  }

  if (oferentes.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        No hay oferentes registrados. Volvé a la pestaña <strong>Oferentes</strong> para agregarlos.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border -mx-4 sm:-mx-6">
        <table className="w-full text-[15px] border-collapse">
          <thead>
            <tr className="bg-secondary/60 border-b border-border">
              <th className="text-left px-4 py-3 text-[13px] font-semibold text-muted-foreground w-36 border-r border-border">
                Renglón
              </th>
              {oferentes.map((of) => (
                <th
                  key={of.id}
                  className="px-4 py-3 text-[15px] font-semibold text-center text-foreground min-w-[240px] border-r border-border last:border-r-0"
                >
                  {of.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {renglones.map((r, ri) => (
              <tr
                key={r.id}
                className={`border-b border-border last:border-b-0 ${ri % 2 === 0 ? "" : "bg-secondary/20"}`}
              >
                <td className="px-4 py-3 font-medium text-foreground align-top border-r border-border">
                  <span className="text-[13px] text-muted-foreground block">Renglón</span>
                  <span className="text-lg font-semibold">{r.numero}</span>
                </td>
                {oferentes.map((of) => {
                  const key = cellKey(r.id, of.id);
                  const ev = evals.get(key);
                  const hasRecord = evals.has(key);
                  const cumple = ev?.cumple ?? null;
                  const isPendiente = hasRecord && cumple === null;
                  const obs = ev?.observaciones ?? "";
                  const isSaving = saving.has(key);
                  return (
                    <td key={of.id} className="px-3 py-3 align-top border-r border-border last:border-r-0">
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleToggle(r.id, of.id, true)}
                            disabled={isSaving}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded text-[13.5px] font-medium border transition-colors disabled:opacity-60 ${
                              cumple === true
                                ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-400"
                                : "border-border text-muted-foreground hover:bg-secondary/60"
                            }`}
                          >
                            ✓ Cumple
                          </button>
                          <button
                            onClick={() => handlePendiente(r.id, of.id)}
                            disabled={isSaving}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded text-[13.5px] font-medium border transition-colors disabled:opacity-60 ${
                              isPendiente
                                ? "bg-amber-500/15 border-amber-500/60 text-amber-400"
                                : "border-border text-muted-foreground hover:bg-secondary/60"
                            }`}
                          >
                            ⏳ Pendiente
                          </button>
                          <button
                            onClick={() => handleToggle(r.id, of.id, false)}
                            disabled={isSaving}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded text-[13.5px] font-medium border transition-colors disabled:opacity-60 ${
                              cumple === false
                                ? "bg-red-500/15 border-red-500/60 text-red-400"
                                : "border-border text-muted-foreground hover:bg-secondary/60"
                            }`}
                          >
                            ✗ No cumple
                          </button>
                          {isSaving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                        </div>
                        <textarea
                          value={obs}
                          onChange={(e) => handleObsChange(r.id, of.id, e.target.value)}
                          onBlur={() => handleObsBlur(r.id, of.id)}
                          placeholder="Observaciones..."
                          rows={2}
                          className="w-full px-2.5 py-2 rounded-md bg-secondary border border-border text-[14px] text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring/30 placeholder:text-muted-foreground/40"
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Resumen */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h4 className="text-[13px] font-semibold text-foreground uppercase tracking-wide" style={{ color: "oklch(0.55 0 0)" }}>Resumen de evaluación técnica</h4>
        {renglones.map((r) => {
          const cumpleN    = oferentes.filter((of) => evals.get(cellKey(r.id, of.id))?.cumple === true).length;
          const noCumpleN  = oferentes.filter((of) => evals.get(cellKey(r.id, of.id))?.cumple === false).length;
          const pendienteN = oferentes.filter((of) => evals.has(cellKey(r.id, of.id)) && evals.get(cellKey(r.id, of.id))?.cumple === null).length;
          const sinEvalN   = oferentes.length - cumpleN - noCumpleN - pendienteN;
          return (
            <div key={r.id} className="flex items-center gap-3 text-[14px]">
              <span className="text-muted-foreground w-24 shrink-0">Renglón {r.numero}:</span>
              {cumpleN > 0 && (
                <span className="text-emerald-400 font-medium">
                  {cumpleN} {cumpleN === 1 ? "cumple" : "cumplen"}
                </span>
              )}
              {pendienteN > 0 && (
                <span className="text-amber-400 font-medium">
                  {pendienteN} {pendienteN === 1 ? "pendiente" : "pendientes"}
                </span>
              )}
              {noCumpleN > 0 && (
                <span className="text-red-400 font-medium">
                  {noCumpleN} no {noCumpleN === 1 ? "cumple" : "cumplen"}
                </span>
              )}
              {sinEvalN > 0 && (
                <span className="text-muted-foreground/70">
                  {sinEvalN} sin evaluar
                </span>
              )}
              {sinEvalN === 0 && cumpleN === 0 && noCumpleN === 0 && pendienteN === 0 && (
                <span className="text-muted-foreground/50">Sin evaluaciones</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab: Adjudicación ───────────────────────────────────────────

function AdjudicacionTab({ licitacion }: { licitacion: Licitacion }) {
  const licitacionId = licitacion.id;
  const [loading, setLoading] = useState(true);
  const [renglones, setRenglones] = useState<RenglonConItems[]>([]);
  const [oferentes, setOferentes] = useState<Oferente[]>([]);
  const [ofertasMap, setOfertasMap] = useState<Map<string, { precio: number; divisa: Divisa }>>(new Map());
  const [evalsMap, setEvalsMap] = useState<Map<string, { cumple: boolean | null }>>(new Map());
  const [adjMap, setAdjMap] = useState<Map<string, string>>(new Map()); // renglonId → oferenteId
  const [saving, setSaving] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listRenglonesConItems(licitacionId),
      listOferentes(licitacionId),
      listOfertas(licitacionId),
      listEvaluaciones(licitacionId),
      listAdjudicaciones(licitacionId),
    ])
      .then(([rens, offs, oftas, evs, adjs]: [RenglonConItems[], Oferente[], { id: string; oferente_id: string; item_id: string; precio_unitario: number; divisa: Divisa }[], EvaluacionTecnica[], Adjudicacion[]]) => {
        setRenglones(rens);
        setOferentes(offs);
        const om = new Map<string, { precio: number; divisa: Divisa }>();
        for (const o of oftas) om.set(`${o.item_id}|${o.oferente_id}`, { precio: o.precio_unitario, divisa: o.divisa });
        setOfertasMap(om);
        const em = new Map<string, { cumple: boolean | null }>();
        for (const ev of evs) em.set(`${ev.renglon_id}|${ev.oferente_id}`, { cumple: ev.cumple });
        setEvalsMap(em);
        const am = new Map<string, string>();
        for (const adj of adjs) am.set(adj.renglon_id, adj.oferente_id);
        setAdjMap(am);
      })
      .catch((e) => { console.error(e); toast.error("No se pudo cargar la adjudicación"); })
      .finally(() => setLoading(false));
  }, [licitacionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fdOp = licitacion.fd_op_valor;
  const fdSic = licitacion.fd_sic_valor;
  const umbral = licitacion.umbral_economico_pct;

  const calcSicARS = (r: RenglonConItems): number | null => {
    let t = 0;
    for (const it of r.items) {
      if (it.precio_sic_pesos === null) return null;
      const enARS = (it.precio_sic_divisa ?? "ARS") === "USD"
        ? (fdSic ? it.precio_sic_pesos * fdSic : null)
        : it.precio_sic_pesos;
      if (enARS === null) return null;
      t += enARS;
    }
    return t;
  };

  const calcOferta = (r: RenglonConItems, ofId: string): { totalARS: number | null; cobertura: number } => {
    let t = 0;
    let cnt = 0;
    for (const it of r.items) {
      const o = ofertasMap.get(`${it.id}|${ofId}`);
      if (!o) continue;
      const p = o.divisa === "ARS" ? o.precio : fdSic ? o.precio * fdSic : null;
      if (p === null) return { totalARS: null, cobertura: cnt };
      t += p;
      cnt++;
    }
    return { totalARS: cnt > 0 ? t : null, cobertura: cnt };
  };

  const calcPct = (ofARS: number | null, sicARS: number | null): number | null => {
    if (ofARS === null || sicARS === null || sicARS === 0 || !fdSic) return null;
    return (ofARS / sicARS - 1) * 100;
  };

  const handleAdjudicar = async (renglonId: string, ofId: string) => {
    setSaving((p) => new Set(p).add(renglonId));
    try {
      if (adjMap.get(renglonId) === ofId) {
        await deleteAdjudicacion(renglonId);
        setAdjMap((p) => { const n = new Map(p); n.delete(renglonId); return n; });
      } else {
        await upsertAdjudicacion({ renglon_id: renglonId, oferente_id: ofId });
        setAdjMap((p) => new Map(p).set(renglonId, ofId));
      }
    } catch (e) { console.error(e); toast.error("No se pudo guardar"); }
    finally { setSaving((p) => { const n = new Set(p); n.delete(renglonId); return n; }); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
    </div>
  );

  if (renglones.length === 0) return (
    <div className="border border-dashed border-border rounded-lg py-10 text-center text-sm text-muted-foreground">
      No hay renglones. Cargalos en <strong>Renglones e Ítems</strong> primero.
    </div>
  );

  if (oferentes.length === 0) return (
    <div className="border border-dashed border-border rounded-lg py-10 text-center text-sm text-muted-foreground">
      No hay oferentes. Cargalos en <strong>Oferentes</strong> primero.
    </div>
  );

  const missingRates = !fdSic || !fdOp;

  return (
    <div className="space-y-4">
      {missingRates && (
        <div style={{ background: "oklch(0.25 0.06 55 / 0.35)", border: "1px solid oklch(0.55 0.12 55 / 0.45)", borderRadius: 10, padding: "11px 16px", fontSize: 14, color: "oklch(0.82 0.08 60)" }}>
          ⚠ Cargá los valores del dólar SIC y OP en <strong>Datos generales</strong> para calcular el % vs. SIC.
        </div>
      )}

      {renglones.map((r) => {
        const sicARS = calcSicARS(r);
        const adjOfId = adjMap.get(r.id);
        const isSaving = saving.has(r.id);

        // Ranking de % vs SIC: más barato (menor %) → verde, siguiente → amarillo, resto → blanco
        const pctByOf = new Map<string, number>();
        for (const of of oferentes) {
          const { totalARS, cobertura } = calcOferta(r, of.id);
          const pct = cobertura === r.items.length ? calcPct(totalARS, sicARS) : null;
          if (pct !== null) pctByOf.set(of.id, pct);
        }
        const rankedOfIds = [...pctByOf.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
        const rankColor = (ofId: string): string => {
          const idx = rankedOfIds.indexOf(ofId);
          if (idx === 0) return "#86efac";       // más barato → verde
          if (idx === 1) return "#fcd34d";       // siguiente → amarillo
          return "oklch(0.92 0 0)";              // resto → blanco
        };

        return (
          <div key={r.id} style={{ background: "oklch(0.205 0.005 270)", border: "1px solid oklch(1 0 0 / 0.07)", borderRadius: 12 }}>
            {/* Header */}
            <div style={{ padding: "11px 16px", borderBottom: "1px solid oklch(1 0 0 / 0.06)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "oklch(0.48 0 0)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Renglón</span>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 18, fontWeight: 700, color: "#86efac" }}>{r.numero}</span>
              {r.condicion_adjudicacion && (
                <span style={{ fontSize: 12.5, color: "oklch(0.58 0 0)" }}>{r.condicion_adjudicacion}</span>
              )}
              {sicARS !== null && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "oklch(0.60 0 0)", background: "oklch(0.18 0.005 270)", border: "1px solid oklch(1 0 0 / 0.07)", borderRadius: 6, padding: "2px 9px" }}>
                  <span style={{ color: "oklch(0.48 0 0)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10.5 }}>Total SIC del Renglón</span>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, color: "oklch(0.72 0 0)" }}>
                    {sicARS.toLocaleString("es-AR", { maximumFractionDigits: 0 })} ARS
                  </span>
                </span>
              )}
              {adjOfId && (
                <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: "oklch(0.30 0.10 155 / 0.45)", border: "1px solid oklch(0.55 0.15 155 / 0.5)", color: "#86efac" }}>
                  ✓ Adjudicado — {oferentes.find((o) => o.id === adjOfId)?.nombre}
                </span>
              )}
            </div>

            {/* Comparison table */}
            <div className="overflow-x-auto">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid oklch(1 0 0 / 0.06)" }}>
                    <th style={{ textAlign: "left", padding: "9px 16px", fontSize: 11, fontWeight: 600, color: "oklch(0.43 0 0)", textTransform: "uppercase", letterSpacing: "0.05em", width: 130 }}>
                      Criterio
                    </th>
                    {oferentes.map((of) => {
                      const isAdj = adjOfId === of.id;
                      return (
                        <th key={of.id} style={{ textAlign: "center", padding: "11px 16px", fontSize: 15.5, fontWeight: 600, minWidth: 190, color: isAdj ? "#86efac" : "oklch(0.85 0 0)", background: isAdj ? "oklch(0.24 0.04 155 / 0.20)" : "transparent", borderBottom: isAdj ? "2px solid oklch(0.55 0.15 155 / 0.55)" : "none" }}>
                          {of.nombre}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {/* Precio total ofertado */}
                  <tr style={{ borderBottom: "1px solid oklch(1 0 0 / 0.04)" }}>
                    <td style={{ padding: "9px 16px", fontSize: 13.5, color: "oklch(0.58 0 0)", fontWeight: 500 }}>Precio total ofertado</td>
                    {oferentes.map((of) => {
                      const { totalARS, cobertura } = calcOferta(r, of.id);
                      const isAdj = adjOfId === of.id;
                      return (
                        <td key={of.id} style={{ textAlign: "center", padding: "9px 12px", background: isAdj ? "oklch(0.22 0.03 155 / 0.12)" : "transparent" }}>
                          {totalARS !== null && cobertura === r.items.length ? (
                            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 14.5, color: "oklch(0.90 0 0)", fontWeight: 500 }}>
                              {totalARS.toLocaleString("es-AR", { maximumFractionDigits: 0 })} ARS
                            </span>
                          ) : cobertura > 0 ? (
                            <span style={{ fontSize: 13.5, color: "oklch(0.52 0 0)" }}>parcial</span>
                          ) : (
                            <span style={{ fontSize: 14.5, color: "oklch(0.33 0 0)" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* % vs SIC */}
                  <tr style={{ borderBottom: "1px solid oklch(1 0 0 / 0.04)" }}>
                    <td style={{ padding: "9px 16px", fontSize: 13.5, color: "oklch(0.58 0 0)", fontWeight: 500 }}>% vs. SIC</td>
                    {oferentes.map((of) => {
                      const { totalARS, cobertura } = calcOferta(r, of.id);
                      const pct = cobertura === r.items.length ? calcPct(totalARS, sicARS) : null;
                      const isAdj = adjOfId === of.id;
                      const over = pct !== null && pct > umbral;
                      return (
                        <td key={of.id} style={{ textAlign: "center", padding: "9px 12px", background: isAdj ? "oklch(0.22 0.03 155 / 0.12)" : "transparent" }}>
                          {pct !== null ? (
                            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 16, fontWeight: 700, color: over ? "#fca5a5" : rankColor(of.id) }}>
                              {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                            </span>
                          ) : (
                            <span style={{ fontSize: 14.5, color: "oklch(0.33 0 0)" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Técnica */}
                  <tr style={{ borderBottom: "1px solid oklch(1 0 0 / 0.04)" }}>
                    <td style={{ padding: "9px 16px", fontSize: 13.5, color: "oklch(0.58 0 0)", fontWeight: 500 }}>Técnica</td>
                    {oferentes.map((of) => {
                      const cumple = evalsMap.get(`${r.id}|${of.id}`)?.cumple ?? null;
                      const isAdj = adjOfId === of.id;
                      return (
                        <td key={of.id} style={{ textAlign: "center", padding: "9px 12px", background: isAdj ? "oklch(0.22 0.03 155 / 0.12)" : "transparent" }}>
                          {cumple === true ? (
                            <span style={{ fontSize: 14, color: "#86efac", fontWeight: 500 }}>✓ Cumple</span>
                          ) : cumple === false ? (
                            <span style={{ fontSize: 14, color: "#fca5a5", fontWeight: 500 }}>✗ No cumple</span>
                          ) : cumple === null && evalsMap.has(`${r.id}|${of.id}`) ? (
                            <span style={{ fontSize: 14, color: "#fcd34d", fontWeight: 500 }}>⏳ Pendiente</span>
                          ) : (
                            <span style={{ fontSize: 14, color: "oklch(0.42 0 0)" }}>Sin evaluar</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Cobertura */}
                  <tr style={{ borderBottom: "1px solid oklch(1 0 0 / 0.06)" }}>
                    <td style={{ padding: "9px 16px", fontSize: 13.5, color: "oklch(0.58 0 0)", fontWeight: 500 }}>Cobertura</td>
                    {oferentes.map((of) => {
                      const { cobertura } = calcOferta(r, of.id);
                      const total = r.items.length;
                      const isAdj = adjOfId === of.id;
                      return (
                        <td key={of.id} style={{ textAlign: "center", padding: "9px 12px", background: isAdj ? "oklch(0.22 0.03 155 / 0.12)" : "transparent" }}>
                          {total === 0 ? (
                            <span style={{ fontSize: 14, color: "oklch(0.42 0 0)" }}>—</span>
                          ) : cobertura === total ? (
                            <span style={{ fontSize: 14, color: "#86efac", fontWeight: 500 }}>✓ Completo</span>
                          ) : cobertura > 0 ? (
                            <span style={{ fontSize: 14, color: "#fcd34d" }}>⚠ {cobertura}/{total}</span>
                          ) : (
                            <span style={{ fontSize: 14, color: "oklch(0.42 0 0)" }}>Sin ofertar</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Adjudicar row */}
                  <tr>
                    <td style={{ padding: "10px 16px", fontSize: 13.5, color: "oklch(0.58 0 0)", fontWeight: 600 }}>Adjudicar</td>
                    {oferentes.map((of) => {
                      const isAdj = adjOfId === of.id;
                      return (
                        <td key={of.id} style={{ textAlign: "center", padding: "10px 12px", background: isAdj ? "oklch(0.22 0.03 155 / 0.12)" : "transparent" }}>
                          <button
                            onClick={() => handleAdjudicar(r.id, of.id)}
                            disabled={isSaving}
                            style={{
                              padding: "9px 22px", borderRadius: 8, border: "none", cursor: isSaving ? "wait" : "pointer",
                              background: isAdj ? "#86efac" : "oklch(0.27 0.005 270)",
                              color: isAdj ? "oklch(0.10 0.02 155)" : "oklch(0.62 0 0)",
                              fontSize: 14, fontWeight: 600,
                              transition: "background .15s, color .15s",
                              boxShadow: isAdj ? "0 2px 10px -4px oklch(0.55 0.15 155 / 0.5)" : "none",
                            }}
                            onMouseEnter={(e) => { if (!isAdj && !isSaving) e.currentTarget.style.background = "oklch(0.32 0.005 270)"; }}
                            onMouseLeave={(e) => { if (!isAdj) e.currentTarget.style.background = "oklch(0.27 0.005 270)"; }}
                          >
                            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : isAdj ? "✓ Adjudicado" : "Adjudicar"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Summary */}
      {adjMap.size > 0 && (
        <div style={{ background: "oklch(0.205 0.005 270)", border: "1px solid oklch(1 0 0 / 0.07)", borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "oklch(0.50 0 0)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            Resumen de adjudicación
          </div>
          <div className="space-y-2">
            {renglones.map((r) => {
              const adjOfId = adjMap.get(r.id);
              const adjOf = adjOfId ? oferentes.find((o) => o.id === adjOfId) : null;
              const { totalARS, cobertura } = adjOfId ? calcOferta(r, adjOfId) : { totalARS: null, cobertura: 0 };
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14.5 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", color: "#86efac", fontWeight: 600, width: 96, flexShrink: 0 }}>Renglón {r.numero}</span>
                  {adjOf ? (
                    <>
                      <span style={{ color: "oklch(0.88 0 0)", fontWeight: 500 }}>{adjOf.nombre}</span>
                      {totalARS !== null && cobertura === r.items.length && (
                        <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontSize: 14, color: "oklch(0.65 0 0)" }}>
                          {totalARS.toLocaleString("es-AR", { maximumFractionDigits: 0 })} ARS
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: "oklch(0.42 0 0)", fontStyle: "italic" }}>Sin adjudicar</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PlaceholderTab({ tab }: { tab: WizardTab }) {
  const messages: Record<WizardTab, { title: string; desc: string }> = {
    datos:        { title: "Datos generales",     desc: "Fechas, valores de dólar y umbral económico." },
    renglones:    { title: "Renglones e Ítems",   desc: "Matrícula, descripción, cantidad y precio SIC por renglón." },
    oferentes:    { title: "Oferentes",           desc: "Próxima fase: registrar la lista de oferentes participantes." },
    ofertas:      { title: "Ofertas",             desc: "Próxima fase: grilla de precios unitarios por ítem × oferente (USD o ARS)." },
    evaluacion:   { title: "Evaluación técnica",  desc: "Próxima fase: marcar Cumple/No cumple técnicamente por renglón × oferente." },
    adjudicacion: { title: "Adjudicación",        desc: "Próxima fase: tabla resumen con cálculo de %SIC y selección manual del ganador por renglón." },
  };
  const iconMap: Record<WizardTab, React.ElementType> = {
    datos: FileText, renglones: Layers, oferentes: Users, ofertas: Tag, evaluacion: ClipboardCheck, adjudicacion: Trophy,
  };
  const Icon = iconMap[tab];
  const m = messages[tab];
  return (
    <div
      className="text-center"
      style={{
        padding: "70px 24px", color: "oklch(0.50 0 0)",
        background: "oklch(0.205 0.005 270)",
        border: "1px dashed oklch(1 0 0 / 0.07)",
        borderRadius: 14,
      }}
    >
      <div
        className="mx-auto grid place-items-center"
        style={{
          width: 48, height: 48, borderRadius: 12, marginBottom: 14,
          background: "oklch(0.27 0.005 270)", color: "oklch(0.70 0 0)",
        }}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-[15px] font-semibold" style={{ color: "oklch(0.97 0 0)", marginBottom: 4 }}>{m.title}</div>
      <div className="text-[13px] max-w-md mx-auto leading-relaxed">{m.desc}</div>
    </div>
  );
}

// ─── Tab: Renglones e Ítems ──────────────────────────────────

function RenglonesTab({
  licitacionId,
  licitacion,
  onUpdated,
}: {
  licitacionId: string;
  licitacion: Licitacion;
  onUpdated: (l: Licitacion) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [renglones, setRenglones] = useState<RenglonConItems[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savingToggle, setSavingToggle] = useState(false);

  const [showCreateRenglon, setShowCreateRenglon] = useState(false);
  const [editingRenglon, setEditingRenglon] = useState<Renglon | null>(null);

  const [creatingItemFor, setCreatingItemFor] = useState<RenglonConItems | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  // Drag & drop / duplicación de ítems entre renglones
  const [dragItem, setDragItem] = useState<{ item: Item; fromRenglonId: string } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [duplicatingRenglon, setDuplicatingRenglon] = useState<string | null>(null);

  const handleToggleExclusividad = async () => {
    setSavingToggle(true);
    try {
      const updated = await updateLicitacion(licitacion.id, {
        exclusividad_renglones: !licitacion.exclusividad_renglones,
      });
      onUpdated(updated);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo guardar la condición");
    } finally {
      setSavingToggle(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const rows = await listRenglonesConItems(licitacionId);
      setRenglones(rows);
      if (rows.length <= 3) setExpanded(new Set(rows.map((r) => r.id)));
    } catch (e) {
      console.error(e);
      toast.error("No se pudieron cargar los renglones");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [licitacionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const nextRenglonNumero = () => renglones.reduce((m, r) => Math.max(m, r.numero), 0) + 1;
  const nextItemNumero = (renglon: RenglonConItems) => renglon.items.reduce((m, i) => Math.max(m, i.numero_item), 0) + 1;

  // Copia un ítem (independiente) a un renglón destino
  const copyItemToRenglon = async (item: Item, target: RenglonConItems) => {
    const numero_item = target.items.reduce((m, i) => Math.max(m, i.numero_item), 0) + 1;
    const created = await createItem({
      renglon_id: target.id,
      numero_item,
      matricula: item.matricula,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precio_sic_pesos: item.precio_sic_pesos,
      precio_sic_divisa: item.precio_sic_divisa,
    });
    setRenglones((prev) => prev.map((r2) => r2.id === target.id
      ? { ...r2, items: [...r2.items, created].sort((a, b) => a.numero_item - b.numero_item) }
      : r2));
    return created;
  };

  // Soltar un ítem arrastrado en un renglón destino (copia, mantiene original)
  const handleDropOnRenglon = async (target: RenglonConItems) => {
    const d = dragItem;
    setDragItem(null);
    setDragOverId(null);
    if (!d || d.fromRenglonId === target.id) return;
    try {
      await copyItemToRenglon(d.item, target);
      toast.success(`Ítem copiado al renglón ${target.numero}`);
    } catch (e) { console.error(e); toast.error("No se pudo copiar el ítem"); }
  };

  // Duplica un renglón completo con todos sus ítems
  const duplicateRenglon = async (r: RenglonConItems) => {
    setDuplicatingRenglon(r.id);
    try {
      const numero = nextRenglonNumero();
      const created = await createRenglon({
        licitacion_id: licitacionId,
        numero,
        condicion_adjudicacion: r.condicion_adjudicacion,
      });
      const newItems: Item[] = [];
      for (const it of r.items) {
        const ci = await createItem({
          renglon_id: created.id,
          numero_item: it.numero_item,
          matricula: it.matricula,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          precio_sic_pesos: it.precio_sic_pesos,
          precio_sic_divisa: it.precio_sic_divisa,
        });
        newItems.push(ci);
      }
      setRenglones((prev) => [...prev, { ...created, items: newItems.sort((a, b) => a.numero_item - b.numero_item) }].sort((a, b) => a.numero - b.numero));
      setExpanded((prev) => new Set(prev).add(created.id));
      toast.success(`Renglón ${r.numero} duplicado como renglón ${numero} (${r.items.length} ítem${r.items.length === 1 ? "" : "s"})`);
    } catch (e) { console.error(e); toast.error("No se pudo duplicar el renglón"); }
    finally { setDuplicatingRenglon(null); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando renglones...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {renglones.length} renglón{renglones.length === 1 ? "" : "es"} · {renglones.reduce((n, r) => n + r.items.length, 0)} ítem{renglones.reduce((n, r) => n + r.items.length, 0) === 1 ? "" : "s"}
          </p>
          {renglones.length > 1 && (
            <p className="text-[11px] mt-0.5" style={{ color: "oklch(0.48 0 0)" }}>
              Arrastrá un ítem (<GripVertical className="inline w-3 h-3 -mt-0.5" />) a otro renglón para copiarlo · o usá <Copy className="inline w-3 h-3 -mt-0.5" /> para duplicar el renglón completo.
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setShowCreateRenglon(true)}>
          <Plus className="w-4 h-4 mr-1" /> Agregar renglón
        </Button>
      </div>

      {renglones.length === 0 && (
        <div className="border border-dashed border-border rounded-lg py-10 text-center text-sm text-muted-foreground">
          No hay renglones aún. Hacé clic en "Agregar renglón" para empezar.
        </div>
      )}

      <div className="space-y-3">
        {renglones.map((r) => {
          const open = expanded.has(r.id);
          const isDropTarget = dragOverId === r.id && dragItem?.fromRenglonId !== r.id;
          const canDrop = !!dragItem && dragItem.fromRenglonId !== r.id;
          return (
            <div
              key={r.id}
              className="border rounded-lg bg-card overflow-hidden transition-colors"
              style={{
                borderColor: isDropTarget ? "#86efac" : undefined,
                boxShadow: isDropTarget ? "0 0 0 1px #86efac, 0 0 18px -6px rgba(134,239,172,0.5)" : undefined,
              }}
              onDragOver={(e) => {
                if (!canDrop) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                if (dragOverId !== r.id) setDragOverId(r.id);
              }}
              onDragLeave={(e) => {
                // sólo limpiar si el cursor sale realmente del contenedor
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverId((prev) => (prev === r.id ? null : prev));
                }
              }}
              onDrop={(e) => {
                if (!canDrop) return;
                e.preventDefault();
                handleDropOnRenglon(r);
              }}
            >
              <div className="flex items-center gap-2 px-3 py-2.5 bg-secondary/30">
                <button onClick={() => toggleExpand(r.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <div className="flex-1 min-w-0" onClick={() => toggleExpand(r.id)} role="button">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">Renglón {r.numero}</span>
                    <span className="text-xs text-muted-foreground">· {r.items.length} ítem{r.items.length === 1 ? "" : "s"}</span>
                    {isDropTarget && (
                      <span className="text-[11px] font-medium" style={{ color: "#86efac" }}>Soltá para copiar aquí</span>
                    )}
                  </div>
                  {r.condicion_adjudicacion && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{r.condicion_adjudicacion}</p>
                  )}
                </div>
                <button
                  onClick={() => duplicateRenglon(r)}
                  disabled={duplicatingRenglon === r.id}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  title="Duplicar renglón con todos sus ítems"
                >
                  {duplicatingRenglon === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => setEditingRenglon(r)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Editar renglón">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`¿Eliminar el renglón ${r.numero} y todos sus ítems?`)) return;
                    try {
                      await deleteRenglon(r.id);
                      toast.success("Renglón eliminado");
                      setRenglones((prev) => prev.filter((x) => x.id !== r.id));
                    } catch (e) { console.error(e); toast.error("No se pudo eliminar el renglón"); }
                  }}
                  className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="Eliminar renglón"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {open && (
                <div className="p-3 space-y-3">
                  {r.items.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-4">Sin ítems cargados.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13.5px]">
                        <thead>
                          <tr className="border-b border-border text-muted-foreground">
                            <th className="w-6"></th>
                            <th className="text-left py-2 px-2 w-12">#</th>
                            <th className="text-left py-2 px-2 w-32">Matrícula</th>
                            <th className="text-left py-2 px-2">Descripción</th>
                            <th className="text-right py-2 px-2 w-24">Cantidad</th>
                            <th className="text-right py-2 px-2 w-44">Precio SIC</th>
                            <th className="w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.items.map((it) => {
                            const isDragging = dragItem?.item.id === it.id;
                            return (
                            <tr key={it.id} className="border-b border-border/40 hover:bg-secondary/30 transition-colors" style={{ opacity: isDragging ? 0.4 : 1 }}>
                              <td className="py-2 pl-1 pr-0 align-middle">
                                <span
                                  draggable
                                  onDragStart={(e) => {
                                    setDragItem({ item: it, fromRenglonId: r.id });
                                    e.dataTransfer.effectAllowed = "copy";
                                    try { e.dataTransfer.setData("text/plain", it.id); } catch { /* noop */ }
                                  }}
                                  onDragEnd={() => { setDragItem(null); setDragOverId(null); }}
                                  className="inline-flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors"
                                  title="Arrastrar para copiar a otro renglón"
                                >
                                  <GripVertical className="w-3.5 h-3.5" />
                                </span>
                              </td>
                              <td className="py-2 px-2 font-mono text-muted-foreground">{it.numero_item}</td>
                              <td className="py-2 px-2 font-mono">{it.matricula || "—"}</td>
                              <td className="py-2 px-2 text-foreground">{it.descripcion || "—"}</td>
                              <td className="py-1.5 px-2 text-right">
                                <input
                                  key={`qty-${it.id}-${it.cantidad}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  defaultValue={it.cantidad}
                                  onBlur={async (e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!Number.isFinite(val) || val <= 0 || val === it.cantidad) return;
                                    try {
                                      const up = await updateItem(it.id, { cantidad: val });
                                      setRenglones((prev) => prev.map((r2) => r2.id === r.id ? { ...r2, items: r2.items.map((i) => i.id === it.id ? up : i) } : r2));
                                    } catch { toast.error("No se pudo actualizar"); }
                                  }}
                                  className="oferta-price-input w-full text-right tabular-nums bg-transparent border-b border-transparent hover:border-border/50 focus:border-accent focus:outline-none py-0.5 text-[13.5px]"
                                />
                              </td>
                              <td className="py-1.5 px-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    key={`prc-${it.id}-${it.precio_sic_pesos}`}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    defaultValue={it.precio_sic_pesos ?? ""}
                                    placeholder="—"
                                    onBlur={async (e) => {
                                      const raw = e.target.value.trim();
                                      const val = raw ? parseFloat(raw) : null;
                                      if (val === it.precio_sic_pesos) return;
                                      try {
                                        const up = await updateItem(it.id, { precio_sic_pesos: val });
                                        setRenglones((prev) => prev.map((r2) => r2.id === r.id ? { ...r2, items: r2.items.map((i) => i.id === it.id ? up : i) } : r2));
                                      } catch { toast.error("No se pudo actualizar"); }
                                    }}
                                    className="oferta-price-input w-28 text-right tabular-nums bg-transparent border-b border-transparent hover:border-border/50 focus:border-accent focus:outline-none py-0.5 text-[13.5px]"
                                  />
                                  <select
                                    key={`div-${it.id}-${it.precio_sic_divisa ?? "ARS"}`}
                                    defaultValue={it.precio_sic_divisa ?? "ARS"}
                                    onChange={async (e) => {
                                      const d = e.target.value as Divisa;
                                      try {
                                        const up = await updateItem(it.id, { precio_sic_divisa: d });
                                        setRenglones((prev) => prev.map((r2) => r2.id === r.id ? { ...r2, items: r2.items.map((i) => i.id === it.id ? up : i) } : r2));
                                      } catch { toast.error("No se pudo actualizar"); }
                                    }}
                                    className="text-[12.5px] bg-transparent border-none focus:outline-none cursor-pointer text-muted-foreground"
                                  >
                                    <option value="ARS">ARS</option>
                                    <option value="USD">USD</option>
                                  </select>
                                </div>
                              </td>
                              <td className="py-2 px-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => setEditingItem(it)} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Editar ítem">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!confirm(`¿Eliminar el ítem ${it.numero_item}?`)) return;
                                      try {
                                        await deleteItem(it.id);
                                        toast.success("Ítem eliminado");
                                        setRenglones((prev) => prev.map((x) => x.id === r.id ? { ...x, items: x.items.filter((i) => i.id !== it.id) } : x));
                                      } catch (e) { console.error(e); toast.error("No se pudo eliminar el ítem"); }
                                    }}
                                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                    title="Eliminar ítem"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setCreatingItemFor(r)} className="w-full border border-dashed border-border">
                    <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Condiciones del pliego */}
      {(() => {
        const hint =
          renglones.length >= 2
            ? renglones.length === 2
              ? "Aplicará entre los 2 renglones cargados."
              : `Aplicará al conjunto de los ${renglones.length} renglones.`
            : "Requiere al menos 2 renglones cargados para tener efecto.";
        return (
          <div style={{ background: "oklch(0.205 0.005 270)", border: "1px solid oklch(1 0 0 / 0.07)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "oklch(0.50 0 0)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              Condiciones del pliego
            </div>
            <button
              onClick={handleToggleExclusividad}
              disabled={savingToggle}
              style={{ display: "flex", alignItems: "flex-start", gap: 12, width: "100%", background: "none", border: "none", cursor: savingToggle ? "wait" : "pointer", padding: "6px 8px", borderRadius: 8, opacity: savingToggle ? 0.6 : 1, transition: "background .12s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "oklch(0.27 0.005 270)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
            >
              <div style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 1, background: licitacion.exclusividad_renglones ? "oklch(0.30 0.10 155 / 0.45)" : "oklch(0.16 0.005 270)", border: `1px solid ${licitacion.exclusividad_renglones ? "oklch(0.55 0.15 155 / 0.5)" : "oklch(1 0 0 / 0.12)"}`, display: "flex", alignItems: "center", justifyContent: "center", transition: "background .15s, border-color .15s" }}>
                {licitacion.exclusividad_renglones && <Check className="w-3 h-3" style={{ color: "#86efac" }} strokeWidth={2.5} />}
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: "oklch(0.92 0 0)" }}>Exclusividad entre renglones</div>
                <div style={{ fontSize: 12, color: "oklch(0.55 0 0)", marginTop: 3, lineHeight: 1.5 }}>
                  Un mismo oferente no puede ganar todos los renglones, salvo que los demás no cumplan técnicamente. {hint}
                </div>
              </div>
              {savingToggle && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "oklch(0.50 0 0)", marginTop: 2, flexShrink: 0 }} />}
            </button>
            <div style={{ fontSize: 11, color: "oklch(0.48 0 0)", borderTop: "1px solid oklch(1 0 0 / 0.06)", paddingTop: 8, marginTop: 8, lineHeight: 1.6 }}>
              <span style={{ fontWeight: 500, color: "oklch(0.60 0 0)" }}>Regla automática:</span>{" "}
              Si un oferente no oferta para alguno de los ítems de un renglón, queda descalificado para ese renglón (mirá la fila <em>Cobertura</em> al pie de cada renglón).
            </div>
          </div>
        );
      })()}

      {showCreateRenglon && (
        <RenglonModal
          mode="create"
          initialNumero={nextRenglonNumero()}
          onClose={() => setShowCreateRenglon(false)}
          onSubmit={async ({ numero, condicion }) => {
            try {
              const created = await createRenglon({ licitacion_id: licitacionId, numero, condicion_adjudicacion: condicion || null });
              setRenglones((prev) => [...prev, { ...created, items: [] }].sort((a, b) => a.numero - b.numero));
              setExpanded((prev) => new Set(prev).add(created.id));
              setShowCreateRenglon(false);
              toast.success("Renglón creado");
            } catch (e) { console.error(e); toast.error("No se pudo crear el renglón"); }
          }}
        />
      )}

      {editingRenglon && (
        <RenglonModal
          mode="edit"
          initialNumero={editingRenglon.numero}
          initialCondicion={editingRenglon.condicion_adjudicacion ?? ""}
          onClose={() => setEditingRenglon(null)}
          onSubmit={async ({ numero, condicion }) => {
            try {
              const updated = await updateRenglon(editingRenglon.id, { numero, condicion_adjudicacion: condicion || null });
              setRenglones((prev) => prev.map((r) => r.id === editingRenglon.id ? { ...r, ...updated } : r).sort((a, b) => a.numero - b.numero));
              setEditingRenglon(null);
              toast.success("Renglón actualizado");
            } catch (e) { console.error(e); toast.error("No se pudo actualizar el renglón"); }
          }}
        />
      )}

      {creatingItemFor && (
        <ItemModal
          mode="create"
          initialNumero={nextItemNumero(creatingItemFor)}
          renglonNumero={creatingItemFor.numero}
          onClose={() => setCreatingItemFor(null)}
          onSubmit={async (vals) => {
            try {
              const created = await createItem({ renglon_id: creatingItemFor.id, ...vals });
              setRenglones((prev) => prev.map((r) => r.id === creatingItemFor.id ? { ...r, items: [...r.items, created].sort((a, b) => a.numero_item - b.numero_item) } : r));
              setCreatingItemFor(null);
              toast.success("Ítem agregado");
            } catch (e) { console.error(e); toast.error("No se pudo crear el ítem"); }
          }}
        />
      )}

      {editingItem && (
        <ItemModal
          mode="edit"
          initialNumero={editingItem.numero_item}
          initialMatricula={editingItem.matricula ?? ""}
          initialDescripcion={editingItem.descripcion ?? ""}
          initialCantidad={editingItem.cantidad}
          initialPrecio={editingItem.precio_sic_pesos}
          initialDivisa={editingItem.precio_sic_divisa ?? "ARS"}
          onClose={() => setEditingItem(null)}
          onSubmit={async (vals) => {
            try {
              const updated = await updateItem(editingItem.id, vals);
              setRenglones((prev) => prev.map((r) => r.id === editingItem.renglon_id ? { ...r, items: r.items.map((i) => i.id === editingItem.id ? updated : i).sort((a, b) => a.numero_item - b.numero_item) } : r));
              setEditingItem(null);
              toast.success("Ítem actualizado");
            } catch (e) { console.error(e); toast.error("No se pudo actualizar el ítem"); }
          }}
        />
      )}
    </div>
  );
}

// ─── Tab: Oferentes ──────────────────────────────────────────────

function OferentesTab({ licitacionId }: { licitacionId: string }) {
  const [loading, setLoading]     = useState(true);
  const [oferentes, setOferentes] = useState<Oferente[]>([]);
  const [nombre, setNombre]       = useState("");
  const [adding, setAdding]       = useState(false);
  const inputRef                  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    listOferentes(licitacionId)
      .then(setOferentes)
      .catch((e) => { console.error(e); toast.error("No se pudieron cargar los oferentes"); })
      .finally(() => setLoading(false));
  }, [licitacionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    const n = nombre.trim();
    if (!n) return;
    if (oferentes.some((o) => o.nombre.toLowerCase() === n.toLowerCase())) {
      toast.error("Ya existe un oferente con ese nombre");
      return;
    }
    setAdding(true);
    try {
      const created = await createOferente({ licitacion_id: licitacionId, nombre: n });
      setOferentes((prev) => [...prev, created].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNombre("");
      inputRef.current?.focus();
      toast.success("Oferente agregado");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo agregar el oferente");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (o: Oferente) => {
    if (!confirm(`¿Eliminar a "${o.nombre}"? Se borrarán también sus ofertas y evaluaciones técnicas.`)) return;
    try {
      await deleteOferente(o.id);
      setOferentes((prev) => prev.filter((x) => x.id !== o.id));
      toast.success("Oferente eliminado");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo eliminar el oferente");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando oferentes...
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="Nombre del oferente (Ej: Empresa S.A.)"
          className="flex-1 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          autoFocus
        />
        <Button onClick={handleAdd} disabled={adding || !nombre.trim()} size="sm">
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
          Agregar
        </Button>
      </div>

      {oferentes.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg py-10 text-center text-sm text-muted-foreground">
          No hay oferentes cargados. Agregaí los participantes del Acta de Apertura.
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
          {oferentes.map((o, i) => (
            <div key={o.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/30 transition-colors">
              <span className="text-xs text-muted-foreground w-5 text-right tabular-nums">{i + 1}.</span>
              <span className="flex-1 text-sm text-foreground">{o.nombre}</span>
              <button
                onClick={() => handleDelete(o)}
                className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                title="Eliminar oferente"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {oferentes.length} oferente{oferentes.length === 1 ? "" : "s"} registrado{oferentes.length === 1 ? "" : "s"}.
        {oferentes.length > 0 && " Cargá las ofertas en la pestaña siguiente."}
      </p>
    </div>
  );
}

function DivisaPicker({ value, onChange, size = "md" }: { value: Divisa; onChange: (d: Divisa) => void; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const h = size === "sm" ? 36 : 44;
  const fs = size === "sm" ? 13 : 14;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ height: h, padding: "0 10px", borderRadius: 8, background: "oklch(0.16 0.005 270)", border: `1px solid ${open ? "oklch(0.55 0.15 155 / 0.6)" : "oklch(1 0 0 / 0.09)"}`, color: value === "USD" ? "#86efac" : "oklch(0.82 0 0)", fontSize: fs, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, minWidth: 68, transition: "border-color .15s" }}>
        {value}
        <ChevronDown className="w-3 h-3" style={{ opacity: 0.55, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 5px)", right: 0, zIndex: 200, background: "oklch(0.20 0.005 270)", border: "1px solid oklch(1 0 0 / 0.12)", borderRadius: 9, overflow: "hidden", boxShadow: "0 8px 24px -4px oklch(0 0 0 / 0.55)", minWidth: 68 }}>
          {(["ARS", "USD"] as Divisa[]).map((d) => (
            <button key={d} type="button"
              onClick={() => { onChange(d); setOpen(false); }}
              style={{ display: "block", width: "100%", padding: "9px 13px", background: d === value ? "oklch(0.27 0.005 270)" : "transparent", color: d === "USD" ? "#86efac" : "oklch(0.85 0 0)", fontSize: fs, fontWeight: 600, textAlign: "left", border: "none", cursor: "pointer" }}>
              {d}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Ofertas ─────────────────────────────────────────────────────

function OfertasTab({
  licitacion,
  onUpdated,
}: {
  licitacion: Licitacion;
  onUpdated: (l: Licitacion) => void;
}) {
  const licitacionId = licitacion.id;
  const [loading, setLoading] = useState(true);
  const [renglones, setRenglones] = useState<RenglonConItems[]>([]);
  const [oferentes, setOferentes] = useState<Oferente[]>([]);
  const [cells, setCells] = useState<Map<string, { precio: string; divisa: Divisa }>>(new Map());
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listRenglonesConItems(licitacionId),
      listOferentes(licitacionId),
      listOfertas(licitacionId),
    ])
      .then(([rens, offs, oftas]) => {
        setRenglones(rens);
        setOferentes(offs);
        const map = new Map<string, { precio: string; divisa: Divisa }>();
        for (const o of oftas) {
          map.set(`${o.item_id}|${o.oferente_id}`, {
            precio: o.precio_unitario.toString(),
            divisa: o.divisa,
          });
        }
        setCells(map);
      })
      .catch((e) => { console.error(e); toast.error("No se pudieron cargar las ofertas"); })
      .finally(() => setLoading(false));
  }, [licitacionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setAllDivisas = async (divisa: Divisa) => {
    const allItems = renglones.flatMap((r) => r.items);
    const updates: Promise<unknown>[] = [];
    setCells((prev) => {
      const next = new Map(prev);
      for (const of_ of oferentes) {
        for (const it of allItems) {
          const key = `${it.id}|${of_.id}`;
          const existing = next.get(key);
          if (existing) {
            next.set(key, { ...existing, divisa });
            if (existing.precio.trim()) {
              updates.push(
                upsertOferta({ oferente_id: of_.id, item_id: it.id, precio_unitario: parseFloat(existing.precio), divisa })
                  .catch((e) => console.error(e))
              );
            }
          }
        }
      }
      return next;
    });
    await Promise.all(updates);
    toast.success(`Todas las divisas cambiadas a ${divisa}`);
  };

  const getCell = (itemId: string, ofId: string) =>
    cells.get(`${itemId}|${ofId}`) ?? { precio: "", divisa: "ARS" as Divisa };

  const setCell = (itemId: string, ofId: string, patch: Partial<{ precio: string; divisa: Divisa }>) =>
    setCells((prev) => {
      const next = new Map(prev);
      const key = `${itemId}|${ofId}`;
      next.set(key, { ...(next.get(key) ?? { precio: "", divisa: "ARS" as Divisa }), ...patch });
      return next;
    });

  const saveCell = async (itemId: string, ofId: string) => {
    const key = `${itemId}|${ofId}`;
    const cell = cells.get(key) ?? { precio: "", divisa: "ARS" as Divisa };
    const precioStr = cell.precio.trim();

    if (!precioStr) {
      try { await deleteOferta(ofId, itemId); }
      catch (e) { console.error(e); }
      setCells((prev) => { const next = new Map(prev); next.delete(key); return next; });
      return;
    }

    const precio = Number(precioStr.replace(",", "."));
    if (!Number.isFinite(precio) || precio < 0) { toast.error("Precio inválido"); return; }

    setSavingCells((prev) => new Set(prev).add(key));
    try {
      await upsertOferta({ oferente_id: ofId, item_id: itemId, precio_unitario: precio, divisa: cell.divisa });
    } catch (e) { console.error(e); toast.error("No se pudo guardar la oferta"); }
    finally {
      setSavingCells((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando ofertas...
      </div>
    );
  }

  const totalItems = renglones.reduce((n, r) => n + r.items.length, 0);
  const totalOfertas = cells.size;

  if (renglones.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-lg py-10 text-center text-sm text-muted-foreground">
        No hay renglones cargados. Cargalos en la pestaña <strong>Renglones e Ítems</strong> primero.
      </div>
    );
  }

  if (oferentes.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-lg py-10 text-center text-sm text-muted-foreground">
        No hay oferentes cargados. Cargalos en la pestaña <strong>Oferentes</strong> primero.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <style>{`
        .oferta-price-input::-webkit-inner-spin-button,
        .oferta-price-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .oferta-price-input { -moz-appearance: textfield; }
      `}</style>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          Los precios se guardan automáticamente al salir de cada celda.
        </p>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 12.5, color: "oklch(0.50 0 0)", fontWeight: 500 }}>Cambiar todas las divisas:</span>
          <button onClick={() => setAllDivisas("USD")}
            style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid oklch(1 0 0 / 0.10)", background: "oklch(0.20 0.005 270)", color: "#86efac", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            USD
          </button>
          <button onClick={() => setAllDivisas("ARS")}
            style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid oklch(1 0 0 / 0.10)", background: "oklch(0.20 0.005 270)", color: "oklch(0.85 0 0)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            ARS
          </button>
          <p className="text-[14px] text-muted-foreground tabular-nums">
            {totalOfertas} / {totalItems * oferentes.length} celdas completadas
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border -mx-4 sm:-mx-6">
        <table className="w-full text-[14.5px] border-collapse">
          <thead>
            <tr className="bg-secondary/50">
              <th
                className="text-left py-3.5 px-4 font-medium text-muted-foreground border-r border-border"
                style={{ minWidth: "320px" }}
              >
                Ítem
              </th>
              {oferentes.map((of) => (
                <th
                  key={of.id}
                  className="py-3.5 px-4 font-semibold text-foreground border-r border-border last:border-r-0 text-center text-[15px]"
                  style={{ minWidth: "210px" }}
                >
                  {of.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {renglones.flatMap((r) => [
              <tr key={`reng-${r.id}`} className="bg-secondary/20 border-t border-border">
                <td colSpan={1 + oferentes.length} className="py-2.5 px-4 font-semibold text-[14.5px]">
                  <span className="text-accent">Renglón {r.numero}</span>
                  {r.condicion_adjudicacion && (
                    <span className="font-normal text-muted-foreground ml-2">{r.condicion_adjudicacion}</span>
                  )}
                </td>
              </tr>,
              ...r.items.map((item) => (
                <tr key={item.id} className="border-t border-border hover:bg-secondary/10 transition-colors">
                  <td className="py-2.5 px-4 border-r border-border align-top">
                    <div className="flex items-start gap-2.5">
                      <span className="font-mono text-muted-foreground shrink-0 text-[13px] mt-0.5">
                        {r.numero}.{item.numero_item}
                      </span>
                      <div className="min-w-0">
                        {item.matricula && (
                          <div className="font-mono text-accent text-[13px]">{item.matricula}</div>
                        )}
                        <div className="text-foreground leading-snug break-words text-[14.5px]">
                          {item.descripcion || "Sin descripción"}
                        </div>
                        <div className="text-muted-foreground text-[13px] mt-0.5">
                          Cant: {item.cantidad}
                        </div>
                      </div>
                    </div>
                  </td>
                  {oferentes.map((of) => {
                    const key = `${item.id}|${of.id}`;
                    const cell = getCell(item.id, of.id);
                    const isSaving = savingCells.has(key);
                    return (
                      <td key={of.id} className="py-2 px-2.5 border-r border-border last:border-r-0 align-middle">
                        <div className="flex items-center gap-1.5 relative">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={cell.precio}
                            onChange={(e) => setCell(item.id, of.id, { precio: e.target.value })}
                            onBlur={() => saveCell(item.id, of.id)}
                            placeholder="—"
                            className="oferta-price-input w-full min-w-0 h-9 px-2.5 rounded border text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20"
                            style={{ background: "oklch(0.16 0.005 270)", borderColor: "oklch(1 0 0 / 0.09)", color: "oklch(0.92 0 0)", fontSize: 14.5 }}
                          />
                          <DivisaPicker size="sm" value={cell.divisa} onChange={(divisa) => {
                              setCell(item.id, of.id, { divisa });
                              const precioStr = cell.precio.trim();
                              if (precioStr) {
                                const n = Number(precioStr.replace(",", "."));
                                if (Number.isFinite(n) && n >= 0)
                                  upsertOferta({ oferente_id: of.id, item_id: item.id, precio_unitario: n, divisa }).catch(console.error);
                              }
                            }} />
                          {isSaving && (
                            <span className="absolute -top-1.5 -right-1.5">
                              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              )),
              ...(r.items.length === 0
                ? [
                    <tr key={`empty-${r.id}`} className="border-t border-border">
                      <td
                        colSpan={1 + oferentes.length}
                        className="py-2 px-3 text-center text-muted-foreground italic"
                      >
                        Sin ítems en este renglón.
                      </td>
                    </tr>,
                  ]
                : [
                    <tr key={`cob-${r.id}`} className="border-t border-border bg-secondary/10">
                      <td className="py-2 px-4 text-[13px] text-muted-foreground italic border-r border-border">
                        Cobertura del renglón
                      </td>
                      {oferentes.map((of) => {
                        const total = r.items.length;
                        const con = r.items.reduce((n, it) => {
                          const c = cells.get(`${it.id}|${of.id}`);
                          return c && c.precio.trim() !== "" ? n + 1 : n;
                        }, 0);
                        let badge: React.ReactNode;
                        if (con === 0) {
                          badge = <span className="text-muted-foreground">— Sin ofertar</span>;
                        } else if (con === total) {
                          badge = <span className="text-emerald-500">✓ Completo ({con}/{total})</span>;
                        } else {
                          badge = (
                            <span className="text-amber-500" title={`Faltan ${total - con} ítem${total - con === 1 ? "" : "s"}`}>
                              ⚠ {con}/{total} — descalificado
                            </span>
                          );
                        }
                        return (
                          <td
                            key={of.id}
                            className="py-2 px-2.5 text-[13px] text-center border-r border-border last:border-r-0"
                          >
                            {badge}
                          </td>
                        );
                      })}
                    </tr>,
                  ]),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Modal: Renglón (crear/editar) ─────────────────────────────

function RenglonModal({
  mode, initialNumero, initialCondicion = "", onClose, onSubmit,
}: {
  mode: "create" | "edit";
  initialNumero: number;
  initialCondicion?: string;
  onClose: () => void;
  onSubmit: (vals: { numero: number; condicion: string }) => void | Promise<void>;
}) {
  const [numero, setNumero] = useState(initialNumero.toString());
  const [condicion, setCondicion] = useState(initialCondicion);
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    const n = parseInt(numero, 10);
    if (!Number.isFinite(n) || n < 1) { toast.error("Número de renglón inválido"); return; }
    setSaving(true);
    try { await onSubmit({ numero: n, condicion: condicion.trim() }); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{mode === "create" ? "Nuevo renglón" : "Editar renglón"}</CardTitle>
              <CardDescription>Un renglón es un grupo de ítems que se adjudican juntos a un mismo oferente.</CardDescription>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Número</span>
            <input type="number" min={1} value={numero} onChange={(e) => setNumero(e.target.value)} className="mt-1 w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Condición de adjudicación (opcional)</span>
            <textarea value={condicion} onChange={(e) => setCondicion(e.target.value)} placeholder="Ej: Adjudicación por renglón completo a un único oferente." rows={3} className="mt-1 w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={handle} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (mode === "create" ? "Crear" : "Guardar")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Modal: Ítem (crear/editar) ────────────────────────────────────

type LookupStatus = "idle" | "loading" | "found" | "not_found";

function ItemModal({
  mode,
  renglonNumero,
  initialNumero,
  initialMatricula = "",
  initialDescripcion = "",
  initialCantidad = 1,
  initialPrecio = null,
  initialDivisa = "ARS",
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  renglonNumero?: number;
  initialNumero: number;
  initialMatricula?: string;
  initialDescripcion?: string;
  initialCantidad?: number;
  initialPrecio?: number | null;
  initialDivisa?: Divisa;
  onClose: () => void;
  onSubmit: (vals: {
    numero_item: number;
    matricula: string;
    descripcion: string;
    cantidad: number;
    precio_sic_pesos: number | null;
    precio_sic_divisa: Divisa;
  }) => void | Promise<void>;
}) {
  const [numero, setNumero]           = useState(initialNumero.toString());
  const [matricula, setMatricula]     = useState(initialMatricula);
  const [descripcion, setDescripcion] = useState(initialDescripcion);
  const [cantidad, setCantidad]       = useState(initialCantidad.toString());
  const [precio, setPrecio]           = useState(initialPrecio?.toString() ?? "");
  const [divisa, setDivisa]           = useState<Divisa>(initialDivisa);
  const [saving, setSaving]           = useState(false);
  const [lookupStatus, setLookupStatus] = useState<LookupStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const code = matricula.trim();
    if (!code) { setLookupStatus("idle"); return; }
    setLookupStatus("loading");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const result = await lookupMatricula(code);
      if (result) {
        setDescripcion(result.descripcion);
        setLookupStatus("found");
      } else {
        setLookupStatus("not_found");
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [matricula]); // eslint-disable-line react-hooks/exhaustive-deps

  const parseNum = (s: string): number | null => {
    if (!s.trim()) return null;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const handle = async () => {
    const n = parseInt(numero, 10);
    if (!Number.isFinite(n) || n < 1) { toast.error("Número de ítem inválido"); return; }
    const cantNum = parseNum(cantidad);
    if (cantNum === null || cantNum <= 0) { toast.error("Cantidad inválida"); return; }
    setSaving(true);
    try {
      await onSubmit({ numero_item: n, matricula: matricula.trim(), descripcion: descripcion.trim(), cantidad: cantNum, precio_sic_pesos: parseNum(precio), precio_sic_divisa: divisa });
    } finally { setSaving(false); }
  };

  const lookupBadge = () => {
    if (lookupStatus === "loading")   return <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Buscando…</span>;
    if (lookupStatus === "found")     return <span className="text-xs text-emerald-500">✓ Encontrada en catálogo</span>;
    if (lookupStatus === "not_found") return <span className="text-xs text-amber-500">⚠ No está en el catálogo — escribí la descripción manualmente</span>;
    return null;
  };

  const S: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 600, color: "oklch(0.50 0 0)",
    textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 7,
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "oklch(0 0 0 / 0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 520, background: "oklch(0.18 0.005 270)", border: "1px solid oklch(1 0 0 / 0.09)", borderRadius: 16, boxShadow: "0 24px 64px -12px oklch(0 0 0 / 0.7)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid oklch(1 0 0 / 0.07)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "oklch(0.97 0 0)" }}>
              {mode === "create" ? "Nuevo ítem" : "Editar ítem"}
            </div>
            <div style={{ fontSize: 13, color: "oklch(0.52 0 0)", marginTop: 3 }}>
              {renglonNumero ? <><span style={{ color: "#86efac", fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>Renglón {renglonNumero}</span> — </> : ""}
              Ingresá la matrícula para autocompletar la descripción.
            </div>
          </div>
          <button onClick={onClose} style={{ color: "oklch(0.45 0 0)", background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, lineHeight: 1 }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <style>{`
          .im-input {
            width: 100%; height: 44px; padding: 0 13px; border-radius: 9px;
            background: oklch(0.14 0.005 270); border: 1px solid oklch(1 0 0 / 0.08);
            color: oklch(0.95 0 0); font-size: 15px; outline: none;
            transition: border-color .15s, box-shadow .15s; box-sizing: border-box;
          }
          .im-input:focus {
            border-color: oklch(0.55 0.15 155 / 0.7);
            box-shadow: 0 0 0 3px oklch(0.55 0.15 155 / 0.12);
          }
          .im-input::placeholder { color: oklch(0.38 0 0); }
          .im-input-sm {
            width: 100%; height: 40px; padding: 0 12px; border-radius: 8px;
            background: oklch(0.14 0.005 270); border: 1px solid oklch(1 0 0 / 0.08);
            color: oklch(0.95 0 0); font-size: 15px; font-family: ui-monospace, monospace;
            font-weight: 600; text-align: center; outline: none;
            transition: border-color .15s, box-shadow .15s; box-sizing: border-box;
          }
          .im-input-sm:focus {
            border-color: oklch(0.55 0.15 155 / 0.7);
            box-shadow: 0 0 0 3px oklch(0.55 0.15 155 / 0.12);
          }
          .im-textarea {
            width: 100%; padding: 10px 13px; border-radius: 9px;
            background: oklch(0.14 0.005 270); border: 1px solid oklch(1 0 0 / 0.08);
            color: oklch(0.95 0 0); font-size: 14px; resize: none; outline: none;
            transition: border-color .15s, box-shadow .15s; box-sizing: border-box; line-height: 1.6;
          }
          .im-textarea:focus {
            border-color: oklch(0.55 0.15 155 / 0.7);
            box-shadow: 0 0 0 3px oklch(0.55 0.15 155 / 0.12);
          }
          .im-textarea::placeholder { color: oklch(0.38 0 0); }
        `}</style>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Matrícula (protagonista) + Nº ítem (compacto) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 80px", gap: 12, alignItems: "end" }}>
            <div>
              <label style={S}>Matrícula</label>
              <input type="text" value={matricula} onChange={(e) => setMatricula(e.target.value)} placeholder="Ej: 12345" className="im-input" autoFocus={mode === "create"} />
              <div style={{ marginTop: 5, minHeight: 18 }}>{lookupBadge()}</div>
            </div>
            <div style={{ paddingBottom: 23 }}>
              <label style={{ ...S, textAlign: "center", display: "block" }}>Nº ítem</label>
              <input type="number" min={1} value={numero} onChange={(e) => setNumero(e.target.value)} className="im-input-sm" />
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label style={S}>
              Descripción
              {lookupStatus === "found" && <span style={{ fontSize: 11, color: "oklch(0.48 0 0)", fontWeight: 400, marginLeft: 6 }}>(podés editarla)</span>}
            </label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Se completa automáticamente al ingresar la matrícula"
              rows={3}
              className="im-textarea"
            />
          </div>

          {/* Precio SIC (protagonista) + Cantidad (compacto) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 80px", gap: 12, alignItems: "end" }}>
            <div>
              <label style={S}>Precio SIC</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number" step="0.01" min="0" value={precio}
                  onChange={(e) => setPrecio(e.target.value)}
                  placeholder="Ej: 1500000"
                  className="im-input"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <DivisaPicker value={divisa} onChange={setDivisa} />
              </div>
            </div>
            <div style={{ paddingBottom: 0 }}>
              <label style={{ ...S, textAlign: "center", display: "block" }}>Cantidad</label>
              <input type="number" step="0.01" min="0" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="im-input-sm" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px 20px", borderTop: "1px solid oklch(1 0 0 / 0.07)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: "10px 20px", borderRadius: 9, border: "1px solid oklch(1 0 0 / 0.10)", background: "transparent", color: "oklch(0.65 0 0)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
            Cancelar
          </button>
          <button onClick={handle} disabled={saving}
            style={{ padding: "10px 24px", borderRadius: 9, border: "none", background: saving ? "oklch(0.35 0.005 270)" : "#86efac", color: saving ? "oklch(0.60 0 0)" : "oklch(0.12 0.02 155)", fontSize: 14, fontWeight: 700, cursor: saving ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 7 }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {mode === "create" ? "Agregar" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Help Modal ──────────────────────────────────────────────────────

const HELP_STEPS_META = [
  { id: "datos",        icon: FileText,      label: "Datos generales",     color: "#60a5fa", subtitle: "Identificación y tipo de cambio" },
  { id: "renglones",    icon: Layers,        label: "Renglones e Ítems",   color: "#34d399", subtitle: "Estructura del pliego y precios SIC" },
  { id: "oferentes",    icon: Users,         label: "Oferentes",           color: "#a78bfa", subtitle: "Registro de participantes" },
  { id: "ofertas",      icon: Tag,           label: "Ofertas",             color: "#fbbf24", subtitle: "Carga de precios por oferente" },
  { id: "evaluacion",   icon: ClipboardCheck,label: "Evaluación técnica",  color: "#f87171", subtitle: "Aptitud técnica por renglón" },
  { id: "adjudicacion", icon: Trophy,        label: "Adjudicación",        color: "#86efac", subtitle: "Comparativa y selección final" },
] as const;

function HelpTip({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 9, background: "oklch(0.30 0.10 155 / 0.12)", border: "1px solid oklch(0.55 0.15 155 / 0.22)", marginTop: 8 }}>
      <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#86efac" }} />
      <span style={{ fontSize: 13, color: "oklch(0.78 0 0)", lineHeight: 1.55 }}>{children}</span>
    </div>
  );
}

function HelpWarning({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 9, background: "oklch(0.35 0.12 55 / 0.15)", border: "1px solid oklch(0.65 0.15 55 / 0.25)", marginTop: 8 }}>
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#fcd34d" }} />
      <span style={{ fontSize: 13, color: "oklch(0.78 0 0)", lineHeight: 1.55 }}>{children}</span>
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <ListChecks className="w-4 h-4" style={{ color: "oklch(0.50 0 0)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "oklch(0.50 0 0)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function HelpField({ name, desc }: { name: string; desc: string }) {
  return (
    <div style={{ display: "flex", gap: 8, paddingBottom: 7, borderBottom: "1px solid oklch(1 0 0 / 0.04)", alignItems: "flex-start" }}>
      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, fontWeight: 600, color: "#86efac", paddingTop: 1, minWidth: 160, flexShrink: 0 }}>{name}</span>
      <span style={{ fontSize: 13, color: "oklch(0.68 0 0)", lineHeight: 1.5 }}>{desc}</span>
    </div>
  );
}

function HelpAction({ label, desc }: { label: string; desc: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingBottom: 8 }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 24, height: 22, borderRadius: 6, background: "oklch(0.28 0.005 270)", border: "1px solid oklch(1 0 0 / 0.08)", fontSize: 12, color: "oklch(0.80 0 0)", fontWeight: 600, paddingLeft: 5, paddingRight: 5, whiteSpace: "nowrap", marginTop: 1 }}>{label}</span>
      <span style={{ fontSize: 13, color: "oklch(0.68 0 0)", lineHeight: 1.5 }}>{desc}</span>
    </div>
  );
}

function HelpStepContent({ step }: { step: number }) {
  switch (step) {
    case 0:
      return (
        <>
          <p style={{ fontSize: 14, color: "oklch(0.72 0 0)", lineHeight: 1.65, marginBottom: 4 }}>
            Configurá los datos identificatorios de la licitación y los tipos de cambio que se usan para normalizar los precios en toda la comparativa.
          </p>
          <HelpSection title="Campos">
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <HelpField name="Número SIC" desc="Código único del proceso en el sistema SIC. Ej: 2024-0001." />
              <HelpField name="Título" desc="Nombre descriptivo de la licitación." />
              <HelpField name="Fecha SIC" desc="Fecha de referencia del pliego original." />
              <HelpField name="Dólar SIC" desc="Tipo de cambio a la Fecha SIC. Se ingresa manualmente." />
              <HelpField name="Fecha de la OP" desc="Fecha del Acta de Apertura de las ofertas." />
              <HelpField name="Dólar OP" desc='Tipo de cambio al día de la OP. Usá el botón "BCRA" para consultar automáticamente.' />
              <HelpField name="Umbral económico (%)" desc="Porcentaje máximo sobre el precio SIC que se acepta sin marcar en rojo." />
            </div>
          </HelpSection>
          <HelpSection title="Acciones">
            <HelpAction label="BCRA" desc="Consulta la cotización oficial del dólar en el BCRA para el día hábil anterior a la Fecha de la OP." />
            <HelpAction label="Guardar cambios" desc="Persiste todos los campos en la base de datos." />
          </HelpSection>
          <HelpTip>El Dólar SIC se usa para convertir <strong>tanto los precios SIC como las ofertas</strong> a ARS. Usar el mismo dólar para ambas conversiones garantiza una comparación consistente.</HelpTip>
          <HelpTip>Si la Fecha de la OP cae en sábado o domingo, el sistema retrocede automáticamente al viernes para consultar el BCRA.</HelpTip>
        </>
      );
    case 1:
      return (
        <>
          <p style={{ fontSize: 14, color: "oklch(0.72 0 0)", lineHeight: 1.65, marginBottom: 4 }}>
            Cargá la estructura del pliego: los renglones a adjudicar y los ítems que componen cada uno con sus precios de referencia SIC.
          </p>
          <HelpSection title="Acciones sobre renglones">
            <HelpAction label="+ Renglón" desc="Crea un nuevo renglón numerado (Renglón 1, 2…)." />
            <HelpAction label="⧉ Duplicar" desc="Copia el renglón completo con todos sus ítems. Ícono de papeles en el encabezado del card." />
            <HelpAction label="🗑 Eliminar" desc="Borra el renglón y todos sus ítems, ofertas y evaluaciones asociadas." />
          </HelpSection>
          <HelpSection title="Acciones sobre ítems">
            <HelpAction label="+ Ítem" desc="Abre el modal de carga con los campos del ítem." />
            <HelpAction label="✏ Editar" desc="Modifica un ítem existente." />
            <HelpAction label="Drag & drop" desc="Arrastrá un ítem desde un renglón hacia otro para copiarlo." />
          </HelpSection>
          <HelpSection title="Campos del ítem">
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <HelpField name="Matrícula" desc="Código del artículo. El sistema completa la descripción automáticamente desde el catálogo." />
              <HelpField name="Nº ítem" desc="Número de orden dentro del renglón." />
              <HelpField name="Descripción" desc="Descripción del artículo. Se auto-completa si hay matrícula; podés editarla." />
              <HelpField name="Precio SIC" desc="Precio unitario de referencia del pliego." />
              <HelpField name="Divisa" desc="ARS o USD. Si es USD se convierte con el Dólar SIC para los cálculos." />
              <HelpField name="Cantidad" desc="Cantidad requerida (informativa; no afecta el cálculo de totales)." />
            </div>
          </HelpSection>
          <HelpTip>El <strong>Total SIC del Renglón</strong> es la suma de los precios unitarios SIC de todos los ítems, sin multiplicar por cantidad.</HelpTip>
          <HelpWarning>La cantidad se registra pero <strong>no se multiplica</strong> en los totales de la comparativa — el análisis es sobre precios unitarios.</HelpWarning>
        </>
      );
    case 2:
      return (
        <>
          <p style={{ fontSize: 14, color: "oklch(0.72 0 0)", lineHeight: 1.65, marginBottom: 4 }}>
            Registrá todas las empresas o personas que presentaron ofertas válidas en la licitación.
          </p>
          <HelpSection title="Acciones">
            <HelpAction label="+ Agregar" desc="Escribí el nombre del oferente en el campo y presioná Enter o el botón +." />
            <HelpAction label="🗑 Eliminar" desc="Borra el oferente y todas sus ofertas y evaluaciones." />
          </HelpSection>
          <HelpTip>Agregá todos los oferentes antes de pasar a la pestaña de Ofertas — sus nombres van a aparecer como columnas en las tablas.</HelpTip>
          <HelpWarning>Eliminar un oferente borra también todos sus precios registrados en Ofertas y sus evaluaciones técnicas. Esta acción no se puede deshacer.</HelpWarning>
        </>
      );
    case 3:
      return (
        <>
          <p style={{ fontSize: 14, color: "oklch(0.72 0 0)", lineHeight: 1.65, marginBottom: 4 }}>
            Ingresá el precio unitario ofertado por cada proveedor para cada ítem de la licitación.
          </p>
          <HelpSection title="Estructura de la tabla">
            <HelpField name="Filas" desc="Ítems de la licitación, agrupados por renglón." />
            <HelpField name="Columnas" desc="Un bloque precio + divisa por cada oferente registrado." />
          </HelpSection>
          <HelpSection title="Acciones">
            <HelpAction label="Precio" desc="Escribí el precio unitario ofertado en el campo correspondiente." />
            <HelpAction label="ARS / USD" desc="Selector de divisa por celda. Podés mezclar divisas entre oferentes." />
            <HelpAction label="Botón USD" desc="Cambia la divisa de todas las celdas a USD con un solo clic." />
            <HelpAction label="Botón ARS" desc="Cambia la divisa de todas las celdas a ARS con un solo clic." />
          </HelpSection>
          <HelpTip>El precio <strong>se guarda automáticamente</strong> al salir del campo (sin necesidad de botón Guardar).</HelpTip>
          <HelpTip>Los campos en blanco se interpretan como "sin oferta" para ese ítem, lo que resulta en cobertura Parcial en la Adjudicación.</HelpTip>
          <HelpWarning>Si hay precios en USD, se convierten a ARS con el Dólar SIC para la comparativa. Verificá que el dólar SIC esté cargado en Datos generales.</HelpWarning>
        </>
      );
    case 4:
      return (
        <>
          <p style={{ fontSize: 14, color: "oklch(0.72 0 0)", lineHeight: 1.65, marginBottom: 4 }}>
            Evaluá si cada oferente cumple los requisitos técnicos del pliego para cada renglón.
          </p>
          <HelpSection title="Estructura de la tabla">
            <HelpField name="Filas" desc="Un renglón de la licitación por fila." />
            <HelpField name="Columnas" desc="Un bloque de evaluación por cada oferente registrado." />
          </HelpSection>
          <HelpSection title="Estados posibles">
            <HelpAction label="✓ Cumple" desc="El oferente cumplió todos los requisitos técnicos del renglón. Se muestra en verde." />
            <HelpAction label="⏳ Pendiente" desc="La evaluación está en curso o requiere más análisis. Se muestra en amarillo." />
            <HelpAction label="✗ No cumple" desc="El oferente no cumplió los requisitos técnicos. Se muestra en rojo." />
            <HelpAction label="Sin evaluar" desc="No se registró ninguna evaluación (celda vacía / sin color)." />
          </HelpSection>
          <HelpSection title="Observaciones">
            <HelpAction label="Campo de texto" desc="Podés escribir observaciones adicionales en cada celda. Se guardan junto al estado." />
          </HelpSection>
          <HelpTip>Hacé clic en el <strong>mismo botón activo</strong> para quitar la evaluación y dejarla en estado "Sin evaluar".</HelpTip>
          <HelpTip>El estado de la evaluación aparece en la columna "Técnica" dentro de la pestaña Adjudicación para ayudar en la decisión.</HelpTip>
        </>
      );
    case 5:
      return (
        <>
          <p style={{ fontSize: 14, color: "oklch(0.72 0 0)", lineHeight: 1.65, marginBottom: 4 }}>
            Vista comparativa final para seleccionar el oferente a adjudicar en cada renglón. Se muestra un card por renglón con la tabla de comparación.
          </p>
          <HelpSection title="Datos por renglón">
            <HelpField name="Total SIC del Renglón" desc="Suma de precios unitarios SIC (en ARS con Dólar SIC). Es la referencia de comparación." />
            <HelpField name="Precio total ofertado" desc="Suma de precios unitarios del oferente (en ARS usando Dólar SIC). Sin cantidad." />
            <HelpField name="% vs. SIC" desc="Diferencia porcentual entre el precio ofertado y el SIC. Negativo = más barato." />
            <HelpField name="Técnica" desc="Estado de la evaluación técnica para ese renglón." />
            <HelpField name="Cobertura" desc="Completo = ofertó todos los ítems. Parcial = le falta alguno. Sin ofertar = no hay precios." />
          </HelpSection>
          <HelpSection title="Código de colores (% vs. SIC)">
            <HelpAction label="🟢 Verde" desc="El oferente más económico del renglón." />
            <HelpAction label="🟡 Amarillo" desc="El segundo más económico del renglón." />
            <HelpAction label="⚪ Blanco" desc="Demás oferentes." />
            <HelpAction label="🔴 Rojo" desc="Supera el umbral económico configurado en Datos generales." />
          </HelpSection>
          <HelpSection title="Adjudicar">
            <HelpAction label="Adjudicar" desc="Marca al oferente como adjudicado para ese renglón. Es un toggle — hacé clic de nuevo para desadjudicar." />
          </HelpSection>
          <HelpTip>El ranking de colores es <strong>automático</strong>: se recalcula en tiempo real según los precios ingresados.</HelpTip>
          <HelpWarning>Un oferente puede adjudicarse aunque tenga evaluación "Pendiente" o "Sin evaluar". El sistema no bloquea la adjudicación por estado técnico.</HelpWarning>
        </>
      );
    default:
      return null;
  }
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = HELP_STEPS_META[step];
  const Icon = current.icon;
  const total = HELP_STEPS_META.length;

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "oklch(0 0 0 / 0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ width: "100%", maxWidth: 860, maxHeight: "90vh", display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden", background: "oklch(0.15 0.005 270)", border: "1px solid oklch(1 0 0 / 0.09)", boxShadow: "0 24px 64px -20px oklch(0 0 0 / 0.8)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid oklch(1 0 0 / 0.07)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 8, background: "oklch(0.30 0.10 155 / 0.35)", border: "1px solid oklch(0.55 0.15 155 / 0.45)", color: "#86efac" }}>
              <HelpCircle className="w-4 h-4" />
            </div>
            <span style={{ fontSize: 17, fontWeight: 600, color: "oklch(0.95 0 0)", letterSpacing: -0.3 }}>Guía de uso — Informe Técnico</span>
          </div>
          <button onClick={onClose} style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 7, background: "transparent", border: "1px solid oklch(1 0 0 / 0.08)", color: "oklch(0.60 0 0)", cursor: "pointer", transition: "color .15s, background .15s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.90 0 0)"; (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.22 0.005 270)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.60 0 0)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Step sidebar */}
          <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid oklch(1 0 0 / 0.06)", padding: "14px 10px", overflowY: "auto", background: "oklch(0.13 0.005 270)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "oklch(0.38 0 0)", padding: "0 8px 10px" }}>Pasos</div>
            {HELP_STEPS_META.map((s, idx) => {
              const SIcon = s.icon;
              const isActive = idx === step;
              return (
                <button
                  key={s.id}
                  onClick={() => setStep(idx)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 9, marginBottom: 2,
                    background: isActive ? `${s.color}18` : "transparent",
                    border: isActive ? `1px solid ${s.color}40` : "1px solid transparent",
                    cursor: "pointer", textAlign: "left", transition: "background .12s, border .12s",
                  }}
                  onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.20 0.005 270)"; }}
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, background: isActive ? `${s.color}22` : "oklch(0.20 0.005 270)", border: `1px solid ${isActive ? s.color + "55" : "oklch(1 0 0 / 0.06)"}`, flexShrink: 0, color: isActive ? s.color : "oklch(0.45 0 0)", transition: "color .12s, border-color .12s" }}>
                    <SIcon className="w-3.5 h-3.5" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? "oklch(0.95 0 0)" : "oklch(0.65 0 0)", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: isActive ? "oklch(0.55 0 0)" : "oklch(0.40 0 0)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.subtitle}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Content area */}
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
            {/* Step header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid oklch(1 0 0 / 0.06)" }}>
              <div style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10, background: `${current.color}18`, border: `1px solid ${current.color}44`, color: current.color, flexShrink: 0 }}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "oklch(0.42 0 0)" }}>Paso {step + 1} de {total}</span>
                  <ArrowRight className="w-3 h-3" style={{ color: "oklch(0.30 0 0)" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: current.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{current.subtitle}</span>
                </div>
                <div style={{ fontSize: 19, fontWeight: 700, color: "oklch(0.95 0 0)", letterSpacing: -0.3, marginTop: 2 }}>{current.label}</div>
              </div>
            </div>

            {/* Dynamic content */}
            <HelpStepContent step={step} />
          </div>
        </div>

        {/* Footer navigation */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderTop: "1px solid oklch(1 0 0 / 0.07)", flexShrink: 0 }}>
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid oklch(1 0 0 / 0.09)", background: "oklch(0.20 0.005 270)", color: step === 0 ? "oklch(0.35 0 0)" : "oklch(0.78 0 0)", fontSize: 13, fontWeight: 500, cursor: step === 0 ? "not-allowed" : "pointer" }}
          >
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>
          <div style={{ display: "flex", gap: 5 }}>
            {HELP_STEPS_META.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => setStep(idx)}
                style={{ width: idx === step ? 20 : 7, height: 7, borderRadius: 4, border: "none", background: idx === step ? current.color : "oklch(0.30 0.005 270)", cursor: "pointer", transition: "width .2s, background .2s", padding: 0 }}
              />
            ))}
          </div>
          {step < total - 1 ? (
            <button
              onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: current.color === "#86efac" ? "#86efac" : current.color, color: "oklch(0.10 0 0)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onClose}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: "#86efac", color: "oklch(0.10 0 0)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              <Check className="w-4 h-4" /> Entendido
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
