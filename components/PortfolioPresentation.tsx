"use client";

import React, { useRef } from "react";
import { Download } from "lucide-react";

export function PortfolioPresentation() {
  const contentRef = useRef<HTMLDivElement>(null);

  const handleExportPDF = async () => {
    const html2pdf = (await import("html2pdf.js")).default;
    const element = contentRef.current;
    if (!element) return;

    const opt = {
      margin: [10, 10, 10, 10],
      filename: "Gerencia-Distribucion-SaaS-Portfolio.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { orientation: "portrait", unit: "mm", format: "a4" },
    };

    html2pdf().set(opt).from(element).save();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl font-bold text-white">Portfolio Presentation</h1>
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent/90 text-white rounded-lg font-medium transition-colors"
          >
            <Download className="w-5 h-5" />
            Descargar PDF
          </button>
        </div>

        <div
          ref={contentRef}
          className="bg-white text-slate-900 rounded-xl shadow-2xl overflow-hidden"
          style={{ padding: "40px" }}
        >
          {/* PAGE 1: COVER */}
          <div style={{ pageBreakAfter: "always", paddingBottom: "60px" }}>
            <div style={{ textAlign: "center", marginBottom: "60px" }}>
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
          </div>

          {/* PAGE 2: OVERVIEW */}
          <div style={{ pageBreakAfter: "always", paddingBottom: "60px" }}>
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
          <div style={{ pageBreakAfter: "always", paddingBottom: "60px" }}>
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

            <div>
              <h3 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "15px", color: "#2c3e50" }}>
                Herramientas & Librerías
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", fontSize: "14px" }}>
                <div style={{ padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "5px" }}>
                  <strong>Sonner</strong> - Toast Notifications
                </div>
                <div style={{ padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "5px" }}>
                  <strong>Git & GitHub</strong> - Version Control
                </div>
              </div>
            </div>
          </div>

          {/* PAGE 4: FEATURES */}
          <div style={{ pageBreakAfter: "always", paddingBottom: "60px" }}>
            <h2 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px", color: "#1a5490" }}>
              ⚡ Features Principales
            </h2>

            <div style={{ marginBottom: "25px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "10px", color: "#2c3e50" }}>
                1. Carga de Datos
              </h3>
              <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.6" }}>
                Sistema automatizado que permite cargar planillas en Excel. Los datos se extraen automáticamente usando
                SheetJS y se poblan en formularios interactivos. Soporta 4 tablas: Nuevos y Reparados por Terceros,
                Reparados por Taller, Autorizados Pendiente de Retiro, y Relación 33/0.4kV.
              </p>
            </div>

            <div style={{ marginBottom: "25px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "10px", color: "#2c3e50" }}>
                2. Tabla Interactiva
              </h3>
              <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.6" }}>
                Visualización de todas las planillas guardadas semanalmente. Permite expandir cada registro para ver los
                datos en forma de tablas con estructura similar a Excel. Búsqueda y filtrado por fecha.
              </p>
            </div>

            <div style={{ marginBottom: "25px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "10px", color: "#2c3e50" }}>
                3. Dashboard Resumen
              </h3>
              <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.6" }}>
                KPI Dashboard con 5 tarjetas de métricas clave (Total, Disponibles, En Servicio, En Reparación, Bajas).
                Incluye gráficos de distribución por tipo, ubicación y registro de últimas planillas.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "10px", color: "#2c3e50" }}>
                4. Validación & Persistencia
              </h3>
              <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.6" }}>
                Cálculo automático de totales, validación de datos, y almacenamiento en Supabase. Cada planilla se guarda
                con fecha semanal para seguimiento histórico.
              </p>
            </div>
          </div>

          {/* PAGE 5: ESTRUCTURA */}
          <div style={{ pageBreakAfter: "always", paddingBottom: "60px" }}>
            <h2 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px", color: "#1a5490" }}>
              🏗️ Arquitectura
            </h2>

            <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "15px", color: "#2c3e50" }}>
              Estructura de Directorios
            </h3>
            <div style={{ backgroundColor: "#f5f5f5", padding: "15px", borderRadius: "5px", fontSize: "12px", fontFamily: "monospace", marginBottom: "30px", lineHeight: "1.6" }}>
              src/app/
              ├── page.tsx (Dashboard principal)
              ├── api/
              │   └── analizar-planilla/route.ts (Excel parsing)
              └── components/
                  ├── dashboard/
                  │   ├── sidebar.tsx (Navegación)
                  │   ├── header.tsx (Títulos)
                  │   └── sections/
                  │       ├── transformadores-carga.tsx
                  │       ├── transformadores-tabla.tsx
                  │       └── transformadores-resumen.tsx
            </div>

            <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "15px", color: "#2c3e50" }}>
              Base de Datos
            </h3>
            <p style={{ fontSize: "14px", color: "#666", marginBottom: "10px" }}>
              <strong>Tabla: planillas_reserva</strong>
            </p>
            <div style={{ backgroundColor: "#f5f5f5", padding: "15px", borderRadius: "5px", fontSize: "12px", fontFamily: "monospace", lineHeight: "1.6" }}>
              - id: BIGINT (PK)<br />
              - fecha: DATE<br />
              - datos: JSONB (estructura completa)<br />
              - created_at: TIMESTAMP
            </div>
          </div>

          {/* PAGE 6: FLUJO & USO */}
          <div style={{ pageBreakAfter: "always", paddingBottom: "60px" }}>
            <h2 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px", color: "#1a5490" }}>
              📱 Flujo de Uso
            </h2>

            <div style={{ marginBottom: "30px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "15px", color: "#2c3e50" }}>
                Usuario típico:
              </h3>
              <ol style={{ fontSize: "14px", lineHeight: "1.8", marginLeft: "20px", color: "#333" }}>
                <li>1. Navega a "Stock de Transformadores" → "Carga de Datos"</li>
                <li>2. Arrastra/selecciona archivo Excel con planilla semanal</li>
                <li>3. Sistema extrae datos automáticamente y los carga en formularios</li>
                <li>4. Usuario revisa/edita valores si es necesario</li>
                <li>5. Hace clic en "Guardar" para persistir en Supabase</li>
                <li>6. En "Tabla", ve todas las planillas guardadas semanales</li>
                <li>7. En "Resumen", visualiza KPIs y gráficos de distribución</li>
              </ol>
            </div>

            <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "15px", color: "#2c3e50" }}>
              Mejoras implementadas:
            </h3>
            <ul style={{ fontSize: "14px", lineHeight: "1.8", marginLeft: "20px", color: "#333" }}>
              <li>✓ Botones +/− para editar cantidades rápidamente</li>
              <li>✓ Cálculo automático de totales (T+M, CON TANQUE es subconjunto)</li>
              <li>✓ Tablas expandibles en vista de planillas guardadas</li>
              <li>✓ Búsqueda por fecha</li>
              <li>✓ Colores para diferencias entre terceros/taller</li>
            </ul>
          </div>

          {/* PAGE 7: DATOS & RESULTADOS */}
          <div style={{ pageBreakAfter: "always", paddingBottom: "60px" }}>
            <h2 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px", color: "#1a5490" }}>
              📊 Datos & Resultados
            </h2>

            <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "15px", color: "#2c3e50" }}>
              Estructura de Datos Ejemplo
            </h3>
            <p style={{ fontSize: "14px", color: "#666", marginBottom: "15px" }}>
              Cada planilla contiene información sobre 17 valores de KVA (5 a 1000):
            </p>

            <div style={{ backgroundColor: "#f5f5f5", padding: "15px", borderRadius: "5px", fontSize: "12px", fontFamily: "monospace", marginBottom: "20px", lineHeight: "1.6" }}>
              terceros: {"{5": {"{t: 0, m: 1, ct: 0}"}, "10": {"{t: 32, ...}"}, ...}}<br />
              taller: {"{5": {"{tipo: 'RURAL', t: 0, m: 0, ...}"}, ...}}<br />
              autorizados: {"{5: 0, 10: 32, ...}"}<br />
              rel33: {"{25": {"{tN: 4, mN: 0, tR: 1, mR: 0}"}, ...}}<br />
              obs: "Observaciones de la planilla..."<br />
              pend: "Pendientes a resolver..."
            </div>

            <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "15px", color: "#2c3e50" }}>
              KPI Ejemplo
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", fontSize: "14px" }}>
              <div style={{ padding: "15px", backgroundColor: "#e8f4f8", borderRadius: "5px", borderLeft: "4px solid #1a5490" }}>
                <div style={{ fontWeight: "bold", color: "#1a5490" }}>211</div>
                <div style={{ color: "#666", fontSize: "12px" }}>Total Transformadores</div>
              </div>
              <div style={{ padding: "15px", backgroundColor: "#e8f4f8", borderRadius: "5px", borderLeft: "4px solid #1a5490" }}>
                <div style={{ fontWeight: "bold", color: "#1a5490" }}>211</div>
                <div style={{ color: "#666", fontSize: "12px" }}>Disponibles para Retiro</div>
              </div>
            </div>
          </div>

          {/* PAGE 8: CONCLUSIÓN */}
          <div style={{ pageBreakAfter: "always" }}>
            <h2 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px", color: "#1a5490" }}>
              ✨ Conclusión
            </h2>
            <p style={{ fontSize: "16px", lineHeight: "1.8", marginBottom: "20px", color: "#333" }}>
              Este proyecto demuestra la capacidad de desarrollar sistemas SaaS complejos con:
            </p>
            <ul style={{ fontSize: "14px", lineHeight: "1.8", marginLeft: "20px", color: "#333", marginBottom: "30px" }}>
              <li>✓ Frontend moderno y responsivo (Next.js + React + TypeScript)</li>
              <li>✓ Gestión de datos compleja (múltiples tablas interrelacionadas)</li>
              <li>✓ Integración con APIs externas (Supabase)</li>
              <li>✓ Parsing automático de archivos (Excel)</li>
              <li>✓ Dashboard analítico con KPIs y visualizaciones</li>
              <li>✓ Persistencia de datos históricos</li>
              <li>✓ UX intuitiva y accesible</li>
            </ul>
            <div style={{ borderTop: "2px solid #1a5490", paddingTop: "20px", textAlign: "center" }}>
              <p style={{ fontSize: "14px", color: "#999" }}>
                Proyecto completamente funcional y listo para producción
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
