"use client";

import React, { useRef } from "react";
import { Download } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export function PortfolioPresentation() {
  const contentRef = useRef<HTMLDivElement>(null);

  const handleExportPDF = async () => {
    const element = contentRef.current;
    if (!element) return;

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const imgWidth = pageWidth - 2 * margin;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let y = margin;
      let remainingHeight = imgHeight;

      pdf.addImage(imgData, "PNG", margin, y, imgWidth, imgHeight);

      while (remainingHeight > pageHeight - 2 * margin) {
        remainingHeight -= pageHeight - 2 * margin;
        pdf.addPage();
        y = remainingHeight - imgHeight;
        pdf.addImage(imgData, "PNG", margin, -y, imgWidth, imgHeight);
      }

      pdf.save("Gerencia-Distribucion-SaaS-Portfolio.pdf");
    } catch (error) {
      console.error("Error al generar PDF:", error);
      alert("Error al generar el PDF. Intenta de nuevo.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl font-bold text-white">Portfolio Presentation</h1>
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <Download className="w-5 h-5" />
            Descargar PDF
          </button>
        </div>

        <div
          ref={contentRef}
          className="bg-white text-slate-900 rounded-xl shadow-2xl"
          style={{ padding: "40px" }}
        >
          {/* PAGE 1: COVER */}
          <div style={{ marginBottom: "100px", textAlign: "center" }}>
            <h1 style={{ fontSize: "48px", fontWeight: "bold", marginBottom: "20px", color: "#1a5490" }}>
              Gerencia de Distribución SaaS
            </h1>
            <p style={{ fontSize: "18px", color: "#666", marginBottom: "40px" }}>
              Sistema de gestión de transformadores y reserva de distribución
            </p>
            <div style={{ borderTop: "3px solid #1a5490", width: "200px", margin: "40px auto" }} />
            <p style={{ fontSize: "14px", color: "#999", marginTop: "40px" }}>
              Presentación de Proyecto • 2026
            </p>
          </div>

          {/* PAGE 2: OVERVIEW */}
          <div style={{ marginBottom: "100px" }}>
            <h2 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px", color: "#1a5490" }}>
              📋 Descripción del Proyecto
            </h2>
            <p style={{ fontSize: "14px", lineHeight: "1.8", marginBottom: "20px", color: "#333" }}>
              Sistema web SaaS desarrollado con Next.js 15 y React 19 para la gestión integral de stock de transformadores
              de distribución. Permite a los usuarios registrar, actualizar y analizar información de transformadores
              reparados y nuevos a través de formularios intuitivos y tablas interactivas.
            </p>
            <p style={{ fontSize: "14px", lineHeight: "1.8", marginBottom: "20px", color: "#333" }}>
              <strong>Características principales:</strong>
            </p>
            <ul style={{ fontSize: "14px", lineHeight: "1.8", marginLeft: "20px", color: "#333" }}>
              <li>✓ Carga automática de datos desde archivos Excel</li>
              <li>✓ Formularios con validación en tiempo real</li>
              <li>✓ Tablas interactivas y ordenables</li>
              <li>✓ Dashboard con KPIs y gráficos de distribución</li>
              <li>✓ Almacenamiento persistente en Supabase</li>
              <li>✓ Interfaz responsive y moderna</li>
            </ul>
          </div>

          {/* PAGE 3: TECH STACK */}
          <div style={{ marginBottom: "100px" }}>
            <h2 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px", color: "#1a5490" }}>
              🛠️ Tech Stack
            </h2>

            <div style={{ marginBottom: "30px" }}>
              <h3 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "15px", color: "#2c3e50" }}>
                Frontend
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", fontSize: "14px" }}>
                <div style={{ padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "5px" }}>
                  <strong>Next.js 15</strong> - App Router
                </div>
                <div style={{ padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "5px" }}>
                  <strong>React 19</strong> - UI Components
                </div>
                <div style={{ padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "5px" }}>
                  <strong>TypeScript</strong> - Type Safety
                </div>
                <div style={{ padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "5px" }}>
                  <strong>Tailwind CSS</strong> - Styling
                </div>
              </div>
            </div>

            <div style={{ marginBottom: "30px" }}>
              <h3 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "15px", color: "#2c3e50" }}>
                Backend & Data
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", fontSize: "14px" }}>
                <div style={{ padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "5px" }}>
                  <strong>Supabase</strong> - PostgreSQL
                </div>
                <div style={{ padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "5px" }}>
                  <strong>SheetJS</strong> - Excel Parsing
                </div>
                <div style={{ padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "5px" }}>
                  <strong>Radix UI</strong> - Accessible Components
                </div>
                <div style={{ padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "5px" }}>
                  <strong>Lucide Icons</strong> - Icon Library
                </div>
              </div>
            </div>
          </div>

          {/* PAGE 4: FEATURES */}
          <div style={{ marginBottom: "100px" }}>
            <h2 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px", color: "#1a5490" }}>
              ⚡ Features Principales
            </h2>

            <div style={{ marginBottom: "25px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "10px", color: "#2c3e50" }}>
                1. Carga de Datos
              </h3>
              <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.6" }}>
                Sistema automatizado que permite cargar planillas en Excel. Los datos se extraen automáticamente y se
                poblan en formularios interactivos.
              </p>
            </div>

            <div style={{ marginBottom: "25px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "10px", color: "#2c3e50" }}>
                2. Tabla Interactiva
              </h3>
              <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.6" }}>
                Visualización de todas las planillas guardadas semanalmente con búsqueda y filtrado por fecha.
              </p>
            </div>

            <div style={{ marginBottom: "25px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "10px", color: "#2c3e50" }}>
                3. Dashboard Resumen
              </h3>
              <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.6" }}>
                KPI Dashboard con 5 tarjetas de métricas clave e incluye gráficos de distribución por tipo.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "10px", color: "#2c3e50" }}>
                4. Validación & Persistencia
              </h3>
              <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.6" }}>
                Cálculo automático de totales y almacenamiento en Supabase con seguimiento histórico.
              </p>
            </div>
          </div>

          {/* PAGE 5: CONCLUSIÓN */}
          <div style={{ textAlign: "center", paddingTop: "40px" }}>
            <h2 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px", color: "#1a5490" }}>
              ✨ Conclusión
            </h2>
            <p style={{ fontSize: "16px", lineHeight: "1.8", marginBottom: "20px", color: "#333" }}>
              Sistema SaaS completamente funcional y listo para producción con:
            </p>
            <ul style={{ fontSize: "14px", lineHeight: "1.8", marginLeft: "20px", color: "#333", marginBottom: "30px" }}>
              <li>✓ Frontend moderno y responsivo</li>
              <li>✓ Gestión de datos compleja</li>
              <li>✓ Integración con APIs externas</li>
              <li>✓ Parsing automático de archivos</li>
              <li>✓ Dashboard analítico con KPIs</li>
              <li>✓ UX intuitiva y accesible</li>
            </ul>
            <div style={{ borderTop: "2px solid #1a5490", paddingTop: "20px" }}>
              <p style={{ fontSize: "14px", color: "#999" }}>
                Proyecto 100% funcional • 2026
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
