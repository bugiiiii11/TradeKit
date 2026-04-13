/**
 * Trade logger
 *
 * Appends trade records to trades/trade_log.json using the exact JSON schema
 * from the strategy KB. Each trade is a single object in a JSON array.
 *
 * Schema:
 * {
 *   timestamp, strategy, direction, entry_price, stop_loss, take_profit,
 *   leverage, position_size_usd, margin_used_usd, risk_percent,
 *   confluence_score, exit_price, exit_reason, pnl_usd, pnl_percent, notes
 * }
 */

import * as fs from "fs";
import * as path from "path";

const LOG_PATH = path.resolve(__dirname, "../../trades/trade_log.json");

export interface TradeRecord {
  timestamp: string;
  strategy: "S1" | "S2" | "S3";
  direction: "long" | "short";
  entry_price: number;
  stop_loss: number;
  take_profit: number | null;
  leverage: number;
  position_size_usd: number;
  margin_used_usd: number;
  risk_percent: number;
  confluence_score: number;
  exit_price: number | null;
  exit_reason: string | null;
  pnl_usd: number | null;
  pnl_percent: number | null;
  notes: string;
}

/** Append an opened trade (exit fields are null until close) */
export function logTradeOpen(record: Omit<TradeRecord, "exit_price" | "exit_reason" | "pnl_usd" | "pnl_percent"> & {
  exit_price?: null;
  exit_reason?: null;
  pnl_usd?: null;
  pnl_percent?: null;
}): void {
  const full: TradeRecord = {
    exit_price: null,
    exit_reason: null,
    pnl_usd: null,
    pnl_percent: null,
    ...record,
  };
  appendRecord(full);
}

/** Update the most recent open trade record with exit data */
export function logTradeClose(
  entryTimestamp: string,
  exitPrice: number,
  exitReason: string
): void {
  const records = readAll();
  const idx = records.findIndex(
    (r) => r.timestamp === entryTimestamp && r.exit_price === null
  );

  if (idx === -1) {
    console.warn(`[Logger] No open trade found for timestamp ${entryTimestamp}`);
    return;
  }

  const trade = records[idx];
  const pnlUsd =
    trade.direction === "long"
      ? (exitPrice - trade.entry_price) * (trade.position_size_usd / trade.entry_price)
      : (trade.entry_price - exitPrice) * (trade.position_size_usd / trade.entry_price);

  const pnlPercent = (pnlUsd / trade.margin_used_usd) * 100;

  records[idx] = {
    ...trade,
    exit_price: exitPrice,
    exit_reason: exitReason,
    pnl_usd: parseFloat(pnlUsd.toFixed(4)),
    pnl_percent: parseFloat(pnlPercent.toFixed(2)),
  };

  writeAll(records);
  console.log(`[Logger] Trade closed — PnL: $${records[idx].pnl_usd} (${records[idx].pnl_percent}%)`);
}

export function readAll(): TradeRecord[] {
  ensureFile();
  const raw = fs.readFileSync(LOG_PATH, "utf-8");
  return JSON.parse(raw) as TradeRecord[];
}

// ---------------------------------------------------------------------------

function appendRecord(record: TradeRecord): void {
  const records = readAll();
  records.push(record);
  writeAll(records);
  console.log(`[Logger] Trade logged — ${record.strategy} ${record.direction} @ $${record.entry_price}`);
}

function writeAll(records: TradeRecord[]): void {
  ensureFile();
  fs.writeFileSync(LOG_PATH, JSON.stringify(records, null, 2), "utf-8");
}

function ensureFile(): void {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, "[]", "utf-8");
}
