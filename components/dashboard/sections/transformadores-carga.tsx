"use client";

import React, { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  UploadCloud, X, ImagePlus, Loader2, CheckCircle2, FileImage,
} from "lucide-react";

interface TransformadorRow {
  id:         string;
  numero:     string;
  tipo:       string;
  potencia:   string;
  tension:    string;
  estado:     string;
  ubicacion:  string;
  imagen_url: string | null;
}

export function TransformadoresCargaSection() {
  const [form, setForm] = useState<Omit<TransformadorRow, "id" | "imagen_url">>({
    numero:   "",
    tipo:     "",
    potencia: "",
    tension:  "",
    estado:   "Disponible",
    ubicacion:"",
  });
  const [imageFile, setImageFile]   = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving]         = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Solo se permiten imágenes");
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.numero.trim()) { toast.error("El número de transformador es requerido"); return; }
    setSaving(true);
    try {
      let imagen_url: string | null = null;

      if (imageFile) {
        const ext = imageFile.name.split(".").pop();
        const path = `transformadores/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("imagenes")
          .upload(path, imageFile, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("imagenes").getPublicUrl(path);
        imagen_url = urlData.publicUrl;
      }

      const { error } = await supabase
        .from("transformadores")
        .insert([{ ...form, imagen_url }]);
      if (error) throw error;

      toast.success("Transformador registrado correctamente");
      setForm({ numero: "", tipo: "", potencia: "", tension: "", estado: "Disponible", ubicacion: "" });
      clearImage();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-6">Registrar transformador</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Imagen */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Imagen del transformador
            </label>
            {imagePreview ? (
              <div className="relative w-full h-52 rounded-lg overflow-hidden border border-border bg-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Preview" className="w-full h-full object-contain" />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-background/80 border border-border flex items-center justify-center hover:bg-secondary transition-colors"
                >
                  <X className="w-4 h-4 text-foreground" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-40 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-accent hover:text-accent transition-colors"
              >
                <ImagePlus className="w-8 h-8" />
                <span className="text-sm">Haz clic para subir una imagen</span>
                <span className="text-xs">PNG, JPG, WEBP</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />
          </div>

          {/* Fields grid */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Número / ID" required>
              <input
                type="text"
                value={form.numero}
                onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
                placeholder="Ej: TR-0042"
                className={inputCls}
              />
            </Field>

            <Field label="Tipo">
              <input
                type="text"
                value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                placeholder="Ej: Monofásico"
                className={inputCls}
              />
            </Field>

            <Field label="Potencia (kVA)">
              <input
                type="text"
                value={form.potencia}
                onChange={e => setForm(f => ({ ...f, potencia: e.target.value }))}
                placeholder="Ej: 250"
                className={inputCls}
              />
            </Field>

            <Field label="Tensión (kV)">
              <input
                type="text"
                value={form.tension}
                onChange={e => setForm(f => ({ ...f, tension: e.target.value }))}
                placeholder="Ej: 13.2/0.4"
                className={inputCls}
              />
            </Field>

            <Field label="Estado">
              <select
                value={form.estado}
                onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}
                className={inputCls}
              >
                <option>Disponible</option>
                <option>En servicio</option>
                <option>En reparación</option>
                <option>Baja</option>
              </select>
            </Field>

            <Field label="Ubicación">
              <input
                type="text"
                value={form.ubicacion}
                onChange={e => setForm(f => ({ ...f, ubicacion: e.target.value }))}
                placeholder="Ej: Depósito A — Estante 3"
                className={inputCls}
              />
            </Field>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</>
            ) : (
              <><CheckCircle2 className="w-4 h-4" /> Registrar transformador</>
            )}
          </button>
        </form>
      </div>

      {/* Hint card */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/10 border border-accent/20 text-sm text-muted-foreground">
        <FileImage className="w-5 h-5 shrink-0 text-accent mt-0.5" />
        <p>
          La imagen se sube al storage de Supabase. Si no existe el bucket <code className="text-xs bg-secondary px-1 rounded">imagenes</code>, créalo desde el panel de Supabase antes de subir archivos.
        </p>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "h-9 w-full rounded-lg bg-secondary border border-border px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all";
