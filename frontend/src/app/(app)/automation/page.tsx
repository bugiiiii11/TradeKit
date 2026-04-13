import {
  CheckCircle2,
  Clock,
  History,
  OctagonX,
  PlayCircle,
  Terminal,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime, formatTime } from "@/lib/format";

type CommandStatus = "pending" | "running" | "done" | "failed";
type CommandType = "kill_switch" | "resume" | string;

type BotCommand = {
  id: string;
  type: CommandType;
  payload: Record<string, unknown> | null;
  status: CommandStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  issued_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("bot_commands")
    .select("*")
    .order("issued_at", { ascending: false })
    .limit(100);

  const commands = (rows ?? []) as BotCommand[];

  const total = commands.length;
  const done = commands.filter((c) => c.status === "done").length;
  const failed = commands.filter((c) => c.status === "failed").length;
  const inFlight = commands.filter(
    (c) => c.status === "pending" || c.status === "running",
  ).length;

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = commands.filter(
    (c) => new Date(c.issued_at).getTime() >= dayAgo,
  ).length;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
        <p className="text-sm text-muted-foreground">
          Command bus history. The dashboard inserts rows into{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            bot_commands
          </code>
          ; the bot claims and executes each one via Supabase Realtime.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total"
          value={`${total}`}
          icon={<History className="h-4 w-4" />}
          hint="All time (latest 100 shown)"
        />
        <StatCard
          title="Succeeded"
          value={`${done}`}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint={total ? `${Math.round((done / total) * 100)}% success` : "—"}
        />
        <StatCard
          title="Failed"
          value={`${failed}`}
          icon={<XCircle className="h-4 w-4" />}
          hint={failed ? "Investigate" : "None"}
          tone={failed ? "destructive" : "default"}
        />
        <StatCard
          title="Last 24h"
          value={`${last24h}`}
          icon={<Clock className="h-4 w-4" />}
          hint={inFlight ? `${inFlight} in-flight` : "Nothing pending"}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Command History</CardTitle>
          </div>
          <CardDescription>
            Most recent 100 commands, newest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {commands.length === 0 ? (
            <EmptyState
              icon={<Terminal className="h-5 w-5" />}
              title="No commands yet"
              description={
                <>
                  Use the Kill Switch button on the Dashboard to issue a
                  command. Entries will appear here once the bot processes
                  them.
                </>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Issued</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="whitespace-nowrap">
                      Duration
                    </TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commands.map((cmd) => (
                    <TableRow key={cmd.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        <div>{formatTime(cmd.issued_at)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(cmd.issued_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <TypeBadge type={cmd.type} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={cmd.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {formatDuration(cmd.started_at, cmd.finished_at)}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                        {extractReason(cmd) ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs">
                        {cmd.error ? (
                          <span className="text-destructive">{cmd.error}</span>
                        ) : (
                          <span className="text-muted-foreground">
                            {formatResult(cmd)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({
  title,
  value,
  icon,
  hint,
  tone = "default",
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
  tone?: "default" | "destructive";
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        <div
          className={
            tone === "destructive" ? "text-destructive" : "text-muted-foreground"
          }
        >
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div
          className={`text-2xl font-semibold tabular-nums ${
            tone === "destructive" ? "text-destructive" : ""
          }`}
        >
          {value}
        </div>
        {hint && (
          <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}

function TypeBadge({ type }: { type: CommandType }) {
  if (type === "kill_switch") {
    return (
      <Badge variant="destructive" className="gap-1">
        <OctagonX className="h-3 w-3" />
        kill_switch
      </Badge>
    );
  }
  if (type === "resume") {
    return (
      <Badge variant="default" className="gap-1">
        <PlayCircle className="h-3 w-3" />
        resume
      </Badge>
    );
  }
  return <Badge variant="secondary">{type}</Badge>;
}

function StatusBadge({ status }: { status: CommandStatus }) {
  switch (status) {
    case "done":
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          done
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          failed
        </Badge>
      );
    case "running":
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3 animate-pulse" />
          running
        </Badge>
      );
    case "pending":
    default:
      return <Badge variant="outline">pending</Badge>;
  }
}

function formatDuration(
  startedAt: string | null,
  finishedAt: string | null,
): string {
  if (!startedAt || !finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function extractReason(cmd: BotCommand): string | null {
  const payload = cmd.payload ?? {};
  const result = cmd.result ?? {};
  const fromPayload =
    typeof payload.reason === "string" ? (payload.reason as string) : null;
  if (fromPayload) return fromPayload;
  const fromResult =
    typeof result.reason === "string" ? (result.reason as string) : null;
  return fromResult;
}

function formatResult(cmd: BotCommand): string {
  if (cmd.status !== "done") return "—";
  const result = cmd.result ?? {};

  if (cmd.type === "kill_switch") {
    const closed = Array.isArray(result.closedPositions)
      ? (result.closedPositions as unknown[]).length
      : 0;
    const dryRun = result.dryRun === true ? " (dry-run)" : "";
    return `Closed ${closed} position${closed === 1 ? "" : "s"}${dryRun}`;
  }
  if (cmd.type === "resume") {
    return "Kill switch cleared";
  }

  // Fallback — show the first useful key.
  const keys = Object.keys(result);
  if (keys.length === 0) return "Done";
  return keys
    .slice(0, 2)
    .map((k) => `${k}=${JSON.stringify(result[k])}`)
    .join(", ");
}
