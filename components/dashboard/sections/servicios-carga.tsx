"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Zap,
  User,
  MapPin,
  Hash,
  RefreshCw,
  FileSpreadsheet,
  X,
} from "lucide-react";

type FormData = {
  nroServicio: string;
  cliente: string;
  dni: string;
  direccion: string;
  zona: string;
  tipo: string;
  medidor: string;
  lecturaActual: string;
  estado: string;
  observaciones: string;
};

const initialForm: FormData = {
  nroServicio: "",
  cliente: "",
  dni: "",
  direccion: "",
  zona: "",
  tipo: "",
  medidor: "",
  lecturaActual: "",
  estado: "",
  observaciones: "",
};

type Status = "idle" | "loading" | "success" | "error";

export function ServiciosCargaSection() {
  const [form, setForm] = useState<FormData>(initialForm);
  const [status, setStatus] = useState<Status>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    await new Promise((r) => setTimeout(r, 1200));
    // Simulated success
    setStatus("success");
    setTimeout(() => {
      setStatus("idle");
      setForm(initialForm);
    }, 3000);
  };

  const handleReset = () => {
    setForm(initialForm);
    setStatus("idle");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) setUploadedFile(file.name);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Registrá un nuevo servicio o actualizá datos existentes
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulario manual */}
        <div className="lg:col-span-2">
          <div className="bg-card border border-border rounded-xl p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <Zap className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">Carga manual de servicio</h3>
                <p className="text-xs text-muted-foreground">Completá todos los campos requeridos</p>
              </div>
            </div>

            {status === "success" && (
              <div className="flex items-center gap-2 text-sm text-success bg-success/10 border border-success/20 rounded-lg px-4 py-3 mb-5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Servicio cargado correctamente
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Fila 1 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                    Nº de Servicio <span className="text-destructive">*</span>
                  </label>
                  <input
                    name="nroServicio"
                    value={form.nroServicio}
                    onChange={handleChange}
                    placeholder="Ej: SV-001244"
                    required
                    className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                    Nº de Medidor <span className="text-destructive">*</span>
                  </label>
                  <input
                    name="medidor"
                    value={form.medidor}
                    onChange={handleChange}
                    placeholder="Ej: MED-4531"
                    required
                    className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
                  />
                </div>
              </div>

              {/* Fila 2 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    Cliente <span className="text-destructive">*</span>
                  </label>
                  <input
                    name="cliente"
                    value={form.cliente}
                    onChange={handleChange}
                    placeholder="Apellido, Nombre / Razón social"
                    required
                    className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                    DNI / CUIT
                  </label>
                  <input
                    name="dni"
                    value={form.dni}
                    onChange={handleChange}
                    placeholder="Ej: 30-12345678-9"
                    className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
                  />
                </div>
              </div>

              {/* Fila 3 */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                  Dirección del servicio <span className="text-destructive">*</span>
                </label>
                <input
                  name="direccion"
                  value={form.direccion}
                  onChange={handleChange}
                  placeholder="Calle, número, ciudad"
                  required
                  className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
                />
              </div>

              {/* Fila 4 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Zona <span className="text-destructive">*</span></label>
                  <select
                    name="zona"
                    value={form.zona}
                    onChange={handleChange}
                    required
                    className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200 appearance-none cursor-pointer"
                  >
                    <option value="">Seleccioná</option>
                    <option>Norte</option>
                    <option>Sur</option>
                    <option>Este</option>
                    <option>Oeste</option>
                    <option>Centro</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Tipo <span className="text-destructive">*</span></label>
                  <select
                    name="tipo"
                    value={form.tipo}
                    onChange={handleChange}
                    required
                    className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200 appearance-none cursor-pointer"
                  >
                    <option value="">Seleccioná</option>
                    <option>Residencial</option>
                    <option>Comercial</option>
                    <option>Industrial</option>
                    <option>Alumbrado Público</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Estado <span className="text-destructive">*</span></label>
                  <select
                    name="estado"
                    value={form.estado}
                    onChange={handleChange}
                    required
                    className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200 appearance-none cursor-pointer"
                  >
                    <option value="">Seleccioná</option>
                    <option value="activo">Activo</option>
                    <option value="cortado">Cortado</option>
                    <option value="pendiente">Pendiente</option>
                    <option value="falla">Falla</option>
                  </select>
                </div>
              </div>

              {/* Lectura */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Lectura actual (kWh)</label>
                <input
                  name="lecturaActual"
                  type="number"
                  min="0"
                  value={form.lecturaActual}
                  onChange={handleChange}
                  placeholder="Ej: 12540"
                  className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
                />
              </div>

              {/* Observaciones */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Observaciones</label>
                <textarea
                  name="observaciones"
                  value={form.observaciones}
                  onChange={handleChange}
                  placeholder="Notas adicionales sobre el servicio..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200 resize-none"
                />
              </div>

              {/* Acciones */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
                >
                  <X className="w-4 h-4" />
                  Limpiar
                </button>
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {status === "loading" ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Guardar servicio
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Panel derecho: carga masiva */}
        <div className="space-y-4">
          {/* Drag & drop */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              "bg-card border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300 animate-in fade-in slide-in-from-right-4 duration-500 cursor-pointer",
              dragOver
                ? "border-accent bg-accent/5"
                : "border-border hover:border-accent/50 hover:bg-secondary/30"
            )}
          >
            <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mx-auto mb-3">
              <UploadCloud className={cn("w-6 h-6 transition-colors", dragOver ? "text-accent" : "text-muted-foreground")} />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              Carga masiva por archivo
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Arrastrá un archivo CSV o Excel aquí
            </p>
            <label className="cursor-pointer">
              <span className="px-3 py-1.5 rounded-lg bg-secondary text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-200">
                Seleccionar archivo
              </span>
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setUploadedFile(f.name);
              }} />
            </label>

            {uploadedFile && (
              <div className="mt-4 flex items-center gap-2 bg-accent/10 border border-accent/20 rounded-lg px-3 py-2">
                <FileSpreadsheet className="w-4 h-4 text-accent shrink-0" />
                <span className="text-xs text-foreground truncate">{uploadedFile}</span>
                <button
                  onClick={() => setUploadedFile(null)}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Info / template */}
          <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-right-4 duration-500 delay-100">
            <h4 className="text-sm font-semibold text-foreground mb-3">Formato requerido</h4>
            <div className="space-y-2">
              {[
                "nro_servicio",
                "cliente",
                "direccion",
                "zona",
                "tipo",
                "estado",
                "medidor",
                "lectura_actual",
              ].map((col) => (
                <div key={col} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  <span className="text-xs font-mono text-muted-foreground">{col}</span>
                </div>
              ))}
            </div>
            <button className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-secondary text-xs text-muted-foreground hover:text-foreground transition-colors duration-200">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Descargar plantilla
            </button>
          </div>

          {/* Nota */}
          <div className="flex items-start gap-2.5 bg-warning/10 border border-warning/20 rounded-xl p-4 animate-in fade-in slide-in-from-right-4 duration-500 delay-200">
            <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Los datos ingresados serán validados antes de procesarse. Servicios con errores se indicarán al finalizar.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
