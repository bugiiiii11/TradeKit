import fs from "fs";
import path from "path";
import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { BacktestTabs, type BacktestRun } from "@/components/backtest-tabs";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Load all runs from backtest-results/ directory (+ legacy backtest-results.json)
// ---------------------------------------------------------------------------

function loadRuns(): BacktestRun[] {
  const projectRoot = path.resolve(process.cwd(), "..");
  const runsDir = path.join(projectRoot, "backtest-results");
  const legacyFile = path.join(projectRoot, "backtest-results.json");

  const runs: BacktestRun[] = [];
  const seen = new Set<string>(); // deduplicate by generatedAt

  // Read from backtest-results/ directory
  if (fs.existsSync(runsDir)) {
    const files = fs.readdirSync(runsDir)
      .filter(f => f.endsWith(".json"))
      .sort()                       // lexicographic = chronological (YYYYMMDD-HHmmss)
      .reverse();                   // newest first

    for (const filename of files) {
      try {
        const raw = fs.readFileSync(path.join(runsDir, filename), "utf-8");
        const data = JSON.parse(raw);
        const key = data.generatedAt ?? filename;
        if (seen.has(key)) continue;
        seen.add(key);
        runs.push({ ...data, label: makeLabel(data, filename), filename });
      } catch { /* skip malformed files */ }
    }
  }

  // Fall back to legacy file only if directory produced nothing
  if (runs.length === 0 && fs.existsSync(legacyFile)) {
    try {
      const raw = fs.readFileSync(legacyFile, "utf-8");
      const data = JSON.parse(raw);
      runs.push({ ...data, label: makeLabel(data, "backtest-results.json"), filename: "backtest-results.json" });
    } catch { /* skip */ }
  }

  return runs;
}

function makeLabel(data: { config?: { days?: number }; generatedAt?: string }, filename: string): string {
  const days = data.config?.days ?? parseDaysFromFilename(filename);
  const at   = data.generatedAt ? new Date(data.generatedAt) : null;
  const datePart = at
    ? at.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : filename.replace(".json", "");
  return `${days}d · ${datePart}`;
}

function parseDaysFromFilename(filename: string): number {
  const m = filename.match(/^(\d+)d/);
  return m ? parseInt(m[1], 10) : 0;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BacktestsPage() {
  const runs = loadRuns();

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Backtests</h1>
        <p className="text-sm text-muted-foreground">
          Historical strategy replay on Hyperliquid candle data. Each tab is one run.
        </p>
      </div>

      {runs.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<BarChart3 className="h-5 w-5" />}
              title="No backtest results yet"
              description={
                <>
                  Run{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    npx ts-node src/scripts/backtest.ts
                  </code>{" "}
                  to generate results. Files are saved to{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    backtest-results/
                  </code>{" "}
                  and appear here automatically.
                </>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <BacktestTabs runs={runs} />
      )}
    </>
  );
}
