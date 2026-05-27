import { createClient } from "@supabase/supabase-js";

/**
 * Cache-friendly Supabase client for read-only queries.
 * Unlike the SSR client, this does NOT call cookies(), so it can
 * be used inside unstable_cache without triggering dynamic rendering.
 *
 * Only use for public/anon-level reads. Once auth/RLS is enabled,
 * protected queries should still go through the SSR createClient.
 */
export function createCacheClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
