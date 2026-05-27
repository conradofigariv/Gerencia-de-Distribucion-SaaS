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
  type Licitacion,
  type Renglon,
  type Item,
  type RenglonConItems,
  type Oferente,
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Gavel className="w-6 h-6 text-accent" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Informe Técnico</h2>
            <p className="text-xs text-muted-foreground">Análisis de ofertas y adjudicación por renglón.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {licitaciones.length > 0 && (
            <LicitacionSelector licitaciones={licitaciones} selectedId={selectedId} onSelect={setSelectedId} />
          )}
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Nueva licitación
          </Button>
        </div>
      </div>

      {licitaciones.length === 0 && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <Gavel className="w-10 h-10 text-muted-foreground" />
            <CardTitle>No hay licitaciones cargadas</CardTitle>
            <CardDescription>Creá una nueva licitación para empezar a cargar renglones, oferentes y ofertas.</CardDescription>
            <Button onClick={() => setShowCreate(true)} className="mt-2">
              <Plus className="w-4 h-4 mr-1" /> Crear primera licitación
            </Button>
          </CardContent>
        </Card>
      )}

      {selected && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as WizardTab)} className="w-full">
          <TabsList className="w-full justify-start overflow-x-auto h-auto flex-wrap">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.id} value={t.id} className="gap-2">
                  <Icon className="w-4 h-4" /> {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {TABS.map((t) => (
            <TabsContent key={t.id} value={t.id} className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <t.icon className="w-5 h-5 text-accent" /> {t.label}
                  </CardTitle>
                  <CardDescription>
                    Licitación SIC <span className="font-mono">{selected.numero_sic}</span> — {selected.titulo}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {t.id === "datos" ? (
                    <DatosGeneralesTab
                      licitacion={selected}
                      onUpdated={(updated) => setLicitaciones((prev) => prev.map((l) => l.id === updated.id ? updated : l))}
                    />
                  ) : t.id === "renglones" ? (
                    <RenglonesTab licitacionId={selected.id} />
                  ) : t.id === "oferentes" ? (
                    <OferentesTab licitacionId={selected.id} />
                  ) : (
                    <PlaceholderTab tab={t.id} />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}

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

function LicitacionSelector({ licitaciones, selectedId, onSelect }: {
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
            <><span className="font-mono text-xs text-accent mr-2">SIC {selected.numero_sic}</span>{selected.titulo}</>
          ) : "Seleccionar licitación"}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-[calc(100%+4px)] right-0 min-w-[320px] bg-card border border-border rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          {licitaciones.map((l) => (
            <button key={l.id} onClick={() => { onSelect(l.id); setOpen(false); }}
              className={`w-full px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-left ${l.id === selectedId ? "bg-secondary/40" : ""}`}>
              <div className="font-mono text-xs text-accent">SIC {l.numero_sic}</div>
              <div className="text-foreground">{l.titulo}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modal: crear licitación ─────────────────────────────────────────────────

function CreateLicitacionModal({ loading, onClose, onSubmit }: {
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
          <CardDescription>Solo necesitás un número de SIC y un título. El resto de los datos los cargás en las pestañas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Número SIC</span>
            <input type="text" value={numeroSic} onChange={(e) => setNumeroSic(e.target.value)} placeholder="Ej: 21441"
              className="mt-1 w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Título / objeto</span>
            <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: Adquisición de RTU para teleoperación"
              className="mt-1 w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={loading}>Cancelar</Button>
            <Button onClick={() => onSubmit(numeroSic.trim(), titulo.trim())} disabled={loading || !numeroSic.trim() || !titulo.trim()}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Crear"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab: Datos generales ────────────────────────────────────────────

function DatosGeneralesTab({ licitacion, onUpdated }: {
  licitacion: Licitacion;
  onUpdated: (l: Licitacion) => void;
}) {
  const [numeroSic,     setNumeroSic]     = useState(licitacion.numero_sic);
  const [titulo,        setTitulo]        = useState(licitacion.titulo);
  const [fechaApertura, setFechaApertura] = useState(licitacion.fecha_apertura ?? "");
  const [fdSicFecha,    setFdSicFecha]    = useState(licitacion.fd_sic_fecha ?? "");
  const [fdSicValor,    setFdSicValor]    = useState<string>(licitacion.fd_sic_valor?.toString() ?? "");
  const [fdOpFecha,     setFdOpFecha]     = useState(licitacion.fd_op_fecha ?? "");
  const [fdOpValor,     setFdOpValor]     = useState<string>(licitacion.fd_op_valor?.toString() ?? "");
  const [umbral,        setUmbral]        = useState<string>(licitacion.umbral_economico_pct?.toString() ?? "50");
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    setNumeroSic(licitacion.numero_sic);
    setTitulo(licitacion.titulo);
    setFechaApertura(licitacion.fecha_apertura ?? "");
    setFdSicFecha(licitacion.fd_sic_fecha ?? "");
    setFdSicValor(licitacion.fd_sic_valor?.toString() ?? "");
    setFdOpFecha(licitacion.fd_op_fecha ?? "");
    setFdOpValor(licitacion.fd_op_valor?.toString() ?? "");
    setUmbral(licitacion.umbral_economico_pct?.toString() ?? "50");
  }, [licitacion.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!numeroSic.trim() || !titulo.trim()) { toast.error("Número SIC y título son obligatorios"); return; }
    const umbralNum = parseNum(umbral);
    if (umbralNum === null || umbralNum < 0) { toast.error("Umbral económico inválido"); return; }
    setSaving(true);
    try {
      const updated = await updateLicitacion(licitacion.id, {
        numero_sic: numeroSic.trim(), titulo: titulo.trim(),
        fecha_apertura: fechaApertura || null,
        fd_sic_fecha: fdSicFecha || null, fd_sic_valor: parseNum(fdSicValor),
        fd_op_fecha: fdOpFecha || null,   fd_op_valor: parseNum(fdOpValor),
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

      <FormSection title="Configuración" description="Umbral máximo de sobreprecio aceptable respecto al precio SIC en USD. Default: 50%.">
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
          height: 2.25rem; padding: 0 0.75rem; border-radius: 0.5rem;
          background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border));
          font-size: 0.875rem; color: hsl(var(--foreground)); width: 100%;
        }
        .ti-input:focus { outline: none; box-shadow: 0 0 0 2px hsl(var(--ring) / 0.2); }
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
    datos:        "Datos generales — fechas, valores de dólar y umbral económico.",
    renglones:    "Renglones e ítems — matrícula, descripción, cantidad, precio SIC.",
    oferentes:    "Oferentes — participantes del Acta de Apertura.",
    ofertas:      "Próxima fase: grilla de precios unitarios por ítem × oferente (USD o ARS).",
    evaluacion:   "Próxima fase: marcar Cumple/No cumple técnicamente por renglón × oferente.",
    adjudicacion: "Próxima fase: tabla resumen con cálculo de %SIC y selección manual del ganador por renglón.",
  };
  return <div className="text-sm text-muted-foreground py-6 text-center">{messages[tab]}</div>;
}

// ─── Tab: Renglones e Ítems ──────────────────────────────────────────

function RenglonesTab({ licitacionId }: { licitacionId: string }) {
  const [loading, setLoading] = useState(true);
  const [renglones, setRenglones] = useState<RenglonConItems[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreateRenglon, setShowCreateRenglon] = useState(false);
  const [editingRenglon, setEditingRenglon] = useState<Renglon | null>(null);
  const [creatingItemFor, setCreatingItemFor] = useState<RenglonConItems | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  useEffect(() => {
    setLoading(true);
    listRenglonesConItems(licitacionId)
      .then((rows) => {
        setRenglones(rows);
        if (rows.length <= 3) setExpanded(new Set(rows.map((r) => r.id)));
      })
      .catch((e) => { console.error(e); toast.error("No se pudieron cargar los renglones"); })
      .finally(() => setLoading(false));
  }, [licitacionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const nextRenglonNumero = () => renglones.reduce((m, r) => Math.max(m, r.numero), 0) + 1;
  const nextItemNumero = (r: RenglonConItems) => r.items.reduce((m, i) => Math.max(m, i.numero_item), 0) + 1;

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando renglones...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {renglones.length} renglón{renglones.length === 1 ? "" : "es"} · {renglones.reduce((n, r) => n + r.items.length, 0)} ítem{renglones.reduce((n, r) => n + r.items.length, 0) === 1 ? "" : "s"}
        </p>
        <Button size="sm" onClick={() => setShowCreateRenglon(true)}><Plus className="w-4 h-4 mr-1" /> Agregar renglón</Button>
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
                  {r.condicion_adjudicacion && <p className="text-xs text-muted-foreground truncate mt-0.5">{r.condicion_adjudicacion}</p>}
                </div>
                <button onClick={() => setEditingRenglon(r)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Editar renglón">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`¿Eliminar el renglón ${r.numero} y todos sus ítems?`)) return;
                    try { await deleteRenglon(r.id); toast.success("Renglón eliminado"); setRenglones((prev) => prev.filter((x) => x.id !== r.id)); }
                    catch (e) { console.error(e); toast.error("No se pudo eliminar el renglón"); }
                  }}
                  className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Eliminar renglón"
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
                                {it.precio_sic_pesos !== null ? it.precio_sic_pesos.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                              </td>
                              <td className="py-2 px-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => setEditingItem(it)} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Editar ítem"><Pencil className="w-3 h-3" /></button>
                                  <button
                                    onClick={async () => {
                                      if (!confirm(`¿Eliminar el ítem ${it.numero_item}?`)) return;
                                      try { await deleteItem(it.id); toast.success("Ítem eliminado"); setRenglones((prev) => prev.map((x) => x.id === r.id ? { ...x, items: x.items.filter((i) => i.id !== it.id) } : x)); }
                                      catch (e) { console.error(e); toast.error("No se pudo eliminar el ítem"); }
                                    }}
                                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Eliminar ítem"
                                  ><Trash2 className="w-3 h-3" /></button>
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
        <RenglonModal mode="create" initialNumero={nextRenglonNumero()} onClose={() => setShowCreateRenglon(false)}
          onSubmit={async ({ numero, condicion }) => {
            try {
              const created = await createRenglon({ licitacion_id: licitacionId, numero, condicion_adjudicacion: condicion || null });
              setRenglones((prev) => [...prev, { ...created, items: [] }].sort((a, b) => a.numero - b.numero));
              setExpanded((prev) => new Set(prev).add(created.id));
              setShowCreateRenglon(false); toast.success("Renglón creado");
            } catch (e) { console.error(e); toast.error("No se pudo crear el renglón"); }
          }}
        />
      )}
      {editingRenglon && (
        <RenglonModal mode="edit" initialNumero={editingRenglon.numero} initialCondicion={editingRenglon.condicion_adjudicacion ?? ""}
          onClose={() => setEditingRenglon(null)}
          onSubmit={async ({ numero, condicion }) => {
            try {
              const updated = await updateRenglon(editingRenglon.id, { numero, condicion_adjudicacion: condicion || null });
              setRenglones((prev) => prev.map((r) => r.id === editingRenglon.id ? { ...r, ...updated } : r).sort((a, b) => a.numero - b.numero));
              setEditingRenglon(null); toast.success("Renglón actualizado");
            } catch (e) { console.error(e); toast.error("No se pudo actualizar el renglón"); }
          }}
        />
      )}
      {creatingItemFor && (
        <ItemModal mode="create" initialNumero={nextItemNumero(creatingItemFor)} renglonNumero={creatingItemFor.numero}
          onClose={() => setCreatingItemFor(null)}
          onSubmit={async (vals) => {
            try {
              const created = await createItem({ renglon_id: creatingItemFor.id, ...vals });
              setRenglones((prev) => prev.map((r) => r.id === creatingItemFor.id ? { ...r, items: [...r.items, created].sort((a, b) => a.numero_item - b.numero_item) } : r));
              setCreatingItemFor(null); toast.success("Ítem agregado");
            } catch (e) { console.error(e); toast.error("No se pudo agregar el ítem"); }
          }}
        />
      )}
      {editingItem && (
        <ItemModal mode="edit" initialNumero={editingItem.numero_item} initialMatricula={editingItem.matricula ?? ""}
          initialDescripcion={editingItem.descripcion ?? ""} initialCantidad={editingItem.cantidad} initialPrecio={editingItem.precio_sic_pesos}
          onClose={() => setEditingItem(null)}
          onSubmit={async (vals) => {
            try {
              const updated = await updateItem(editingItem.id, vals);
              setRenglones((prev) => prev.map((r) => r.id === editingItem.renglon_id ? { ...r, items: r.items.map((i) => i.id === editingItem.id ? updated : i).sort((a, b) => a.numero_item - b.numero_item) } : r));
              setEditingItem(null); toast.success("Ítem actualizado");
            } catch (e) { console.error(e); toast.error("No se pudo actualizar el ítem"); }
          }}
        />
      )}
    </div>
  );
}

// ─── Tab: Oferentes ───────────────────────────────────────────────────

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
      toast.error("Ya existe un oferente con ese nombre"); return;
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

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando oferentes...</div>;

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
          No hay oferentes cargados. Agregá los participantes del Acta de Apertura.
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
          {oferentes.map((o, i) => (
            <div key={o.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/30 transition-colors">
              <span className="text-xs text-muted-foreground w-5 text-right tabular-nums">{i + 1}.</span>
              <span className="flex-1 text-sm text-foreground">{o.nombre}</span>
              <button onClick={() => handleDelete(o)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Eliminar oferente">
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

// ─── Modal: Renglón (crear/editar) ─────────────────────────────────────

function RenglonModal({ mode, initialNumero, initialCondicion = "", onClose, onSubmit }: {
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
            <input type="number" min={1} value={numero} onChange={(e) => setNumero(e.target.value)}
              className="mt-1 w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Condición de adjudicación (opcional)</span>
            <textarea value={condicion} onChange={(e) => setCondicion(e.target.value)}
              placeholder="Ej: Adjudicación por renglón completo a un único oferente." rows={3}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none" />
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

// ─── Modal: Ítem (crear/editar) ────────────────────────────────────────

type LookupStatus = "idle" | "loading" | "found" | "not_found";

function ItemModal({
  mode, renglonNumero, initialNumero, initialMatricula = "", initialDescripcion = "",
  initialCantidad = 1, initialPrecio = null, onClose, onSubmit,
}: {
  mode: "create" | "edit";
  renglonNumero?: number;
  initialNumero: number;
  initialMatricula?: string;
  initialDescripcion?: string;
  initialCantidad?: number;
  initialPrecio?: number | null;
  onClose: () => void;
  onSubmit: (vals: { numero_item: number; matricula: string; descripcion: string; cantidad: number; precio_sic_pesos: number | null }) => void | Promise<void>;
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
      if (result) { setDescripcion(result.descripcion); setLookupStatus("found"); }
      else { setLookupStatus("not_found"); }
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
              <input type="text" value={matricula} onChange={(e) => setMatricula(e.target.value)} placeholder="Ej: 12345" className="mt-1 ti-input" autoFocus={mode === "create"} />
              <div className="mt-1 min-h-[1rem]">{lookupBadge()}</div>
            </div>
          </div>
          <label className="block">
            <span className="text-xs text-muted-foreground">
              Descripción{lookupStatus === "found" && <span className="ml-1 text-muted-foreground/60">(podés editarla)</span>}
            </span>
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Se completa automáticamente al ingresar la matrícula" rows={2}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none" />
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
