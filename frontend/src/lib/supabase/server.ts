import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for use in Server Components, Route Handlers, and Server
 * Actions.
 *
 * Next.js 16 requires `cookies()` to be awaited — synchronous access is
 * fully removed. Each request must create a fresh client; never cache one
 * across requests.
 *
 * Note: in Server Components, Next.js may throw when writing cookies. We
 * swallow those errors because `proxy.ts` handles the canonical session
 * refresh, writing the refreshed cookies to the outgoing response.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't write cookies. The proxy (middleware)
            // catches session refreshes on the next navigation.
          }
        },
      },
    },
  );
}
