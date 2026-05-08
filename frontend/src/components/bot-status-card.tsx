import { Clock, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KillSwitchButton } from "./kill-switch-button";
import { StrategyControls } from "./strategy-controls";
import { cn } from "@/lib/utils";
import {
  formatPercent,
  formatRelativeTime,
  formatTime,
} from "@/lib/format";

type BotHealth = "online" | "stale" | "offline" | "killed" | "paused";

export interface BotStatusRisk {
  daily_dd_pct: number | string | null;
  weekly_dd_pct: number | string | null;
  consecutive_losses: number | null;
  paused_until: string | null;
  pause_reason: string | null;
  killed: boolean | null;
  kill_reason: string | null;
}

interface BotStatusCardProps {
  risk: BotStatusRisk | null;
  lastTickAt: string | null;
  source: string | null;
  initialStrategies: string[];
  initialRequireEma200: boolean;
  initialLeverageMult: number;
}

function getBotHealth(
  risk: BotStatusRisk | null,
  lastTickAt: string | null,
): BotHealth {
  if (risk?.killed) return "killed";
  if (
    risk?.paused_until &&
    new Date(risk.paused_until).getTime() > Date.now()
  ) {
    return "paused";
  }
  if (!lastTickAt) return "offline";
  const ageMs = Date.now() - new Date(lastTickAt).getTime();
  if (ageMs > 60 * 60 * 1000) return "offline";
  if (ageMs > 20 * 60 * 1000) return "stale";
  return "online";
}

const HEALTH_STYLES: Record<
  BotHealth,
  {
    label: string;
    dot: string;
    border: string;
    badge: "default" | "secondary" | "destructive";
  }
> = {
  online: {
    label: "Online",
    dot: "bg-green-500 animate-pulse",
    border: "border-l-green-500",
    badge: "default",
  },
  stale: {
    label: "Stale",
    dot: "bg-yellow-500",
    border: "border-l-yellow-500",
    badge: "secondary",
  },
  offline: {
    label: "Offline",
    dot: "bg-destructive",
    border: "border-l-destructive",
    badge: "destructive",
  },
  killed: {
    label: "Killed",
    dot: "bg-destructive",
    border: "border-l-destructive",
    badge: "destructive",
  },
  paused: {
    label: "Paused",
    dot: "bg-yellow-500",
    border: "border-l-yellow-500",
    badge: "secondary",
  },
};

export function BotStatusCard({
  risk,
  lastTickAt,
  source,
  initialStrategies,
  initialRequireEma200,
  initialLeverageMult,
}: BotStatusCardProps) {
  const health = getBotHealth(risk, lastTickAt);
  const style = HEALTH_STYLES[health];

  return (
    <Card className={cn("border-l-4", style.border)}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={cn("inline-block h-2.5 w-2.5 rounded-full", style.dot)}
            />
            <CardTitle className="text-base">Bot Status</CardTitle>
          </div>
          <Badge variant={style.badge} className="text-xs">
            {style.label}
          </Badge>
        </div>
        <KillSwitchButton killed={Boolean(risk?.killed)} />
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {lastTickAt ? (
              <span>
                Last tick{" "}
                <span className="font-medium text-foreground">
                  {formatRelativeTime(lastTickAt)}
                </span>
                <span className="ml-1 text-xs">
                  ({formatTime(lastTickAt)})
                </span>
              </span>
            ) : (
              <span>No ticks yet</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5" />
            <span>{source ?? "unknown"}</span>
          </div>

          {risk && (
            <span>
              DD{" "}
              <span className="font-medium text-foreground">
                {formatPercent(risk.daily_dd_pct)}
              </span>{" "}
              daily /{" "}
              <span className="font-medium text-foreground">
                {formatPercent(risk.weekly_dd_pct)}
              </span>{" "}
              weekly
            </span>
          )}

          {(risk?.consecutive_losses ?? 0) > 0 && (
            <span>
              <span className="font-medium text-destructive">
                {risk!.consecutive_losses}
              </span>{" "}
              consecutive losses
            </span>
          )}
        </div>

        {health === "killed" && risk?.kill_reason && (
          <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {risk.kill_reason}
          </div>
        )}
        {health === "paused" && risk?.paused_until && (
          <div className="mt-3 rounded-md bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
            Paused until {formatTime(risk.paused_until)}
            {risk.pause_reason ? ` — ${risk.pause_reason}` : ""}
          </div>
        )}

        <div className="mt-4 border-t border-border pt-4">
          <StrategyControls
            initialStrategies={initialStrategies}
            initialRequireEma200={initialRequireEma200}
            initialLeverageMult={initialLeverageMult}
          />
        </div>
      </CardContent>
    </Card>
  );
}
