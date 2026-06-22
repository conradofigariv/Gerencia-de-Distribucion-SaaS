# PRD — Módulo Stock de Transformadores

**Estado:** Activo (en producción) · **Versión:** 1.0 · **Última actualización:** 2026-06-22
**Owner:** Conrado Figari · **Repositorio:** `conradofigariv/Gerencia-de-Distribucion-SaaS`

---

## 1. Resumen ejecutivo

El módulo **Stock de Transformadores** permite a la gerencia de distribución registrar,
consultar y analizar el inventario de transformadores en reserva (nuevos y reparados,
por terceros o por taller propio), su disponibilidad para retiro y su evolución en el
tiempo, reemplazando el seguimiento manual en planillas sueltas por una fuente única,
auditable e históricamente comparable.

Está compuesto por tres secciones del sidebar, que comparten la tabla `planillas_reserva`
de Supabase:

| Sección | Sidebar ID | Rol |
|---|---|---|
| Carga de datos | `transformadores-carga` | Ingreso manual del informe diario/periódico |
| Tabla / Historial | `transformadores-tabla` | Consulta y borrado de informes ya cargados |
| Resumen | `transformadores-resumen` | KPIs, gráficos de evolución y alarmas de stock |

## 2. Problema

- El conteo de transformadores en reserva (por potencia, relación de transformación,
  fases, depósito/zona) se hacía en planillas dispersas, sin trazabilidad ni forma
  rápida de ver tendencias (¿estamos quedando cortos de stock de algún tipo?).
- No había alertas proactivas: el déficit de stock se detectaba recién cuando faltaba
  un transformador para una obra.
- Cargar el mismo informe dos veces (doble clic, recarga accidental) generaba datos
  duplicados sin aviso.

## 3. Objetivos y métricas de éxito

| Objetivo | Métrica |
|---|---|
| Centralizar el registro de stock de reserva | 100% de los informes periódicos cargados vía la app (no más planillas Excel sueltas) |
| Visibilidad de tendencia | Resumen muestra evolución neta mensual/semanal sin trabajo manual |
| Prevenir quiebres de stock | Alarmas configurables por combinación potencia/relación/fases/zona, con notificación visual cuando el stock neto cae bajo el umbral |
| Evitar datos duplicados | 0 informes duplicados por doble clic o reintento de guardado |
| Usable en mobile | Las 3 secciones operables (carga, consulta, lectura de KPIs/gráficos) desde un celular |

## 4. Usuarios

- **Operador de depósito / control de stock:** carga el informe periódico (sección Carga).
- **Gerencia / supervisión:** consulta el Resumen para ver KPIs, tendencias y alarmas;
  decide reposición o redistribución de stock entre zonas.
- **Auditoría interna:** consulta el Historial (Tabla) para revisar informes pasados o
  corregir un error (eliminar un informe mal cargado).

## 5. Alcance

### Incluido
- Carga manual de un informe de reserva por fecha + depósito/zona, con detalle por
  potencia (kVA), origen (terceros/taller), estado (nuevo/reparado), relación de
  transformación (13,2/0,4 kV y 33/0,4 kV) y fases (mono/tri).
- Detección de duplicados exactos y de informes existentes para la misma fecha+zona,
  con diálogo de confirmación para sobreescribir o descartar.
- Historial completo, filtrable por año/mes/fecha exacta, con vista expandida tipo
  reporte y borrado de informes.
- Resumen con:
  - Filtros por año (multi), mes (multi, rango continuo), potencia, relación, fases y zona.
  - 4 KPIs (bruto, autorizados pendientes de retiro, neto, neto por relación) reordenables.
  - Gráfico de variación neta período a período (mensual o semanal según filtro de mes).
  - Gráfico de evolución y de distribución por kVA/zona (bloques existentes).
  - Sistema de alarmas: umbral de stock neto por combinación de filtros, con indicador
    visual (badge) cuando hay alarmas activas.
  - Todos los bloques (Filtros, Stock de Reserva/KPIs, gráficos) son tarjetas
    **arrastrables y reordenables** de forma independiente, persistidas en
    `localStorage` por usuario/navegador.

### Fuera de alcance (no contemplado en esta versión)
- Carga automática desde SIGA u otro sistema externo (sigue siendo carga manual).
- Reserva/asignación de un transformador específico a una obra (eso vive en otro
  proceso, fuera de este módulo).
- Notificaciones push/email cuando se dispara una alarma (hoy es solo indicador visual
  dentro de la sección).
- Multi-tenant / permisos granulares por zona (hoy cualquier usuario logueado con acceso
  al dashboard puede cargar y ver todo).

## 6. Requisitos funcionales

### 6.1 Carga de datos (`transformadores-carga.tsx`)
- RF-1: El formulario debe permitir ingresar, por cada potencia kVA estándar
  (13 y 33), cantidades de trafos nuevos y reparados, separadas por terceros/taller,
  más cantidad "con tanque" y tipo de uso.
- RF-2: Debe permitir indicar autorizados pendientes de retiro por potencia.
- RF-3: Debe permitir cargar la relación 33/0,4 kV (nuevos/reparados) por potencia.
- RF-4: Debe permitir indicar observaciones y pendientes de entrega en texto libre.
- RF-5: Debe permitir seleccionar fecha del informe y depósito/zona (o inferirlos
  desde el nombre de archivo si se importa un Excel).
- RF-6: Al guardar, el sistema debe:
  - a) Bloquear guardados concurrentes/duplicados por doble clic (guard síncrono).
  - b) Si ya existe un informe con la misma fecha+zona, mostrar un diálogo bloqueante
    ofreciendo **Sobreescribir** o **Descartar** — nunca guardar silenciosamente un duplicado.
- RF-7: Debe tener un recordatorio configurable (frecuencia + hora) para avisar cuando
  toca cargar el próximo informe, vía el sistema global de recordatorios
  (`lib/reminders.ts`, campana `reminder-bell.tsx`).

### 6.2 Historial / Tabla (`transformadores-tabla.tsx`)
- RF-8: Debe listar todos los informes ordenados por fecha descendente.
- RF-9: Debe permitir filtrar por año, mes y por fecha exacta (búsqueda de texto).
- RF-10: Cada informe debe ser expandible a una vista de reporte completa (los 5
  paneles: nuevos/reparados por terceros, reparados por taller, total, relación
  33/0,4 kV, observaciones).
- RF-11: Debe permitir eliminar un informe individual, con confirmación previa.

### 6.3 Resumen (`transformadores-resumen.tsx`)
- RF-12: Debe calcular y mostrar como KPIs: stock bruto, autorizados pendientes de
  retiro, stock neto total, y neto desagregado por relación (13/33).
- RF-13: Debe permitir filtrar por año (multi-selección), mes (multi-selección),
  potencia, relación, fases y zona/depósito.
- RF-14: El filtro temporal debe interpretarse como **rango continuo**:
  - Si se seleccionan meses sin año (o "todos" en año), se compara el lapso entre el
    mes mínimo y máximo seleccionados, restringido al año donde existan datos en ese
    rango (no se mezclan años distintos para el mismo rango de meses).
  - Si se seleccionan años (sin meses), se compara el lapso completo entre el año
    mínimo y máximo seleccionados.
- RF-15: Las fechas mostradas en ejes/etiquetas de gráficos deben abreviar el año a
  2 dígitos (ej. "25" en lugar de "2025").
- RF-16: La granularidad del gráfico de variación debe ser semanal cuando hay un
  filtro de mes activo, y mensual en caso contrario; la etiqueta de cada punto debe
  mostrar la **fecha real del informe** más reciente de ese período (no una fecha
  sintética de inicio de semana/mes).
- RF-17: Debe permitir configurar alarmas: combinación de potencia/relación/fases/zona
  + umbral de stock neto; mostrar indicador visual (ícono + contador) cuando existan
  alarmas activas configuradas.
- RF-18: Las tarjetas de Filtros, Stock de Reserva (KPIs) y cada bloque de gráfico
  deben ser reordenables por drag & drop, de forma independiente entre sí, con el
  orden persistido en `localStorage`.
- RF-19: Los 4 KPI cards dentro del bloque Stock de Reserva deben ser también
  reordenables entre sí (drag & drop interno).

## 7. Requisitos no funcionales
- RNF-1: Responsive — operable en mobile (sidebar fijo/drawer, sin que el sidebar se
  achique al hacer zoom, contenido scrolleable).
- RNF-2: Consistencia visual con el sistema de diseño "beast pure" (tokens oklch,
  paneles `var(--panel)`/`var(--panel-2)`, sin componentes nativos `<select>` en
  secciones nuevas).
- RNF-3: Sin pérdida de datos por condiciones de carrera (doble clic, doble submit).
- RNF-4: Persistencia de preferencias de UI (orden de bloques/KPIs, anchos de columna
  donde aplique) por navegador, sin requerir configuración server-side.

## 8. Modelo de datos (Supabase)

```sql
planillas_reserva (
  id            bigint PK,
  fecha         date,            -- fecha del informe (YYYY-MM-DD)
  datos         jsonb,           -- { terceros, taller, autorizados, rel33, obs, pend, deposito }
  created_at    timestamptz
)
```
`datos.deposito` identifica la zona/depósito; es la clave (junto con `fecha`) usada
para detectar duplicados y para el filtro de Zona en el Resumen.

## 9. Flujos clave

1. **Carga periódica:** operador abre Carga de datos → completa el formulario →
   Guardar → si hay conflicto de fecha+zona, decide Sobreescribir/Descartar → se
   marca el recordatorio como actualizado.
2. **Revisión de tendencia:** gerencia abre Resumen → filtra por zona y rango de
   meses/años → revisa KPIs y gráfico de variación → si el neto está por debajo de
   umbral, configura/revisa una alarma.
3. **Auditoría/corrección:** usuario abre Tabla → busca por fecha → expande el
   informe → si está mal cargado, lo elimina y se vuelve a cargar desde Carga de datos.

## 10. Riesgos y dependencias
- Depende de que los operadores carguen el informe con la fecha y zona correctas
  (es la clave de deduplicación); un error de tipeo en la fecha puede generar un
  "duplicado lógico" no detectado por el sistema.
- El histórico semanal solo tiene sentido si se cargan informes con cierta frecuencia
  (gaps grandes entre cargas degradan la legibilidad del gráfico, no la integridad
  de los datos).

## 11. Futuro / no comprometido
- Notificaciones (email/push) al dispararse una alarma.
- Integración con SIGA para carga semi-automática.
- Reserva/asignación de transformadores específicos a obras dentro del mismo módulo.
