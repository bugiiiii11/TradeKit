"use client";

import { useState, useTransition } from "react";
import {
  Loader2,
  Power,
  PowerOff,
  Shield,
  ShieldOff,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  toggleStrategy,
  toggleS1Filter,
  setLeverage,
} from "@/app/actions/commands";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const LEVERAGE_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;

interface StrategyControlsProps {
  initialStrategies: string[];
  initialRequireEma200: boolean;
  initialLeverageMult: number;
}

export function StrategyControls({
  initialStrategies,
  initialRequireEma200,
  initialLeverageMult,
}: StrategyControlsProps) {
  const [strategies, setStrategies] = useState(initialStrategies);
  const [requireEma200, setRequireEma200] = useState(initialRequireEma200);
  const [leverageMult, setLeverageMult] = useState(initialLeverageMult);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleToggleStrategy = (strategy: string) => {
    const currentlyEnabled = strategies.includes(strategy);
    const newEnabled = !currentlyEnabled;
    setPendingAction(strategy);

    startTransition(async () => {
      const res = await toggleStrategy(strategy, newEnabled);
      setPendingAction(null);

      if (res.ok) {
        const active = (res.result?.activeStrategies as string[]) ?? [];
        setStrategies(active);
        toast.success(
          `${strategy} ${newEnabled ? "enabled" : "disabled"}`,
          { description: `Active: ${active.join(", ") || "none"}` },
        );
      } else {
        toast.error(`Toggle ${strategy} failed`, { description: res.error });
      }
    });
  };

  const handleToggleFilter = () => {
    const newSkip = requireEma200;
    setPendingAction("ema200");

    startTransition(async () => {
      const res = await toggleS1Filter(newSkip);
      setPendingAction(null);

      if (res.ok) {
        const newRequire = res.result?.requireDailyEma200 as boolean;
        setRequireEma200(newRequire);
        toast.success(
          `S1 Daily-EMA200 filter ${newRequire ? "enabled" : "disabled"}`,
        );
      } else {
        toast.error("Toggle S1 filter failed", { description: res.error });
      }
    });
  };

  const handleSetLeverage = (mult: number) => {
    if (mult === leverageMult) return;
    setPendingAction("leverage");

    startTransition(async () => {
      const res = await setLeverage(mult);
      setPendingAction(null);

      if (res.ok) {
        const newMult = res.result?.leverageMult as number;
        setLeverageMult(newMult);
        toast.success(`Leverage set to ${newMult}x`, {
          description: `S1=${res.result?.effectiveS1}x, S6=${res.result?.effectiveS6}x`,
        });
      } else {
        toast.error("Set leverage failed", { description: res.error });
      }
    });
  };

  const ALL_STRATEGIES = ["S1", "S6"] as const;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Strategies
        </span>
        {ALL_STRATEGIES.map((s) => {
          const enabled = strategies.includes(s);
          const loading = isPending && pendingAction === s;
          return (
            <Button
              key={s}
              variant={enabled ? "default" : "outline"}
              size="xs"
              onClick={() => handleToggleStrategy(s)}
              disabled={isPending}
              className="gap-1.5"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : enabled ? (
                <Power className="h-3 w-3" />
              ) : (
                <PowerOff className="h-3 w-3" />
              )}
              {s}
            </Button>
          );
        })}
        <Badge variant="outline" className="ml-1 text-[10px]">
          Override — resets on restart
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          S1 Filter
        </span>
        <Button
          variant={requireEma200 ? "default" : "outline"}
          size="xs"
          onClick={handleToggleFilter}
          disabled={isPending}
          className="gap-1.5"
        >
          {isPending && pendingAction === "ema200" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : requireEma200 ? (
            <Shield className="h-3 w-3" />
          ) : (
            <ShieldOff className="h-3 w-3" />
          )}
          Daily EMA200 {requireEma200 ? "Required" : "Skipped"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <SlidersHorizontal className="mr-1 inline h-3 w-3" />
          Leverage
        </span>
        <div className="flex items-center gap-1">
          {LEVERAGE_STEPS.map((step) => (
            <Button
              key={step}
              variant={leverageMult === step ? "default" : "outline"}
              size="xs"
              onClick={() => handleSetLeverage(step)}
              disabled={isPending}
              className="min-w-[3rem] tabular-nums"
            >
              {isPending && pendingAction === "leverage" && leverageMult !== step
                ? ""
                : `${step}x`}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          S1={Math.max(1, Math.round(10 * leverageMult))}x
          S6={Math.max(1, Math.round(8 * leverageMult))}x
        </span>
      </div>
    </div>
  );
}
