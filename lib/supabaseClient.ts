import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";

export const supabase = createClient(url, key);

export const isSupabaseConfigured =
  url !== "https://placeholder.supabase.co" &&
  key !== "placeholder-anon-key" &&
  url.startsWith("https://") &&
  url.includes(".supabase.co");
