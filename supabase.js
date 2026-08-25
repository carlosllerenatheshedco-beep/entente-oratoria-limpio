import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://cezgntxyurzgctwwvmib.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_bd2aLD19H3XlqK_yZ5p-rQ_gGP6mXtc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)