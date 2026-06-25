import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Server-side client with service role (for API routes)
// Passes cache: 'no-store' to every internal fetch so Next.js's data cache
// never serves stale Supabase responses.
export const supabaseAdmin = () =>
  createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY!, {
    global: {
      fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }),
    },
  })
