"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  User as UserIcon, Shield, RefreshCw, Check, LogOut, Eye, EyeOff,
  Lock, Loader2, Upload, Users, Trash2, Plus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type NivelAcceso = "administrador" | "editor" | "visualizador";

interface Profile {
  nombre:       string;
  apellido:     string;
  empresa:      string;
  cargo:        string;
  telefono:     string;
  avatar_url:   string;
  nivel_acceso: NivelAcceso;
}

interface AdminUser {
  id:           string;
  email:        string;
  nombre:       string;
  apellido:     string;
  nivel_acceso: NivelAcceso;
  created_at:   string;
}

const EMPTY_PROFILE: Profile = {
  nombre: "", apellido: "", empresa: "", cargo: "", telefono: "", avatar_url: "", nivel_acceso: "visualizador",
};

const NIVEL_BADGE: Record<NivelAcceso, { label: string; cls: string }> = {
  administrador: { label: "Administrador", cls: "bg-accent/20 text-accent border-accent/30" },
  editor:        { label: "Editor",        cls: "bg-chart-1/20 text-chart-1 border-chart-1/30" },
  visualizador:  { label: "Visualizador",  cls: "bg-muted text-muted-foreground border-border" },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsSection({ user }: { user: User }) {
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

  // Load profile
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("nombre, apellido, empresa, cargo, telefono, avatar_url, nivel_acceso")
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

  const initials = [profile.nombre, profile.apellido]
    .map(s => (s ?? "").trim()[0] ?? "")
    .join("")
    .toUpperCase() || user.email?.[0]?.toUpperCase() || "U";

  // ── Save profile
  const handleSaveProfile = async () => {
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, ...profile, updated_at: new Date().toISOString() });
    if (error) toast.error(`Error al guardar: ${error.message}`);
    else toast.success("Perfil actualizado");
    setSavingProfile(false);
  };

  // ── Upload avatar
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Solo se permiten imágenes"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("La imagen no puede superar 2 MB"); return; }

    setUploadingAvatar(true);
    const ext  = file.name.split(".").pop() ?? "jpg";
    const path = `${user.id}/avatar.${ext}`;

    const { error: upError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (upError) {
      const msg = upError.message.toLowerCase().includes("bucket")
        ? "Bucket 'avatars' no encontrado — crealo en Supabase Storage"
        : `Error al subir: ${upError.message}`;
      toast.error(msg);
      setUploadingAvatar(false);
      e.target.value = "";
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
      toast.success("Avatar actualizado");
    }

    setUploadingAvatar(false);
    e.target.value = "";
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

  // ── Admin: change nivel_acceso
  const handleChangeNivel = async (userId: string, nivel: NivelAcceso) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ userId, nivel_acceso: nivel }),
    });
    if (res.ok) {
      toast.success("Nivel actualizado");
      setAdminUsers(us => us.map(u => u.id === userId ? { ...u, nivel_acceso: nivel } : u));
    } else {
      toast.error("Error al actualizar nivel");
    }
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
          <TabsTrigger value="perfil" className="data-[state=active]:bg-card data-[state=active]:text-foreground">
            <UserIcon className="w-4 h-4 mr-2" />Perfil
          </TabsTrigger>
          <TabsTrigger value="seguridad" className="data-[state=active]:bg-card data-[state=active]:text-foreground">
            <Shield className="w-4 h-4 mr-2" />Seguridad
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger
              value="usuarios"
              className="data-[state=active]:bg-card data-[state=active]:text-foreground"
              onClick={() => { if (adminUsers.length === 0) loadAdminUsers(); }}
            >
              <Users className="w-4 h-4 mr-2" />Usuarios
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── PERFIL ─────────────────────────────────────────────── */}
        <TabsContent value="perfil" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Información personal</CardTitle>
              <CardDescription>Tus datos de perfil guardados en la base de datos</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {loadingProfile ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />Cargando perfil...
                </div>
              ) : (
                <>
                  {/* Avatar */}
                  <div className="flex items-center gap-5">
                    <div className="relative shrink-0">
                      <Avatar className="w-16 h-16 rounded-lg">
                        {profile.avatar_url && (
                          <AvatarImage src={profile.avatar_url} alt={initials} className="rounded-lg" />
                        )}
                        <AvatarFallback className="rounded-lg bg-gradient-to-br from-accent/80 to-chart-1 text-accent-foreground text-xl font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      {uploadingAvatar && (
                        <div className="absolute inset-0 rounded-lg bg-black/40 flex items-center justify-center">
                          <Loader2 className="w-5 h-5 text-white animate-spin" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAvatarUpload}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={uploadingAvatar}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        {uploadingAvatar ? "Subiendo..." : "Cambiar foto"}
                      </Button>
                      <p className="text-xs text-muted-foreground">JPG, PNG o GIF · máx. 2 MB</p>
                    </div>
                  </div>

                  {/* Email + Nivel de acceso */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Email (no editable)</Label>
                      <input
                        type="email"
                        value={user.email ?? ""}
                        disabled
                        className="w-full h-10 px-3 rounded-lg bg-secondary/50 border border-border text-sm text-muted-foreground cursor-not-allowed"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Nivel de acceso</Label>
                      <div className={`inline-flex items-center h-10 px-3 rounded-lg border text-sm font-medium ${badge.cls}`}>
                        {badge.label}
                      </div>
                    </div>
                  </div>

                  {/* Campos editables */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Nombre</Label>
                      {field("nombre")}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Apellido</Label>
                      {field("apellido")}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Empresa / Organización</Label>
                      {field("empresa")}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Puesto</Label>
                      {field("cargo")}
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label>Teléfono</Label>
                      {field("telefono")}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveProfile}
              disabled={savingProfile || loadingProfile}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
            >
              {savingProfile
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Guardando...</>
                : <><Check className="w-4 h-4 mr-2" />Guardar cambios</>}
            </Button>
          </div>

          {/* Cerrar sesión */}
          <Card className="border-destructive/30 bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium text-destructive">Zona de peligro</CardTitle>
              <CardDescription>Acciones que afectan tu sesión activa</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-destructive/15 flex items-center justify-center">
                    <LogOut className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Cerrar sesión</p>
                    <p className="text-sm text-muted-foreground">Salís de tu cuenta en este dispositivo</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleLogout}
                  className="border-destructive/40 text-destructive hover:bg-destructive hover:text-white transition-all"
                >
                  <LogOut className="w-4 h-4 mr-2" />Cerrar sesión
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SEGURIDAD ──────────────────────────────────────────── */}
        <TabsContent value="seguridad" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Cambiar contraseña</CardTitle>
              <CardDescription>Actualizá la contraseña de acceso a tu cuenta</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">

              <div className="space-y-1.5 max-w-md">
                <Label>Contraseña actual</Label>
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

              <div className="space-y-1.5 max-w-md">
                <Label>Nueva contraseña</Label>
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

              <div className="space-y-1.5 max-w-md">
                <Label>Confirmar contraseña</Label>
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

              <Button onClick={handleChangePassword} disabled={savingPass} variant="outline" className="mt-1">
                {savingPass
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Actualizando...</>
                  : <><Check className="w-4 h-4 mr-2" />Actualizar contraseña</>}
              </Button>
            </CardContent>
          </Card>
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
                  onClick={handleCreateUser}
                  disabled={creatingUser}
                  className="bg-accent hover:bg-accent/90 text-accent-foreground"
                >
                  {creatingUser
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creando...</>
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
                <Button variant="outline" size="sm" onClick={loadAdminUsers} disabled={loadingUsers}>
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
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent/60 to-chart-1 flex items-center justify-center text-xs font-semibold text-accent-foreground shrink-0">
                              {(u.nombre?.[0] ?? u.email[0] ?? "?").toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {u.nombre && u.apellido ? `${u.nombre} ${u.apellido}` : u.email}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <select
                              value={u.nivel_acceso}
                              onChange={e => handleChangeNivel(u.id, e.target.value as NivelAcceso)}
                              className={`h-7 px-2 rounded border text-xs font-medium bg-transparent focus:outline-none ${nb.cls}`}
                            >
                              <option value="visualizador">Visualizador</option>
                              <option value="editor">Editor</option>
                              <option value="administrador">Administrador</option>
                            </select>
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
    </div>
  );
}
