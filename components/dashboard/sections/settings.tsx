"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  User as UserIcon, Shield, RefreshCw, Check, LogOut, Eye, EyeOff,
  Lock, Loader2, Upload, Users, Trash2, Plus, ListChecks, ChevronDown, Pencil,
} from "lucide-react";
import { SIDEBAR_SECTIONS } from "@/components/dashboard/sidebar";
import { AvatarCropDialog } from "@/components/dashboard/avatar-crop-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type NivelAcceso = "administrador" | "editor" | "visualizador";

interface Profile {
  nombre:       string;
  apellido:     string;
  empresa:      string;
  cargo:        string;
  telefono:     string;
  cumpleanos:   string;
  avatar_url:   string;
  nivel_acceso: NivelAcceso;
}

interface AdminUser {
  id:                   string;
  email:                string;
  nombre:               string;
  apellido:             string;
  empresa:              string;
  cargo:                string;
  telefono:             string;
  cumpleanos:           string;
  avatar_url:           string;
  nivel_acceso:         NivelAcceso;
  // null = sin restricción, ve todo (default). Ver lib/sectionAccess.ts.
  secciones_permitidas: string[] | null;
  // Plantilla asignada. Si está, PISA a secciones_permitidas — ver
  // resolverSecciones() en lib/sectionAccess.ts.
  plantilla_acceso_id:  string | null;
  created_at:           string;
}

const EMPTY_PROFILE: Profile = {
  nombre: "", apellido: "", empresa: "", cargo: "", telefono: "", cumpleanos: "", avatar_url: "", nivel_acceso: "visualizador",
};

const NIVEL_BADGE: Record<NivelAcceso, { label: string; cls: string }> = {
  administrador: { label: "Administrador", cls: "bg-accent/20 text-accent border-accent/30" },
  editor:        { label: "Editor",        cls: "bg-chart-1/20 text-chart-1 border-chart-1/30" },
  visualizador:  { label: "Visualizador",  cls: "bg-muted text-muted-foreground border-border" },
};

// ─── Plantillas de acceso ───────────────────────────────────────────────────
// Antes esto era un desplegable con 18 checkboxes por usuario, y había que
// repetirlo para cada persona con el mismo rol. Ahora el conjunto de secciones
// se define UNA vez como plantilla con nombre y se asigna de un click; editar
// la plantilla actualiza a todos los que la tienen (es una referencia viva,
// no una copia — ver supabase/acceso_plantillas.sql).

interface Plantilla { id: string; nombre: string; secciones: string[] }

/** Texto corto del acceso de un usuario, para la fila de la lista. */
function resumenAcceso(u: AdminUser, plantillas?: Plantilla[]): string {
  if (u.nivel_acceso === "administrador") return "Ve todo";
  if (u.plantilla_acceso_id) {
    return plantillas?.find((p) => p.id === u.plantilla_acceso_id)?.nombre ?? "Plantilla";
  }
  if (u.secciones_permitidas == null) return "Sin restricción";
  return `${u.secciones_permitidas.length} secciones`;
}

/** Checkboxes agrupados por grupo del sidebar. Se usa al crear/editar plantillas. */
function SeccionesCheckboxes({
  value, onChange,
}: { value: string[]; onChange: (v: string[]) => void }) {
  const grupos = useMemo(() => {
    const map = new Map<string, { id: string; label: string }[]>();
    for (const s of SIDEBAR_SECTIONS) {
      const g = s.group ?? "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push({ id: s.id, label: s.label });
    }
    return [...map.entries()];
  }, []);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  // Marcar/desmarcar un grupo entero: la mayoría de los grupos se dan o se
  // quitan completos, y tildarlos de a uno era la parte más tediosa.
  const toggleGrupo = (ids: string[], todos: boolean) =>
    onChange(todos ? value.filter((x) => !ids.includes(x)) : [...new Set([...value, ...ids])]);

  return (
    <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => onChange(SIDEBAR_SECTIONS.map((s) => s.id))}>
          Todas
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => onChange([])}>
          Ninguna
        </Button>
      </div>
      {grupos.map(([grupo, items]) => {
        const ids = items.map((i) => i.id);
        const todos = ids.every((id) => value.includes(id));
        return (
          <div key={grupo || "_top"}>
            {grupo ? (
              <label className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground mb-1 cursor-pointer">
                <input type="checkbox" checked={todos} onChange={() => toggleGrupo(ids, todos)} className="accent-accent" />
                {grupo}
              </label>
            ) : null}
            <div className={cn("space-y-1", grupo && "pl-5")}>
              {items.map((it) => (
                <label key={it.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={value.includes(it.id)} onChange={() => toggle(it.id)} className="accent-accent" />
                  {it.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Editar usuario (admin) ──────────────────────────────────────────────────
// A diferencia del resto de la lista (nivel de acceso, secciones), esto edita
// los mismos campos que "Perfil" pero DE OTRO usuario — algo que la UPDATE
// policy de `profiles` no deja hacer desde el cliente (cada uno solo puede
// tocar su propia fila). Por eso viaja como multipart a /api/admin/users, que
// escribe con la service role key. Ver el comentario de CAMPOS_PERFIL_EDITABLES
// en esa ruta.

function EditUserDialog({
  usuario, plantillas, esYo, open, onOpenChange, onSaved, onGestionarPlantillas,
}: {
  usuario: AdminUser;
  plantillas: Plantilla[];
  /** El admin no puede bajarse el propio nivel y quedarse afuera. */
  esYo: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (patch: Partial<AdminUser>) => void;
  onGestionarPlantillas: () => void;
}) {
  const [nombre,     setNombre]     = useState(usuario.nombre);
  const [apellido,   setApellido]   = useState(usuario.apellido);
  const [empresa,    setEmpresa]    = useState(usuario.empresa);
  const [cargo,      setCargo]      = useState(usuario.cargo);
  const [telefono,   setTelefono]   = useState(usuario.telefono);
  const [cumpleanos, setCumpleanos] = useState(usuario.cumpleanos);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Recorte antes de subir: mismo diálogo que usa la propia pestaña "Perfil".
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  // Acceso: nivel + plantilla. "" = sin plantilla (sin restricción).
  const [nivel, setNivel] = useState<NivelAcceso>(usuario.nivel_acceso);
  const [plantillaId, setPlantillaId] = useState<string>(usuario.plantilla_acceso_id ?? "");

  // Cada apertura vuelve a partir del usuario actual — sin esto, editar a
  // Juan y después a María mostraría los campos de Juan a medio tipear.
  useEffect(() => {
    if (!open) return;
    setNombre(usuario.nombre); setApellido(usuario.apellido);
    setEmpresa(usuario.empresa); setCargo(usuario.cargo);
    setTelefono(usuario.telefono); setCumpleanos(usuario.cumpleanos);
    setAvatarFile(null); setAvatarPreview(null);
    setNivel(usuario.nivel_acceso);
    setPlantillaId(usuario.plantilla_acceso_id ?? "");
  }, [open, usuario]);

  const initials = [nombre, apellido].map((s) => s.trim()[0] ?? "").join("").toUpperCase() || usuario.email[0]?.toUpperCase() || "U";

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Solo se permiten imágenes"); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("La imagen no puede superar 8 MB"); return; }
    setCropFile(file);
    setCropOpen(true);
  };

  const handleCropped = (file: File) => {
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleGuardar = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.set("userId", usuario.id);
      form.set("nombre", nombre);
      form.set("apellido", apellido);
      form.set("empresa", empresa);
      form.set("cargo", cargo);
      form.set("telefono", telefono);
      form.set("cumpleanos", cumpleanos);
      if (avatarFile) form.set("avatar", avatarFile);

      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Error al guardar");

      // El acceso (nivel + plantilla) va en una segunda llamada, en JSON: el
      // PATCH multipart de arriba solo toca campos de perfil, y no se mezclan
      // a propósito — así el camino de permisos queda separado del de datos.
      const cambioAcceso = nivel !== usuario.nivel_acceso
        || (plantillaId || null) !== usuario.plantilla_acceso_id;
      if (cambioAcceso) {
        const res2 = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            userId: usuario.id,
            nivel_acceso: nivel,
            plantilla_acceso_id: plantillaId || null,
          }),
        });
        const json2 = await res2.json().catch(() => ({}));
        if (!res2.ok) throw new Error(json2.error ?? "Error al guardar el acceso");
      }

      onSaved({
        nombre, apellido, empresa, cargo, telefono, cumpleanos,
        nivel_acceso: nivel,
        plantilla_acceso_id: plantillaId || null,
        // El backend limpia secciones_permitidas al asignar una plantilla; se
        // refleja acá para que la fila no muestre un resumen que ya no aplica.
        ...(plantillaId ? { secciones_permitidas: null } : {}),
        ...(json.avatar_url ? { avatar_url: json.avatar_url as string } : {}),
      });
      toast.success("Usuario actualizado");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar usuario</DialogTitle>
          <DialogDescription>{usuario.email}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <Avatar className="w-16 h-16 rounded-lg">
                {(avatarPreview || usuario.avatar_url) && (
                  <AvatarImage src={avatarPreview || usuario.avatar_url} alt={initials} className="rounded-lg" />
                )}
                <AvatarFallback className="rounded-lg bg-gradient-to-br from-accent/80 to-chart-1 text-accent-foreground text-xl font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="space-y-2">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" />
                {avatarFile ? "Cambiar imagen elegida" : "Subir foto"}
              </Button>
              <p className="text-xs text-muted-foreground">JPG, PNG o GIF · se recorta antes de subir</p>
            </div>
          </div>

          <AvatarCropDialog file={cropFile} open={cropOpen} onOpenChange={setCropOpen} onCropped={handleCropped} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nombre</Label>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Apellido</Label>
              <input value={apellido} onChange={(e) => setApellido(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Empresa</Label>
              <input value={empresa} onChange={(e) => setEmpresa(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Cargo</Label>
              <input value={cargo} onChange={(e) => setCargo(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Teléfono</Label>
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Cumpleaños</Label>
              <input type="date" value={cumpleanos} onChange={(e) => setCumpleanos(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all" />
            </div>
          </div>

          <Separator className="bg-border" />

          {/* ── Acceso ──
              Dos decisiones y nada más: qué puede HACER (nivel) y qué SECCIONES
              ve (plantilla). Antes había que tildar 18 checkboxes acá mismo. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Acceso</Label>
              <button
                type="button"
                onClick={onGestionarPlantillas}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
              >
                Gestionar plantillas
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Nivel</Label>
                <select
                  value={nivel}
                  onChange={(e) => setNivel(e.target.value as NivelAcceso)}
                  disabled={esYo}
                  title={esYo ? "No podés cambiarte el nivel a vos mismo" : undefined}
                  className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="visualizador">Visualizador</option>
                  <option value="editor">Editor</option>
                  <option value="administrador">Administrador</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Plantilla de secciones</Label>
                <select
                  value={plantillaId}
                  onChange={(e) => setPlantillaId(e.target.value)}
                  disabled={nivel === "administrador"}
                  title={nivel === "administrador" ? "Los administradores ven todas las secciones" : undefined}
                  className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Sin restricción (ve todo)</option>
                  {plantillas.map((pl) => (
                    <option key={pl.id} value={pl.id}>{pl.nombre}</option>
                  ))}
                </select>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {nivel === "administrador"
                ? "Los administradores ven todas las secciones, sin importar la plantilla."
                : plantillaId
                  ? `Ve ${plantillas.find((pl) => pl.id === plantillaId)?.secciones.length ?? 0} secciones. Si editás la plantilla, cambia para todos los que la tienen.`
                  : "Sin plantilla ve todas las secciones. Elegí una para restringirlo."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button variant="accent" onClick={handleGuardar} loading={saving}>
            {!saving && <Check className="w-4 h-4 mr-2" />}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ─── Gestión de plantillas (admin) ──────────────────────────────────────────
// Crear, renombrar, cambiar qué secciones incluye y borrar. Todo pasa por
// /api/admin/plantillas: la tabla es de solo lectura para el cliente.

function PlantillasDialog({
  open, onOpenChange, plantillas, onCambio,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plantillas: Plantilla[];
  onCambio: () => void;
}) {
  const [editando, setEditando] = useState<Plantilla | null>(null);
  const [nombre, setNombre] = useState("");
  const [secciones, setSecciones] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  const limpiar = () => { setEditando(null); setNombre(""); setSecciones([]); };
  useEffect(() => { if (!open) limpiar(); }, [open]);

  const auth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
  };

  const guardar = async () => {
    if (!nombre.trim()) { toast.error("Poné un nombre."); return; }
    setGuardando(true);
    try {
      const headers = await auth();
      const res = await fetch("/api/admin/plantillas", {
        method: editando ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(editando
          ? { id: editando.id, nombre, secciones }
          : { nombre, secciones }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Error al guardar");
      toast.success(editando ? "Plantilla actualizada" : "Plantilla creada");
      limpiar();
      onCambio();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (pl: Plantilla) => {
    if (!confirm(`¿Borrar la plantilla «${pl.nombre}»? Los usuarios que la tengan quedan sin restricción.`)) return;
    try {
      const headers = await auth();
      const res = await fetch(`/api/admin/plantillas?id=${pl.id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Error al borrar");
      toast.success("Plantilla borrada");
      if (editando?.id === pl.id) limpiar();
      onCambio();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al borrar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Plantillas de acceso</DialogTitle>
          <DialogDescription>
            Definí una vez qué secciones incluye cada plantilla y asignala a los usuarios.
            Editarla actualiza a todos los que la tienen.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 py-2">
          {/* Lista */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Plantillas</Label>
            {plantillas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Todavía no hay ninguna.</p>
            ) : (
              <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
                {plantillas.map((pl) => (
                  <div
                    key={pl.id}
                    className={cn(
                      "flex items-center justify-between gap-2 p-2.5 rounded-lg border transition-colors",
                      editando?.id === pl.id ? "border-accent/50 bg-accent/10" : "border-border bg-secondary/40"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => { setEditando(pl); setNombre(pl.nombre); setSecciones(pl.secciones); }}
                      className="min-w-0 text-left flex-1"
                    >
                      <p className="text-sm font-medium text-foreground truncate">{pl.nombre}</p>
                      <p className="text-xs text-muted-foreground">{pl.secciones.length} secciones</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => borrar(pl)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {editando && (
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={limpiar}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />Crear una nueva
              </Button>
            )}
          </div>

          {/* Editor */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {editando ? "Editando plantilla" : "Nueva plantilla"}
              </Label>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre de la plantilla"
                className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
              />
            </div>
            <SeccionesCheckboxes value={secciones} onChange={setSecciones} />
            <Button variant="accent" className="w-full" onClick={guardar} loading={guardando}>
              {!guardando && <Check className="w-4 h-4 mr-2" />}
              {editando ? "Guardar cambios" : "Crear plantilla"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SettingsSectionProps {
  user: User;
  onProfileUpdate?: (p: { nombre: string; apellido: string; avatar_url: string }) => void;
}

export function SettingsSection({ user, onProfileUpdate }: SettingsSectionProps) {
  const [profile, setProfile]               = useState<Profile>(EMPTY_PROFILE);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile]   = useState(false);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password change
  const [currentPass, setCurrentPass]         = useState("");
  const [newPass, setNewPass]                 = useState("");
  const [confirmPass, setConfirmPass]         = useState("");
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass]         = useState(false);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [savingPass, setSavingPass]           = useState(false);

  // Admin users tab
  const [adminUsers, setAdminUsers]     = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPass, setNewUserPass]   = useState("");
  const [newUserNivel, setNewUserNivel] = useState<NivelAcceso>("visualizador");
  const [creatingUser, setCreatingUser] = useState(false);
  const [editingUser, setEditingUser]   = useState<AdminUser | null>(null);
  const [plantillas, setPlantillas]     = useState<Plantilla[]>([]);
  const [plantillasOpen, setPlantillasOpen] = useState(false);

  // Load profile
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("nombre, apellido, empresa, cargo, telefono, cumpleanos, avatar_url, nivel_acceso")
        .eq("id", user.id)
        .single();
      if (!error && data) {
        const clean = Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v ?? ""])
        ) as unknown as Profile;
        setProfile({ ...EMPTY_PROFILE, ...clean });
      }
      setLoadingProfile(false);
    })();
  }, [user.id]);

  const isAdmin = profile.nivel_acceso === "administrador";

  const loadAdminUsers = useCallback(async () => {
    setLoadingUsers(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (res.ok) {
      const json = await res.json();
      setAdminUsers(json.users ?? []);
    } else {
      toast.error("No se pudieron cargar los usuarios");
    }
    setLoadingUsers(false);
  }, []);

  // Las plantillas se usan tanto en el resumen de cada fila como en el
  // desplegable del diálogo, así que se cargan junto con los usuarios.
  const loadPlantillas = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/plantillas", {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (res.ok) setPlantillas((await res.json()).plantillas ?? []);
  }, []);

  const initials = [profile.nombre, profile.apellido]
    .map(s => (s ?? "").trim()[0] ?? "")
    .join("")
    .toUpperCase() || user.email?.[0]?.toUpperCase() || "U";

  // ── Save profile
  const handleSaveProfile = async () => {
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        ...profile,
        cumpleanos: profile.cumpleanos || null, // columna date: "" no es válido
        updated_at: new Date().toISOString(),
      });
    if (error) toast.error(`Error al guardar: ${error.message}`);
    else {
      toast.success("Perfil actualizado");
      onProfileUpdate?.({ nombre: profile.nombre, apellido: profile.apellido, avatar_url: profile.avatar_url });
    }
    setSavingProfile(false);
  };

  // ── Elegir archivo → recortar → subir. El input ya no sube directo: abre el
  // diálogo de encuadre y `handleAvatarUpload` recibe el PNG ya recortado, no
  // el archivo crudo — así lo que se guarda es exactamente lo que se vio en
  // el círculo guía, no lo que object-cover decida centrar solo.
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  const handleFileElegido = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Solo se permiten imágenes"); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("La imagen no puede superar 8 MB"); return; }
    setCropFile(file);
    setCropOpen(true);
  };

  const handleAvatarUpload = async (file: File) => {
    setUploadingAvatar(true);
    const path = `${user.id}/avatar.png`;

    const { error: upError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (upError) {
      const msg = upError.message.toLowerCase().includes("bucket")
        ? "Bucket 'avatars' no encontrado — crealo en Supabase Storage"
        : `Error al subir: ${upError.message}`;
      toast.error(msg);
      setUploadingAvatar(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = `${publicUrl}?t=${Date.now()}`;

    const { error: saveError } = await supabase
      .from("profiles")
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq("id", user.id);

    if (saveError) toast.error(`Error al guardar: ${saveError.message}`);
    else {
      setProfile(p => ({ ...p, avatar_url: url }));
      onProfileUpdate?.({ nombre: profile.nombre, apellido: profile.apellido, avatar_url: url });
      toast.success("Avatar actualizado");
    }

    setUploadingAvatar(false);
  };

  // ── Change password (verifies current password first)
  const handleChangePassword = async () => {
    if (!currentPass.trim()) { toast.error("Ingresá tu contraseña actual"); return; }
    if (!newPass.trim()) { toast.error("Ingresá una contraseña nueva"); return; }
    if (newPass !== confirmPass) { toast.error("Las contraseñas no coinciden"); return; }
    if (newPass.length < 6) { toast.error("La contraseña debe tener al menos 6 caracteres"); return; }
    if (currentPass === newPass) { toast.error("La nueva contraseña debe ser diferente"); return; }

    setSavingPass(true);

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPass,
    });
    if (verifyError) {
      toast.error("Contraseña actual incorrecta");
      setSavingPass(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPass });
    if (error) toast.error(`Error: ${error.message}`);
    else {
      toast.success("Contraseña actualizada");
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
    }
    setSavingPass(false);
  };

  // ── Admin: create user
  const handleCreateUser = async () => {
    if (!newUserEmail.trim() || !newUserPass.trim()) {
      toast.error("Completá email y contraseña"); return;
    }
    setCreatingUser(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ email: newUserEmail, password: newUserPass, nivel_acceso: newUserNivel }),
    });
    const json = await res.json();
    if (res.ok) {
      toast.success("Usuario creado");
      setNewUserEmail("");
      setNewUserPass("");
      setNewUserNivel("visualizador");
      loadAdminUsers();
    } else {
      toast.error(json.error ?? "Error al crear usuario");
    }
    setCreatingUser(false);
  };

  // ── Admin: delete user
  const handleDeleteUser = async (userId: string) => {
    if (!confirm("¿Eliminás este usuario? Esta acción no se puede deshacer.")) return;
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/users?userId=${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (res.ok) {
      toast.success("Usuario eliminado");
      setAdminUsers(us => us.filter(u => u.id !== userId));
    } else {
      toast.error("Error al eliminar usuario");
    }
  };

  // ── Logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const field = (key: keyof Omit<Profile, "nivel_acceso">) => (
    <input
      type="text"
      value={profile[key] as string}
      onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))}
      className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
    />
  );

  const badge = NIVEL_BADGE[profile.nivel_acceso] ?? NIVEL_BADGE.visualizador;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Configuración</h2>
        <p className="text-sm text-muted-foreground mt-1">Gestioná tu cuenta y preferencias</p>
      </div>

      <Tabs defaultValue="perfil" className="space-y-6">
        <TabsList className="bg-secondary border border-border p-1">
          {/* "Seguridad" ya no es una pestaña propia: tenía una sola tarjeta
              (cambiar contraseña) y obligaba a cambiar de vista para algo que
              es parte de la misma cuenta. Ahora convive con el perfil en la
              columna de la derecha. */}
          <TabsTrigger value="perfil" className="data-[state=active]:bg-card data-[state=active]:text-foreground">
            <UserIcon className="w-4 h-4 mr-2" />Mi cuenta
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger
              value="usuarios"
              className="data-[state=active]:bg-card data-[state=active]:text-foreground"
              onClick={() => { if (adminUsers.length === 0) { loadAdminUsers(); loadPlantillas(); } }}
            >
              <Users className="w-4 h-4 mr-2" />Usuarios
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── MI CUENTA (perfil + seguridad) ──────────────────────
            Dos columnas en pantallas grandes: los datos personales, que es lo
            que más se toca, y a la derecha lo de la cuenta en sí (contraseña y
            cerrar sesión). Antes "Seguridad" era una pestaña aparte con una
            sola tarjeta, y había que cambiar de vista para algo que pertenece
            al mismo lugar. */}
        <TabsContent value="perfil" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

            {/* ── Datos personales ── */}
            <Card className="border-border bg-card lg:col-span-2">
              <CardContent className="p-5 space-y-5">
                {loadingProfile ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                    <Loader2 className="w-4 h-4 animate-spin" />Cargando perfil...
                  </div>
                ) : (
                  <>
                    {/* Identidad: foto grande + quién sos + nivel. Redondo, no
                        cuadrado, porque el recorte que se sube ya es un círculo
                        y así coincide con cómo se ve el avatar en el resto de
                        la app (header, Yerba, lista de usuarios). */}
                    <div className="flex items-center gap-5">
                      <div className="relative shrink-0">
                        <Avatar className="w-28 h-28 ring-4 ring-accent/15">
                          {profile.avatar_url && (
                            <AvatarImage src={profile.avatar_url} alt={initials} />
                          )}
                          <AvatarFallback className="bg-gradient-to-br from-accent/80 to-chart-1 text-accent-foreground text-3xl font-semibold">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        {uploadingAvatar && (
                          <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                            <Loader2 className="w-6 h-6 text-white animate-spin" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 space-y-2">
                        <div className="min-w-0">
                          <p className="text-lg font-semibold text-foreground truncate">
                            {[profile.nombre, profile.apellido].filter(Boolean).join(" ") || "Sin nombre"}
                          </p>
                          <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center h-7 px-2.5 rounded-md border text-xs font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileElegido}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7"
                            disabled={uploadingAvatar}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Upload className="w-3.5 h-3.5 mr-1.5" />
                            {uploadingAvatar ? "Subiendo..." : "Cambiar foto"}
                          </Button>
                        </div>
                      </div>
                    </div>

                    <Separator className="bg-border" />

                    {/* Campos. gap-y chico: son pares label+input cortos y con
                        el espaciado anterior la tarjeta quedaba larguísima con
                        aire muerto entre filas. */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Nombre</Label>
                        {field("nombre")}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Apellido</Label>
                        {field("apellido")}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Empresa / Organización</Label>
                        {field("empresa")}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Puesto</Label>
                        {field("cargo")}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Teléfono</Label>
                        {field("telefono")}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Cumpleaños</Label>
                        <input
                          type="date"
                          value={profile.cumpleanos}
                          onChange={e => setProfile(p => ({ ...p, cumpleanos: e.target.value }))}
                          style={{ colorScheme: "dark" }}
                          className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
                        />
                      </div>
                    </div>

                    {/* Guardar dentro de la tarjeta: antes flotaba suelto
                        debajo y no se leía a qué bloque pertenecía. */}
                    <div className="flex justify-end pt-1">
                      <Button variant="accent" onClick={handleSaveProfile} loading={savingProfile}>
                        {savingProfile ? "Guardando..." : <><Check className="w-4 h-4 mr-2" />Guardar cambios</>}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── Cuenta: contraseña + cerrar sesión ── */}
            <div className="space-y-5">
              <Card className="border-border bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <Shield className="w-4 h-4 text-muted-foreground" />Contraseña
                  </CardTitle>
                  <CardDescription>Actualizá la clave de acceso a tu cuenta</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Contraseña actual</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type={showCurrentPass ? "text" : "password"}
                        value={currentPass}
                        onChange={e => setCurrentPass(e.target.value)}
                        placeholder="Tu contraseña actual"
                        className="w-full h-10 pl-10 pr-10 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
                      />
                      <button type="button" onClick={() => setShowCurrentPass(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showCurrentPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Nueva contraseña</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type={showNewPass ? "text" : "password"}
                        value={newPass}
                        onChange={e => setNewPass(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        className="w-full h-10 pl-10 pr-10 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
                      />
                      <button type="button" onClick={() => setShowNewPass(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Confirmar contraseña</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type={showConfirm ? "text" : "password"}
                        value={confirmPass}
                        onChange={e => setConfirmPass(e.target.value)}
                        placeholder="Repetí la contraseña"
                        className="w-full h-10 pl-10 pr-10 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
                      />
                      <button type="button" onClick={() => setShowConfirm(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <Button onClick={handleChangePassword} disabled={savingPass} variant="outline" className="w-full">
                    {savingPass
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Actualizando...</>
                      : <><Check className="w-4 h-4 mr-2" />Actualizar contraseña</>}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-destructive/30 bg-card">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-destructive/15 flex items-center justify-center shrink-0">
                      <LogOut className="w-4 h-4 text-destructive" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">Cerrar sesión</p>
                      <p className="text-xs text-muted-foreground">Salís de tu cuenta en este dispositivo</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="w-full border-destructive/40 text-destructive hover:bg-destructive hover:text-white transition-all"
                  >
                    <LogOut className="w-4 h-4 mr-2" />Cerrar sesión
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── USUARIOS (admin only) ──────────────────────────────── */}
        {isAdmin && (
          <TabsContent value="usuarios" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">

            {/* Crear usuario */}
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base font-medium">Crear usuario</CardTitle>
                <CardDescription>Agregá un nuevo usuario al sistema</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <input
                      type="email"
                      value={newUserEmail}
                      onChange={e => setNewUserEmail(e.target.value)}
                      placeholder="usuario@empresa.com"
                      className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contraseña inicial</Label>
                    <input
                      type="password"
                      value={newUserPass}
                      onChange={e => setNewUserPass(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Nivel de acceso</Label>
                    <select
                      value={newUserNivel}
                      onChange={e => setNewUserNivel(e.target.value as NivelAcceso)}
                      className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
                    >
                      <option value="visualizador">Visualizador</option>
                      <option value="editor">Editor</option>
                      <option value="administrador">Administrador</option>
                    </select>
                  </div>
                </div>
                <Button
                  variant="accent"
                  onClick={handleCreateUser}
                  loading={creatingUser}
                >
                  {creatingUser
                    ? "Creando..."
                    : <><Plus className="w-4 h-4 mr-2" />Crear usuario</>}
                </Button>
              </CardContent>
            </Card>

            {/* Lista de usuarios */}
            <Card className="border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-medium">Usuarios del sistema</CardTitle>
                  <CardDescription>Gestioná los accesos del equipo</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => { loadAdminUsers(); loadPlantillas(); }} disabled={loadingUsers}>
                  {loadingUsers
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <RefreshCw className="w-4 h-4" />}
                </Button>
              </CardHeader>
              <CardContent>
                {loadingUsers ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />Cargando usuarios...
                  </div>
                ) : adminUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No hay usuarios para mostrar.</p>
                ) : (
                  <div className="space-y-2">
                    {adminUsers.map(u => {
                      const nb = NIVEL_BADGE[u.nivel_acceso] ?? NIVEL_BADGE.visualizador;
                      return (
                        <div key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/40 border border-border">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar className="w-8 h-8 shrink-0">
                              {u.avatar_url && <AvatarImage src={u.avatar_url} alt={u.nombre || u.email} />}
                              <AvatarFallback className="bg-gradient-to-br from-accent/60 to-chart-1 text-xs font-semibold text-accent-foreground">
                                {(u.nombre?.[0] ?? u.email[0] ?? "?").toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {u.nombre && u.apellido ? `${u.nombre} ${u.apellido}` : u.email}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            {/* Solo lectura: el nivel se cambia en el diálogo,
                                junto con la plantilla — son la misma decisión. */}
                            <span className={`h-7 px-2.5 rounded border text-xs font-medium inline-flex items-center ${nb.cls}`}>
                              {nb.label}
                            </span>
                            {/* La fila solo RESUME el acceso; asignarlo se hace
                                en el diálogo del lápiz, donde hay espacio. */}
                            <span
                              title={u.nivel_acceso === "administrador"
                                ? "Los administradores siempre ven todas las secciones"
                                : "Editá el acceso desde el lápiz"}
                              className="h-7 px-2.5 rounded border border-border text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5 max-w-[180px]"
                            >
                              <ListChecks className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{resumenAcceso(u, plantillas)}</span>
                            </span>
                            <button
                              onClick={() => setEditingUser(u)}
                              title="Editar datos, foto y acceso"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            {u.id !== user.id && (
                              <button
                                onClick={() => handleDeleteUser(u.id)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <AvatarCropDialog
        file={cropFile}
        open={cropOpen}
        onOpenChange={setCropOpen}
        onCropped={handleAvatarUpload}
      />

      {editingUser && (
        <EditUserDialog
          usuario={editingUser}
          plantillas={plantillas}
          esYo={editingUser.id === user.id}
          open={!!editingUser}
          onOpenChange={(v) => { if (!v) setEditingUser(null); }}
          onGestionarPlantillas={() => setPlantillasOpen(true)}
          onSaved={(patch) => {
            setAdminUsers((us) => us.map((u) => (u.id === editingUser.id ? { ...u, ...patch } : u)));
            // El usuario editado puede ser uno mismo (un admin editándose desde
            // acá en vez de la pestaña "Perfil") — sin este aviso, el header y
            // la pestaña Perfil seguirían mostrando el nombre/foto viejos hasta
            // recargar la página.
            if (editingUser.id === user.id) {
              onProfileUpdate?.({
                nombre: patch.nombre ?? editingUser.nombre,
                apellido: patch.apellido ?? editingUser.apellido,
                avatar_url: patch.avatar_url ?? editingUser.avatar_url,
              });
            }
          }}
        />
      )}

      <PlantillasDialog
        open={plantillasOpen}
        onOpenChange={setPlantillasOpen}
        plantillas={plantillas}
        // Al cambiar una plantilla se recargan también los usuarios: el
        // resumen de cada fila sale del nombre de la plantilla, y borrar una
        // deja a sus usuarios sin plantilla (ON DELETE SET NULL).
        onCambio={() => { loadPlantillas(); loadAdminUsers(); }}
      />
    </div>
  );
}
