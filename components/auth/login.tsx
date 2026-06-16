"use client";

import React, { useState } from "react";
import { Eye, EyeOff, Lock, Mail, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Logo } from "@/components/logo";
import { FloatingInput } from "@/components/ui/floating-input";

export function LoginPage() {
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]             = useState("");
  const [isLoading, setIsLoading]     = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError("Credenciales incorrectas. Verificá tu email y contraseña.");
    }
    // Si tiene éxito, page.tsx detecta el cambio via onAuthStateChange automáticamente.

    setIsLoading(false);
  };

  const CARD_BG = "oklch(0.18 0.005 270)";

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-6 duration-500">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <Logo className="w-12 h-12" />
          <span className="text-2xl font-semibold text-foreground">SaaS Soft</span>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-foreground">Iniciar sesión</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Accedé con tu cuenta de administrador
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <FloatingInput
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              icon={<Mail className="w-4 h-4" />}
              cardBg={CARD_BG}
            />

            {/* Password */}
            <FloatingInput
              label="Contraseña"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              icon={<Lock className="w-4 h-4" />}
              cardBg={CARD_BG}
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ color: "oklch(0.55 0 0)", display: "flex", alignItems: "center" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "oklch(0.85 0 0)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "oklch(0.55 0 0)")}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-10 bg-accent hover:bg-accent/90 text-accent-foreground rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                  Ingresando...
                </>
              ) : (
                "Ingresar"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          SaaS Soft — Acceso restringido a administradores
        </p>
      </div>
    </div>
  );
}
