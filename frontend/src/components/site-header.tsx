import { Activity, LogOut } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MainNav } from "@/components/main-nav";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader({ email }: { email?: string | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">TradingBot</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              BTC / Hyperliquid
            </span>
          </div>
        </Link>

        <MainNav />

        <div className="flex items-center gap-2">
          {email && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {email}
            </span>
          )}
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <Button
              type="submit"
              variant="outline"
              size="icon"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
