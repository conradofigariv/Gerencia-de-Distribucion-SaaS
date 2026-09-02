"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import {
  Plus, X, Check, AlertTriangle, Trash2, Loader2, ShoppingCart, CalendarPlus,
} from "lucide-react";
import {
  listPlanes, createPlan, updatePlan, deletePlan, listItems, updateItem, deleteItem,
  calcularItem, totalPlan, incidencia,
  parseBloque, prepararBloque, aplicarBloque, CAMPOS_CARGABLES,
  type PlanCompra, type PlanCompraItem, type PlanCompraItemInput,
  type CampoCargable, type PreviewBloque,
} from "@/lib/planCompras";
import {
  DataTablePanel, DataTableScroll, DataTableRoot,
  DataTableHead, DataTableCell, DataTableRow,
} from "@/components/ui/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const INPUT =
  "w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground " +
  "placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/20";

const fmtNum = (v: number, dec = 0) =>
  v.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const fmtPct = (v: number) =>
  `${(v * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;

// ─── Columnas ───────────────────────────────────────────────────────────────
//
// `campo` marca las editables (mapea a una columna de `plan_compra_items`);
// las que no lo tienen son calculadas o vienen del catálogo, y van en gris.

type CampoTexto  = "familia" | "subfamilia" | "a_cargo_de";
type CampoNumero = "gd" | "cant_aprobada" | "pu_sic" | "pu_op" | "pu_est_usd";

const COLS: {
  key:    string;
  label:  string;
  width:  number;
  campo?: CampoTexto | CampoNumero;
  tipo:   "texto" | "numero" | "calc";
  dec?:   number;
}[] = [
  { key: "articulo",      label: "Matrícula",     width: 118, tipo: "texto" },
  { key: "descripcion",   label: "Descripción",   width: 300, tipo: "texto" },
  { key: "unidad",        label: "Unidad",        width: 78,  tipo: "texto" },
  { key: "mat_serv",      label: "Mat/Serv",      width: 92,  tipo: "texto" },
  { key: "familia",       label: "Familia",       width: 180, tipo: "texto",  campo: "familia" },
  { key: "subfamilia",    label: "Subfamilia",    width: 150, tipo: "texto",  campo: "subfamilia" },
  { key: "a_cargo_de",    label: "A cargo de",    width: 110, tipo: "texto",  campo: "a_cargo_de" },
  { key: "gd",            label: "GD",            width: 88,  tipo: "numero", campo: "gd" },
  { key: "recorte",       label: "Recorte",       width: 88,  tipo: "calc" },
  { key: "cant_aprobada", label: "Cant. aprob.",  width: 96,  tipo: "numero", campo: "cant_aprobada" },
  { key: "pu_sic",        label: "Pu Sic",        width: 96,  tipo: "numero", campo: "pu_sic" },
  { key: "pu_op",         label: "Pu OP",         width: 96,  tipo: "numero", campo: "pu_op" },
  { key: "pu_sic_20",     label: "Pu Sic +20%",   width: 100, tipo: "calc" },
  { key: "pu_est_usd",    label: "Pu Est (USD)",  width: 104, tipo: "numero", campo: "pu_est_usd", dec: 2 },
  { key: "pu_est_ars",    label: "Pu Est ($)",    width: 104, tipo: "calc" },
  { key: "verif_precio",  label: "Verif. precio", width: 100, tipo: "calc" },
  { key: "total",         label: "Total $",       width: 128, tipo: "calc" },
  { key: "incidencia",    label: "% Incid.",      width: 84,  tipo: "calc" },
];

const ANCHO_TOTAL = COLS.reduce((a, c) => a + c.width, 0) + 40; // +40 = columna de borrar

export function PlanDeComprasCargaSection() {
  const [planes,   setPlanes]   = useState<PlanCompra[]>([]);
  const [planId,   setPlanId]   = useState<string | null>(null);
  const [items,    setItems]    = useState<PlanCompraItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [userId,   setUserId]   = useState<string | null>(null);
  const [modalPlan,   setModalPlan]   = useState(false);
  const [modalPegar,  setModalPegar]  = useState(false);
  const [modalBorrar, setModalBorrar] = useState(false);

  const plan = useMemo(() => planes.find(p => p.id === planId) ?? null, [planes, planId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Planes disponibles. Al entrar se abre el más nuevo.
  const recargarPlanes = useCallback(async (preferido?: string) => {
    try {
      const ps = await listPlanes();
      setPlanes(ps);
      setPlanId(prev => preferido ?? prev ?? ps[0]?.id ?? null);
    } catch (e) {
      toast.error(`No se pudieron cargar los planes: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { recargarPlanes().finally(() => setCargando(false)); }, [recargarPlanes]);

  const recargarItems = useCallback(async (id: string) => {
    setCargando(true);
    try {
      setItems(await listItems(id));
    } catch (e) {
      toast.error(`No se pudieron cargar las matrículas: ${(e as Error).message}`);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!planId) { setItems([]); return; }
    recargarItems(planId);
  }, [planId, recargarItems]);

  const tc = plan?.tipo_cambio ?? 0;
  const total = useMemo(() => totalPlan(items, tc), [items, tc]);

  // Para el pegado de columnas: qué matrículas tiene el plan hoy.
  const articulosDelPlan = useMemo(() => new Set(items.map(i => i.articulo)), [items]);

  // Edición: se pinta al instante y se persiste esa fila. Si el guardado
  // falla se revierte, así la pantalla nunca muestra algo que no se guardó.
  const editarCampo = useCallback(
    async (item: PlanCompraItem, campo: keyof PlanCompraItemInput, valor: string | number) => {
      const previo = item[campo];
      if (previo === valor) return;
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, [campo]: valor } : i)));
      try {
        await updateItem(item.id, { [campo]: valor } as Partial<PlanCompraItemInput>);
      } catch (e) {
        setItems(prev => prev.map(i => (i.id === item.id ? { ...i, [campo]: previo } : i)));
        toast.error(`No se pudo guardar: ${(e as Error).message}`);
      }
    },
    [],
  );

  const borrarItem = useCallback(async (item: PlanCompraItem) => {
    const previo = items;
    setItems(prev => prev.filter(i => i.id !== item.id));
    try {
      await deleteItem(item.id);
    } catch (e) {
      setItems(previo);
      toast.error(`No se pudo borrar: ${(e as Error).message}`);
    }
  }, [items]);

  // Borrar el plan se lleva sus ítems por delante (ON DELETE CASCADE), por eso
  // pasa siempre por la confirmación de `ModalBorrarPlan`.
  const borrarPlan = async () => {
    if (!plan) return;
    try {
      await deletePlan(plan.id);
      toast.success(`Plan «${plan.nombre}» eliminado.`);
      setModalBorrar(false);
      setPlanId(null);
      const ps = await listPlanes();
      setPlanes(ps);
      setPlanId(ps[0]?.id ?? null);
    } catch (e) {
      toast.error(`No se pudo eliminar: ${(e as Error).message}`);
    }
  };

  const guardarTC = async (valor: number) => {
    if (!plan || plan.tipo_cambio === valor) return;
    setPlanes(prev => prev.map(p => (p.id === plan.id ? { ...p, tipo_cambio: valor } : p)));
    try {
      await updatePlan(plan.id, { tipo_cambio: valor });
    } catch (e) {
      toast.error(`No se pudo guardar el tipo de cambio: ${(e as Error).message}`);
      recargarPlanes();
    }
  };

  return (
    <div className="space-y-4">
      {/* Barra: plan activo, tipo de cambio, acciones */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-hairline bg-panel p-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Plan</label>
          {planes.length === 0 ? (
            <p className="text-sm text-muted-foreground h-9 flex items-center">Todavía no hay planes.</p>
          ) : (
            <Select value={planId ?? undefined} onValueChange={setPlanId}>
              <SelectTrigger className="w-[240px] h-9"><SelectValue placeholder="Elegí un plan" /></SelectTrigger>
              <SelectContent>
                {planes.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {plan && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Tipo de cambio <span className="text-muted-foreground/60">(USD → $)</span>
            </label>
            <input
              type="number"
              defaultValue={plan.tipo_cambio || ""}
              key={`tc-${plan.id}-${plan.tipo_cambio}`}
              onBlur={e => guardarTC(Number(e.target.value) || 0)}
              className={cn(INPUT, "w-[130px] font-mono")}
              placeholder="0"
            />
          </div>
        )}

        <div className="flex-1" />

        {plan && (
          <button
            onClick={() => setModalBorrar(true)}
            title="Eliminar este plan y todas sus matrículas"
            className="h-9 px-3 inline-flex items-center gap-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-accent-red hover:border-accent-red/40 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Eliminar plan
          </button>
        )}
        <button
          onClick={() => setModalPlan(true)}
          className="h-9 px-3 inline-flex items-center gap-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-secondary transition-colors"
        >
          <CalendarPlus className="w-4 h-4" /> Nuevo plan
        </button>
        <button
          onClick={() => plan ? setModalPegar(true) : toast.error("Creá un plan primero.")}
          disabled={!plan}
          className="h-9 px-3 inline-flex items-center gap-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          <Plus className="w-4 h-4" /> Agregar matrículas
        </button>
      </div>

      {/* Totales del plan */}
      {plan && (
        <div className="flex flex-wrap gap-4 rounded-xl border border-hairline bg-panel px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Matrículas: <span className="font-mono text-foreground">{fmtNum(items.length)}</span>
          </span>
          <span className="text-muted-foreground">
            Cant. aprobadas:{" "}
            <span className="font-mono text-foreground">
              {fmtNum(items.reduce((a, i) => a + Number(i.cant_aprobada || 0), 0))}
            </span>
          </span>
          <span className="text-muted-foreground">
            Total del plan: <span className="font-mono text-accent-green">$ {fmtNum(total)}</span>
          </span>
        </div>
      )}

      {/* Tabla */}
      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      ) : !plan ? (
        <Vacio
          titulo="No hay ningún plan todavía"
          detalle="Creá el plan del año para empezar a cargar matrículas."
        />
      ) : items.length === 0 ? (
        <Vacio
          titulo="El plan está vacío"
          detalle="Usá «Agregar matrículas» y pegá la lista que querés analizar."
        />
      ) : (
        <DataTablePanel className="h-[calc(100vh-320px)]">
          <DataTableScroll>
            <DataTableRoot width={ANCHO_TOTAL}>
              <thead>
                <tr>
                  {COLS.map(c => (
                    <DataTableHead
                      key={c.key}
                      align={c.tipo === "texto" ? "left" : "right"}
                      style={{ width: c.width }}
                    >
                      {c.label}
                    </DataTableHead>
                  ))}
                  <DataTableHead style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <Fila
                    key={item.id}
                    item={item}
                    tipoCambio={tc}
                    totalPlanArs={total}
                    ultima={idx === items.length - 1}
                    onEditar={editarCampo}
                    onBorrar={borrarItem}
                  />
                ))}
              </tbody>
            </DataTableRoot>
          </DataTableScroll>
        </DataTablePanel>
      )}

      {modalPlan && (
        <ModalNuevoPlan
          aniosUsados={planes.map(p => p.anio)}
          userId={userId}
          onClose={() => setModalPlan(false)}
          onCreado={id => { setModalPlan(false); recargarPlanes(id); }}
        />
      )}
      {modalBorrar && plan && (
        <ModalBorrarPlan
          plan={plan}
          cantidadItems={items.length}
          onClose={() => setModalBorrar(false)}
          onConfirmar={borrarPlan}
        />
      )}
      {modalPegar && plan && (
        <ModalCargar
          planId={plan.id}
          articulosDelPlan={articulosDelPlan}
          onClose={() => setModalPegar(false)}
          onListo={() => { setModalPegar(false); recargarItems(plan.id); }}
        />
      )}
    </div>
  );
}

// ─── Fila ───────────────────────────────────────────────────────────────────

function Fila({
  item, tipoCambio, totalPlanArs, ultima, onEditar, onBorrar,
}: {
  item: PlanCompraItem;
  tipoCambio: number;
  totalPlanArs: number;
  ultima: boolean;
  onEditar: (item: PlanCompraItem, campo: keyof PlanCompraItemInput, valor: string | number) => void;
  onBorrar: (item: PlanCompraItem) => void;
}) {
  const c = calcularItem(item, tipoCambio);

  // Los calculados, en el mismo orden que COLS.
  const calculados: Record<string, { texto: string; clase?: string }> = {
    recorte:      { texto: fmtNum(c.recorte), clase: c.recorte < 0 ? "text-accent-red" : undefined },
    pu_sic_20:    { texto: fmtNum(c.puSicMas20) },
    pu_est_ars:   { texto: fmtNum(c.puEstArs) },
    verif_precio: {
      texto: fmtPct(c.verifPrecio),
      clase: c.verifPrecio > 0 ? "text-accent-amber" : c.verifPrecio < 0 ? "text-accent-green" : undefined,
    },
    total:        { texto: fmtNum(c.totalArs) },
    incidencia:   { texto: fmtPct(incidencia(c.totalArs, totalPlanArs)) },
  };

  return (
    <DataTableRow>
      {COLS.map(col => {
        // Editable
        if (col.campo) {
          return (
            <DataTableCell key={col.key} last={ultima} className="p-0" style={{ width: col.width }}>
              <CeldaEditable
                valor={item[col.campo]}
                numero={col.tipo === "numero"}
                decimales={col.dec ?? 0}
                onGuardar={v => onEditar(item, col.campo!, v)}
              />
            </DataTableCell>
          );
        }
        // Calculada
        const calc = calculados[col.key];
        if (calc) {
          return (
            <DataTableCell key={col.key} num last={ultima} style={{ width: col.width }} className={calc.clase}>
              {calc.texto}
            </DataTableCell>
          );
        }
        // Del catálogo (solo lectura)
        const valor = String(item[col.key as keyof PlanCompraItem] ?? "");
        return (
          <DataTableCell
            key={col.key}
            mono={col.key === "articulo"}
            last={ultima}
            style={{ width: col.width }}
            title={valor}
            className="text-muted-foreground"
          >
            {valor}
          </DataTableCell>
        );
      })}
      <DataTableCell last={ultima} style={{ width: 40 }} className="text-center">
        <button
          onClick={() => onBorrar(item)}
          title="Sacar del plan"
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-accent-red transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </DataTableCell>
    </DataTableRow>
  );
}

/**
 * Celda que se edita en el lugar. Guarda al salir (blur) o con Enter, y
 * cancela con Escape. Mantiene su propio texto mientras se tipea para no
 * pelearse con el re-render de la tabla en cada tecla.
 */
function CeldaEditable({
  valor, numero, decimales, onGuardar,
}: {
  valor: string | number;
  numero: boolean;
  decimales: number;
  onGuardar: (v: string | number) => void;
}) {
  const inicial = numero
    ? (Number(valor) ? fmtNum(Number(valor), decimales) : "")
    : String(valor ?? "");
  const [texto, setTexto] = useState(inicial);
  const [editando, setEditando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  // Si el valor cambia desde afuera (recarga, revert de un error), se refleja.
  useEffect(() => { if (!editando) setTexto(inicial); }, [inicial, editando]);

  const confirmar = () => {
    setEditando(false);
    if (numero) {
      // Formato local: se sacan los separadores de miles y la coma es decimal.
      const limpio = texto.replace(/\./g, "").replace(",", ".").trim();
      const n = limpio === "" ? 0 : Number(limpio);
      if (!Number.isFinite(n)) { setTexto(inicial); return; }
      onGuardar(n);
    } else {
      onGuardar(texto.trim());
    }
  };

  return (
    <input
      ref={ref}
      value={texto}
      onChange={e => setTexto(e.target.value)}
      onFocus={() => { setEditando(true); if (numero) setTexto(Number(valor) ? String(valor) : ""); }}
      onBlur={confirmar}
      onKeyDown={e => {
        if (e.key === "Enter")  { e.currentTarget.blur(); }
        if (e.key === "Escape") { setTexto(inicial); setEditando(false); e.currentTarget.blur(); }
      }}
      className={cn(
        "w-full h-full px-3 py-[7px] bg-transparent text-[12px] text-foreground",
        "border border-transparent rounded-none outline-none",
        "focus:border-accent/60 focus:bg-panel-input",
        numero && "text-right tabular-nums font-mono",
      )}
    />
  );
}

function Vacio({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-hairline bg-panel py-24 text-center">
      <ShoppingCart className="w-9 h-9 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{titulo}</p>
      <p className="text-xs text-muted-foreground">{detalle}</p>
    </div>
  );
}

// ─── Modal: nuevo plan ──────────────────────────────────────────────────────

function ModalNuevoPlan({
  aniosUsados, userId, onClose, onCreado,
}: {
  aniosUsados: number[];
  userId: string | null;
  onClose: () => void;
  onCreado: (id: string) => void;
}) {
  const proximo = new Date().getFullYear() + 1;
  const [anio, setAnio]     = useState(String(proximo));
  const [nombre, setNombre] = useState(`Plan de Compras ${proximo}`);
  const [tc, setTc]         = useState("");
  const [guardando, setGuardando] = useState(false);

  const anioNum = Number(anio);
  const repetido = aniosUsados.includes(anioNum);

  const guardar = async () => {
    if (!Number.isInteger(anioNum) || anioNum < 2000 || anioNum > 2100) {
      toast.error("Poné un año válido."); return;
    }
    if (repetido) { toast.error(`Ya existe el plan de ${anioNum}.`); return; }
    setGuardando(true);
    try {
      const p = await createPlan(anioNum, nombre, Number(tc) || 0, userId);
      toast.success(`Plan «${p.nombre}» creado.`);
      onCreado(p.id);
    } catch (e) {
      toast.error(`No se pudo crear: ${(e as Error).message}`);
      setGuardando(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <CalendarPlus className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">Nuevo plan de compras</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Año *</label>
              <input
                autoFocus type="number" value={anio}
                onChange={e => {
                  setAnio(e.target.value);
                  setNombre(`Plan de Compras ${e.target.value}`);
                }}
                className={cn(INPUT, "font-mono")}
              />
              {repetido && (
                <p className="text-[11px] text-accent-red">Ya existe un plan para ese año.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tipo de cambio</label>
              <input
                type="number" value={tc} onChange={e => setTc(e.target.value)}
                placeholder="Ej. 1255"
                className={cn(INPUT, "font-mono")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nombre</label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} className={INPUT} />
          </div>

          <p className="text-[11px] text-muted-foreground">
            El tipo de cambio convierte «Pu Est (USD)» a pesos en todo el plan. Se puede cambiar después.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={guardar} disabled={guardando || repetido}
            className="h-9 px-4 inline-flex items-center gap-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {guardando && <Loader2 className="w-4 h-4 animate-spin" />} Crear plan
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Modal: borrar plan ─────────────────────────────────────────────────────
//
// Pide escribir el año para confirmar. Es deliberado: el borrado se lleva
// todas las matrículas cargadas del plan y no hay papelera para recuperarlas.

function ModalBorrarPlan({
  plan, cantidadItems, onClose, onConfirmar,
}: {
  plan: PlanCompra;
  cantidadItems: number;
  onClose: () => void;
  onConfirmar: () => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [borrando, setBorrando] = useState(false);
  const confirmado = texto.trim() === String(plan.anio);

  const borrar = async () => {
    if (!confirmado) return;
    setBorrando(true);
    await onConfirmar();
    setBorrando(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-accent-red" />
            <span className="text-sm font-semibold text-foreground">Eliminar plan de compras</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-foreground">
            Se va a eliminar <span className="font-semibold">«{plan.nombre}»</span>
            {cantidadItems > 0 && (
              <> junto con sus <span className="font-semibold">{fmtNum(cantidadItems)} matrícula{cantidadItems === 1 ? "" : "s"}</span></>
            )}. Esta acción no se puede deshacer.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Escribí <span className="font-mono text-foreground">{plan.anio}</span> para confirmar
            </label>
            <input
              autoFocus value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && confirmado) borrar(); }}
              className={cn(INPUT, "font-mono")}
              placeholder={String(plan.anio)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={borrar} disabled={!confirmado || borrando}
            className="h-9 px-4 inline-flex items-center gap-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {borrando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Eliminar plan
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Modal: cargar datos al plan ────────────────────────────────────────────
//
// UNA sola pegada hace todo: suma las matrículas que falten y carga las
// columnas que traiga el bloque. Antes esto estaban separado en dos pasos y
// era trabajo repetido — la lista de matrículas ya viene adentro del bloque
// del Excel, no tiene sentido pedirla aparte.
//
// Acepta las dos formas de pegar, sin elegir modo:
//   • El bloque del Excel con su fila de encabezados (se reconocen las
//     columnas por el título, y se pueden corregir a mano).
//   • Una lista pelada de matrículas, una por línea (solo las suma).

function ModalCargar({
  planId, articulosDelPlan, onClose, onListo,
}: {
  planId: string;
  articulosDelPlan: Set<string>;
  onClose: () => void;
  onListo: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  /** Correcciones manuales del mapeo automático: columna → campo o "ignorar". */
  const [ajustes, setAjustes] = useState<Record<number, CampoCargable | "">>({});

  const bloque = useMemo(() => parseBloque(texto), [texto]);

  // Al cambiar el pegado, las correcciones viejas dejan de tener sentido.
  useEffect(() => { setAjustes({}); }, [texto]);

  // Mapeo efectivo = el automático, pisado por lo que el usuario haya tocado.
  const mapeo = useMemo(() => {
    const m: Record<number, CampoCargable> = { ...bloque.mapeo };
    for (const [idx, campo] of Object.entries(ajustes)) {
      const i = Number(idx);
      if (campo === "") delete m[i];
      else m[i] = campo;
    }
    return m;
  }, [bloque.mapeo, ajustes]);

  const preview: PreviewBloque = useMemo(
    () => prepararBloque(bloque, mapeo, articulosDelPlan),
    [bloque, mapeo, articulosDelPlan],
  );

  const campoDeCol = (i: number): CampoCargable | "" => ajustes[i] ?? bloque.mapeo[i] ?? "";

  // Un campo no puede venir de dos columnas a la vez: sería ambiguo cuál gana.
  const duplicado = (i: number, campo: CampoCargable) =>
    Object.entries(mapeo).some(([j, c]) => Number(j) !== i && c === campo);

  const totalFilas = preview.agregar.length + preview.actualizar.length;
  const faltaArticulo = texto.trim() !== "" && bloque.colArticulo < 0;

  const cargar = async () => {
    if (totalFilas === 0) { toast.error("No hay filas para cargar."); return; }
    setGuardando(true);
    try {
      const r = await aplicarBloque(planId, preview);
      const partes: string[] = [];
      if (r.agregadas)    partes.push(`${r.agregadas} agregada${r.agregadas === 1 ? "" : "s"}`);
      if (r.actualizadas) partes.push(`${r.actualizadas} actualizada${r.actualizadas === 1 ? "" : "s"}`);
      if (r.sinCatalogo.length) {
        partes.push(`${r.sinCatalogo.length} fuera del catálogo (omitida${r.sinCatalogo.length === 1 ? "" : "s"})`);
      }
      toast.success(partes.join(" · ") || "Sin cambios.");
      onListo();
    } catch (e) {
      toast.error(`No se pudo cargar: ${(e as Error).message}`);
      setGuardando(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">Cargar datos al plan</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Pegá desde el Excel</label>
            <textarea
              autoFocus value={texto}
              onChange={e => setTexto(e.target.value)}
              rows={7}
              placeholder={"Artículo\tFAMILIA\tGD 2027\tPu Sic\n00015276.0\tACEITES\t120\t8200\n\n…o una lista de matrículas, una por línea."}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/20 resize-y"
            />
            <p className="text-[11px] text-muted-foreground">
              Seleccioná en el Excel las columnas que necesites —con la de matrículas y su fila de
              encabezados— y pegá todo junto: las matrículas que falten se suman y las columnas se
              cargan de una. También podés pegar una lista pelada de matrículas para sumarlas sin datos.
            </p>
          </div>

          {/* Sin columna de matrículas no hay forma de saber a qué fila va cada dato. */}
          {faltaArticulo && (
            <div className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/5 p-3 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 text-accent-red mt-0.5" />
              <div>
                <p className="font-medium text-foreground">Falta la columna de matrículas</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  El bloque tiene encabezados pero ninguno es el de matrículas —en el Excel esa
                  columna se titula «Artículo»—, así que no se sabe a qué fila corresponde cada valor.
                </p>
              </div>
            </div>
          )}

          {/* Mapeo de columnas: qué entendió de cada título, corregible. */}
          {bloque.tieneEncabezados && bloque.colArticulo >= 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Columnas detectadas{" "}
                <span className="text-muted-foreground/60">({Object.keys(mapeo).length} se van a cargar)</span>
              </p>
              <div className="rounded-lg border border-hairline bg-panel-2 divide-y divide-border max-h-56 overflow-y-auto">
                {bloque.headers.map((h, i) => {
                  const esArticulo = i === bloque.colArticulo;
                  const campo = campoDeCol(i);
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2">
                      <span className="flex-1 min-w-0 truncate text-[12px] text-foreground" title={h}>
                        {h || <span className="text-muted-foreground/60">(sin título)</span>}
                      </span>
                      {esArticulo ? (
                        <span className="text-[11px] font-medium text-accent-green shrink-0">Matrícula</span>
                      ) : (
                        <select
                          value={campo}
                          onChange={e => setAjustes(p => ({ ...p, [i]: e.target.value as CampoCargable | "" }))}
                          className={cn(
                            "h-7 px-2 rounded-md bg-panel-input border text-[11px] shrink-0",
                            "focus:outline-none focus:ring-1 focus:ring-ring/30",
                            campo && duplicado(i, campo)
                              ? "border-accent-red/60 text-accent-red"
                              : campo ? "border-border text-foreground" : "border-border text-muted-foreground",
                          )}
                        >
                          <option value="">Ignorar</option>
                          {CAMPOS_CARGABLES.map(c => (
                            <option key={c.campo} value={c.campo}>{c.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Resultado del cruce */}
          {texto.trim() && bloque.colArticulo >= 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
              {preview.agregar.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-accent-green">
                  <Plus className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{preview.agregar.length} matrícula{preview.agregar.length === 1 ? "" : "s"}</span>
                  <span className="text-muted-foreground">se agregan al plan</span>
                </div>
              )}
              {preview.actualizar.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-accent-green">
                  <Check className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{preview.actualizar.length} matrícula{preview.actualizar.length === 1 ? "" : "s"}</span>
                  <span className="text-muted-foreground">ya en el plan, se actualizan</span>
                </div>
              )}
              {totalFilas === 0 && (
                <p className="text-sm text-muted-foreground">No hay nada para cargar con este pegado.</p>
              )}

              {preview.agregar.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Las que se agregan se cruzan contra el catálogo para traer descripción, unidad y
                  Mat/Serv; si alguna no existe ahí, se omite y te aviso al terminar.
                </p>
              )}

              {preview.invalidas.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-border">
                  <div className="flex items-center gap-2 text-sm text-accent-red">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="font-medium">{preview.invalidas.length} celda{preview.invalidas.length === 1 ? "" : "s"} sin número válido</span>
                    <span className="text-muted-foreground">(se omiten)</span>
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground break-all">
                    {preview.invalidas.slice(0, 8).map(v => `${v.articulo}·${v.campo}→«${v.crudo}»`).join(" · ")}
                  </p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground pt-1 border-t border-border">
                Las celdas vacías no se escriben: las columnas que el pegado no traiga quedan como están.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={cargar} disabled={guardando || totalFilas === 0}
            className="h-9 px-4 inline-flex items-center gap-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {guardando && <Loader2 className="w-4 h-4 animate-spin" />}
            Cargar {totalFilas > 0 ? totalFilas : ""}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
