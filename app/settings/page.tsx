"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { FileText, LogOut, User } from "lucide-react";
import { useRouter } from "next/navigation";

interface UserProfile {
  email?: string;
  user_metadata?: {
    full_name?: string;
  };
}

export default function SettingsPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/");
        return;
      }
      setUser(user as unknown as UserProfile);
      setLoading(false);
    };
    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-4xl font-bold text-foreground mb-8">Configuraciones</h1>

        {/* User Profile Card */}
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
              <User className="w-6 h-6 text-accent" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Usuario autenticado</p>
              <p className="font-semibold text-foreground">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Portfolio Link Card */}
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-accent" />
            Portfolio Presentation
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Accede a tu presentación profesional del proyecto en formato PDF para compartir en tu portfolio.
          </p>
          <Link
            href="/portfolio"
            className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg font-medium transition-colors"
          >
            <FileText className="w-4 h-4" />
            Ver Portfolio & Descargar PDF
          </Link>
        </div>

        {/* Logout Button */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-4 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg font-medium transition-colors border border-red-500/20"
        >
          <LogOut className="w-5 h-5" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
