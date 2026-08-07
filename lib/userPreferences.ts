import { supabase } from "./supabaseClient";

export async function getPreference<T>(userId: string, key: string): Promise<T | null> {
  const { data } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();
  return (data?.value ?? null) as T | null;
}

export async function setPreference(userId: string, key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      { user_id: userId, key, value, updated_at: new Date().toISOString() },
      { onConflict: "user_id,key" }
    );
  if (error) console.error("setPreference:", error.message);
}
