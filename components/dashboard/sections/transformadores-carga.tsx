"use client";

import React, { useState } from "react";
import { UploadCloud, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export function TransformadoresCargaSection() {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      toast.success(`Archivo ${files[0].name} recibido`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4">
        {/* Upload Area */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            isDragging
              ? "border-accent bg-accent/5"
              : "border-border hover:border-accent/50"
          }`}
        >
          <UploadCloud className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-semibold mb-2">Cargar archivo de transformadores</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Arrastra un archivo CSV o haz clic para seleccionar
          </p>
          <input type="file" className="hidden" accept=".csv,.xlsx" />
        </div>

        {/* Info Box */}
        <div className="bg-blue-50/50 border border-blue-200 rounded-lg p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-900">Formato esperado</p>
            <p className="text-sm text-blue-800 mt-1">
              El archivo debe contener columnas para KVA, Nuevos, Reparados, etc.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
