import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";

/**
 * Renovación del token, compartida entre todas las consultas en vuelo.
 *
 * Al volver a una pestaña que estuvo dormida, el dashboard dispara muchas
 * consultas juntas y todas fallan con el mismo token vencido. Sin este candado
 * cada una pediría su propio refresh: N llamadas a /auth/v1/token en paralelo,
 * y las que pierden la carrera se quedan con un refresh token ya rotado.
 */
let refreshing: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  refreshing ??= supabase.auth
    .refreshSession()
    .then(({ data, error }) => (error ? null : data.session?.access_token ?? null))
    .catch(() => null)
    .finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * fetch con un reintento ante 401.
 *
 * El access token de Supabase dura ~1h. El auto-refresh del SDK corre sobre un
 * timer que el navegador congela con la pestaña en segundo plano (y que la
 * suspensión de la máquina se saltea entero), así que la primera consulta al
 * volver sale con el token vencido → PostgREST responde 401 «JWT expired» y el
 * usuario ve un error suelto («Error al cargar matrículas: JWT expired») con la
 * sesión en realidad todavía válida.
 *
 * Acá se renueva y se reintenta una sola vez, de forma transparente. Si el
 * refresh token también murió, refreshSession() borra la sesión y emite
 * SIGNED_OUT: page.tsx escucha ese evento y manda al login, que es lo correcto.
 */
const fetchConRefresh: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;

  // /auth/v1/* es justamente el endpoint que renueva el token: reintentarlo acá
  // sería recursión. Un 401 ahí significa que la sesión está realmente caída.
  const href =
    typeof input === "string" ? input
    : input instanceof URL   ? input.href
    : input.url;
  if (href.includes("/auth/v1/")) return res;

  const token = await refreshAccessToken();
  if (!token) return res;   // no se pudo renovar → que el error suba como antes

  // Los clientes de Supabase llaman fetch(url, init), pero si alguno pasa un
  // Request los headers viajan ahí y no en init.
  const headers = new Headers(
    init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined)
  );
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

export const supabase = createClient(url, key, {
  auth: {
    persistSession:    true,
    autoRefreshToken:  true,
    detectSessionInUrl: true,
  },
  global: { fetch: fetchConRefresh },
});

export const isSupabaseConfigured =
  url !== "https://placeholder.supabase.co" &&
  key !== "placeholder-anon-key" &&
  url.startsWith("https://") &&
  url.includes(".supabase.co");
