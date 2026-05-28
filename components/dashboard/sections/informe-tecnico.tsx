"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Gavel, Loader2, ChevronDown, ChevronRight, FileText, Layers, Users, Tag, ClipboardCheck, Trophy, Save, Pencil, Trash2, X } from "lucide-react";
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
  type Licitacion,
  type Renglon,
  type Item,
  type RenglonConItems,
  type Oferente,
  type Divisa,
  type EvaluacionTecnica,
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

  return (
    <div className="space-y-6">
      {/* Header bar: selector + acciones */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Gavel className="w-6 h-6 text-accent" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Informe Técnico</h2>
            <p className="text-xs text-muted-foreground">
              Análisis de ofertas y adjudicación por renglón.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {licitaciones.length > 0 && (
            <LicitacionSelector
              licitaciones={licitaciones}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Nueva licitación
          </Button>
        </div>
      </div>

      {/* Vacío */}
      {licitaciones.length === 0 && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <Gavel className="w-10 h-10 text-muted-foreground" />
            <CardTitle>No hay licitaciones cargadas</CardTitle>
            <CardDescription>
              Creá una nueva licitación para empezar a cargar renglones, oferentes y ofertas.
            </CardDescription>
            <Button onClick={() => setShowCreate(true)} className="mt-2">
              <Plus className="w-4 h-4 mr-1" />
              Crear primera licitación
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Wizard */}
      {selected && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as WizardTab)} className="w-full">
          <TabsList className="w-full justify-start overflow-x-auto h-auto flex-wrap">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.id} value={t.id} className="gap-2">
                  <Icon className="w-4 h-4" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {TABS.map((t) => (
            <TabsContent key={t.id} value={t.id} className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <t.icon className="w-5 h-5 text-accent" />
                    {t.label}
                  </CardTitle>
                  <CardDescription>
                    Licitación SIC <span className="font-mono">{selected.numero_sic}</span> — {selected.titulo}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {t.id === "datos" ? (
                    <DatosGeneralesTab
                      licitacion={selected}
                      onUpdated={(updated) => {
                        setLicitaciones((prev) =>
                          prev.map((l) => (l.id === updated.id ? updated : l)),
                        );
                      }}
                    />
                  ) : t.id === "renglones" ? (
                    <RenglonesTab licitacionId={selected.id} />
                  ) : t.id === "oferentes" ? (
                    <OferentesTab licitacionId={selected.id} />
                  ) : t.id === "ofertas" ? (
                    <OfertasTab
                      licitacion={selected}
                      onUpdated={(updated) => {
                        setLicitaciones((prev) =>
                          prev.map((l) => (l.id === updated.id ? updated : l)),
                        );
                      }}
                    />
                  ) : t.id === "evaluacion" ? (
                    <EvaluacionTab licitacionId={selected.id} />
                  ) : (
                    <PlaceholderTab tab={t.id} />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}

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

// ─── Selector de licitación ──────────────────────────────────────────

function LicitacionSelector({
  licitaciones, selectedId, onSelect,
}: {
  licitaciones: Licitacion[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = licitaciones.find((l) => l.id === selectedId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground hover:border-accent/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all min-w-[260px]"
      >
        <span className="truncate flex-1 text-left">
          {selected ? (
            <>
              <span className="font-mono text-xs text-accent mr-2">SIC {selected.numero_sic}</span>
              {selected.titulo}
            </>
          ) : (
            "Seleccionar licitación"
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-[calc(100%+4px)] right-0 min-w-[320px] bg-card border border-border rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          {licitaciones.map((l) => (
            <button
              key={l.id}
              onClick={() => { onSelect(l.id); setOpen(false); }}
              className={`w-full px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-left ${l.id === selectedId ? "bg-secondary/40" : ""}`}
            >
              <div className="font-mono text-xs text-accent">SIC {l.numero_sic}</div>
              <div className="text-foreground">{l.titulo}</div>
            </button>
          ))}
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
  const [fechaApertura,   setFechaApertura]   = useState(licitacion.fecha_apertura ?? "");
  const [fdSicFecha,      setFdSicFecha]      = useState(licitacion.fd_sic_fecha ?? "");
  const [fdSicValor,      setFdSicValor]      = useState<string>(licitacion.fd_sic_valor?.toString() ?? "");
  const [fdOpFecha,       setFdOpFecha]       = useState(licitacion.fd_op_fecha ?? "");
  const [fdOpValor,       setFdOpValor]       = useState<string>(licitacion.fd_op_valor?.toString() ?? "");
  const [umbral,          setUmbral]          = useState<string>(licitacion.umbral_economico_pct?.toString() ?? "50");
  const [saving,          setSaving]          = useState(false);

  useEffect(() => {
    setNumeroSic(licitacion.numero_sic);
    setTitulo(licitacion.titulo);
    setFechaApertura(licitacion.fecha_apertura ?? "");
    setFdSicFecha(licitacion.fd_sic_fecha ?? "");
    setFdSicValor(licitacion.fd_sic_valor?.toString() ?? "");
    setFdOpFecha(licitacion.fd_op_fecha ?? "");
    setFdOpValor(licitacion.fd_op_valor?.toString() ?? "");
    setUmbral(licitacion.umbral_economico_pct?.toString() ?? "50");
  }, [licitacion.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    numeroSic     !== licitacion.numero_sic ||
    titulo        !== licitacion.titulo ||
    fechaApertura !== (licitacion.fecha_apertura ?? "") ||
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
        fecha_apertura: fechaApertura || null,
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
          <FormField label="Fecha del Acta de Apertura">
            <input type="date" value={fechaApertura} onChange={(e) => setFechaApertura(e.target.value)} className="ti-input" />
          </FormField>
          <div />

          <FormField label="Fecha de la SIC">
            <input type="date" value={fdSicFecha} onChange={(e) => setFdSicFecha(e.target.value)} className="ti-input" />
          </FormField>
          <FormField label="Dólar de la SIC (ARS por USD)">
            <input type="number" step="0.01" inputMode="decimal" value={fdSicValor} onChange={(e) => setFdSicValor(e.target.value)} placeholder="Ej: 1399.5" className="ti-input" />
          </FormField>

          <FormField label="Fecha de la OP">
            <input type="date" value={fdOpFecha} onChange={(e) => setFdOpFecha(e.target.value)} className="ti-input" />
          </FormField>
          <FormField label="Dólar de la OP (ARS por USD)">
            <input type="number" step="0.01" inputMode="decimal" value={fdOpValor} onChange={(e) => setFdOpValor(e.target.value)} placeholder="Ej: 1398" className="ti-input" />
          </FormField>
        </div>
      </FormSection>

      <FormSection
        title="Configuración"
        description="Umbral máximo de sobreprecio aceptable respecto al precio SIC en USD. Default: 50%."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FormField label="Umbral económico (%)">
            <input type="number" step="0.1" inputMode="decimal" value={umbral} onChange={(e) => setUmbral(e.target.value)} className="ti-input" />
          </FormField>
        </div>
      </FormSection>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
        {dirty && <span className="text-xs text-amber-500">● Cambios sin guardar</span>}
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Guardar cambios
        </Button>
      </div>

      <style jsx global>{`
        .ti-input {
          height: 2.25rem;
          padding: 0 0.75rem;
          border-radius: 0.5rem;
          background-color: hsl(var(--secondary));
          border: 1px solid hsl(var(--border));
          font-size: 0.875rem;
          color: hsl(var(--foreground));
          width: 100%;
        }
        .ti-input:focus {
          outline: none;
          box-shadow: 0 0 0 2px hsl(var(--ring) / 0.2);
        }
      `}</style>
    </div>
  );
}

function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function FormField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
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
    const next = current?.cumple === value ? null : value;
    setEvals((prev) =>
      new Map(prev).set(key, {
        id: current?.id ?? "",
        oferente_id: oferenteId,
        renglon_id: renglonId,
        cumple: next,
        observaciones: current?.observaciones ?? null,
      }),
    );
    doSave(renglonId, oferenteId, next, current?.observaciones ?? null);
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
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-secondary/60 border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground w-36 border-r border-border">
                Renglón
              </th>
              {oferentes.map((of) => (
                <th
                  key={of.id}
                  className="px-4 py-2.5 text-xs font-semibold text-center text-muted-foreground min-w-[220px] border-r border-border last:border-r-0"
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
                  <span className="text-xs text-muted-foreground block">Renglón</span>
                  <span className="text-base font-semibold">{r.numero}</span>
                </td>
                {oferentes.map((of) => {
                  const key = cellKey(r.id, of.id);
                  const ev = evals.get(key);
                  const cumple = ev?.cumple ?? null;
                  const obs = ev?.observaciones ?? "";
                  const isSaving = saving.has(key);
                  return (
                    <td key={of.id} className="px-3 py-3 align-top border-r border-border last:border-r-0">
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleToggle(r.id, of.id, true)}
                            disabled={isSaving}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-60 ${
                              cumple === true
                                ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-400"
                                : "border-border text-muted-foreground hover:bg-secondary/60"
                            }`}
                          >
                            ✓ Cumple
                          </button>
                          <button
                            onClick={() => handleToggle(r.id, of.id, false)}
                            disabled={isSaving}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-60 ${
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
                          className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring/30 placeholder:text-muted-foreground/40"
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
      <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
        <h4 className="text-xs font-semibold text-foreground">Resumen de evaluación técnica</h4>
        {renglones.map((r) => {
          const cumpleN = oferentes.filter((of) => evals.get(cellKey(r.id, of.id))?.cumple === true).length;
          const noCumpleN = oferentes.filter((of) => evals.get(cellKey(r.id, of.id))?.cumple === false).length;
          const pendN = oferentes.length - cumpleN - noCumpleN;
          return (
            <div key={r.id} className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground w-20 shrink-0">Renglón {r.numero}:</span>
              {cumpleN > 0 && (
                <span className="text-emerald-400 font-medium">
                  {cumpleN} {cumpleN === 1 ? "cumple" : "cumplen"}
                </span>
              )}
              {noCumpleN > 0 && (
                <span className="text-red-400 font-medium">
                  {noCumpleN} no {noCumpleN === 1 ? "cumple" : "cumplen"}
                </span>
              )}
              {pendN > 0 && (
                <span className="text-muted-foreground/70">
                  {pendN} sin evaluar
                </span>
              )}
              {pendN === 0 && cumpleN === 0 && noCumpleN === 0 && (
                <span className="text-muted-foreground/50">Sin evaluaciones</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlaceholderTab({ tab }: { tab: WizardTab }) {
  const messages: Record<WizardTab, string> = {
    datos:        "Datos generales — fechas, valores de dólar y umbral económico.",
    renglones:    "Renglones e ítems — matrícula, descripción, cantidad, precio SIC.",
    oferentes:    "Próxima fase: registrar la lista de oferentes participantes.",
    ofertas:      "Próxima fase: grilla de precios unitarios por ítem × oferente (USD o ARS).",
    evaluacion:   "Próxima fase: marcar Cumple/No cumple técnicamente por renglón × oferente.",
    adjudicacion: "Próxima fase: tabla resumen con cálculo de %SIC y selección manual del ganador por renglón.",
  };
  return (
    <div className="text-sm text-muted-foreground py-6 text-center">
      {messages[tab]}
    </div>
  );
}

// ─── Tab: Renglones e Ítems ──────────────────────────────────

function RenglonesTab({ licitacionId }: { licitacionId: string }) {
  const [loading, setLoading] = useState(true);
  const [renglones, setRenglones] = useState<RenglonConItems[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [showCreateRenglon, setShowCreateRenglon] = useState(false);
  const [editingRenglon, setEditingRenglon] = useState<Renglon | null>(null);

  const [creatingItemFor, setCreatingItemFor] = useState<RenglonConItems | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando renglones...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {renglones.length} renglón{renglones.length === 1 ? "" : "es"} · {renglones.reduce((n, r) => n + r.items.length, 0)} ítem{renglones.reduce((n, r) => n + r.items.length, 0) === 1 ? "" : "s"}
        </p>
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
          return (
            <div key={r.id} className="border border-border rounded-lg bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-secondary/30">
                <button onClick={() => toggleExpand(r.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <div className="flex-1 min-w-0" onClick={() => toggleExpand(r.id)} role="button">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">Renglón {r.numero}</span>
                    <span className="text-xs text-muted-foreground">· {r.items.length} ítem{r.items.length === 1 ? "" : "s"}</span>
                  </div>
                  {r.condicion_adjudicacion && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{r.condicion_adjudicacion}</p>
                  )}
                </div>
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
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border text-muted-foreground">
                            <th className="text-left py-2 px-2 w-12">#</th>
                            <th className="text-left py-2 px-2 w-32">Matrícula</th>
                            <th className="text-left py-2 px-2">Descripción</th>
                            <th className="text-right py-2 px-2 w-20">Cantidad</th>
                            <th className="text-right py-2 px-2 w-36">Precio SIC (ARS)</th>
                            <th className="w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.items.map((it) => (
                            <tr key={it.id} className="border-b border-border/40 hover:bg-secondary/30 transition-colors">
                              <td className="py-2 px-2 font-mono text-muted-foreground">{it.numero_item}</td>
                              <td className="py-2 px-2 font-mono">{it.matricula || "—"}</td>
                              <td className="py-2 px-2 text-foreground">{it.descripcion || "—"}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{it.cantidad}</td>
                              <td className="py-2 px-2 text-right tabular-nums">
                                {it.precio_sic_pesos !== null
                                  ? it.precio_sic_pesos.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                  : "—"}
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
                          ))}
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
            } catch (e) { console.error(e); toast.error("No se pudo agregar el ítem"); }
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
  const [savingToggle, setSavingToggle] = useState(false);

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

  const exclusividadHint =
    renglones.length >= 2
      ? renglones.length === 2
        ? "Aplicará entre los 2 renglones cargados."
        : `Aplicará al conjunto de los ${renglones.length} renglones.`
      : "Requiere al menos 2 renglones cargados para tener efecto.";

  const conditionsPanel = (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <h4 className="text-xs font-semibold text-foreground">Condiciones del pliego</h4>
      <label
        className={`flex items-start gap-3 cursor-pointer -m-1 p-1 rounded transition-colors hover:bg-secondary/20 ${savingToggle ? "opacity-60 pointer-events-none" : ""}`}
      >
        <input
          type="checkbox"
          checked={licitacion.exclusividad_renglones}
          onChange={handleToggleExclusividad}
          disabled={savingToggle}
          className="mt-0.5 w-4 h-4 accent-accent"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-foreground font-medium">
            Exclusividad entre renglones
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Un mismo oferente no puede ganar todos los renglones, salvo que los demás no cumplan técnicamente. {exclusividadHint}
          </div>
        </div>
        {savingToggle && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground mt-0.5 shrink-0" />}
      </label>

      <div className="text-[11px] text-muted-foreground border-t border-border pt-2 leading-relaxed">
        <span className="font-medium text-foreground">Regla automática:</span>{" "}
        Si un oferente no oferta para alguno de los ítems de un renglón, queda descalificado para ese renglón (mirá la fila <em>Cobertura</em> al pie de cada renglón).
      </div>
    </div>
  );

  if (renglones.length === 0) {
    return (
      <div className="space-y-3">
        {conditionsPanel}
        <div className="border border-dashed border-border rounded-lg py-10 text-center text-sm text-muted-foreground">
          No hay renglones cargados. Cargalos en la pestaña <strong>Renglones e Ítems</strong> primero.
        </div>
      </div>
    );
  }

  if (oferentes.length === 0) {
    return (
      <div className="space-y-3">
        {conditionsPanel}
        <div className="border border-dashed border-border rounded-lg py-10 text-center text-sm text-muted-foreground">
          No hay oferentes cargados. Cargalos en la pestaña <strong>Oferentes</strong> primero.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {conditionsPanel}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Los precios se guardan automáticamente al salir de cada celda.
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {totalOfertas} / {totalItems * oferentes.length} celdas completadas
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-secondary/50">
              <th
                className="text-left py-2.5 px-3 font-medium text-muted-foreground border-r border-border"
                style={{ minWidth: "280px" }}
              >
                Ítem
              </th>
              {oferentes.map((of) => (
                <th
                  key={of.id}
                  className="py-2.5 px-3 font-medium text-foreground border-r border-border last:border-r-0 text-center"
                  style={{ minWidth: "180px" }}
                >
                  {of.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {renglones.flatMap((r) => [
              <tr key={`reng-${r.id}`} className="bg-secondary/20 border-t border-border">
                <td colSpan={1 + oferentes.length} className="py-1.5 px-3 font-semibold">
                  <span className="text-accent">Renglón {r.numero}</span>
                  {r.condicion_adjudicacion && (
                    <span className="font-normal text-muted-foreground ml-2">{r.condicion_adjudicacion}</span>
                  )}
                </td>
              </tr>,
              ...r.items.map((item) => (
                <tr key={item.id} className="border-t border-border hover:bg-secondary/10 transition-colors">
                  <td className="py-2 px-3 border-r border-border align-top">
                    <div className="flex items-start gap-2">
                      <span className="font-mono text-muted-foreground shrink-0 text-[11px] mt-0.5">
                        {r.numero}.{item.numero_item}
                      </span>
                      <div className="min-w-0">
                        {item.matricula && (
                          <div className="font-mono text-accent text-[11px]">{item.matricula}</div>
                        )}
                        <div className="text-foreground leading-tight break-words">
                          {item.descripcion || "Sin descripción"}
                        </div>
                        <div className="text-muted-foreground text-[11px] mt-0.5">
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
                      <td key={of.id} className="py-1.5 px-2 border-r border-border last:border-r-0 align-middle">
                        <div className="flex items-center gap-1 relative">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={cell.precio}
                            onChange={(e) => setCell(item.id, of.id, { precio: e.target.value })}
                            onBlur={() => saveCell(item.id, of.id)}
                            placeholder="—"
                            className="w-full min-w-0 h-7 px-2 rounded bg-secondary border border-border text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                          <select
                            value={cell.divisa}
                            onChange={(e) => {
                              const divisa = e.target.value as Divisa;
                              setCell(item.id, of.id, { divisa });
                              const precioStr = cell.precio.trim();
                              if (precioStr) {
                                const n = Number(precioStr.replace(",", "."));
                                if (Number.isFinite(n) && n >= 0) {
                                  upsertOferta({
                                    oferente_id: of.id,
                                    item_id: item.id,
                                    precio_unitario: n,
                                    divisa,
                                  }).catch(console.error);
                                }
                              }
                            }}
                            className="h-7 px-1 rounded bg-secondary border border-border focus:outline-none cursor-pointer shrink-0 text-xs"
                          >
                            <option value="ARS">ARS</option>
                            <option value="USD">USD</option>
                          </select>
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
                      <td className="py-1.5 px-3 text-[11px] text-muted-foreground italic border-r border-border">
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
                            className="py-1.5 px-2 text-[11px] text-center border-r border-border last:border-r-0"
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
  onClose: () => void;
  onSubmit: (vals: {
    numero_item: number;
    matricula: string;
    descripcion: string;
    cantidad: number;
    precio_sic_pesos: number | null;
  }) => void | Promise<void>;
}) {
  const [numero, setNumero]           = useState(initialNumero.toString());
  const [matricula, setMatricula]     = useState(initialMatricula);
  const [descripcion, setDescripcion] = useState(initialDescripcion);
  const [cantidad, setCantidad]       = useState(initialCantidad.toString());
  const [precio, setPrecio]           = useState(initialPrecio?.toString() ?? "");
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
      await onSubmit({ numero_item: n, matricula: matricula.trim(), descripcion: descripcion.trim(), cantidad: cantNum, precio_sic_pesos: parseNum(precio) });
    } finally { setSaving(false); }
  };

  const lookupBadge = () => {
    if (lookupStatus === "loading")   return <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Buscando…</span>;
    if (lookupStatus === "found")     return <span className="text-xs text-emerald-500">✓ Encontrada en catálogo</span>;
    if (lookupStatus === "not_found") return <span className="text-xs text-amber-500">⚠ No está en el catálogo — escribí la descripción manualmente</span>;
    return null;
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{mode === "create" ? "Nuevo ítem" : "Editar ítem"}</CardTitle>
              <CardDescription>
                {renglonNumero ? `Renglón ${renglonNumero}. ` : ""}La descripción se completa automáticamente desde el catálogo de matrículas.
              </CardDescription>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">Número de ítem</span>
              <input type="number" min={1} value={numero} onChange={(e) => setNumero(e.target.value)} className="mt-1 ti-input" />
            </label>
            <div className="block">
              <span className="text-xs text-muted-foreground">Matrícula</span>
              <input
                type="text"
                value={matricula}
                onChange={(e) => setMatricula(e.target.value)}
                placeholder="Ej: 12345"
                className="mt-1 ti-input"
                autoFocus={mode === "create"}
              />
              <div className="mt-1 min-h-[1rem]">{lookupBadge()}</div>
            </div>
          </div>
          <label className="block">
            <span className="text-xs text-muted-foreground">
              Descripción
              {lookupStatus === "found" && <span className="ml-1 text-muted-foreground/60">(podés editarla)</span>}
            </span>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Se completa automáticamente al ingresar la matrícula"
              rows={2}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">Cantidad</span>
              <input type="number" step="0.01" min="0" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="mt-1 ti-input" />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Precio SIC (ARS)</span>
              <input type="number" step="0.01" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej: 1500000" className="mt-1 ti-input" />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={handle} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (mode === "create" ? "Agregar" : "Guardar")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
