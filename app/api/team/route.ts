import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ─── Directorio del equipo (para compartir pestañas del Buscador) ──────────
// A diferencia de /api/admin/users, este endpoint NO es solo para admins:
// cualquier usuario autenticado puede compartir una pestaña propia con un
// colega, y para elegirlo necesita poder buscarlo — por nombre O por email.
// `profiles` (leíble por cualquiera) no tiene email, ese dato vive en
// auth.users, que solo la service role puede leer — de ahí la ruta.
//
// Devuelve solo lo mínimo para el picker (id, email, nombre, apellido,
// avatar) — nada de nivel_acceso ni fechas, que no hacen falta para esto.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, nombre, apellido, avatar_url");

  type ProfileRow = { id: string; nombre: string | null; apellido: string | null; avatar_url: string | null };
  const profileMap = Object.fromEntries((profiles ?? [] as ProfileRow[]).map((p: ProfileRow) => [p.id, p]));

  const equipo = authData.users.map(u => ({
    id:         u.id,
    email:      u.email ?? "",
    nombre:     profileMap[u.id]?.nombre ?? "",
    apellido:   profileMap[u.id]?.apellido ?? "",
    avatar_url: profileMap[u.id]?.avatar_url ?? null,
  }));

  return NextResponse.json({ equipo });
}
