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
    .select("id, nombre, apellido, empresa, cargo, telefono, cumpleanos, avatar_url, nivel_acceso, secciones_permitidas");

  type ProfileRow = {
    id: string; nombre: string; apellido: string; empresa: string | null; cargo: string | null;
    telefono: string | null; cumpleanos: string | null; avatar_url: string | null;
    nivel_acceso: string; secciones_permitidas: string[] | null;
  };
  const profileMap = Object.fromEntries((profiles ?? [] as ProfileRow[]).map((p: ProfileRow) => [p.id, p]));

  // Video (o imagen vieja) del cartel de cumpleaños. Si todavía no se corrió
  // supabase/cumpleanos_imagenes.sql la tabla no existe: se sigue sin nada.
  const cumpleMap = await leerCumpleMedia();

  const users = authData.users.map(u => ({
    id:                   u.id,
    email:                u.email ?? "",
    nombre:               profileMap[u.id]?.nombre ?? "",
    apellido:             profileMap[u.id]?.apellido ?? "",
    empresa:              profileMap[u.id]?.empresa ?? "",
    cargo:                profileMap[u.id]?.cargo ?? "",
    telefono:             profileMap[u.id]?.telefono ?? "",
    cumpleanos:           profileMap[u.id]?.cumpleanos ?? "",
    avatar_url:           profileMap[u.id]?.avatar_url ?? "",
    nivel_acceso:         profileMap[u.id]?.nivel_acceso ?? "visualizador",
    secciones_permitidas: profileMap[u.id]?.secciones_permitidas ?? null,
    cumple_url:           cumpleMap[u.id]?.url ?? "",
    cumple_tipo:          cumpleMap[u.id]?.tipo ?? "video",
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

// Campos de perfil que un admin puede editarle a CUALQUIER usuario desde acá.
// Ninguno pasa por la trigger de autoescalada (esa solo mira secciones_
// permitidas, ver supabase/profile_secciones.sql) ni por la UPDATE policy de
// `profiles` (que solo deja a cada usuario tocar su PROPIA fila): esta ruta
// escribe con la service role key, que no lleva sesión — `auth.uid()` da NULL
// server-side y las dos protecciones quedan afuera, a propósito.
const CAMPOS_PERFIL_EDITABLES = ["nombre", "apellido", "empresa", "cargo", "telefono", "cumpleanos"] as const;

export async function PATCH(req: NextRequest) {
  const user = await getRequestingUser(req);
  if (!user || !(await isAdmin(user.id))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const esFormData = (req.headers.get("content-type") ?? "").includes("multipart/form-data");

  // ── Editar perfil completo + foto (dialog "Editar" de Configuración → Usuarios) ──
  // Multipart porque puede llevar un archivo de imagen. Las llamadas de
  // nivel_acceso/secciones_permitidas (los selects sueltos de la lista) siguen
  // mandando JSON más abajo — no se tocan para no romperlas.
  if (esFormData) {
    const form = await req.formData();
    const userId = form.get("userId");
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId requerido" }, { status: 400 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const campo of CAMPOS_PERFIL_EDITABLES) {
      const v = form.get(campo);
      if (v !== null) update[campo] = String(v);
    }

    const avatar = form.get("avatar");
    if (avatar instanceof File && avatar.size > 0) {
      if (!avatar.type.startsWith("image/")) {
        return NextResponse.json({ error: "El archivo tiene que ser una imagen" }, { status: 400 });
      }
      if (avatar.size > 2 * 1024 * 1024) {
        return NextResponse.json({ error: "La imagen no puede superar 2 MB" }, { status: 400 });
      }
      const ext  = avatar.name.split(".").pop() || "jpg";
      const path = `${userId}/avatar.${ext}`;
      const buffer = Buffer.from(await avatar.arrayBuffer());

      // La service role bypasea también las policies de storage.objects (que
      // normalmente limitan cada usuario a subir SOLO a su propia carpeta —
      // ver supabase/storage_avatars.sql) — es lo que le permite al admin
      // subir a la carpeta de OTRO usuario.
      const { error: upError } = await supabaseAdmin.storage
        .from("avatars")
        .upload(path, buffer, { upsert: true, contentType: avatar.type });
      if (upError) return NextResponse.json({ error: `Error al subir la imagen: ${upError.message}` }, { status: 500 });

      const { data: { publicUrl } } = supabaseAdmin.storage.from("avatars").getPublicUrl(path);
      update.avatar_url = `${publicUrl}?t=${Date.now()}`;
    }

    const { error } = await supabaseAdmin.from("profiles").update(update).eq("id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, avatar_url: update.avatar_url ?? null });
  }

  const body = await req.json();
  const { userId } = body;
  if (!userId) return NextResponse.json({ error: "userId requerido" }, { status: 400 });

  // ── Video del cartel de cumpleaños (diálogo "Editar" de Configuración → Usuarios) ──
  if ("cumple_video" in body) return cumpleVideo(userId, body.cumple_video, user.id);

  // ── Restablecer contraseña (botón "Restablecer contraseña" del diálogo) ──
  // `auth.admin.updateUserById` es la única forma de cambiarle la contraseña
  // a OTRO usuario: `auth.updateUser` (lo que usa la pestaña "Mi cuenta")
  // solo puede tocar la sesión propia. No pide la contraseña actual —es el
  // admin fijando una nueva, no el dueño de la cuenta cambiándola— así que
  // esta acción se banca en que el nivel de acceso ya se validó arriba.
  if ("password" in body) {
    const { password } = body;
    if (typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "La contraseña tiene que tener al menos 6 caracteres" }, { status: 400 });
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Nivel de acceso / secciones permitidas (selects sueltos de la lista) ──
  // secciones_permitidas es opcional y puede venir explícitamente `null`
  // (para "sin restricción, ve todo") — por eso se distingue con `in` en vez
  // de solo chequear verdad/falsedad, que trataría `null` como "no vino".
  const { nivel_acceso } = body;
  const tocaSecciones = "secciones_permitidas" in body;
  if (!nivel_acceso && !tocaSecciones) {
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

// ─── Video del cartel de cumpleaños ───────────────────────────────────────────
// Uno por persona, bucket `cumpleanos` + tabla `cumple_imagenes`
// (supabase/cumpleanos_imagenes.sql), sin policies de escritura: solo esta
// ruta, con la service role, los cambia — así nadie se pone su propio video.
//
// El archivo NO viaja por acá: Vercel corta el cuerpo de los pedidos en 4,5 MB
// y un video pesa más. En tres pasos:
//   1. `firmar`    → valida tipo/tamaño y devuelve una URL de subida de UN uso.
//   2. el navegador sube directo a Storage con esa URL (con progreso).
//   3. `confirmar` → verifica que el archivo esté, guarda la fila y borra los
//                    archivos anteriores de esa persona.
// `quitar` borra la fila y los archivos.

const CUMPLE_BUCKET = "cumpleanos";
const CUMPLE_MAX_BYTES = 50 * 1024 * 1024; // = file_size_limit del bucket
const FALTA_SQL_CUMPLE = "Falta correr supabase/cumpleanos_imagenes.sql en Supabase (la versión con video).";
const faltaSqlCumple = (msg: string) => /cumple_imagenes|tipo|bucket not found|does not exist|schema cache/i.test(msg);
type CumpleTipo = "imagen" | "video";

async function leerCumpleMedia(): Promise<Record<string, { url: string; tipo: CumpleTipo }>> {
  let { data, error } = await supabaseAdmin.from("cumple_imagenes").select("user_id, imagen_url, tipo");
  // Tabla de la versión de imágenes (sin `tipo`): todo lo que hay es imagen.
  if (error) ({ data, error } = await supabaseAdmin.from("cumple_imagenes").select("user_id, imagen_url"));
  if (error || !data) return {};
  return Object.fromEntries(
    (data as { user_id: string; imagen_url: string; tipo?: CumpleTipo }[])
      .map((r) => [r.user_id, { url: r.imagen_url, tipo: r.tipo ?? "imagen" }]),
  );
}

async function archivosDe(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.storage.from(CUMPLE_BUCKET).list(userId, { limit: 100 });
  return (data ?? []).map((f) => `${userId}/${f.name}`);
}

async function cumpleVideo(userId: string, pedido: unknown, adminId: string) {
  const p = (pedido ?? {}) as { accion?: string; contentType?: string; size?: number; path?: string };
  const err = (msg: string, status = 400) =>
    NextResponse.json({ error: faltaSqlCumple(msg) ? FALTA_SQL_CUMPLE : msg }, { status });

  if (p.accion === "firmar") {
    if (typeof p.contentType !== "string" || !p.contentType.startsWith("video/")) return err("El archivo tiene que ser un video");
    if (typeof p.size !== "number" || p.size <= 0) return err("Tamaño de archivo inválido");
    if (p.size > CUMPLE_MAX_BYTES) return err("El video no puede superar 50 MB");
    // Nombre nuevo en cada subida: la URL cambia y nadie ve uno viejo cacheado.
    const path = `${userId}/video-${Date.now()}`;
    const { data, error } = await supabaseAdmin.storage.from(CUMPLE_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return err(error?.message ?? "No se pudo preparar la subida", 500);
    return NextResponse.json({ path, signedUrl: data.signedUrl });
  }

  if (p.accion === "confirmar") {
    const path = p.path ?? "";
    // Solo un archivo firmado para ESTA persona (no cualquier ruta del bucket).
    const prefijo = `${userId}/video-`;
    if (!path.startsWith(prefijo) || !/^\d+$/.test(path.slice(prefijo.length))) return err("Ruta de archivo inválida");
    const archivos = await archivosDe(userId);
    if (!archivos.includes(path)) return err("No se encontró el video subido; probá de nuevo", 404);
    const { data: { publicUrl } } = supabaseAdmin.storage.from(CUMPLE_BUCKET).getPublicUrl(path);
    const { error } = await supabaseAdmin.from("cumple_imagenes").upsert({
      user_id: userId, imagen_url: publicUrl, tipo: "video",
      updated_at: new Date().toISOString(), updated_by: adminId,
    });
    if (error) return err(error.message, 500);
    const viejos = archivos.filter((a) => a !== path);
    if (viejos.length) await supabaseAdmin.storage.from(CUMPLE_BUCKET).remove(viejos);
    return NextResponse.json({ ok: true, cumple_url: publicUrl, cumple_tipo: "video" });
  }

  if (p.accion === "quitar") {
    const { error } = await supabaseAdmin.from("cumple_imagenes").delete().eq("user_id", userId);
    if (error) return err(error.message, 500);
    // Si los archivos no se pueden borrar no importa: sin fila, el cartel ya
    // no los usa.
    const archivos = await archivosDe(userId);
    if (archivos.length) await supabaseAdmin.storage.from(CUMPLE_BUCKET).remove(archivos);
    return NextResponse.json({ ok: true, cumple_url: "", cumple_tipo: "video" });
  }

  return err("Acción inválida");
}
