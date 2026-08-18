"use client";

import type { DetalleEntregas } from "@/lib/busqueda";
import { fmtFechaISO } from "@/lib/busqueda";

// ─── Detalle de entregas (contenido de una fila desplegada) ─────────────────
// Compartido entre el Buscador y Control de Servicios: dos listas
// enfrentadas, lo COMPROMETIDO (envíos de la planilla OP, cada uno con su
// fecha pactada) contra lo ENTREGADO realmente (movimientos 'Entregar').
//
// ⚠ El grano no es el mismo de los dos lados y es a propósito: los envíos se
//   abren uno por uno, pero las transacciones no tienen dimensión de envío, así
//   que las entregas son de la LÍNEA completa. Por eso no se intenta parear
//   cada entrega con su envío — eso sería inventar una correspondencia que el
//   dato no tiene. Se comparan los totales, que es lo que sí es cierto.

export function DetalleEntregasFila({ detalle, indent = 62 }: { detalle: DetalleEntregas; indent?: number }) {
  const { envios, entregas, totales } = detalle;
  const falta = totales.comprometido - totales.entregado;

  // Semáforo sobre el total de la línea: completo / parcial / sin entregas.
  const tono =
    totales.comprometido > 0 && totales.entregado >= totales.comprometido ? "#86efac"
    : totales.entregado > 0                                              ? "#fcd34d"
    : "#fca5a5";

  const num = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

  return (
    <div style={{ padding: `12px 16px 14px ${indent}px`, background: "oklch(0.185 0.005 270)" }}>
      {/* Resumen arriba: la comparación que da sentido a todo lo de abajo. */}
      <div className="flex items-center gap-4 flex-wrap mb-3 text-[12px]">
        <span style={{ color: "oklch(0.6 0 0)" }}>
          Entregado <span style={{ color: tono, fontWeight: 600 }}>{num(totales.entregado)}</span>
          {totales.comprometido > 0 && <> de <span style={{ color: "oklch(0.85 0 0)" }}>{num(totales.comprometido)}</span></>}
        </span>
        {falta > 0 && totales.comprometido > 0 && (
          <span style={{ color: "#fcd34d" }}>Faltan {num(falta)}</span>
        )}
        <span style={{ color: "oklch(0.5 0 0)" }}>
          {totales.n_entregas} entrega{totales.n_entregas === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        {/* Comprometido */}
        <div>
          <p className="text-[10.5px] uppercase tracking-wide mb-1.5" style={{ color: "oklch(0.5 0 0)" }}>
            Comprometido — envíos de la OP
          </p>
          {envios.length === 0 ? (
            <p className="text-[12px]" style={{ color: "oklch(0.42 0 0)" }}>Sin envíos en la planilla.</p>
          ) : (
            <ul className="space-y-1">
              {envios.map((e, i) => (
                <li key={`${e.envio}-${i}`} className="flex items-center gap-2 text-[12px]">
                  <span style={{ color: "oklch(0.5 0 0)", minWidth: 52 }}>Envío {e.envio ?? "—"}</span>
                  <span style={{ color: "oklch(0.85 0 0)", fontVariantNumeric: "tabular-nums" }}>
                    {e.cantidad != null ? num(Number(e.cantidad)) : "—"}
                  </span>
                  <span style={{ color: "oklch(0.55 0 0)", fontFamily: "ui-monospace, monospace" }}>
                    {fmtFechaISO(e.fecha_pactada)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Entregado */}
        <div>
          <p className="text-[10.5px] uppercase tracking-wide mb-1.5" style={{ color: "oklch(0.5 0 0)" }}>
            Entregado — movimientos reales
          </p>
          {entregas.length === 0 ? (
            <p className="text-[12px]" style={{ color: "oklch(0.42 0 0)" }}>Sin entregas registradas.</p>
          ) : (
            <ul className="space-y-1">
              {entregas.map((e, i) => (
                <li key={`${e.fecha}-${i}`} className="flex items-center gap-2 text-[12px]">
                  <span style={{ color: "oklch(0.55 0 0)", fontFamily: "ui-monospace, monospace", minWidth: 78 }}>
                    {fmtFechaISO(e.fecha)}
                  </span>
                  <span style={{ color: "#86efac", fontVariantNumeric: "tabular-nums" }}>
                    {num(Number(e.importe))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
