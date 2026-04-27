import { supabase } from "./supabaseClient"

export async function getServices() {
  const { data, error } = await supabase
    .from("services")
    .select("*")

  if (error) {
    console.error(error)
    return []
  }

  return data
}
