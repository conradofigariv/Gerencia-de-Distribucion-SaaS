"use client";

import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  User as UserIcon, Shield, RefreshCw, Check, LogOut, Eye, EyeOff, Lock, Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  nombre:     string;
  apellido:   string;
  empresa:    string;
  cargo:      string;
  telefono:   string;
  avatar_url: string;
}

const EMPTY_PROFILE: Profile = { nombre: "", apellido: "", empresa: "", cargo: "", telefono: "", avatar_url: "" };

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsSection({ user }: { user: User }) {
  const [profile, setProfile]     = useState<Profile>(EMPTY_PROFILE);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile]   = useState(false);

  // Password change
  const [newPass, setNewPass]       = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [savingPass, setSavingPass]   = useState(false);

  // Load profile
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("nombre, apellido, empresa, cargo, telefono, avatar_url")
        .eq("id", user.id)
        .single();
      if (!error && data) {
        // Coerce null DB values to empty strings to avoid runtime errors
        const clean = Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v ?? ""])
        ) as Profile;
        setProfile({ ...EMPTY_PROFILE, ...clean });
      }
      setLoadingProfile(false);
    })();
  }, [user.id]);

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

  // ── Change password
  const handleChangePassword = async () => {
    if (!newPass.trim()) { toast.error("Ingresá una contraseña nueva"); return; }
    if (newPass !== confirmPass) { toast.error("Las contraseñas no coinciden"); return; }
    if (newPass.length < 6) { toast.error("La contraseña debe tener al menos 6 caracteres"); return; }
    setSavingPass(true);
    const { error } = await supabase.auth.updateUser({ password: newPass });
    if (error) toast.error(`Error: ${error.message}`);
    else {
      toast.success("Contraseña actualizada");
      setNewPass("");
      setConfirmPass("");
    }
    setSavingPass(false);
  };

  // ── Logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
    // page.tsx detecta el cambio via onAuthStateChange
  };

  const field = (key: keyof Profile) => (
    <input
      type="text"
      value={profile[key]}
      onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))}
      className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
    />
  );

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
                    <Avatar className="w-16 h-16 rounded-lg">
                      {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt={initials} className="rounded-lg" />}
                      <AvatarFallback className="rounded-lg bg-gradient-to-br from-accent/80 to-chart-1 text-accent-foreground text-xl font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">URL de avatar (opcional)</Label>
                      <input
                        type="url"
                        value={profile.avatar_url}
                        onChange={e => setProfile(p => ({ ...p, avatar_url: e.target.value }))}
                        placeholder="https://..."
                        className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
                      />
                    </div>
                  </div>

                  {/* Email (readonly) */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Email (no editable)</Label>
                    <input
                      type="email"
                      value={user.email ?? ""}
                      disabled
                      className="w-full h-10 px-3 rounded-lg bg-secondary/50 border border-border text-sm text-muted-foreground cursor-not-allowed"
                    />
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
                      <Label>Cargo</Label>
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
                  <LogOut className="w-4 h-4 mr-2" />
                  Cerrar sesión
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SEGURIDAD ──────────────────────────────────────────── */}
        <TabsContent value="seguridad" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">

          {/* Cambiar contraseña */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Cambiar contraseña</CardTitle>
              <CardDescription>Actualizá la contraseña de acceso a tu cuenta</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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

              <Button
                onClick={handleChangePassword}
                disabled={savingPass}
                variant="outline"
                className="mt-1"
              >
                {savingPass
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Actualizando...</>
                  : <><Check className="w-4 h-4 mr-2" />Actualizar contraseña</>}
              </Button>
            </CardContent>
          </Card>

        </TabsContent>
      </Tabs>
    </div>
  );
}
