"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Search,
  Filter,
  ArrowUpDown,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  MoreHorizontal,
  ChevronDown,
  Zap,
} from "lucide-react";

interface Servicio {
  id: string;
  nroServicio: string;
  cliente: string;
  direccion: string;
  zona: string;
  tipo: string;
  estado: "activo" | "cortado" | "pendiente" | "falla";
  medidor: string;
  ultimaLectura: string;
  consumo: number;
}

const servicios: Servicio[] = [
  { id: "1", nroServicio: "SV-001234", cliente: "García, Juan Carlos", direccion: "Av. Colón 1234", zona: "Centro", tipo: "Residencial", estado: "activo", medidor: "MED-4521", ultimaLectura: "05/04/2026", consumo: 245 },
  { id: "2", nroServicio: "SV-001235", cliente: "López, María E.", direccion: "Bv. San Juan 567", zona: "Norte", tipo: "Comercial", estado: "activo", medidor: "MED-4522", ultimaLectura: "05/04/2026", consumo: 1820 },
  { id: "3", nroServicio: "SV-001236", cliente: "Fernández, Roberto", direccion: "Calle Lima 890", zona: "Sur", tipo: "Residencial", estado: "cortado", medidor: "MED-4523", ultimaLectura: "01/03/2026", consumo: 0 },
  { id: "4", nroServicio: "SV-001237", cliente: "Martínez Hnos. S.R.L.", direccion: "Av. Vélez 2310", zona: "Este", tipo: "Industrial", estado: "activo", medidor: "MED-4524", ultimaLectura: "05/04/2026", consumo: 8540 },
  { id: "5", nroServicio: "SV-001238", cliente: "Romero, Ana Paula", direccion: "Calle Rivadavia 45", zona: "Oeste", tipo: "Residencial", estado: "pendiente", medidor: "MED-4525", ultimaLectura: "—", consumo: 0 },
  { id: "6", nroServicio: "SV-001239", cliente: "Torres, Diego M.", direccion: "Calle Deán Funes 321", zona: "Centro", tipo: "Residencial", estado: "activo", medidor: "MED-4526", ultimaLectura: "04/04/2026", consumo: 187 },
  { id: "7", nroServicio: "SV-001240", cliente: "Supermercado El Sol S.A.", direccion: "Av. Maipú 789", zona: "Norte", tipo: "Comercial", estado: "falla", medidor: "MED-4527", ultimaLectura: "02/04/2026", consumo: 0 },
  { id: "8", nroServicio: "SV-001241", cliente: "Pérez, Lucía G.", direccion: "Bv. Chacabuco 1100", zona: "Sur", tipo: "Residencial", estado: "activo", medidor: "MED-4528", ultimaLectura: "05/04/2026", consumo: 312 },
  { id: "9", nroServicio: "SV-001242", cliente: "Industrias Córdoba S.A.", direccion: "Ruta 9 km 15", zona: "Este", tipo: "Industrial", estado: "activo", medidor: "MED-4529", ultimaLectura: "05/04/2026", consumo: 15200 },
  { id: "10", nroServicio: "SV-001243", cliente: "González, Marcela S.", direccion: "Calle Güemes 555", zona: "Oeste", tipo: "Residencial", estado: "cortado", medidor: "MED-4530", ultimaLectura: "10/02/2026", consumo: 0 },
];

const estadoConfig = {
  activo: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10", label: "Activo" },
  cortado: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", label: "Cortado" },
  pendiente: { icon: Clock, color: "text-warning", bg: "bg-warning/10", label: "Pendiente" },
  falla: { icon: AlertTriangle, color: "text-chart-3", bg: "bg-chart-3/10", label: "Falla" },
};

const zonas = ["Norte", "Sur", "Este", "Oeste", "Centro"];

export function ServiciosTablaSection() {
  const [search, setSearch] = useState("");
  const [estadoFilter, setEstadoFilter] = useState<string>("all");
  const [zonaFilter, setZonaFilter] = useState<string>("all");

  const filtered = servicios.filter((s) => {
    const matchSearch =
      s.cliente.toLowerCase().includes(search.toLowerCase()) ||
      s.nroServicio.toLowerCase().includes(search.toLowerCase()) ||
      s.direccion.toLowerCase().includes(search.toLowerCase());
    const matchEstado = estadoFilter === "all" || s.estado === estadoFilter;
    const matchZona = zonaFilter === "all" || s.zona === zonaFilter;
    return matchSearch && matchEstado && matchZona;
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Listado completo de servicios registrados
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Búsqueda */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar servicio, cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64 h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
            />
          </div>

          {/* Estado filter */}
          <div className="flex items-center gap-2">
            {["all", "activo", "cortado", "pendiente", "falla"].map((f) => (
              <button
                key={f}
                onClick={() => setEstadoFilter(f)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                  estadoFilter === f
                    ? "bg-accent text-accent-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "all" ? "Todos" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Zona filter */}
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <select
            value={zonaFilter}
            onChange={(e) => setZonaFilter(e.target.value)}
            className="h-9 pl-9 pr-8 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent appearance-none cursor-pointer transition-all duration-200"
          >
            <option value="all">Todas las zonas</option>
            {zonas.map((z) => (
              <option key={z} value={z}>
                Zona {z}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                    Nº Servicio
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cliente</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dirección</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Zona</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tipo</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estado</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                    Consumo (kWh)
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Últ. Lectura</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const cfg = estadoConfig[s.estado];
                const StatusIcon = cfg.icon;

                return (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors duration-150 cursor-pointer animate-in fade-in slide-in-from-left-2"
                    style={{ animationDelay: `${i * 40}ms`, animationFillMode: "both" }}
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-accent shrink-0" />
                        <span className="text-sm font-mono text-foreground">{s.nroServicio}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-sm text-foreground">{s.cliente}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-sm text-muted-foreground">{s.direccion}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-1 rounded-md bg-secondary text-xs font-medium text-foreground">
                        {s.zona}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-sm text-muted-foreground">{s.tipo}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium", cfg.bg, cfg.color)}>
                        <StatusIcon className="w-3 h-3" />
                        {cfg.label}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-sm font-semibold text-foreground">
                        {s.consumo > 0 ? s.consumo.toLocaleString() : "—"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-sm text-muted-foreground">{s.ultimaLectura}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <button className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200">
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                    No se encontraron servicios
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
          <span className="text-sm text-muted-foreground">
            Mostrando {filtered.length} de {servicios.length} servicios
          </span>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-200">
              Anterior
            </button>
            <button className="px-3 py-1.5 rounded-lg text-sm bg-accent text-accent-foreground font-medium">
              1
            </button>
            <button className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-200">
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
