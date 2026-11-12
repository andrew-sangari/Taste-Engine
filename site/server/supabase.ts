import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Supabase is used for one thing here: proving who is signed in. All data
// access goes through the server's own Postgres connection (`db/index.ts`),
// never through Supabase's REST API, and every table has row level security
// enabled with no policies so the public key below can read nothing.

export function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
    ?? process.env.SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? "";
  return url && key ? { url, key } : null;
}

/** A Supabase client bound to this request's cookies, or null when Supabase is not configured. */
export async function serverSupabase() {
  const config = supabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        // Server components cannot write cookies; `proxy.ts` refreshes the
        // session on every navigation, so a failed write here is harmless.
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {}
      },
    },
  });
}
