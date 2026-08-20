"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Coffee, Plus, Trash2, Loader2, X, Check, GripVertical,
  ShoppingCart, UserPlus, History, Pause, Play,
} from "lucide-react";
import {
  fetchParticipantes, fetchCompras, fetchMarcasUsadas, construirTurnos,
  agregarParticipante, borrarParticipante, setActivo, guardarOrden,
  registrarCompra, borrarCompra, kilosPorMarca, TOTALES_KG,
  type Participante, type Compra, type FilaTurno,
} from "@/lib/yerba";
import { fetchEquipo } from "@/lib/buscadorTabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const ITEM_SELECT = "text-[13px] focus:bg-panel-2 focus:text-foreground data-[state=checked]:bg-accent/15 data-[state=checked]:text-foreground";

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmtFecha = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
};

/** Días desde una fecha ISO hasta hoy. */
const diasDesde = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
};

interface PerfilSimple { id: string; nombre: string; avatarUrl: string | null }

export function YerbaSection() {
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [compras,       setCompras]       = useState<Compra[]>([]);
  const [marcasUsadas,  setMarcasUsadas]  = useState<string[]>([]);
  const [perfiles,      setPerfiles]      = useState<PerfilSimple[]>([]);
  const [cargando,      setCargando]      = useState(true);
  // Estado propio del listado de usuarios registrados: si falla, el diálogo
  // tiene que poder decir «no se pudo cargar» en vez de «ya están todos», que
  // es lo que se veía cuando la lista quedaba vacía por un error.
  const [cargandoEquipo, setCargandoEquipo] = useState(true);
  const [errorEquipo,    setErrorEquipo]    = useState<string | null>(null);

  const [addOpen,    setAddOpen]    = useState(false);
  const [compraOpen, setCompraOpen] = useState<FilaTurno | null>(null);
  const [histOpen,   setHistOpen]   = useState(false);

  // Reordenar (drag & drop sobre la lista).
  const [dragId,     setDragId]     = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try {
      const [p, c, m] = await Promise.all([fetchParticipantes(), fetchCompras(), fetchMarcasUsadas()]);
      setParticipantes(p); setCompras(c); setMarcasUsadas(m);
    } catch (e) {
      toast.error(`No se pudo cargar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { recargar(); }, [recargar]);

  // Usuarios registrados, para sumarlos sin tipear el nombre.
  //
  // Vía `fetchEquipo()` (la misma que usa el picker de compartir pestañas) y
  // no con un fetch propio: /api/team exige el header Authorization con el
  // token de la sesión, y sin él responde 401 — que era justamente lo que
  // dejaba la lista vacía. Tampoco se lee `profiles` directo, porque el email
  // vive en auth.users y sin él todo usuario sin perfil completo aparecía como
  // «(sin nombre)».
  useEffect(() => {
    fetchEquipo()
      .then((equipo) => {
        setPerfiles(
          equipo
            .map((u) => ({
              id: u.id,
              nombre: [u.nombre, u.apellido].filter(Boolean).join(" ").trim() || u.email || "(sin nombre)",
              avatarUrl: u.avatar_url,
            }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        );
      })
      .catch((e) => setErrorEquipo(e instanceof Error ? e.message : String(e)))
      .finally(() => setCargandoEquipo(false));
  }, []);

  const filas    = useMemo(() => construirTurnos(participantes, compras), [participantes, compras]);
  const proximo  = filas.find((f) => f.esProximo) ?? null;
  const activos  = filas.filter((f) => f.participante.activo).length;

  const perfilPorUserId = useMemo(
    () => new Map(perfiles.map((p) => [p.id, p])),
    [perfiles]
  );

  /**
   * Nombre y foto a MOSTRAR de un participante.
   *
   * ⚠ `yerba_participantes.nombre` es una COPIA congelada del nombre que tenía
   *   el perfil cuando se lo sumó a la ronda — si en ese momento el perfil
   *   estaba vacío, quedó guardado el email, y completarlo después no
   *   actualizaba nada acá. Por eso, para los registrados manda siempre el
   *   nombre actual de /api/team y la copia queda solo de respaldo (perfil
   *   borrado, o lista de equipo que no cargó).
   *
   *   Los participantes manuales no tienen user_id: ahí la copia ES el dato.
   */
  const datosDe = useCallback((p: Participante) => {
    const perfil = p.user_id ? perfilPorUserId.get(p.user_id) : undefined;
    return {
      nombre: perfil?.nombre || p.nombre,
      avatarUrl: perfil?.avatarUrl ?? null,
    };
  }, [perfilPorUserId]);

  // ── Reordenar ──
  const soltarEn = async (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const ids  = participantes.map((p) => p.id);
    const from = ids.indexOf(dragId);
    const to   = ids.indexOf(targetId);
    setDragId(null); setDragOverId(null);
    if (from === -1 || to === -1) return;

    ids.splice(to, 0, ids.splice(from, 1)[0]);
    // Optimista: la lista se reacomoda al instante y el orden viaja después.
    const byId = new Map(participantes.map((p) => [p.id, p]));
    const previo = participantes;
    setParticipantes(ids.map((id, i) => ({ ...byId.get(id)!, orden: i })));
    try {
      await guardarOrden(ids);
    } catch (e) {
      setParticipantes(previo);
      toast.error(`No se pudo guardar el orden: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Cabecera ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid place-items-center w-9 h-9 rounded-xl bg-accent-green/15 text-accent-green shrink-0">
            <Coffee className="w-4.5 h-4.5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Control de Yerba</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {cargando ? "Cargando…" : `${activos} en la ronda · ${compras.length} compra${compras.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHistOpen(true)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-hairline hover:bg-panel-2 transition-colors"
          >
            <History className="w-3.5 h-3.5" /> Historial
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold text-accent-green bg-accent-green/10 hover:bg-accent-green/20 border border-accent-green/30 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" /> Sumar a la ronda
          </button>
        </div>
      </div>

      {/* ── A quién le toca ──
          Es la pregunta que trae a alguien a esta pantalla, así que se lleva
          el espacio: foto grande, nombre grande y el resto como apoyo. El
          resplandor verde detrás de la foto separa el bloque del panel sin
          necesidad de otro borde. */}
      <div className="relative bg-panel border border-hairline rounded-xl p-6 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-16 -top-16 w-72 h-72 rounded-full blur-3xl"
          style={{ background: "color-mix(in oklab, var(--accent-green) 12%, transparent)" }}
        />
        <div className="relative">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">Le toca comprar</p>
          {cargando ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
            </div>
          ) : !proximo ? (
            <p className="text-sm text-muted-foreground py-6">
              No hay nadie en la ronda todavía. Sumá gente con «Sumar a la ronda».
            </p>
          ) : (() => {
            const { nombre, avatarUrl } = datosDe(proximo.participante);
            const dias = proximo.ultima ? diasDesde(proximo.ultima.fecha) : null;
            return (
              <div className="flex items-center gap-6 flex-wrap">
                <Avatar className="size-40 shrink-0 ring-4 ring-accent-green/25">
                  <AvatarImage src={avatarUrl ?? undefined} />
                  {/* Sin foto (participante manual, o registrado sin avatar
                      cargado): la inicial sobre el mismo verde del turno. */}
                  <AvatarFallback className="bg-accent-green/15 text-accent-green font-semibold text-5xl">
                    {nombre.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1 space-y-3">
                  <p className="text-4xl font-bold text-accent-green leading-tight break-words">{nombre}</p>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    {proximo.ultima ? (
                      <>
                        <span className="px-2 py-1 rounded-md bg-panel-2">
                          Última compra: <span className="text-foreground">{fmtFecha(proximo.ultima.fecha)}</span>
                        </span>
                        {dias != null && (
                          <span className="px-2 py-1 rounded-md bg-panel-2">hace {dias} d</span>
                        )}
                      </>
                    ) : (
                      <span className="px-2 py-1 rounded-md bg-panel-2">Nunca compró</span>
                    )}
                    <span className="px-2 py-1 rounded-md bg-panel-2">
                      {proximo.compras} compra{proximo.compras === 1 ? "" : "s"}
                    </span>
                  </div>
                  <button
                    onClick={() => setCompraOpen(proximo)}
                    className="flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold text-accent-green bg-accent-green/10 hover:bg-accent-green/20 border border-accent-green/30 transition-colors"
                  >
                    <ShoppingCart className="w-4 h-4" /> Registrar compra
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── La ronda ── */}
      <div className="bg-panel border border-hairline rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-hairline flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">La ronda</p>
          <p className="text-[11px] text-muted-foreground">Arrastrá para cambiar el orden</p>
        </div>

        {cargando ? (
          <div className="py-10 text-center"><Loader2 className="w-5 h-5 text-accent animate-spin inline" /></div>
        ) : participantes.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin participantes.</p>
        ) : (
          <ul>
            {filas.map((f, i) => {
              const p = f.participante;
              const { nombre, avatarUrl } = datosDe(p);
              return (
                <li
                  key={p.id}
                  draggable
                  onDragStart={(e) => { setDragId(p.id); e.dataTransfer.setData("text/plain", p.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragId && dragId !== p.id) setDragOverId(p.id); }}
                  onDragLeave={() => setDragOverId((k) => (k === p.id ? null : k))}
                  onDrop={(e) => { e.preventDefault(); soltarEn(p.id); }}
                  onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                  className={cn(
                    "flex items-center gap-3 px-5 py-3 border-b border-hairline last:border-0 transition-colors cursor-grab active:cursor-grabbing",
                    dragId === p.id && "opacity-40",
                    dragOverId === p.id && "bg-accent/10",
                    f.esProximo ? "bg-accent-green/8" : "hover:bg-panel-2/40",
                    !p.activo && "opacity-45"
                  )}
                >
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  <span className="text-xs text-muted-foreground tabular-nums w-5 shrink-0">{i + 1}</span>
                  <Avatar className="size-7 shrink-0">
                    <AvatarImage src={avatarUrl ?? undefined} />
                    <AvatarFallback className="bg-panel-2 text-muted-foreground text-[11px]">
                      {nombre.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-foreground font-medium truncate">{nombre}</span>
                      {f.esProximo && p.activo && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-semibold bg-accent-green/20 text-accent-green">
                          LE TOCA
                        </span>
                      )}
                      {!p.user_id && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] bg-panel-2 text-muted-foreground">manual</span>
                      )}
                      {!p.activo && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] bg-panel-2 text-muted-foreground">pausado</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {f.ultima
                        ? <>última: {fmtFecha(f.ultima.fecha)} · {f.ultima.marcas.map((m) => m.marca).join(" + ") || "sin marca"}</>
                        : "nunca compró"}
                      {f.compras > 0 && ` · ${f.compras} compra${f.compras === 1 ? "" : "s"}`}
                    </p>
                  </div>

                  <button
                    onClick={() => setCompraOpen(f)}
                    title="Registrar una compra de esta persona"
                    className="shrink-0 grid place-items-center w-7 h-7 rounded-lg text-muted-foreground hover:text-accent-green hover:bg-accent-green/10 transition-colors"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      try { await setActivo(p.id, !p.activo); recargar(); }
                      catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
                    }}
                    title={p.activo ? "Pausar (saltearlo en la ronda)" : "Reactivar"}
                    className="shrink-0 grid place-items-center w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-2 transition-colors"
                  >
                    {p.activo ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`¿Sacar a ${nombre} de la ronda? Se borran también sus compras del historial.`)) return;
                      try { await borrarParticipante(p.id); recargar(); }
                      catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
                    }}
                    title="Sacar de la ronda"
                    className="shrink-0 grid place-items-center w-7 h-7 rounded-lg text-muted-foreground hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {addOpen && (
        <DialogSumar
          perfiles={perfiles}
          cargandoEquipo={cargandoEquipo}
          errorEquipo={errorEquipo}
          yaEn={new Set(participantes.map((p) => p.user_id).filter(Boolean) as string[])}
          ordenFinal={participantes.length}
          onClose={() => setAddOpen(false)}
          onHecho={() => { setAddOpen(false); recargar(); }}
        />
      )}

      {compraOpen && (
        <DialogCompra
          fila={compraOpen}
          nombre={datosDe(compraOpen.participante).nombre}
          marcasUsadas={marcasUsadas}
          onClose={() => setCompraOpen(null)}
          onHecho={() => { setCompraOpen(null); recargar(); }}
        />
      )}

      {histOpen && (
        <DialogHistorial
          compras={compras}
          // El nombre resuelto, no la copia congelada de la tabla — si no, el
          // historial seguiría mostrando el email de quien completó su perfil
          // después de sumarse a la ronda.
          nombrePorParticipante={new Map(participantes.map((p) => [p.id, datosDe(p).nombre]))}
          onClose={() => setHistOpen(false)}
          onBorrada={recargar}
        />
      )}
    </div>
  );
}

// ─── Sumar a la ronda ───────────────────────────────────────────────────────
// Dos caminos en el mismo diálogo: elegir un usuario registrado, o escribir un
// nombre suelto. El segundo existe porque no todos los que ceban tienen usuario
// en la app, y pedirles que se registren para entrar en la ronda sería absurdo.

function DialogSumar({
  perfiles, cargandoEquipo, errorEquipo, yaEn, ordenFinal, onClose, onHecho,
}: {
  perfiles: PerfilSimple[]; cargandoEquipo: boolean; errorEquipo: string | null;
  yaEn: Set<string>; ordenFinal: number;
  onClose: () => void; onHecho: () => void;
}) {
  const [modo,     setModo]     = useState<"usuario" | "manual">("usuario");
  const [userId,   setUserId]   = useState<string>("");
  const [nombre,   setNombre]   = useState("");
  const [guardando, setGuardando] = useState(false);

  const disponibles = perfiles.filter((p) => !yaEn.has(p.id));

  const guardar = async () => {
    const esUsuario = modo === "usuario";
    const nom = esUsuario ? disponibles.find((p) => p.id === userId)?.nombre : nombre;
    if (!nom?.trim()) { toast.error(esUsuario ? "Elegí un usuario." : "Escribí un nombre."); return; }
    setGuardando(true);
    try {
      await agregarParticipante(nom, esUsuario ? userId : null, ordenFinal);
      toast.success(`${nom} se sumó a la ronda.`);
      onHecho();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] grid place-items-center p-4 bg-black/65" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-hairline bg-panel overflow-hidden animate-in fade-in zoom-in-95 duration-150" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <p className="text-sm font-semibold text-foreground">Sumar a la ronda</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            {(["usuario", "manual"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={cn(
                  "flex-1 h-9 rounded-lg text-xs font-medium border transition-colors",
                  modo === m
                    ? "bg-accent/15 text-foreground border-accent/40"
                    : "text-muted-foreground border-hairline hover:bg-panel-2"
                )}
              >
                {m === "usuario" ? "Usuario registrado" : "Nombre suelto"}
              </button>
            ))}
          </div>

          {modo === "usuario" ? (
            // Los tres motivos por los que puede no haber lista son distintos y
            // el mensaje tiene que decir cuál es: antes un error de carga se
            // veía igual que «ya están todos», y no había forma de darse cuenta.
            cargandoEquipo ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando usuarios…
              </p>
            ) : errorEquipo ? (
              <p className="text-xs text-accent-red py-2">
                No se pudo cargar la lista de usuarios ({errorEquipo}). Podés sumarlo con «Nombre suelto».
              </p>
            ) : perfiles.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No hay usuarios registrados en la app. Usá «Nombre suelto».
              </p>
            ) : disponibles.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                Todos los usuarios registrados ya están en la ronda. Usá «Nombre suelto».
              </p>
            ) : (
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="w-full bg-panel-2 border-hairline">
                  <SelectValue placeholder="Elegí un usuario…" />
                </SelectTrigger>
                {/* ⚠ z-index explícito: el SelectContent de shadcn se portea a
                    <body> con z-50, y este diálogo —que también vive en body,
                    por createPortal— está en z-200. Sin subirlo, el desplegable
                    se abre DETRÁS del diálogo y se ve la lista de fondo. */}
                <SelectContent className="bg-panel border-hairline z-[300]">
                  {disponibles.map((p) => (
                    <SelectItem key={p.id} value={p.id} className={ITEM_SELECT}>{p.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : (
            <input
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") guardar(); }}
              placeholder="Nombre"
              className="w-full h-9 px-3 rounded-lg bg-panel-2 border border-hairline text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-hairline">
          <button onClick={onClose} className="h-9 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-panel-2 transition-colors">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold text-accent-green bg-accent-green/10 hover:bg-accent-green/20 border border-accent-green/30 transition-colors disabled:opacity-50"
          >
            {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Sumar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Registrar compra ───────────────────────────────────────────────────────
// La cantidad de marcas define los kilos, no al revés: es la regla de la
// oficina (1 marca → 1 kg, 2 marcas → ½ kg cada una), así que se muestra
// calculado y no se puede escribir un valor que la contradiga.

function DialogCompra({
  fila, nombre, marcasUsadas, onClose, onHecho,
}: {
  fila: FilaTurno; nombre: string; marcasUsadas: string[]; onClose: () => void; onHecho: () => void;
}) {
  const [totalKg, setTotalKg] = useState<number>(1);
  const [dos,    setDos]    = useState(false);
  const [marcaA, setMarcaA] = useState("");
  const [marcaB, setMarcaB] = useState("");
  const [fecha,  setFecha]  = useState(hoyISO());
  const [nota,   setNota]   = useState("");
  const [guardando, setGuardando] = useState(false);

  const marcas = dos ? [marcaA, marcaB] : [marcaA];
  const kilos  = kilosPorMarca(totalKg, marcas.filter((m) => m.trim()).length);

  const guardar = async () => {
    setGuardando(true);
    try {
      await registrarCompra(fila.participante.id, fecha, totalKg, marcas, nota || null);
      toast.success("Compra registrada.");
      onHecho();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] grid place-items-center p-4 bg-black/65" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-hairline bg-panel overflow-hidden animate-in fade-in zoom-in-95 duration-150" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <div>
            <p className="text-sm font-semibold text-foreground">Registrar compra</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{nombre}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Dos toggles independientes: cuánto en total y en cuántas marcas
              se reparte. Los kilos por marca salen de dividir uno por otro
              (kilosPorMarca), nunca se eligen sueltos. */}
          <div>
            <p className="text-[11px] text-muted-foreground mb-1.5">Total</p>
            <div className="flex gap-2">
              {TOTALES_KG.map((kg) => (
                <button
                  key={kg}
                  onClick={() => setTotalKg(kg)}
                  className={cn("flex-1 h-9 rounded-lg text-xs font-medium border transition-colors",
                    totalKg === kg ? "bg-accent/15 text-foreground border-accent/40" : "text-muted-foreground border-hairline hover:bg-panel-2")}
                >
                  {kg} kg
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] text-muted-foreground mb-1.5">Marcas</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDos(false)}
                className={cn("flex-1 h-9 rounded-lg text-xs font-medium border transition-colors",
                  !dos ? "bg-accent/15 text-foreground border-accent/40" : "text-muted-foreground border-hairline hover:bg-panel-2")}
              >
                Una marca
              </button>
              <button
                onClick={() => setDos(true)}
                className={cn("flex-1 h-9 rounded-lg text-xs font-medium border transition-colors",
                  dos ? "bg-accent/15 text-foreground border-accent/40" : "text-muted-foreground border-hairline hover:bg-panel-2")}
              >
                Dos marcas (para comparar)
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <MarcaInput valor={marcaA} onChange={setMarcaA} sugerencias={marcasUsadas} placeholder="Marca" autoFocus />
            {dos && <MarcaInput valor={marcaB} onChange={setMarcaB} sugerencias={marcasUsadas} placeholder="Segunda marca" />}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground shrink-0">Fecha</label>
            <input
              type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
              className="h-9 px-3 rounded-lg bg-panel-2 border border-hairline text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              style={{ colorScheme: "dark" }}
            />
            {kilos && (
              <span className="ml-auto text-[11px] text-accent-green">
                {kilos} kg × {marcas.filter((m) => m.trim()).length}
              </span>
            )}
          </div>

          <input
            value={nota} onChange={(e) => setNota(e.target.value)}
            placeholder="Nota (opcional)"
            className="w-full h-9 px-3 rounded-lg bg-panel-2 border border-hairline text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-hairline">
          <button onClick={onClose} className="h-9 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-panel-2 transition-colors">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !kilos}
            title={!kilos ? "Completá la o las marcas" : undefined}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold text-accent-green bg-accent-green/10 hover:bg-accent-green/20 border border-accent-green/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Guardar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Input de marca con sugerencias de las ya compradas (datalist nativo). */
function MarcaInput({
  valor, onChange, sugerencias, placeholder, autoFocus,
}: { valor: string; onChange: (v: string) => void; sugerencias: string[]; placeholder: string; autoFocus?: boolean }) {
  const listId = `marcas-${placeholder.replace(/\s/g, "")}`;
  return (
    <>
      <input
        autoFocus={autoFocus}
        list={listId}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 rounded-lg bg-panel-2 border border-hairline text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <datalist id={listId}>
        {sugerencias.map((m) => <option key={m} value={m} />)}
      </datalist>
    </>
  );
}

// ─── Historial ──────────────────────────────────────────────────────────────

function DialogHistorial({
  compras, nombrePorParticipante: nombreDe, onClose, onBorrada,
}: {
  compras: Compra[]; nombrePorParticipante: Map<string, string>;
  onClose: () => void; onBorrada: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[200] grid place-items-center p-4 bg-black/65" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl border border-hairline bg-panel overflow-hidden animate-in fade-in zoom-in-95 duration-150" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
          <p className="text-sm font-semibold text-foreground">Historial de compras</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-auto">
          {compras.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Todavía no hay compras registradas.</p>
          ) : (
            <ul>
              {compras.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3 border-b border-hairline last:border-0 hover:bg-panel-2/40 transition-colors">
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0 w-14">{fmtFecha(c.fecha)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">{nombreDe.get(c.participante_id) ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {c.marcas.map((m) => `${m.marca} (${m.kilos} kg)`).join(" + ") || "sin marca"}
                      {c.nota && ` · ${c.nota}`}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm("¿Borrar esta compra? Puede cambiar de quién es el turno.")) return;
                      try { await borrarCompra(c.id); onBorrada(); }
                      catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
                    }}
                    className="shrink-0 grid place-items-center w-7 h-7 rounded-lg text-muted-foreground hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
