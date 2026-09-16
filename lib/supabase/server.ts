import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client bound to the incoming request's cookies.
 * This is what makes the NexFetch-Chrome extension's `credentials: "include"`
 * fetches to /api/user, /api/videos, etc. work: as long as the person is
 * logged in to nexfetch.vercel.app in the same browser, the session cookie
 * set by Supabase Auth is sent automatically and this client can read it.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component render — safe to ignore,
            // middleware handles session refresh instead.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // same as above
          }
        }
      }
    }
  );
}

/**
 * Service-role client for privileged server-only operations
 * (e.g. writing usage counters across users). NEVER import this
 * into client components — the key must stay server-side only.
 */
export function createSupabaseServiceClient() {
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
