"use client";

/**
 * /styleguide — Laboratorio de diseño (FASE 0.3 del DESIGN_PLAN.md)
 *
 * Página interna que renderiza todos los tokens y componentes juntos para
 * iterar la identidad visual sin navegar toda la app. NO está enlazada en el
 * sidebar; se accede manualmente en /styleguide.
 *
 * Regla: cuando rediseñemos un componente, lo probamos acá primero.
 */

import { useState } from "react";
import { Loader2, Check, Bell, Trash2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ─── Tokens de color (leídos de globals.css) ──────────────────────────────
const COLOR_TOKENS: { name: string; varName: string; note: string }[] = [
  { name: "background",          varName: "--background",          note: "Fondo de la app" },
  { name: "card",                varName: "--card",                note: "Cards / paneles" },
  { name: "secondary",           varName: "--secondary",           note: "Inputs, fondos 2º" },
  { name: "muted",               varName: "--muted",               note: "Apagado" },
  { name: "border",              varName: "--border",              note: "Bordes" },
  { name: "foreground",          varName: "--foreground",          note: "Texto principal" },
  { name: "muted-foreground",    varName: "--muted-foreground",    note: "Texto 2º" },
  { name: "accent",              varName: "--accent",              note: "Acento verde" },
  { name: "destructive",         varName: "--destructive",         note: "Error / peligro" },
  { name: "success",             varName: "--success",             note: "Éxito" },
  { name: "warning",             varName: "--warning",             note: "Advertencia" },
];

const CHART_TOKENS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];

// ─── Helpers de layout ─────────────────────────────────────────────────────
function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="rounded-xl border border-border bg-card p-6">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-6 border-b border-border/50 last:border-0">
      <span className="w-40 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export default function StyleguidePage() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-12 space-y-12">

        {/* Header */}
        <header className="space-y-2">
          <Badge variant="outline" className="font-mono text-[10px]">FASE 0 · DESIGN_PLAN.md</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">Styleguide</h1>
          <p className="text-muted-foreground">
            Laboratorio de identidad visual. Dark-first · acento verde · DM Sans + JetBrains Mono.
          </p>
        </header>

        {/* ── Colores ──────────────────────────────────────────────── */}
        <Section title="Colores (tokens)" description="Fuente de verdad: variables oklch en globals.css. Usar siempre tokens, nunca oklch() literal.">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {COLOR_TOKENS.map(t => (
              <div key={t.varName} className="space-y-2">
                <div
                  className="h-16 w-full rounded-lg border border-border"
                  style={{ background: `var(${t.varName})` }}
                />
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{t.varName}</p>
                  <p className="text-[11px] text-muted-foreground">{t.note}</p>
                </div>
              </div>
            ))}
          </div>
          <Separator className="my-6" />
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Series de gráficos</p>
          <div className="flex flex-wrap gap-3">
            {CHART_TOKENS.map(v => (
              <div key={v} className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md border border-border" style={{ background: `var(${v})` }} />
                <span className="font-mono text-[11px] text-muted-foreground">{v}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Tipografía ───────────────────────────────────────────── */}
        <Section title="Tipografía" description="DM Sans para UI · JetBrains Mono para números, precios y matrículas.">
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Sans (DM Sans)</p>
              <p className="text-3xl font-semibold">Gerencia de Distribución</p>
              <p className="text-base">Texto de cuerpo — control de servicios y stock.</p>
              <p className="text-sm text-muted-foreground">Texto secundario / descripciones.</p>
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Mono (JetBrains Mono)</p>
              <p className="font-mono text-2xl">$ 1.284.500,00</p>
              <p className="font-mono text-sm text-muted-foreground">MAT-0098234.0 · SIC-2026-0042</p>
            </div>
          </div>
        </Section>

        {/* ── Botones ──────────────────────────────────────────────── */}
        <Section title="Botones" description="FASE 1: unificar todo a <Button variant>. Hoy faltan success/warning y estado loading integrado.">
          <div className="space-y-1">
            <Row label="Variantes">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </Row>
            <Row label="Tamaños">
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="icono"><Plus /></Button>
            </Row>
            <Row label="Con ícono">
              <Button><Check /> Guardar</Button>
              <Button variant="outline"><Bell /> Recordatorio</Button>
              <Button variant="destructive"><Trash2 /> Eliminar</Button>
            </Row>
            <Row label="Estados">
              <Button disabled>Disabled</Button>
              <Button onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1500); }} disabled={loading}>
                {loading ? <><Loader2 className="animate-spin" /> Guardando…</> : "Probar loading"}
              </Button>
            </Row>
          </div>
        </Section>

        {/* ── Badges ───────────────────────────────────────────────── */}
        <Section title="Badges">
          <div className="flex flex-wrap gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
        </Section>

        {/* ── Controles de formulario ──────────────────────────────── */}
        <Section title="Controles de formulario">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Input de texto</Label>
              <Input placeholder="Escribí algo…" />
            </div>
            <div className="space-y-1.5">
              <Label>Con ícono</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Buscar…" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Select</Label>
              <Select>
                <SelectTrigger><SelectValue placeholder="Elegí una zona" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="centro">Centro</SelectItem>
                  <SelectItem value="norte">Norte</SelectItem>
                  <SelectItem value="sur">Sur</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Textarea</Label>
              <Textarea placeholder="Observaciones…" />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="sw" />
              <Label htmlFor="sw">Switch</Label>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox id="cb" />
              <Label htmlFor="cb">Checkbox</Label>
            </div>
          </div>
        </Section>

        {/* ── Cards ────────────────────────────────────────────────── */}
        <Section title="Cards">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Stock total</CardTitle>
                <CardDescription>Resumen por zona</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-3xl font-semibold">12.480</p>
                <p className="text-sm text-muted-foreground">unidades en 4 zonas</p>
              </CardContent>
              <CardFooter>
                <Button size="sm" variant="outline">Ver detalle</Button>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>KPI con acento</CardTitle>
                <CardDescription>Un solo acento verde por vista</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="font-mono text-3xl font-semibold text-accent">+18,4%</p>
                <Progress value={64} />
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* ── Alerts ───────────────────────────────────────────────── */}
        <Section title="Alerts">
          <div className="space-y-3">
            <Alert>
              <AlertTitle>Información</AlertTitle>
              <AlertDescription>Mensaje informativo neutro.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>Algo salió mal al guardar.</AlertDescription>
            </Alert>
          </div>
        </Section>

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <Section title="Tabs">
          <Tabs defaultValue="resumen">
            <TabsList>
              <TabsTrigger value="resumen">Resumen</TabsTrigger>
              <TabsTrigger value="tabla">Tabla</TabsTrigger>
              <TabsTrigger value="carga">Carga</TabsTrigger>
            </TabsList>
            <TabsContent value="resumen" className="pt-4 text-sm text-muted-foreground">Contenido de Resumen.</TabsContent>
            <TabsContent value="tabla" className="pt-4 text-sm text-muted-foreground">Contenido de Tabla.</TabsContent>
            <TabsContent value="carga" className="pt-4 text-sm text-muted-foreground">Contenido de Carga.</TabsContent>
          </Tabs>
        </Section>

        {/* ── Estados de carga ─────────────────────────────────────── */}
        <Section title="Estados de carga (skeleton)" description="FASE 3: base para loading de tablas y gráficos.">
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </Section>

        {/* ── Escala de espaciado y radios ─────────────────────────── */}
        <Section title="Espaciado y radios" description="FASE 0.2: escalas a usar siempre.">
          <div className="space-y-6">
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Espaciado (Tailwind)</p>
              <div className="flex items-end gap-3">
                {[1, 2, 3, 4, 6, 8].map(n => (
                  <div key={n} className="flex flex-col items-center gap-1">
                    <div className="bg-accent/70" style={{ width: `${n * 4}px`, height: `${n * 4}px` }} />
                    <span className="font-mono text-[10px] text-muted-foreground">{n}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Radios</p>
              <div className="flex flex-wrap gap-4">
                {[
                  { c: "rounded-sm", l: "sm" },
                  { c: "rounded-md", l: "md" },
                  { c: "rounded-lg", l: "lg (base)" },
                  { c: "rounded-xl", l: "xl" },
                  { c: "rounded-full", l: "full" },
                ].map(r => (
                  <div key={r.c} className="flex flex-col items-center gap-1">
                    <div className={`size-12 border border-border bg-secondary ${r.c}`} />
                    <span className="font-mono text-[10px] text-muted-foreground">{r.l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <footer className="pt-8 text-center text-xs text-muted-foreground">
          /styleguide — laboratorio de la Fase 0 · ver DESIGN_PLAN.md
        </footer>
      </div>
    </div>
  );
}
