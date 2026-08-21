import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ─── Plantillas de acceso (CRUD, solo admin) ────────────────────────────────
// La tabla `acceso_plantillas` es de LECTURA para cualquier autenticado (el
// cliente necesita resolver su propia plantilla para armar el sidebar) pero no
// tiene policy de escritura: crear, editar y borrar pasa por acá, con la
// service role key y el chequeo de admin. Ver supabase/acceso_plantillas.sql.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function requireAdmin(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data } = await supabaseAdmin
    .from("profiles").select("nivel_acceso").eq("id", user.id).single();
  return data?.nivel_acceso === "administrador" ? user : null;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { data, error } = await supabaseAdmin
    .from("acceso_plantillas")
    .select("id, nombre, secciones")
    .order("nombre");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ plantillas: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { nombre, secciones } = await req.json();
  if (!nombre?.trim()) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("acceso_plantillas")
    .insert({ nombre: nombre.trim(), secciones: secciones ?? [] })
    .select("id, nombre, secciones")
    .single();
  // `nombre` es UNIQUE: sin este mensaje el error crudo de Postgres no dice
  // nada útil a quien está creando la plantilla.
  if (error) {
    const msg = error.code === "23505" ? "Ya existe una plantilla con ese nombre." : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ plantilla: data });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const body = await req.json();
  const { id, nombre, secciones } = body;
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (nombre !== undefined) update.nombre = String(nombre).trim();
  // Puede venir un array vacío ("no ve nada"), que es válido — por eso se
  // chequea contra undefined y no con verdad/falsedad.
  if (secciones !== undefined) update.secciones = secciones;

  const { data, error } = await supabaseAdmin
    .from("acceso_plantillas")
    .update(update)
    .eq("id", id)
    .select("id, nombre, secciones")
    .single();
  if (error) {
    const msg = error.code === "23505" ? "Ya existe una plantilla con ese nombre." : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ plantilla: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  // Los perfiles que la tenían quedan con plantilla_acceso_id NULL por el
  // ON DELETE SET NULL de la FK — no se bloquea a nadie. Ver el SQL.
  const { error } = await supabaseAdmin.from("acceso_plantillas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
