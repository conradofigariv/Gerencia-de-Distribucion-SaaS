import { createClient } from '@supabase/supabase-js'

// Load from environment variables with fallbacks to prevent build-time crashes
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

// Diagnostic logging for development
if (typeof window !== 'undefined') {
  console.log('[Supabase Client] Config loaded:', {
    urlLength: url?.length,
    keyLength: key?.length,
    isPlaceholder: key === 'placeholder-anon-key'
  })
}

export const supabase = createClient(url, key)
