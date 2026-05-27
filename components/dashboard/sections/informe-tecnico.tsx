"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Gavel, Loader2, ChevronDown, FileText, Layers, Users, Tag, ClipboardCheck, Trophy, Save } from "lucide-react";
import {
  listLicitaciones,
  createLicitacion,
  updateLicitacion,
  type Licitacion,
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

// ─── Modal: crear licitación ────────────────────────────────────────────

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

// ─── Tab: Datos generales ────────────────────────────────────────────

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
          <FormField label="Fecha de apertura">
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

function PlaceholderTab({ tab }: { tab: WizardTab }) {
  const messages: Record<WizardTab, string> = {
    datos:        "Próxima fase: cargar fechas y valores de dólar (FD_SIC / FD_OP) y umbral económico.",
    renglones:    "Próxima fase: agregar renglones e ítems (matrícula, descripción, cantidad, precio SIC).",
    oferentes:    "Próxima fase: registrar la lista de oferentes participantes.",
    ofertas:      "Próxima fase: grilla de precios unitarios por ítem × oferente (USD o ARS).",
    evaluacion:   "Próxima fase: marcar Cumple/No cumple técnicamente por renglón × oferente.",
    adjudicacion: "Próxima fase: tabla resumen con cálculo de %SIC y selección manual del ganádor por renglón.",
  };
  return (
    <div className="text-sm text-muted-foreground py-6 text-center">
      {messages[tab]}
    </div>
  );
}
