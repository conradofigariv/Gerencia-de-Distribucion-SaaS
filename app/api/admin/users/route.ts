import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function getRequestingUser(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("nivel_acceso")
    .eq("id", userId)
    .single();
  return data?.nivel_acceso === "administrador";
}

export async function GET(req: NextRequest) {
  const user = await getRequestingUser(req);
  if (!user || !(await isAdmin(user.id))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, nombre, apellido, nivel_acceso, secciones_permitidas");

  type ProfileRow = { id: string; nombre: string; apellido: string; nivel_acceso: string; secciones_permitidas: string[] | null };
  const profileMap = Object.fromEntries((profiles ?? [] as ProfileRow[]).map((p: ProfileRow) => [p.id, p]));

  const users = authData.users.map(u => ({
    id:                   u.id,
    email:                u.email ?? "",
    nombre:               profileMap[u.id]?.nombre ?? "",
    apellido:             profileMap[u.id]?.apellido ?? "",
    nivel_acceso:         profileMap[u.id]?.nivel_acceso ?? "visualizador",
    secciones_permitidas: profileMap[u.id]?.secciones_permitidas ?? null,
    created_at:           u.created_at,
  }));

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const user = await getRequestingUser(req);
  if (!user || !(await isAdmin(user.id))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { email, password, nivel_acceso } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) return NextResponse.json({ error: createError.message }, { status: 400 });

  await supabaseAdmin.from("profiles").upsert({
    id: created.user.id,
    nivel_acceso: nivel_acceso ?? "visualizador",
    updated_at: new Date().toISOString(),
  });

  return NextResponse.json({ user: created.user });
}

export async function PATCH(req: NextRequest) {
  const user = await getRequestingUser(req);
  if (!user || !(await isAdmin(user.id))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // secciones_permitidas es opcional y puede venir explícitamente `null`
  // (para "sin restricción, ve todo") — por eso se distingue con `in` en vez
  // de solo chequear verdad/falsedad, que trataría `null` como "no vino".
  const body = await req.json();
  const { userId, nivel_acceso } = body;
  const tocaSecciones = "secciones_permitidas" in body;
  if (!userId || (!nivel_acceso && !tocaSecciones)) {
    return NextResponse.json({ error: "userId y (nivel_acceso o secciones_permitidas) requeridos" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (nivel_acceso) update.nivel_acceso = nivel_acceso;
  if (tocaSecciones) update.secciones_permitidas = body.secciones_permitidas;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update(update)
    .eq("id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getRequestingUser(req);
  if (!user || !(await isAdmin(user.id))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId requerido" }, { status: 400 });
  if (userId === user.id) {
    return NextResponse.json({ error: "No podés eliminarte a vos mismo" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from("profiles").delete().eq("id", userId);

  return NextResponse.json({ ok: true });
}
