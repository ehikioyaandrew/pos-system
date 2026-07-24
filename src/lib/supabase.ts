import { createClient, SupabaseClient } from '@supabase/supabase-js'

function cleanEnv(value: string | undefined): string {
  return (value ?? '')
    .replace(/\\r|\\n/g, '')
    .replace(/[\r\n\u2028\u2029]/g, '')
    .trim()
}

const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL)
const anonKey = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

export { supabaseUrl }

export const isSupabaseConfigured =
  Boolean(supabaseUrl) &&
  Boolean(anonKey) &&
  !supabaseUrl.includes('your-project') &&
  supabaseUrl.startsWith('https://')

if (!isSupabaseConfigured) {
  console.warn(
    'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  )
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  anonKey || 'placeholder'
)

export type BackupUser = {
  id: number
  username: string
  password_hash?: string
  role: string
  name?: string | null
  email?: string | null
  business_id?: number | null
  is_active?: boolean
  temporary_password?: string | null
  created_at?: string
  synced_at?: string
  last_login?: string | null
  is_hidden?: boolean | null
  has_temporary_password?: boolean
}
