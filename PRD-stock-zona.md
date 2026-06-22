# PRD — Módulo Stock por Zona

**Estado:** Activo (en producción) · **Versión:** 1.0 · **Última actualización:** 2026-06-22
**Owner:** Conrado Figari · **Repositorio:** `conradofigariv/Gerencia-de-Distribucion-SaaS`

---

## 1. Resumen ejecutivo

El módulo **Stock por Zona** centraliza la visibilidad del stock de materiales (con
matrícula) distribuido entre los distintos depósitos/zonas de la gerencia, cruzando
tres fuentes independientes — el catálogo maestro de matrículas, las cargas
periódicas de stock por zona (extracción de SIGA) y una clasificación manual por
familias — en una sola vista consultable, filtrable y personalizable, reemplazando
el cruce manual de planillas sueltas entre depósitos.

Es una única sección del sidebar (`stock-zona`) organizada en tres pestañas que
comparten el mismo modelo de datos:

| Pestaña | Rol |
|---|---|
| Resumen de stock | Tabla pivot consultable: una fila por matrícula, una columna por zona |
| Cargar datos | Ingreso de la extracción periódica de stock por zona (pegado de texto) |
| Familias | Clasificación manual de matrículas en familias + override de tipo Material/Servicio |

## 2. Problema

- El stock de materiales con matrícula estaba repartido en extracciones sueltas por
  zona/depósito, sin una vista única que permitiera comparar cuánto hay de un
  artículo en cada zona al mismo tiempo.
- No existía una clasificación reutilizable de los artículos por familia (cables,
  aluminio, etc.): cada análisis ad-hoc requería volver a agrupar manualmente.
- Distinguir Material de Servicio dependía de criterio manual disperso, sin una
  fuente de verdad ni la posibilidad de corregir casos puntuales.
- Al buscar un artículo puntual, no había forma de aislar solo las zonas donde
  efectivamente hay stock, ni de "fijar" varios artículos de interés para
  monitorearlos juntos mientras se sigue filtrando/buscando otros.
- La sección no estaba pensada para mobile: la barra de pestañas se desarmaba
  (botones que bajaban de línea) en pantallas angostas.

## 3. Objetivos y métricas de éxito

| Objetivo | Métrica |
|---|---|
| Vista única de stock por zona | 100% de las zonas cargadas visibles en una sola tabla pivot, sin cruces manuales en Excel |
| Clasificación reutilizable | Toda matrícula de interés puede tener 1+ familias asignadas, persistidas y reutilizables entre cargas de stock |
| Tipo confiable (Material/Servicio) | El tipo sale por defecto del catálogo maestro, con posibilidad de override manual por matrícula sin perder la fuente original |
| Foco rápido en lo relevante | Un usuario puede aislar columnas de zona con stock y fijar artículos de seguimiento en menos de 2 clics, sin perder esa configuración entre sesiones |
| Usable en mobile | Las 3 pestañas operables desde un celular, sin que ningún control se desborde o baje de línea |
| Rendimiento con catálogos grandes | La tabla de Resumen y la lista de Familias permanecen fluidas con miles de matrículas (listas virtualizadas) |

## 4. Usuarios

- **Control de stock / depósito:** carga periódicamente la extracción de SIGA por
  zona (pestaña Cargar datos) y consulta el Resumen para verificar cantidades.
- **Gerencia / supervisión:** consulta el Resumen para comparar stock entre zonas,
  fija matrículas críticas para seguimiento y filtra por familia o tipo.
- **Administrador de catálogo:** mantiene la clasificación por familias y corrige
  el tipo Material/Servicio cuando el catálogo maestro no lo refleja correctamente
  (pestaña Familias).

## 5. Alcance

### Incluido
- **Tres fuentes de datos cruzadas por matrícula exacta** (sin normalizar el
  formato visible del número, incluyendo puntos y ceros):
  - Catálogo maestro de matrículas (`matriculas`): descripción, UDM y tipo
    Material/Servicio — la fuente más actualizada.
  - Cargas de stock por zona (`stock_uploads`): cantidad por zona, vía pegado de
    texto tab-separado desde el sistema de origen.
  - Familias manuales (`stock_article_families`): etiquetas multi-familia +
    override manual de tipo.
- **Resumen de stock:** tabla pivot virtualizada, una fila por matrícula, columnas
  fijas (Matrícula, Descripción, UDM, Tipo, Total) + una columna por zona,
  colapsables. Orden y redimensión de columnas persistidos.
  - Filtros por zona (multi-selección), familia, Servicio/Material y búsqueda por
    número o nombre.
  - Botón para mostrar solo las columnas de zona que tienen stock en el conjunto de
    filas actualmente visible.
  - Selección de múltiples zonas en el filtro: limita qué columnas de zona se
    muestran, sin afectar qué filas (matrículas) aparecen.
  - Fijado de matrículas: cualquier fila puede fijarse para que permanezca siempre
    visible arriba de la tabla, independientemente de los filtros o la búsqueda
    activos; admite fijar varias matrículas en simultáneo, acumulándose en el
    orden en que se fijaron, con indicador de cantidad fijada y botón para
    limpiar todas.
  - Toda la configuración de la pestaña (zonas seleccionadas, matrículas fijadas,
    "solo zonas con stock") persiste en el navegador entre sesiones.
  - Servicios del catálogo se muestran aunque no tengan stock cargado (Total 0);
    materiales sin stock y sin familia asignada no se muestran (evitar ruido).
- **Cargar datos:** textarea para pegar la extracción del sistema de origen
  (encabezado `Artículo`, `Desc Artículo`, `UDM Primaria`, `En Mano`, `Organización`);
  detección automática de zona desde la columna Organización; previsualización por
  zona antes de confirmar la importación; cada importación reemplaza por completo
  los datos previos de esa zona.
- **Familias:** lista virtualizada de matrículas con selección múltiple.
  - Alta masiva de una familia nueva pegando una lista de matrículas.
  - Edición por fila: familias como chips removibles + alta rápida de una familia
    por matrícula.
  - Acciones en lote sobre la selección: agregar familia (sin pisar existentes),
    quitar una familia, aplicar tipo Material/Servicio, borrar toda clasificación.
  - Filtros por familia, por "sin clasificar" y por búsqueda.
- **Centro de ayuda** (`StockHelpModal`) con guía paso a paso para cada pestaña,
  incluyendo capturas del proceso de extracción en SIGA.
- **Responsive:** la barra de pestañas (Resumen / Cargar datos / Familias) ocupa
  el ancho completo en una sola fila en mobile, sin que ningún botón baje de línea,
  revirtiendo a una barra de pills compacta en pantallas de escritorio.

### Fuera de alcance (no contemplado en esta versión)
- Carga automática desde SIGA (sigue siendo pegado manual de texto).
- Reserva o asignación de stock a una obra específica (vive en otro proceso).
- Notificaciones push/email al detectar quiebre o faltante de stock por zona
  (no hay sistema de alarmas como en Transformadores).
- Movimientos de stock entre zonas dentro de la app (transferencias) — el módulo es
  de consulta y clasificación, no de logística de traslado.
- Multi-tenant / permisos granulares por zona (cualquier usuario logueado con
  acceso al dashboard puede cargar y clasificar).

## 6. Requisitos funcionales

### 6.1 Resumen de stock
- RF-1: Debe mostrar una tabla pivot con una fila por matrícula (proveniente de la
  unión de catálogo, stock cargado y familias asignadas) y columnas Matrícula,
  Descripción, UDM, Tipo, Total y una columna por cada zona con datos.
- RF-2: Descripción y UDM deben priorizar el catálogo maestro (`matriculas`) y usar
  el dato del stock cargado como respaldo si el catálogo no tiene la matrícula.
- RF-3: Los Servicios del catálogo deben listarse aunque su Total sea 0; los
  Materiales sin stock y sin familia asignada no deben listarse.
- RF-4: Debe permitir colapsar/expandir el bloque de columnas de zona con
  animación, para alternar entre vista compacta (solo totales) y detallada.
- RF-5: Debe permitir filtrar por familia, por tipo Servicio/Material y por texto
  (número o nombre de matrícula).
- RF-6: Debe permitir seleccionar múltiples zonas en un desplegable; la selección
  debe limitar exclusivamente qué columnas de zona se muestran, sin alterar qué
  filas/matrículas aparecen en la tabla.
- RF-7: Debe ofrecer un control para mostrar solo las columnas de zona que tengan
  stock mayor a cero en el conjunto de filas visible en ese momento.
- RF-8: Debe permitir fijar (pin) cualquier matrícula desde su fila; las matrículas
  fijadas deben permanecer siempre visibles en la parte superior de la tabla,
  en el orden en que fueron fijadas, sin importar los filtros, la búsqueda o la
  selección de zona activos.
- RF-9: Debe permitir fijar varias matrículas en simultáneo, acumulándolas, y
  desfijarlas individualmente o todas a la vez; debe mostrarse un indicador con la
  cantidad de matrículas fijadas.
- RF-10: La selección de zonas, las matrículas fijadas y el estado de "solo zonas
  con stock" deben persistir en el navegador entre sesiones (recordados al volver
  a abrir la sección).
- RF-11: Debe permitir ordenar la tabla por cualquier columna (ascendente/
  descendente) y redimensionar el ancho de cada columna, persistiendo el ancho
  elegido para la próxima visita.
- RF-12: El catálogo maestro debe cachearse en el navegador para que la segunda
  carga de la pestaña sea instantánea, refrescándose en segundo plano sin bloquear
  la vista.

### 6.2 Cargar datos
- RF-13: Debe aceptar el pegado de datos tab-separados con encabezado en la
  primera fila (`Artículo`, `Desc Artículo`, `UDM Primaria`, `En Mano`,
  `Organización`).
- RF-14: La zona debe inferirse automáticamente desde la columna Organización.
- RF-15: Debe mostrar una previsualización agrupada por zona antes de confirmar
  la importación.
- RF-16: Al importar, los datos de cada zona pegada deben reemplazar por completo
  los datos previamente cargados para esa misma zona (no acumular ni duplicar).
- RF-17: Debe tener un recordatorio configurable (frecuencia + hora) integrado al
  sistema global de recordatorios (`lib/reminders.ts`, campana `reminder-bell.tsx`).

### 6.3 Familias
- RF-18: Debe permitir crear una familia nueva pegando una lista de matrículas
  (una por línea, tab o coma) y asignársela a todas en un solo paso, sumando a las
  familias que ya tuvieran (sin pisarlas).
- RF-19: Cada fila debe mostrar sus familias asignadas como chips removibles
  individualmente, y permitir agregar una familia nueva por fila con un campo de
  texto + Enter.
- RF-20: Debe permitir seleccionar múltiples matrículas y aplicarles en lote:
  agregar una familia (sin pisar existentes), quitar una familia puntual, aplicar
  un tipo Material/Servicio, o borrar toda su clasificación.
- RF-21: Debe permitir filtrar por familia, por "sin clasificar" (matrículas sin
  ninguna familia asignada) y por búsqueda de número o descripción.
- RF-22: El tipo efectivo de una matrícula debe resolverse como: override manual
  guardado en `stock_article_families.tipo` si existe; si no, el tipo (`mat_serv`)
  del catálogo maestro.

## 7. Requisitos no funcionales
- RNF-1: Responsive — la barra de pestañas debe ocupar el ancho completo en una
  sola fila en mobile sin que ningún botón baje de línea, revirtiendo a un diseño
  de pills compacto en escritorio.
- RNF-2: Consistencia visual con el sistema de diseño "beast pure" compartido con
  Informe Técnico (tokens oklch, dropdowns custom `BeastSelect`/`BeastMultiSelect`,
  sin `<select>` nativo).
- RNF-3: Las tablas y listas (Resumen, Familias) deben permanecer fluidas con
  miles de matrículas mediante virtualización (`@tanstack/react-virtual`).
- RNF-4: El número de matrícula debe respetarse y mostrarse exactamente como está
  cargado (incluyendo puntos y ceros) en toda búsqueda, guardado y cruce entre
  tablas — nunca normalizado.
- RNF-5: Los menús desplegables anclados a un disparador (zona, familia, tipo)
  deben permanecer abiertos y re-posicionarse correctamente al hacer scroll, tanto
  dentro del propio menú como en la página, sin cerrarse inesperadamente.
- RNF-6: Persistencia de preferencias de UI (anchos de columna, zonas
  seleccionadas, matrículas fijadas, filtro de zonas con stock) por navegador, sin
  requerir configuración server-side.

## 8. Modelo de datos (Supabase)

```sql
-- Stock cargado por zona (reemplaza completo en cada importación)
stock_uploads (
  zona          text PRIMARY KEY,
  file_name     text,
  uploaded_at   timestamptz DEFAULT now(),
  rows          jsonb NOT NULL
)

-- Familias + override de tipo por matrícula (multi-familia)
stock_article_families (
  articulo      text PRIMARY KEY,
  familia       text,   -- array JSON de familias (ej. ["Cables","Aluminio"]) o texto plano legado, migrado al leer
  subfamilia    text,   -- sin uso (histórico, modelo pasó a multi-familia)
  tipo          text    -- 'material' | 'servicio' | null (override manual)
)

-- Catálogo maestro de matrículas (solo lectura desde esta sección)
matriculas (
  articulo      text PRIMARY KEY,
  descripcion   text,
  udm           text,
  mat_serv      text    -- Material/Servicio normalizado por la sección
)
```
El cruce entre las tres tablas se hace siempre por `articulo`/matrícula exacta, sin
normalizar el formato.

## 9. Flujos clave

1. **Carga periódica de stock:** control de stock abre Cargar datos → pega la
   extracción de SIGA → previsualiza zonas detectadas → Importa → los datos de esa
   zona reemplazan los anteriores → se marca el recordatorio como actualizado.
2. **Consulta y seguimiento:** gerencia abre Resumen → filtra por familia o tipo →
   busca una matrícula puntual → activa "solo zonas con stock" para ver dónde hay
   unidades → fija esa matrícula (y otras de interés) para monitorearlas mientras
   sigue explorando el resto de la tabla con otros filtros.
3. **Clasificación:** administrador de catálogo abre Familias → crea una familia
   nueva pegando una lista de matrículas, o ajusta caso por caso con los chips por
   fila → corrige el tipo Material/Servicio de una matrícula puntual si el
   catálogo maestro no lo refleja bien.

## 10. Riesgos y dependencias
- Depende de que el catálogo maestro de matrículas (cargado desde la sección
  "Carga de datos" general) esté actualizado; si una matrícula no está en el
  catálogo, su descripción/UDM se respaldan en el stock cargado (que puede ser
  menos preciso o estar desactualizado).
- Cada importación de stock por zona **reemplaza completo** los datos de esa zona:
  una carga parcial o incompleta del archivo de origen genera pérdida de datos de
  esa zona hasta la siguiente carga.
- El cruce por matrícula exacta es sensible al formato: una matrícula pegada con
  un formato distinto (ceros/puntos) al del catálogo no cruzará correctamente.

## 11. Futuro / no comprometido
- Integración con SIGA para carga semi-automática del stock por zona.
- Sistema de alarmas de stock mínimo por zona/familia, similar al de
  Transformadores.
- Movimientos/transferencias de stock entre zonas gestionados desde la app.
- Notificaciones (email/push) ante quiebres de stock detectados.
