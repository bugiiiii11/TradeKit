"use client";

import { useTransition } from "react";
import { Loader2, OctagonX, Play } from "lucide-react";
import { toast } from "sonner";
import { killSwitch, resumeBot } from "@/app/actions/commands";
import { Button } from "@/components/ui/button";

/**
 * Kill switch / resume control. Two states:
 *  - killed=false → destructive "Kill Switch" button. Confirms via
 *    window.confirm (proper shadcn dialog is a follow-up).
 *  - killed=true → default "Resume" button. No confirm — resume is safe.
 *
 * Both call the corresponding Server Action which inserts a row into
 * bot_commands. The bot picks it up via Supabase Realtime. After the
 * action returns, the dashboard revalidates and the banner state updates
 * on the next request.
 */
export function KillSwitchButton({ killed }: { killed: boolean }) {
  const [pending, startTransition] = useTransition();

  const handleKill = () => {
    if (
      !window.confirm(
        "Kill switch will CLOSE ALL open positions and BLOCK new entries until you Resume.\n\nContinue?",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await killSwitch("Dashboard manual kill");
      if (res.ok) {
        toast.success("Kill switch issued", {
          description: "The bot will close positions and halt on next tick.",
        });
      } else {
        toast.error("Kill switch failed", { description: res.error });
      }
    });
  };

  const handleResume = () => {
    startTransition(async () => {
      const res = await resumeBot();
      if (res.ok) {
        toast.success("Resume issued", {
          description: "The bot will resume strategy evaluation on next tick.",
        });
      } else {
        toast.error("Resume failed", { description: res.error });
      }
    });
  };

  if (killed) {
    return (
      <Button
        variant="default"
        size="sm"
        onClick={handleResume}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Play />
        )}
        Resume
      </Button>
    );
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleKill}
      disabled={pending}
    >
      {pending ? <Loader2 className="animate-spin" /> : <OctagonX />}
      Kill Switch
    </Button>
  );
}
