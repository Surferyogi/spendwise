import { createClient } from '@supabase/supabase-js'

// life-compass project — spend_* tables are isolated from the other apps' tables.
const SUPABASE_URL = 'https://pcmucpwotcwuypgifnxx.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_tXVILzokqrV3t1kk8Cmyzw_tA88ffgI'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
