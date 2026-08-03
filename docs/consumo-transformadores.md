# Consumo de Transformadores

Registro mensual de transformadores **entregados** a las distintas zonas y
sectores. Es la fuente del cálculo de consumo promedio mensual y anual.

> No confundir con `planillas_reserva`, que guarda **fotos de stock** a una
> fecha. Esta tabla guarda **flujo** (cuánto salió en el mes), que es lo que el
> stock por sí solo no permite derivar de forma confiable.

## Origen de los datos

Hoja **`3-TRAFOS. ENTREGADOS`** del informe mensual (`INFORMES_COMPLETOS_<MES>.xlsx`).

La hoja trae tres bloques con la misma grilla de 14 sectores × 16 potencias:

| Bloque en el Excel | Se guarda como |
|---|---|
| `CANTIDADES POR POTENCIA (KVA) NUEVOS` | `nuevos` |
| `CANTIDADES POR POTENCIA (KVA) REPARADOS POR TERCEROS` | `reparados` |
| `CANTIDADES POR POTENCIA (KVA) REPARADOS POR EPEC` | `reparados` |

Los dos bloques de reparados **se suman en uno solo**: no interesa quién hizo la
reparación. Solo se cuenta como reparado el bloque que lo dice explícitamente.

## Formatos soportados

El formato del informe cambió con los años, así que el parser no asume nada de
la forma del archivo:

| | Informes nuevos (2025) | Informes viejos (2021) |
|---|---|---|
| Hojas | 7 pestañas | una sola, `Hoja1` |
| Bloques | 3 (nuevos + 2 de reparados) | 1, sin distinguir tipo |
| Sectores | 14 | 13 (sin "Coordinacion Tecnica") |
| Título | `INFORME MES ENERO 2025` | `INFORME DEL MES DE ENERO 2021-…` |

Por eso:

- **La hoja se elige por contenido, no por nombre.** Se puntúa cada pestaña por
  cantidad de bloques y por si menciona la entrega en sus títulos. Hace falta
  puntuar porque en el informe completo *todas* las pestañas comparten la grilla
  de `CANTIDADES POR POTENCIA`; quedarse con la primera elegiría
  `1-BAJA-ALMACENES`.
- **Un bloque sin tipo se carga como `nuevos`**, y el import lo avisa. Los
  informes viejos no separan nuevos de reparados, así que la alternativa era
  inventarle un tipo en silencio.
- **La cantidad de sectores es variable.** Los nombres se reconocen contra el
  catálogo normalizando acentos y puntuación, así que `Mant.subterr.` y
  `Mant. Subterr.` son el mismo sector. Solo se avisa si casi no se reconoció
  ninguno.

### Verificación con enero 2025

| Bloque | Total |
|---|---|
| Nuevos | 6 |
| Reparados por terceros | 9 |
| Reparados por EPEC | 13 |
| **Total del informe** | **28** |

Unificado: **6 nuevos + 22 reparados = 28**.

## Diferencias con el resto de la app

- **Potencias:** el informe usa 16 valores (5, 10, 16, 25, 50, 63, 80, 100, 160,
  200, 250, 315, 500, 630, 800, 1000). **No tiene 125 kVA**, que sí existe en
  `POT_13` de la sección de reserva. Para 125 el consumo se asume 0.
- **Sin relación:** la hoja no distingue 13,2/0,4 de 33/0,4, así que el consumo
  no se puede filtrar por relación.
- **Sin depósito:** el desglose es por sector de entrega, no por depósito de
  origen, así que no aplica el filtro Villa Revol / Alta Gracia Norte.

## Tabla Supabase

```sql
create table if not exists consumo_transformadores (
  id         bigserial primary key,
  mes        date        not null,
  datos      jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un único registro por mes. `mes` se guarda siempre como el día 1 (2025-01-01).
create unique index if not exists consumo_transformadores_mes_key
  on consumo_transformadores (mes);

alter table consumo_transformadores enable row level security;

create policy "consumo_transformadores lectura autenticada"
  on consumo_transformadores for select
  to authenticated using (true);

create policy "consumo_transformadores escritura autenticada"
  on consumo_transformadores for all
  to authenticated using (true) with check (true);
```

### Forma de `datos`

Disperso — solo se guardan las celdas con valor mayor a cero:

```jsonc
{
  "nuevos": {
    "Mant. Sur":   { "160": 2 },
    "Mant. Norte": { "63": 2 },
    "Mant. Subterr.": { "1000": 1 },
    "Zona C - Villa María": { "315": 1 }
  },
  "reparados": {
    "Mant. Sur":   { "315": 3, "160": 1, "500": 1 },
    "Mant. Norte": { "315": 2, "160": 1, "630": 1 }
  },
  "obs": "texto libre opcional"
}
```

La clave de potencia va como **string** porque las claves de objeto JSON siempre
son strings; `lib/consumo-transformadores.ts` normaliza al comparar.

## Lib

`lib/consumo-transformadores.ts` concentra constantes y cálculos puros:

| Export | Para qué |
|---|---|
| `POT_CONSUMO`, `SECTORES`, `SECTORES_ZONA_A`, `TIPOS_CONSUMO` | Constantes del informe |
| `normalizarDatos(raw)` | Sanea un `datos` incompleto que viene de la base |
| `totalDelMes(datos, filtro)` | Consumo de un mes bajo filtro de tipo/potencia/sector |
| `aniosDisponibles(registros)` | Años presentes, para poblar el filtro |
| `filtrarPorPeriodo(registros, periodo)` | Acota a un año y/o a un mes del año |
| `serieMensual(registros, filtro, periodo)` | Serie ordenada por mes, con desglose nuevos/reparados |

En `serieMensual`, el filtro de `tipo` **no** se aplica a las columnas
`nuevos`/`reparados` — esas siempre traen su valor real, para que el detalle
mensual pueda mostrar el desglose completo. Solo `total` respeta el tipo.
| `promedios(serie)` | Promedio mensual y proyección anual |
| `etiquetaMes`, `formatPromedio` | Presentación |

### Filtros de período

`FiltroPeriodo` es distinto de `FiltroConsumo`: aquel filtra celdas dentro de un
mes, este elige **qué meses** entran en el cálculo.

- `anio` → el consumo de un año calendario.
- `mesDelAnio` (1–12) → el mismo mes across años, para responder "cuánto se
  consume en promedio en enero".

Cuando `mesDelAnio` está activo, la tarjeta **oculta el promedio anual**:
multiplicar por 12 el promedio de un único mes del año no significa nada, y el
número ya lo da el promedio principal. En ese caso el denominador pasa a ser
años, no meses.

### Criterio del promedio

- **Mensual:** total acumulado ÷ cantidad de meses **con registro cargado**.
  Un mes sin planilla se excluye del denominador — no saber cuánto se consumió
  no es lo mismo que no haber consumido nada.
- **Anual:** `mensual × 12`. Es una proyección anualizada, para que el número
  sea estable aunque haya menos de un año de historia cargada.
