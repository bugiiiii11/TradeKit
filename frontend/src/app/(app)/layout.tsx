import { SiteHeader } from "@/components/site-header";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared layout for authenticated app pages (Dashboard, Trades, Strategies,
 * Automation). Route group `(app)` does not affect URLs — all pages under
 * it still render at their normal paths.
 *
 * Auth is enforced upstream in `src/proxy.ts`; this layout assumes a user
 * is present and uses it to populate the header.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader email={user?.email} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </>
  );
}
