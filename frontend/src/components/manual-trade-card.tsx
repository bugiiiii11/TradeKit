"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, TrendingDown, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { issueManualTrade } from "@/app/actions/commands";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPrice } from "@/lib/format";

type TpLevel = { price: string };

/** Auto-distribute position portions based on TP count. Matches test_custom_trade.ts logic. */
function getPortions(count: number): number[] {
  if (count === 1) return [1.0];
  if (count === 2) return [0.5, 0.5];
  return [0.5, 0.25, 0.25];
}

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50";

const LABEL_CLASS = "text-xs font-medium text-muted-foreground";

export function ManualTradeCard({ markPrice }: { markPrice: number }) {
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [leverage, setLeverage] = useState("5");
  const [notionalUsd, setNotionalUsd] = useState("100");
  const [slPrice, setSlPrice] = useState("");
  const [tpLevels, setTpLevels] = useState<TpLevel[]>([{ price: "" }]);
  const [pending, startTransition] = useTransition();

  const portions = getPortions(tpLevels.length);

  const addTp = () => {
    if (tpLevels.length < 3) setTpLevels((prev) => [...prev, { price: "" }]);
  };

  const removeTp = (i: number) => {
    setTpLevels((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updateTpPrice = (i: number, value: string) => {
    setTpLevels((prev) => {
      const next = [...prev];
      next[i] = { price: value };
      return next;
    });
  };

  const handleSubmit = () => {
    const lev = parseFloat(leverage);
    const notional = parseFloat(notionalUsd);
    const sl = parseFloat(slPrice);

    if (!lev || lev < 1 || lev > 40) {
      toast.error("Leverage must be 1–40");
      return;
    }
    if (!notional || notional < 10) {
      toast.error("Size must be ≥ $10");
      return;
    }
    if (!sl || sl <= 0) {
      toast.error("Stop Loss price is required");
      return;
    }
    for (let i = 0; i < tpLevels.length; i++) {
      const tp = parseFloat(tpLevels[i].price);
      if (!tp || tp <= 0) {
        toast.error(`TP${i + 1} price is required`);
        return;
      }
    }

    const tpTargets = tpLevels.map((t, i) => ({
      price: parseFloat(t.price),
      portion: portions[i],
    }));

    const allocationLines = tpTargets
      .map((t, i) => `  TP${i + 1}: $${t.price.toLocaleString()} (${Math.round(t.portion * 100)}%)`)
      .join("\n");

    const confirmed = window.confirm(
      `Place manual BTC trade?\n\n` +
        `${direction.toUpperCase()} ${lev}x | Size: ~$${notional}\n` +
        `Stop Loss: $${sl.toLocaleString()}\n` +
        `Take Profits:\n${allocationLines}\n\n` +
        `This will use REAL FUNDS on Hyperliquid mainnet.`
    );
    if (!confirmed) return;

    startTransition(async () => {
      const res = await issueManualTrade({
        direction,
        leverage: lev,
        notionalUsd: notional,
        slPrice: sl,
        tpTargets,
      });

      if (res.ok) {
        const r = res.result;
        const entryStr = r?.entryPrice
          ? `@ $${Number(r.entryPrice).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
          : "";
        const dryRun = r?.dryRun ? " (DRY_RUN)" : "";
        toast.success(
          `Trade placed: ${direction.toUpperCase()} ${lev}x ${entryStr}${dryRun}`,
          {
            description: `SL: $${sl.toLocaleString()} · ${tpTargets.length} TP order${tpTargets.length > 1 ? "s" : ""} set`,
          }
        );
        setSlPrice("");
        setTpLevels([{ price: "" }]);
      } else {
        toast.error("Trade failed", { description: res.error });
      }
    });
  };

  const isLong = direction === "long";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isLong ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
            <CardTitle className="text-base">Manual Trade</CardTitle>
          </div>
          {markPrice > 0 && (
            <span className="text-xs text-muted-foreground">
              BTC ref: {formatPrice(markPrice)}
            </span>
          )}
        </div>
        <CardDescription>
          Place a manual BTC-PERP order via the command bus with SL and scaled TPs.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left column: direction, leverage, size, SL */}
          <div className="space-y-4">
            {/* Direction toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={isLong ? "default" : "outline"}
                size="sm"
                className={`flex-1 gap-1.5 ${isLong ? "bg-green-600 hover:bg-green-700 text-white border-green-600" : ""}`}
                onClick={() => setDirection("long")}
                disabled={pending}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                Long
              </Button>
              <Button
                type="button"
                variant={!isLong ? "destructive" : "outline"}
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => setDirection("short")}
                disabled={pending}
              >
                <TrendingDown className="h-3.5 w-3.5" />
                Short
              </Button>
            </div>

            {/* Leverage + Size */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={LABEL_CLASS}>Leverage (x)</label>
                <input
                  type="number"
                  min="1"
                  max="40"
                  step="1"
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                  disabled={pending}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="space-y-1.5">
                <label className={LABEL_CLASS}>Size (USD)</label>
                <input
                  type="number"
                  min="10"
                  step="10"
                  value={notionalUsd}
                  onChange={(e) => setNotionalUsd(e.target.value)}
                  disabled={pending}
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            {/* Stop Loss */}
            <div className="space-y-1.5">
              <label className={LABEL_CLASS}>Stop Loss Price</label>
              <input
                type="number"
                min="0"
                step="100"
                placeholder={isLong ? "Below current price" : "Above current price"}
                value={slPrice}
                onChange={(e) => setSlPrice(e.target.value)}
                disabled={pending}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          {/* Right column: TP levels + submit */}
          <div className="space-y-4">
            {/* TP levels */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={LABEL_CLASS}>Take Profit Levels</label>
                <span className="text-xs text-muted-foreground">
                  {portions.map((p) => `${Math.round(p * 100)}%`).join(" / ")}
                </span>
              </div>

              <div className="space-y-2">
                {tpLevels.map((tp, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-xs text-muted-foreground">
                      TP{i + 1}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      placeholder={isLong ? "Above current price" : "Below current price"}
                      value={tp.price}
                      onChange={(e) => updateTpPrice(i, e.target.value)}
                      disabled={pending}
                      className={INPUT_CLASS}
                    />
                    {tpLevels.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 shrink-0 p-0"
                        onClick={() => removeTp(i)}
                        disabled={pending}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {tpLevels.length < 3 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={addTp}
                  disabled={pending}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add TP level
                </Button>
              )}
            </div>

            {/* Submit */}
            <Button
              type="button"
              variant={isLong ? "default" : "destructive"}
              className={`w-full gap-1.5 ${isLong ? "bg-green-600 hover:bg-green-700" : ""}`}
              onClick={handleSubmit}
              disabled={pending}
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Placing…
                </>
              ) : (
                `Place ${isLong ? "Long" : "Short"} Trade`
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
