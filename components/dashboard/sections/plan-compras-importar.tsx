"use client";

// Modal de importación del Excel del Plan de Compras (PC_ANUAL_GD).
//
// Pasos: elegir → leyendo → revisar → subiendo (o error). La lectura corre en
// un Web Worker (lib/planComprasLeer.ts) y devuelve, además de las filas, la
// verificación del cálculo contra los valores que el propio Excel guardó: se
// muestra ANTES de subir para que nadie reemplace el plan sin ver si la app
// replica bien las fórmulas.
//
// Solo `import type` de lib/planComprasImport: importar un valor de ahí
// arrastraría la librería xlsx al bundle, y el lector ya vive en el worker.

import { useEffect, useId, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Download, FileSpreadsheet, Loader2, Plus, UploadCloud } from "lucide-react";
import { leerExcelPlan, ErrorEstructuraPlan } from "@/lib/planComprasLeer";
import { esErrorDeVersion, recargarPagina, MENSAJE_VERSION_NUEVA } from "@/lib/versionNueva";
import {
  importarPlan, mensajeErrorPlan,
  type PlanCompras, type ProgresoImportacion,
} from "@/lib/planCompras";
import type { ImportacionPlan } from "@/lib/planComprasImport";
import {
  altaEnCatalogo, descargarCsv, revisarContraCatalogo, type CruceCatalogo,
} from "@/lib/planComprasCatalogo";

// ─── Estado ──────────────────────────────────────────────────────────────────

type Paso =
  | { tipo: "elegir"; error: string | null }
  | { tipo: "leyendo"; archivo: string }
  | { tipo: "revisar"; imp: ImportacionPlan }
  | { tipo: "subiendo"; progreso: ProgresoImportacion }
  | { tipo: "error"; origen: "lectura" | "subida"; mensaje: string; version?: boolean };

/** Cruce con el catálogo de matrículas: corre en paralelo a la revisión y es
 *  informativo (no bloquea la importación). */
type EstadoCatalogo =
  | { tipo: "cargando" }
  | { tipo: "listo"; cruce: CruceCatalogo }
  | { tipo: "error"; mensaje: string };

type EstadoAlta =
  | { tipo: "nada" }
  | { tipo: "confirmar" }
  | { tipo: "subiendo"; hechas: number; total: number }
  | { tipo: "hecho"; cantidad: number }
  | { tipo: "error"; mensaje: string };

/** Año válido para un plan: 4 cifras, rango razonable. */
function anioValido(txt: string): number | null {
  const n = Number(txt.trim());
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

/** Filas que se muestran en las tablas del catálogo (el CSV lleva todas). */
const MAX_FILAS_TABLA = 300;

// ─── Formato ─────────────────────────────────────────────────────────────────

const nro = (v: number, maxDec = 0): string =>
  v.toLocaleString("es-AR", { maximumFractionDigits: maxDec });

/** dd/mm/yyyy HH:mm fijo: toLocaleString("es-AR") no rellena con ceros. */
function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Los ejemplos de la verificación vienen como texto con punto decimal
 *  («1234.5»): si es un número se pasa a es-AR, si no («(vacío)», «Sin
 *  Datos») queda igual. */
function valorEsAR(s: string): string {
  return /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s) ? nro(Number(s), 6) : s;
}

function mensajeLectura(e: unknown): string {
  // ErrorEstructuraPlan ya dice qué columnas faltan; el resto también viene
  // armado por el lector («No se pudo leer el archivo: …»).
  if (e instanceof ErrorEstructuraPlan) return e.message;
  // «Failed to load chunk …»: la pestaña quedó con una versión vieja de la app.
  if (esErrorDeVersion(e)) return MENSAJE_VERSION_NUEVA;
  return e instanceof Error ? e.message : String(e);
}

/** El total de filas es casi todo el trabajo; el resto son unos pocos requests. */
function porcentaje(p: ProgresoImportacion): number {
  switch (p.fase) {
    case "preparando": return 2;
    case "items":      return 2 + (p.total > 0 ? (p.hechos / p.total) * 90 : 90);
    case "familias":   return 94;
    case "activando":  return 97;
  }
}

function textoFase(p: ProgresoImportacion): string {
  switch (p.fase) {
    case "preparando": return "Preparando…";
    case "items":      return `Subiendo filas: ${nro(p.hechos)} de ${nro(p.total)}`;
    case "familias":   return "Guardando familias y cuentas…";
    case "activando":  return "Activando el plan…";
  }
}

const esExcel = (nombre: string) => /\.(xlsx|xlsm)$/i.test(nombre);

// ─── Piezas ──────────────────────────────────────────────────────────────────

const ETIQUETA: CSSProperties = {
  fontSize: 11, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase",
  color: "var(--ido-text-dim)",
};

function Dato({ etiqueta, valor, className = "" }: { etiqueta: string; valor: string; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div style={{ ...ETIQUETA, marginBottom: 4 }}>{etiqueta}</div>
      <div className="font-mono tabular-nums truncate" title={valor} style={{ fontSize: 13, color: "var(--ido-text)" }}>
        {valor}
      </div>
    </div>
  );
}

interface ColTabla {
  titulo:  string;
  ancho:   string;
  derecha?: boolean;
}

/** Tabla chica de solo lectura (CSS grid, §4.11): ejemplos de diferencias y
 *  familias que no cierran. Encabezado sticky opaco para que las filas no se
 *  transparenten al scrollear. */
function TablaChica({ columnas, filas }: { columnas: ColTabla[]; filas: string[][] }) {
  const plantilla = columnas.map((c) => c.ancho).join(" ");
  const celda = (c: ColTabla): CSSProperties => ({
    padding: "0 8px", textAlign: c.derecha ? "right" : "left",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  });
  return (
    <div style={{ maxHeight: 196, overflow: "auto", border: "1px solid var(--ido-border)", borderRadius: 8 }}>
      <div
        className="grid items-center"
        style={{
          gridTemplateColumns: plantilla, height: 28, position: "sticky", top: 0,
          background: "var(--ido-header)", borderBottom: "1px solid var(--ido-border-strong)",
          fontSize: 10, fontWeight: 500, letterSpacing: ".1em", textTransform: "uppercase",
          color: "var(--ido-text-dim)",
        }}
      >
        {columnas.map((c) => <div key={c.titulo} style={celda(c)}>{c.titulo}</div>)}
      </div>
      {filas.map((f, i) => (
        <div
          key={i}
          className="grid items-center font-mono tabular-nums"
          style={{
            gridTemplateColumns: plantilla, height: 28, fontSize: 12, color: "var(--ido-text)",
            borderTop: i === 0 ? "none" : "1px solid var(--ido-line)",
          }}
        >
          {f.map((v, j) => <div key={j} style={celda(columnas[j])} title={v}>{v}</div>)}
        </div>
      ))}
    </div>
  );
}

// ─── Revisión ────────────────────────────────────────────────────────────────

function Verificacion({ imp }: { imp: ImportacionPlan }) {
  const v = imp.verificacion;
  const famMal = v.familias.filter((f) => !f.ok);
  const famOk = v.familias.length - famMal.length;
  const colsMal = v.porColumna.filter((c) => c.diferencias > 0);

  // Sin columnas fórmula en el Excel no hay nada que comparar: «Verificado»
  // con 0 celdas sería mentira.
  if (v.celdasComparadas === 0) {
    return (
      <div
        className="flex flex-col gap-2"
        style={{ padding: 12, borderRadius: 8, border: "1px solid var(--ido-border)", background: "var(--ido-panel)" }}
      >
        <span className="ido-chip ido-badge-neutral self-start">Sin verificar</span>
        <p style={{ fontSize: 13, color: "var(--ido-text-2)" }}>
          El Excel no trae las columnas calculadas, así que no hay contra qué comparar. La app las calcula igual.
        </p>
      </div>
    );
  }

  // Una familia de Prioridad que no cierra también es una diferencia con el
  // Excel: el «Verificado» verde exige que coincidan celdas Y familias.
  if (v.diferencias === 0 && famMal.length === 0) {
    return (
      <div
        className="flex flex-col gap-2"
        style={{ padding: 12, borderRadius: 8, border: "1px solid var(--ido-border)", background: "var(--ido-panel)" }}
      >
        <span className="ido-chip ido-badge-ok self-start">
          <Check className="w-3 h-3" strokeWidth={2.6} />
          Verificado
        </span>
        <p style={{ fontSize: 13, color: "var(--ido-text-2)" }}>
          {nro(v.celdasComparadas)} celdas calculadas en {nro(v.porColumna.length)} columnas: 0 diferencias con el Excel
        </p>
        {v.familias.length > 0 && (
          <p style={{ fontSize: 13, color: "var(--ido-text-2)" }}>
            {nro(famOk)}/{nro(v.familias.length)} familias de Prioridad coinciden (total GD $ y cantidad)
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: 8, overflow: "hidden",
        border: "1px solid color-mix(in srgb, var(--ido-warning) 20%, transparent)",
      }}
    >
      <div className="ido-banner-warning" style={{ padding: "10px 12px" }}>
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>
          {v.diferencias > 0
            ? `${nro(v.diferencias)} diferencias en ${nro(v.celdasComparadas)} celdas`
            : `0 diferencias en ${nro(v.celdasComparadas)} celdas, pero ${nro(famMal.length)} familias de Prioridad no coinciden`}
        </span>
      </div>

      <div className="flex flex-col gap-3" style={{ padding: 12 }}>
        {colsMal.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {colsMal.map((c) => (
              <span key={c.clave} className="ido-chip ido-badge-neutral">
                {c.titulo}
                <span className="font-mono tabular-nums" style={{ color: "var(--ido-text)" }}>{nro(c.diferencias)}</span>
              </span>
            ))}
          </div>
        )}

        {v.ejemplos.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <TablaChica
              columnas={[
                { titulo: "Fila", ancho: "56px", derecha: true },
                { titulo: "Artículo", ancho: "minmax(0, 0.9fr)" },
                { titulo: "Columna", ancho: "minmax(0, 1.2fr)" },
                { titulo: "Excel", ancho: "minmax(0, 1fr)", derecha: true },
                { titulo: "App", ancho: "minmax(0, 1fr)", derecha: true },
              ]}
              filas={v.ejemplos.map((d) => [
                nro(d.fila), d.articulo, imp.etiquetas[d.clave] ?? d.clave, valorEsAR(d.excel), valorEsAR(d.app),
              ])}
            />
            {v.diferencias > v.ejemplos.length && (
              <span style={{ fontSize: 12, color: "var(--ido-text-dim)" }}>
                Se muestran las primeras {nro(v.ejemplos.length)} de {nro(v.diferencias)}.
              </span>
            )}
          </div>
        )}

        {v.familias.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span style={{ fontSize: 13, color: "var(--ido-text-2)" }}>
              {nro(famOk)}/{nro(v.familias.length)} familias de Prioridad coinciden (total GD $ y cantidad)
            </span>
            {famMal.length > 0 && (
              <TablaChica
                columnas={[
                  { titulo: "Familia", ancho: "minmax(0, 1.4fr)" },
                  { titulo: "Excel $", ancho: "minmax(0, 1fr)", derecha: true },
                  { titulo: "App $", ancho: "minmax(0, 1fr)", derecha: true },
                  { titulo: "Cant. Excel / App", ancho: "minmax(0, 1fr)", derecha: true },
                ]}
                filas={famMal.map((f) => [
                  f.familia,
                  f.excelTotal == null ? "—" : nro(f.excelTotal, 2),
                  nro(f.appTotal, 2),
                  `${f.excelCantidad == null ? "—" : nro(f.excelCantidad)} / ${nro(f.appCantidad)}`,
                ])}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OrigenAnio({ imp, anio }: { imp: ImportacionPlan; anio: number | null }) {
  const { anioEncabezado: enc, anioArchivo: arch } = imp;
  let texto: string;
  let aviso = false;
  if (enc != null && arch != null && enc !== arch) {
    texto = `El encabezado dice ${enc} y el nombre del archivo ${arch}: confirmá cuál es.`;
    aviso = true;
  } else if (enc != null) {
    texto = `Detectado del encabezado «${imp.etiquetas.total_plan ?? enc}».`;
  } else if (arch != null) {
    texto = "Detectado del nombre del archivo (los encabezados no traen el año).";
  } else {
    texto = "No se pudo detectar: escribilo.";
    aviso = true;
  }
  if (anio == null) { texto = "Escribí un año de 4 cifras."; aviso = true; }
  return (
    <span style={{ fontSize: 12, color: aviso ? "var(--ido-warning)" : "var(--ido-text-dim)" }}>{texto}</span>
  );
}

function Revision({
  imp, anioTxt, onAnio, planes, catalogo, alta, onAlta, onReintentarCatalogo,
}: {
  imp: ImportacionPlan;
  anioTxt: string;
  onAnio: (txt: string) => void;
  planes: PlanCompras[];
  catalogo: EstadoCatalogo;
  alta: EstadoAlta;
  onAlta: (a: "pedir" | "cancelar" | "confirmar") => void;
  onReintentarCatalogo: () => void;
}) {
  const anio = anioValido(anioTxt);
  const existente = anio == null ? null : planes.find((p) => p.anio === anio) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        <div className="col-span-2 sm:col-span-4 flex flex-col gap-1.5">
          <label htmlFor="pc-imp-anio" style={ETIQUETA}>Año del plan</label>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              id="pc-imp-anio"
              className="ido-input ido-input-mono"
              style={{ width: 96, height: 32 }}
              inputMode="numeric"
              maxLength={4}
              value={anioTxt}
              onChange={(e) => onAnio(e.target.value.replace(/\D/g, ""))}
            />
            <OrigenAnio imp={imp} anio={anio} />
          </div>
        </div>
        <Dato etiqueta="Nombre" valor={anio == null ? "—" : nombrePlan(anio)} className="col-span-2 sm:col-span-4" />
        <Dato etiqueta="Tipo de cambio" valor={nro(imp.tipo_cambio, 4)} />
        <Dato etiqueta="Mayoración" valor={`${nro(imp.pct_mayoracion * 100, 2)} %`} />
        <Dato etiqueta="Filas de Global" valor={nro(imp.items.length)} />
        <Dato etiqueta="Familias (Prioridad)" valor={nro(imp.familias.length)} />
        <Dato etiqueta="Cuentas (Resumen)" valor={nro(imp.cuentas.length)} />
        <Dato etiqueta="Archivo" valor={imp.archivo} className="sm:col-span-3" />
      </div>

      <Verificacion imp={imp} />

      <Catalogo estado={catalogo} alta={alta} onAlta={onAlta} onReintentar={onReintentarCatalogo} />

      {imp.advertencias.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {imp.advertencias.map((a, i) => (
            <li key={i} className="flex items-start gap-2" style={{ fontSize: 13, color: "var(--ido-text-2)" }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ido-warning)", marginTop: 3 }} />
              <span>{a}</span>
            </li>
          ))}
        </ul>
      )}

      {existente ? (
        <div
          className="ido-banner-warning"
          style={{
            alignItems: "flex-start", padding: "10px 12px", borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--ido-warning) 20%, transparent)",
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ marginTop: 2 }} />
          <span>
            Ya hay un plan {existente.anio} cargado
            {(existente.importado_at || existente.archivo) && (
              <>
                {" ("}importado
                {existente.importado_at && <> el {fechaHora(existente.importado_at)}</>}
                {existente.archivo && <> desde «{existente.archivo}»</>}
                {")"}
              </>
            )}
            . Importar lo <strong>REEMPLAZA</strong> completo. Los planes de otros años no se tocan.
          </span>
        </div>
      ) : anio != null && planes.length > 0 ? (
        <p style={{ fontSize: 13, color: "var(--ido-text-2)" }}>
          No hay plan {anio} cargado: se agrega como un plan nuevo y los de otros años quedan como están.
        </p>
      ) : null}
    </div>
  );
}

/** Mismo nombre que arma el importador, con el año (posiblemente corregido). */
const nombrePlan = (anio: number) => `Plan de Compras Anual GD ${anio}`;

// ─── Matrículas vs. catálogo ─────────────────────────────────────────────────

function CabeceraBloque({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ido-text)", marginRight: "auto" }}>{titulo}</span>
      {children}
    </div>
  );
}

function Catalogo({
  estado, alta, onAlta, onReintentar,
}: {
  estado: EstadoCatalogo;
  alta: EstadoAlta;
  onAlta: (a: "pedir" | "cancelar" | "confirmar") => void;
  onReintentar: () => void;
}) {
  const caja: CSSProperties = {
    padding: 12, borderRadius: 8, border: "1px solid var(--ido-border)", background: "var(--ido-panel)",
  };

  if (estado.tipo === "cargando") {
    return (
      <div className="flex items-center gap-2" style={{ ...caja, fontSize: 13, color: "var(--ido-text-2)" }}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Cruzando las matrículas con el catálogo…
      </div>
    );
  }
  if (estado.tipo === "error") {
    return (
      <div className="flex items-center gap-3 flex-wrap" style={{ ...caja, fontSize: 13, color: "var(--ido-text-2)" }}>
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ido-warning)" }} />
        <span style={{ marginRight: "auto" }}>No se pudo leer el catálogo de matrículas: {estado.mensaje}</span>
        <button type="button" className="ido-btn ido-btn-ghost" style={{ height: 30 }} onClick={onReintentar}>
          Reintentar
        </button>
      </div>
    );
  }

  const c = estado.cruce;
  const hechoAlta = alta.tipo === "hecho" ? (
    <span className="ido-chip ido-badge-ok self-start">
      <Check className="w-3 h-3" strokeWidth={2.6} />
      {nro(alta.cantidad)} dadas de alta en el catálogo
    </span>
  ) : null;

  if (c.faltantes.length === 0 && c.diferencias.length === 0) {
    return (
      <div className="flex flex-col gap-2" style={caja}>
        <span className="ido-chip ido-badge-ok self-start">
          <Check className="w-3 h-3" strokeWidth={2.6} />
          Catálogo al día
        </span>
        {hechoAlta}
        <p style={{ fontSize: 13, color: "var(--ido-text-2)" }}>
          Las {nro(c.revisadas)} matrículas del Excel están en el catálogo con los mismos datos.
        </p>
      </div>
    );
  }

  const ocupado = alta.tipo === "subiendo";
  return (
    <div className="flex flex-col gap-4" style={caja}>
      <div className="flex flex-col gap-1">
        <span style={ETIQUETA}>Matrículas vs. catálogo</span>
        <span style={{ fontSize: 13, color: "var(--ido-text-2)" }}>
          {nro(c.enCatalogo)} de {nro(c.revisadas)} matrículas del Excel están en el catálogo
          ({nro(c.catalogo)} matrículas en total). No bloquea la importación.
        </span>
        {hechoAlta}
      </div>

      {c.faltantes.length > 0 && (
        <div className="flex flex-col gap-2">
          <CabeceraBloque titulo={`${nro(c.faltantes.length)} no están en el catálogo`}>
            <button
              type="button"
              className="ido-btn ido-btn-ghost"
              style={{ height: 30 }}
              onClick={() => descargarCsv("matriculas_fuera_de_catalogo",
                ["Matrícula", "Descripción", "Unidad", "M/S", "Familia", "A cargo de"],
                c.faltantes.map((f) => [f.articulo, f.descripcion, f.unidad, f.mat_serv, f.familia, f.a_cargo_de]))}
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            {alta.tipo !== "confirmar" && (
              <button
                type="button"
                className="ido-btn ido-btn-ghost"
                style={{ height: 30 }}
                disabled={ocupado}
                onClick={() => onAlta("pedir")}
              >
                {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {ocupado
                  ? `Dando de alta… ${nro(alta.hechas)}/${nro(alta.total)}`
                  : `Dar de alta ${nro(c.faltantes.length)}`}
              </button>
            )}
          </CabeceraBloque>

          {alta.tipo === "confirmar" && (
            <div
              className="flex items-center gap-3 flex-wrap"
              style={{
                padding: "10px 12px", borderRadius: 8, fontSize: 13, color: "var(--ido-text-2)",
                border: "1px solid var(--ido-border-strong)", background: "var(--ido-elevated)",
              }}
            >
              <span style={{ marginRight: "auto", minWidth: 0 }}>
                Se agregan {nro(c.faltantes.length)} matrículas al catálogo con el código, la descripción,
                la unidad y el M/S tal como vienen en el Excel.
              </span>
              <button type="button" className="ido-btn ido-btn-text" style={{ height: 30 }} onClick={() => onAlta("cancelar")}>
                Cancelar
              </button>
              <button type="button" className="ido-btn ido-btn-primary" style={{ height: 30 }} onClick={() => onAlta("confirmar")}>
                Dar de alta
              </button>
            </div>
          )}
          {alta.tipo === "error" && (
            <p style={{ fontSize: 12, color: "var(--ido-error)" }}>{alta.mensaje}</p>
          )}

          <TablaChica
            columnas={[
              { titulo: "Matrícula", ancho: "104px" },
              { titulo: "Descripción", ancho: "minmax(0, 2fr)" },
              { titulo: "Unidad", ancho: "64px" },
              { titulo: "A cargo de", ancho: "minmax(0, 0.8fr)" },
            ]}
            filas={c.faltantes.slice(0, MAX_FILAS_TABLA).map((f) => [f.articulo, f.descripcion, f.unidad, f.a_cargo_de])}
          />
          {c.faltantes.length > MAX_FILAS_TABLA && (
            <span style={{ fontSize: 12, color: "var(--ido-text-dim)" }}>
              Se muestran las primeras {nro(MAX_FILAS_TABLA)}; el CSV las tiene todas.
            </span>
          )}
        </div>
      )}

      {c.diferencias.length > 0 && (
        <div className="flex flex-col gap-2">
          <CabeceraBloque titulo={`${nro(c.diferencias.length)} datos distintos al catálogo`}>
            <button
              type="button"
              className="ido-btn ido-btn-ghost"
              style={{ height: 30 }}
              onClick={() => descargarCsv("matriculas_diferencias_catalogo",
                ["Matrícula", "Campo", "Excel del plan", "Catálogo"],
                c.diferencias.map((d) => [d.articulo, d.campo, d.plan, d.catalogo]))}
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </CabeceraBloque>
          <TablaChica
            columnas={[
              { titulo: "Matrícula", ancho: "104px" },
              { titulo: "Campo", ancho: "108px" },
              { titulo: "Excel del plan", ancho: "minmax(0, 1fr)" },
              { titulo: "Catálogo", ancho: "minmax(0, 1fr)" },
            ]}
            filas={c.diferencias.slice(0, MAX_FILAS_TABLA).map((d) => [d.articulo, d.campo, d.plan, d.catalogo])}
          />
          <span style={{ fontSize: 12, color: "var(--ido-text-dim)" }}>
            {c.diferencias.length > MAX_FILAS_TABLA && <>Se muestran las primeras {nro(MAX_FILAS_TABLA)}; el CSV las tiene todas. </>}
            El plan guarda lo que dice el Excel; el catálogo no se modifica.
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function PlanComprasImportarModal({
  planes, onClose, onImportado,
}: {
  /** Planes activos (uno por año): para avisar si el año elegido ya tiene uno. */
  planes: PlanCompras[];
  onClose: () => void;
  onImportado: (plan: PlanCompras, imp: ImportacionPlan) => void;
}) {
  const [paso, setPaso] = useState<Paso>({ tipo: "elegir", error: null });
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Cada lectura lleva un número: si el usuario volvió a elegir (o cerró)
  // mientras el worker leía, el resultado viejo se descarta.
  const lecturaRef = useRef(0);
  const tituloId = useId();

  // Revisión: año (editable), cruce con el catálogo y alta de faltantes.
  const [anioTxt, setAnioTxt] = useState("");
  const [catalogo, setCatalogo] = useState<EstadoCatalogo>({ tipo: "cargando" });
  const [alta, setAlta] = useState<EstadoAlta>({ tipo: "nada" });
  const cruceRef = useRef(0);

  const cruzar = (imp: ImportacionPlan) => {
    const id = ++cruceRef.current;
    setCatalogo({ tipo: "cargando" });
    revisarContraCatalogo(imp.items).then(
      (cruce) => { if (id === cruceRef.current) setCatalogo({ tipo: "listo", cruce }); },
      (e) => { if (id === cruceRef.current) setCatalogo({ tipo: "error", mensaje: mensajeErrorPlan(e) }); },
    );
  };

  const onAlta = async (accion: "pedir" | "cancelar" | "confirmar", imp: ImportacionPlan) => {
    if (accion === "pedir") { setAlta({ tipo: "confirmar" }); return; }
    if (accion === "cancelar") { setAlta({ tipo: "nada" }); return; }
    if (catalogo.tipo !== "listo") return;
    const faltantes = catalogo.cruce.faltantes;
    setAlta({ tipo: "subiendo", hechas: 0, total: faltantes.length });
    try {
      const n = await altaEnCatalogo(faltantes, (hechas, total) => setAlta({ tipo: "subiendo", hechas, total }));
      setAlta({ tipo: "hecho", cantidad: n });
      cruzar(imp);
    } catch (e) {
      setAlta({ tipo: "error", mensaje: mensajeErrorPlan(e) });
    }
  };

  // A mitad de la subida no se cierra: importarPlan deshace la versión nueva
  // si falla, pero solo si la promesa sigue viva para atrapar el error.
  const puedeCerrar = paso.tipo !== "subiendo" && alta.tipo !== "subiendo";
  const cerrarSiSePuede = () => { if (puedeCerrar) onClose(); };

  useEffect(() => {
    if (!puedeCerrar) return;
    // `defaultPrevented`: un desplegable de Radix abierto adentro ya consumió
    // ese Esc (mismo criterio que useEscape de ido-kit, que no se exporta).
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [puedeCerrar, onClose]);

  const volverAElegir = () => {
    lecturaRef.current++;
    cruceRef.current++;
    setArrastrando(false);
    setPaso({ tipo: "elegir", error: null });
  };

  const leer = async (file: File) => {
    if (!esExcel(file.name)) {
      setPaso({ tipo: "elegir", error: `«${file.name}» no es un Excel: tiene que ser .xlsx o .xlsm.` });
      return;
    }
    const id = ++lecturaRef.current;
    setPaso({ tipo: "leyendo", archivo: file.name });
    try {
      const imp = await leerExcelPlan(file);
      if (id === lecturaRef.current) {
        setAnioTxt(String(imp.anio));
        setAlta({ tipo: "nada" });
        setPaso({ tipo: "revisar", imp });
        cruzar(imp);
      }
    } catch (e) {
      if (id === lecturaRef.current) setPaso({ tipo: "error", origen: "lectura", mensaje: mensajeLectura(e), version: esErrorDeVersion(e) });
    }
  };

  const importar = async (leida: ImportacionPlan, anio: number) => {
    // El año pudo corregirse en la revisión: el nombre se arma con el elegido.
    const imp: ImportacionPlan = { ...leida, anio, nombre: nombrePlan(anio) };
    cruceRef.current++;
    setPaso({ tipo: "subiendo", progreso: { fase: "preparando", hechos: 0, total: imp.items.length } });
    try {
      const plan = await importarPlan(imp, (progreso) => setPaso({ tipo: "subiendo", progreso }));
      onImportado(plan, imp);
    } catch (e) {
      setPaso({ tipo: "error", origen: "subida", mensaje: mensajeErrorPlan(e) });
    }
  };

  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setArrastrando(false);
    const f = e.dataTransfer.files[0];
    if (f) void leer(f);
  };

  // ── Cuerpo según el paso ───────────────────────────────────────────────────
  let cuerpo: ReactNode;
  let pie: ReactNode;

  const btnCancelar = (
    <button type="button" className="ido-btn ido-btn-text" style={{ height: 38 }} onClick={onClose}>
      Cancelar
    </button>
  );

  if (paso.tipo === "elegir") {
    cuerpo = (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            setArrastrando(true);
          }}
          onDragLeave={(e) => {
            // dragleave también salta al pasar sobre un hijo: solo cuenta si
            // el puntero salió de la zona.
            if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setArrastrando(false);
          }}
          onDrop={onDrop}
          className="flex flex-col items-center justify-center gap-3 w-full cursor-pointer"
          style={{
            padding: "32px 16px", borderRadius: 12,
            border: `1px dashed ${arrastrando ? "var(--ido-accent)" : "var(--ido-border-strong)"}`,
            background: arrastrando ? "rgba(63,207,142,.04)" : "transparent",
            transition: "border-color 120ms var(--ido-ease), background 120ms var(--ido-ease)",
          }}
        >
          <span
            className="grid place-items-center"
            style={{ width: 40, height: 40, borderRadius: 999, background: "var(--ido-elevated)", color: "var(--ido-text-2)" }}
          >
            <UploadCloud className="w-5 h-5" />
          </span>
          <span className="flex flex-col items-center gap-1">
            <span style={{ fontSize: 13, color: "var(--ido-text)" }}>Soltá el archivo acá</span>
            <span style={{ fontSize: 12, color: "var(--ido-text-2)" }}>o hacé clic para elegirlo · .xlsx / .xlsm</span>
          </span>
        </button>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ido-text-2)" }}>
          Subí el Excel del plan (PC_ANUAL_GD). Se leen las pestañas{" "}
          <span style={{ color: "var(--ido-accent)" }}>Global</span>,{" "}
          <span style={{ color: "var(--ido-accent)" }}>Prioridad</span> y{" "}
          <span style={{ color: "var(--ido-accent)" }}>Resumen</span>; las columnas fórmula se{" "}
          <span style={{ color: "var(--ido-accent)" }}>recalculan</span> y se comparan contra los valores del archivo.
        </p>
        {paso.error && <p style={{ fontSize: 12, color: "var(--ido-error)" }}>{paso.error}</p>}
      </div>
    );
    pie = btnCancelar;
  } else if (paso.tipo === "leyendo") {
    cuerpo = (
      <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ padding: "32px 0" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--ido-text-2)" }} />
        <p style={{ fontSize: 13, color: "var(--ido-text-2)" }}>
          Leyendo «<span style={{ color: "var(--ido-text)" }}>{paso.archivo}</span>»… puede tardar unos segundos
        </p>
      </div>
    );
    pie = btnCancelar;
  } else if (paso.tipo === "revisar") {
    const imp = paso.imp;
    const limpio = imp.verificacion.diferencias === 0 && imp.verificacion.familias.every((f) => f.ok);
    const anio = anioValido(anioTxt);
    cuerpo = (
      <Revision
        imp={imp}
        anioTxt={anioTxt}
        onAnio={setAnioTxt}
        planes={planes}
        catalogo={catalogo}
        alta={alta}
        onAlta={(a) => void onAlta(a, imp)}
        onReintentarCatalogo={() => cruzar(imp)}
      />
    );
    pie = (
      <>
        <button type="button" className="ido-btn ido-btn-text" style={{ height: 38, marginRight: "auto" }} onClick={volverAElegir}>
          Elegir otro archivo
        </button>
        {btnCancelar}
        <button
          type="button"
          className="ido-btn ido-btn-primary"
          style={{ height: 38 }}
          disabled={anio == null || alta.tipo === "subiendo"}
          title={anio == null ? "Falta el año del plan" : alta.tipo === "subiendo" ? "Esperá a que termine el alta en el catálogo" : undefined}
          onClick={() => { if (anio != null) void importar(imp, anio); }}
        >
          {limpio ? `Importar ${nro(imp.items.length)} filas` : "Importar igual"}
        </button>
      </>
    );
  } else if (paso.tipo === "subiendo") {
    const p = paso.progreso;
    cuerpo = (
      <div className="flex flex-col gap-3" style={{ padding: "16px 0" }}>
        <div style={{ width: "100%", height: 4, borderRadius: 999, background: "var(--ido-elevated)", overflow: "hidden" }}>
          <div
            style={{
              width: `${porcentaje(p)}%`, height: "100%", borderRadius: 999, background: "var(--ido-accent)",
              transition: "width 200ms var(--ido-ease)",
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="tabular-nums" style={{ fontSize: 13, color: "var(--ido-text)" }}>{textoFase(p)}</span>
          <span style={{ fontSize: 12, color: "var(--ido-text-dim)" }}>No cierres la pestaña hasta que termine.</span>
        </div>
      </div>
    );
    pie = (
      <button type="button" className="ido-btn ido-btn-primary" style={{ height: 38 }} disabled>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Importando…
      </button>
    );
  } else {
    cuerpo = (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="grid place-items-center shrink-0"
            style={{ width: 34, height: 34, borderRadius: 999, background: "rgba(229,72,77,.12)", color: "var(--ido-error)" }}
          >
            <AlertTriangle className="w-4 h-4" />
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ido-text)" }}>
            {paso.version ? "Hay una versión nueva de la app"
              : paso.origen === "lectura" ? "No se pudo leer el archivo" : "No se pudo importar el plan"}
          </span>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ido-text-2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {paso.mensaje}
        </p>
        {paso.origen === "subida" && (
          // importarPlan borra la versión a medio cargar antes de relanzar el error.
          <p style={{ fontSize: 13, color: "var(--ido-text-dim)" }}>
            No se guardó nada: si había un plan cargado, sigue como estaba.
          </p>
        )}
      </div>
    );
    pie = (
      <>
        <button type="button" className="ido-btn ido-btn-text" style={{ height: 38 }} onClick={onClose}>
          Cerrar
        </button>
        {paso.version ? (
          // Elegir otro archivo fallaría igual: el código viejo queda cacheado
          // hasta recargar.
          <button type="button" className="ido-btn ido-btn-primary" style={{ height: 38 }} onClick={recargarPagina}>
            Recargar página
          </button>
        ) : (
          <button type="button" className="ido-btn ido-btn-primary" style={{ height: 38 }} onClick={volverAElegir}>
            Elegir otro archivo
          </button>
        )}
      </>
    );
  }

  return createPortal(
    <div
      className="ido-terminal ido-modal-overlay"
      onClick={cerrarSiSePuede}
      // Un archivo soltado fuera de la zona haría que el navegador lo abra (y
      // se pierda la pantalla): el overlay lo absorbe sin hacer nada.
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "none"; }}
      onDrop={(e) => e.preventDefault()}
    >
      <div
        className="ido-modal flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        style={{ maxWidth: 640, maxHeight: "calc(100dvh - 32px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ido-modal-head shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileSpreadsheet className="w-4 h-4 shrink-0" style={{ color: "var(--ido-text-dim)" }} />
            <span id={tituloId} className="ido-modal-title truncate">Importar Excel del plan</span>
          </div>
          <button
            type="button"
            className="ido-icon-btn"
            onClick={cerrarSiSePuede}
            disabled={!puedeCerrar}
            title={puedeCerrar ? "Cerrar" : "Esperá a que termine la importación"}
            style={puedeCerrar ? undefined : { opacity: 0.45, cursor: "not-allowed" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: 20 }}>
          {cuerpo}
        </div>

        <div className="ido-modal-foot shrink-0">{pie}</div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Se limpia para que volver a elegir el mismo archivo dispare onChange.
            e.target.value = "";
            if (f) void leer(f);
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
