# Plan de Compras (`plan-compras-carga`, `plan-compras-resumen`)

Réplica en la app del Excel anual **PC_ANUAL_GD** (plan 2026: `PC_ANUAL_GD_26_Rev3.xlsx`).
Hecho: **importar todo el Excel y verlo en una grilla** con los encabezados de la
pestaña «Global» (Carga de datos) y las vistas **Prioridad / Por partida / Cuentas
contables** (Resumen). Pendiente: la edición en celda de Global.

| Pieza | Archivo |
|---|---|
| SQL | `supabase/plan_compras.sql` |
| Columnas + fórmulas (puro) | `lib/planComprasCalc.ts` |
| Lectura del Excel (puro, corre en worker) | `lib/planComprasImport.ts` |
| Worker + cliente con fallback | `lib/planComprasImport.worker.ts`, `lib/planComprasLeer.ts` |
| Supabase (lectura / importación) | `lib/planCompras.ts` |
| Cruce con el catálogo de matrículas | `lib/planComprasCatalogo.ts` |
| Grilla | `components/dashboard/sections/plan-compras-carga.tsx` |
| Filtro de columna tipo Excel | `components/dashboard/sections/plan-compras-filtro-columna.tsx` |
| Modal de importación | `components/dashboard/sections/plan-compras-importar.tsx` |
| Resumen (Prioridad, partidas, cuentas — puro) | `lib/planComprasResumen.ts` |
| Pantalla Resumen | `components/dashboard/sections/plan-compras-resumen.tsx` |
| Selector de plan + select de filtro (compartidos) | `components/dashboard/sections/plan-compras-ui.tsx` |
| Estilos | bloque `.pc-*` al final de `app/globals.css` |

## El Excel

8 pestañas: **Global** (22.950 matrículas × 61 columnas, el corazón), **Prioridad**
(resumen por familia, solo «A cargo de = GD»), **Resumen** (tabla dinámica por partida
presupuestaria + cuentas contables) y 5 ocultas que son reportes del sistema pegados
(stock, Envíos, OPS, SIC, PREPARADOR). Las ocultas **no se importan**: alimentaban
columnas de Global que en el Excel ya están pegadas como valor (Stock, Última SIC,
Pu Sic, Pu OP), y la app ya carga esos reportes por su lado (Carga de datos).

### Columnas de «Global»

En la base se guarda **solo lo que es dato**. Lo que en el Excel es fórmula se calcula
en `calcularFila` (redondeo como Excel, incluido el ruido de punto flotante) y nunca
se persiste: cambiar el TC recalcula las 22.950 filas sin reescribir ninguna.

| Letra | Encabezado (2026) | Clave | Tipo / fórmula |
|---|---|---|---|
| A–D | Artículo, Descripción, Unidad, M/S | `articulo`, `descripcion`, `unidad`, `mat_serv` | dato — el artículo se guarda **literal**, como viene («00021126.0») |
| E–H | FAMILIA, FAMILIAS VIEJAS, SUBFAMILIA, A CARGO DE | `familia`, `familia_vieja`, `subfamilia`, `a_cargo_de` | dato |
| I–J | ULTIMA SIC, ULTIMA SIC2 | `ultima_sic_area`, `ultima_sic_solicitante` | dato (pegado) |
| K–M | 2023P, 2023C, 2024P | `hist_1..3` | dato |
| N | MAX 2023 | `max_hist` | `MAX(K; L; M)` (en el Excel está pegado; coincide 100%) |
| O–T | ACR, AORD, MANTENIMIENTO, SEAS, SISTEMAS, SERVICIOS | `d_acr` … `d_servicios` | dato (demanda Zona A) |
| U | ZA | `za` | `SUMA(O:T)` |
| V–AB | ZB … ZH | `d_zb` … `d_zh` | dato (demanda Interior) |
| AC | INTERIOR | `interior` | `SUMA(V:AB)` |
| AD–AJ | MED, TELE, TCT, TRAFOS, REG.TEN., OBRAS, Impacto 2025 | `d_med` … `d_impacto` | dato |
| AK | TOTAL | `total` | `ZA + INTERIOR + MED + TELE + TCT + TRAFOS + OBRAS + REG.TEN. + Impacto` |
| AL | AJUSTE | `ajuste` | dato |
| AM | GD 2025 | `gd` | `TOTAL − AJUSTE` |
| AN | Recorte | `recorte` | `CANT. APROBADAS − GD` |
| AO | CANT. APROBADAS | `cant_aprobadas` | dato |
| AP | Análisis | `analisis` | `SI.ERROR(TOTAL / MAX − 1; "No se compro en 2023")` |
| AQ–AS | Stock, Pendientes, Consumo Promedio | `stock`, `pendientes`, `consumo_promedio` | dato (pegado) |
| AT | Análisis Cons. Prom | `analisis_cons` | `Consumo − Pendientes − Stock` |
| AU | Análisis2 | `analisis2` | `GD − Stock − Pendientes` |
| AV–AW | Pu Sic, Pu OP | `pu_sic`, `pu_op` | dato |
| AX | Pu Sic + 20% | `pu_sic_mas` | `REDONDEAR(MAX(Pu Sic; Pu OP) × 1,2; 0)` — ⚠ el MÁXIMO de los dos |
| AY | Pu Est (USD) | `pu_est_usd` | dato |
| AZ | Pu Est ($) | `pu_est_pesos` | `REDONDEAR.MAS(USD × TC; 0)` |
| BA | Verif. Precio | `verif_precio` | `SI.ERROR(Pu Est $ / Pu Sic+20% − 1; 0)` |
| BB | Total 2026 $ | `total_plan` | `Pu Est ($) × GD` — ⚠ por GD, no por aprobadas |
| BC | % Incidencia | `incidencia` | `Total $ / total de las filas visibles` |
| BD | Pu ajustado | `pu_ajustado` | dato |
| BE | Total Ajustado 2026 $ | `total_ajustado` | `Pu ajustado × CANT. APROBADAS` (pegado en el Excel; coincide 100%) |
| BF | DIF PU% | `dif_pu` | `SI.ERROR(Pu ajustado / Pu Est $ − 1; "Sin Datos")` |
| BG | DIF GLOBAL % | `dif_global` | `SI.ERROR(Total Aj. / Total $ − 1; "Sin Datos")` |
| BH–BI | Partida, Descripción Partida | `partida`, `partida_descripcion` | dato |

- **Claves sin año.** Los encabezados del Excel llevan año («GD 2025», «Total 2026 $»)
  y cambian cada plan. La base usa claves fijas y guarda el encabezado real de cada
  importación en `plan_compras.etiquetas`; la grilla muestra ese texto.
- **0 = vacío.** Una celda en 0 se guarda como `null` (para las fórmulas es igual y la
  base no guarda ~1 millón de ceros). La grilla muestra «–».
- **% Incidencia** se calcula sobre las filas **visibles**, igual que el `SUBTOTAL(109)`
  del Excel: filtrando «A cargo de = GD» la incidencia es dentro de GD.
- **Parámetros del plan** (cabecera): `tipo_cambio` sale de «TC PLAN» (Prioridad!N2);
  `pct_mayoracion` (el 1,2 escrito dentro de la fórmula AX) se deduce de las filas y lo
  confirma la verificación.

## Importación

`Importar Excel` → se elige el .xlsx → **Web Worker** lee Global, Prioridad y Resumen
(la hoja Global pesa ~80 MB descomprimida; en el hilo principal congelaría la pantalla)
→ pantalla de revisión → subida.

- **Verificación antes de subir.** Para cada fila se recalculan las 17 columnas fórmula
  y se comparan con el valor que guardó Excel. Plan 2026: **390.150 celdas, 0
  diferencias**; además, total GD $ y cantidad de matrículas por familia contra
  Prioridad: 29/29.
- **Mapeo por encabezado**, no por posición: las columnas con año van por patrón, así el
  mismo importador sirve para el Excel del año que viene. Solo **Artículo** es
  obligatoria: si el Excel de otro año no trae alguna columna de carga, se avisa y queda
  vacía; si no trae alguna columna fórmula, se avisa que no se pudo verificar. Las filas
  de datos van hasta la última con Artículo (las vacías del medio se saltean; las que
  tienen datos pero no Artículo se avisan).
- **Año del plan**: se detecta del encabezado «Total NNNN $» y, si no, del nombre del
  archivo («…_26…» → 2026). En la revisión se puede corregir; el modal dice de dónde
  salió y avisa si encabezado y archivo no coinciden.
- **Matrículas vs. catálogo** (informativo, no bloquea): antes de subir se cruza contra
  `matriculas` por la clave normalizada (como `gd_norm_articulo`: sin el «.0»). Lista
  las que **no están** (CSV + botón «Dar de alta N», que las inserta con el código
  literal, descripción, unidad y M/S del Excel, previa confirmación y re-chequeando el
  catálogo para no duplicar) y las que están con **datos distintos** (descripción,
  unidad, M/S; sin mayúsculas ni espacios de más; un vacío no cuenta) con CSV. El
  plan guarda lo del Excel y el catálogo no se modifica. «00000000» es relleno y no se
  cruza. El alta no reconstruye el índice del Buscador (se hace desde el Buscador).
- **Versionado.** Cada importación crea una cabecera nueva **inactiva** y carga los
  ítems (lotes de 500, 3 en paralelo). Al final la app apaga la versión activa del
  año, prende la nueva (si falla, vuelve a prender la anterior) y borra las inactivas.
  Si la subida se corta antes, se borra lo nuevo y el plan anterior queda intacto.
  Un solo plan activo por año (índice único parcial).
- **Planes de otros años**: cada año es un plan aparte. Importar el Excel de 2027 agrega
  el plan 2027 sin tocar el 2026; importar de nuevo un año reemplaza solo ese año. Con
  más de un plan aparece el selector de plan en la barra de la grilla.
- **El SQL no tiene funciones ni triggers**, a propósito: pegado en el SQL Editor
  de Supabase, el cuerpo de las funciones llegaba alterado («syntax error at end of
  input / LINE 0», «relation "v_anio" does not exist»). Solo tablas, índices y RLS.
- **Pie de Global**: TC y PC USD de años anteriores se guardan en `plan_compras.pie`.
  Los del año del plan no: son fórmulas que dependen del filtro activo al guardar.

## Grilla (sistema de diseño IDO)

Aplicado (confirmado con el usuario): §4.11 tabla CSS grid con encabezado fijo opaco
(`--ido-header`) en dos filas (grupos + columnas) · §4.14 grupos colapsables solo donde
el Excel ya tiene subtotal (Histórico → MAX, Zona A → ZA, Interior → INTERIOR); colapsado, el grupo sigue mostrando su nombre y cuántas columnas oculta («ZONA A +6»): la columna que queda se ensancha lo justo para que entre · §4.15
redimensionado + doble clic · §4.17/§4.18 Artículo + Descripción anclados con sombra y
borde al scrollear en X, padding compacto (61 columnas siempre desbordan) · §4.19/§4.20
densidad (compacta por defecto), anchos, grupos colapsados y ocultos por usuario
(`planComprasGlobal`) · §4.10 menú Columnas (por grupo) · §4.8 filtros (búsqueda,
A cargo de, Familia, «Con cantidades») · **filtro de columna tipo Excel**: embudo en
cada encabezado (menos % Incidencia) con ordenar A→Z/Z→A, búsqueda, lista de valores
con conteo (solo los que pasan los otros filtros, como Excel) y, en numéricas,
condición (>, ≥, <, ≤, =, entre, ≠ 0, = 0); embudo verde en la columna filtrada y
chips de filtros activos debajo de la barra (clic abre el menú, × lo quita). La flecha
de orden se muestra solo en la columna ordenada. Las columnas ancladas no superan el
45 % del ancho (Descripción autoajusta hasta 480 px) para que siempre quede lugar
para scrollear el resto · §4.12 barra de estado (total visible en $ y
USD, total del plan si hay filtro, total ajustado) · §1 valor calculado verde itálica;
% calculado negativo en rojo (§4.11 «Var %») · tooltip de cada encabezado calculado con
su fórmula.

Pendiente para la etapa de edición: §4.4 estados de celda (edición / error /
modificada), §4.5 menú de clic derecho, pegado desde Excel, guardado automático.

## Resumen (`plan-compras-resumen`)

Lo que el Excel calcula como resultado, recalculado en vivo desde Global (cálculo en
`lib/planComprasResumen.ts`). Filtros: plan (año) y «A cargo de» (GD por defecto, como
el Excel; si el plan no tiene GD pasa a «todos»). Tres pestañas:

- **Prioridad** (Tabla7 del Excel): por familia, Matrículas = `CONTAR.SI.CONJUNTO(familia;
  A CARGO DE; GD > 0)`, Total GD $ = `SUMAR.SI.CONJUNTO(Total $)`, Total Aprobado $ =
  `SUMAR.SI.CONJUNTO(Total Ajustado $)`, USD = $ / TC, %, % Aj. y «GD vs. aprobado» =
  GD / Aprobado − 1 (en el Excel se llama «Respecto Año pasado»; si Aprobado = 0 se ve
  «–» donde el Excel pone 0). Verificado contra el Excel: 29/29 familias y totales
  ($126.050.778.065 / $118.471.917.841 / 6,4 %). La **prioridad es editable en la
  celda** (0–99, Enter guarda, Esc cancela; upsert en `plan_compras_familias`). Una
  familia con filas en Global que no estaba en la tabla del Excel aparece marcada «No
  estaba en Prioridad».
- **Por partida**: reemplaza la tabla dinámica (desactualizada en el Excel): matrículas
  con cantidad aprobada, cant. aprobadas, Total $, Total Ajustado $ (+ USD y %).
- **Cuentas contables** (Tabla5): partida = `EXTRAE(cuenta; 6; 12)`, descripción desde
  Global (el BUSCARV del Excel da #N/A), **Total Excel** (lo pegado) vs **Total
  calculado** (Total Ajustado de esa partida) y la diferencia. Si dos cuentas comparten
  partida, el total se cuenta en la primera («misma partida que la fila N»). Avisa las
  partidas con Total Ajustado que no tienen cuenta. Plan 2026: el Excel suma $105.111 M
  y lo calculado da $118.425 M (lo pegado es de la tabla dinámica vieja).

Sistema de diseño (confirmado): §4.7 pestañas · §4.8 filtros · §4.11 tabla CSS grid con
encabezado sticky opaco, orden por columna (asc → desc → orden del Excel) y fila de
totales sticky abajo · §1 calculado verde itálica, % negativo en rojo · §4.12 barra de
estado · §4.25 «Cargando filas». Excluido: columnas colapsables/redimensionables,
persistencia de layout, selección de filas, menú de clic derecho (tablas chicas, solo
lectura salvo Prioridad).

## Problemas del Excel que la app evita

1. Los totales al pie usan `SUBTOTAL` y el archivo quedó guardado filtrado por
   TELEOPERACIÓN: «PC 2026 USD = 8,77 M» y «−88% vs 2025» son solo de esa familia.
2. Resumen!C27:C61 da `#N/A`: el BUSCARV apunta a `Global!BG:BH`; tras insertar
   columnas debería ser `BH:BI`.
3. La tabla dinámica de Resumen está desactualizada (suma $110.107 M contra $118.472 M).
4. Valores calculados pegados como valor (MAX, Total Ajustado): no se actualizan.
5. «Pendientes» tiene 21 filas con valor; la hoja Envíos tiene pendientes para 443.
6. Datos a normalizar: TRANSMISIÓN/TRANSMISION, GENERACIÓN/GENERACION, «Global.»,
   «Meses.», «MEIDIDORES», «LUBRICENTES»; matrícula 00000000 repetida.

## Tablas

`plan_compras` (cabecera, una activa por año) · `plan_compras_items` (Global) ·
`plan_compras_familias` (Prioridad: familia + prioridad) · `plan_compras_cuentas`
(Resumen: cuentas contables; la partida es `substring(cuenta, 6, 12)`). RLS permisiva
como el resto de las tablas de la oficina. Probado en Postgres 16: base vacía, base con
el esqueleto viejo (se migra solo) y re-ejecución con datos (no los toca).
