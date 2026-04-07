import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://drqvcdwzlnbspvjfaans.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
)
