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
reparación.

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
| `serieMensual(registros, filtro)` | Serie ordenada por mes, con desglose nuevos/reparados |
| `promedios(serie)` | Promedio mensual y proyección anual |
| `etiquetaMes`, `formatPromedio` | Presentación |

### Criterio del promedio

- **Mensual:** total acumulado ÷ cantidad de meses **con registro cargado**.
  Un mes sin planilla se excluye del denominador — no saber cuánto se consumió
  no es lo mismo que no haber consumido nada.
- **Anual:** `mensual × 12`. Es una proyección anualizada, para que el número
  sea estable aunque haya menos de un año de historia cargada.
