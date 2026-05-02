/**
 * WebSocket candle consumer for the headless bot.
 *
 * Subscribes to Hyperliquid 15m BTC candles via the SDK's SubscriptionClient.
 * Maintains a rolling 600-bar buffer, detects bar closes by t-field advancing,
 * aggregates to 1H/4H/1D, and computes all indicators.
 *
 * Consultant requirements:
 *   - Single 15m WS subscription, compute higher TFs locally
 *   - Detect bar close by t advancing (never act on partial candles)
 *   - 600-bar minimum buffer for EMA200 warmup
 *   - REST warmup on startup before subscribing
 *   - Heartbeat: reconnect if no message in 60s
 *   - REST gap-fill on reconnect
 */

import * as hl from "@nktkas/hyperliquid";
import type { Candle as HLCandle } from "@nktkas/hyperliquid/esm/src/types/info/assets.js";
import { fetchCandles, buildBarData, type IndicatorParams } from "../backtest/collector";
import { aggregateTo1H, aggregateTo4H, aggregateTo1D } from "../backtest/aggregator";
import type { Candle, BarData } from "../backtest/types";
import type { IndicatorSnapshot, Timeframe } from "../tradingview/reader";

// 1500 bars of 15m = 375 bars of 1H (enough for BBWP=264, PMARP=369)
// and ~93 bars of 4H (enough for EMA55). Previously 700 → 1H BBWP/PMARP were always NaN.
const BUFFER_SIZE = 1500;
const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_TIMEOUT_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const MS_15M = 15 * 60_000;

export interface CandleConsumerConfig {
  onBarClose: (snapshots: {
    snap15m: IndicatorSnapshot;
    snap1H: IndicatorSnapshot;
    snap4H: IndicatorSnapshot;
    snap1D: IndicatorSnapshot;
  }) => void;
  indicatorParams?: IndicatorParams;
}

function hlCandleToCandle(c: HLCandle): Candle {
  return {
    timestamp: c.t,
    open: parseFloat(c.o),
    high: parseFloat(c.h),
    low: parseFloat(c.l),
    close: parseFloat(c.c),
    volume: parseFloat(c.v),
  };
}

function barToSnapshot(bar: BarData, timeframe: Timeframe): IndicatorSnapshot {
  return {
    timeframe,
    close: bar.close,
    ema8: bar.ema8,
    ema13: bar.ema13,
    ema21: bar.ema21,
    ema55: bar.ema55,
    ema200: bar.ema200,
    rsi14: bar.rsi14,
    stochK: bar.stochK,
    stochD: bar.stochD,
    bbwp: bar.bbwp,
    pmarp: bar.pmarp,
    timestamp: new Date(bar.timestamp).toISOString(),
  };
}

export class CandleConsumer {
  private buffer: Candle[] = [];
  private warmup4H: Candle[] = [];
  private warmup1D: Candle[] = [];
  private currentOpenTime = 0;
  private transport: hl.WebSocketTransport | null = null;
  private subsClient: hl.SubscriptionClient | null = null;
  private subscription: { unsubscribe(): Promise<void> } | null = null;
  private lastMessageTime = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private config: CandleConsumerConfig;
  private running = false;
  private reconnectAttempts = 0;

  constructor(config: CandleConsumerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.running = true;

    // 1. REST warmup — fetch 15m + higher-TF candles in parallel
    console.log("[WS] Fetching historical candles for warmup...");
    const endMs = Date.now();
    const startMs = endMs - BUFFER_SIZE * MS_15M;
    const [candles, candles4H, candles1D] = await Promise.all([
      fetchCandles("15m", startMs, endMs),
      fetchCandles("4H", endMs - 250 * 4 * 3_600_000, endMs),
      fetchCandles("1D", endMs - 250 * 24 * 3_600_000, endMs),
    ]);
    this.buffer = candles.slice(-BUFFER_SIZE);
    this.warmup4H = candles4H;
    this.warmup1D = candles1D;
    console.log(
      `[WS] Warmup complete: ${this.buffer.length} 15m, ` +
      `${candles4H.length} 4H, ${candles1D.length} 1D bars loaded`
    );

    if (this.buffer.length > 0) {
      this.currentOpenTime = this.buffer[this.buffer.length - 1].timestamp;
    }

    // Compute initial snapshots from warmup data
    this.computeAndEmit();

    // 2. Subscribe to WebSocket
    await this.subscribe();

    // 3. Start heartbeat monitor
    this.startHeartbeat();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.subscription) {
      try { await this.subscription.unsubscribe(); } catch { /* ignore */ }
      this.subscription = null;
    }
    if (this.transport) {
      try { await this.transport[Symbol.asyncDispose](); } catch { /* ignore */ }
      this.transport = null;
    }
    this.subsClient = null;
  }

  private async subscribe(): Promise<void> {
    console.log("[WS] Connecting to Hyperliquid WebSocket...");

    const transport = new hl.WebSocketTransport({ url: "wss://api.hyperliquid.xyz/ws" });
    const subsClient = new hl.SubscriptionClient({ transport });

    let subscription: { unsubscribe(): Promise<void> };
    try {
      subscription = await subsClient.candle(
        { coin: "BTC", interval: "15m" },
        (candle: HLCandle) => this.onCandleMessage(candle),
      );
    } catch (err) {
      try { await transport[Symbol.asyncDispose](); } catch { /* ignore */ }
      throw err;
    }

    this.transport = transport;
    this.subsClient = subsClient;
    this.subscription = subscription;
    this.lastMessageTime = Date.now();
    console.log("[WS] Subscribed to BTC 15m candles");
  }

  private onCandleMessage(hlCandle: HLCandle): void {
    this.lastMessageTime = Date.now();
    this.reconnectAttempts = 0;
    const candle = hlCandleToCandle(hlCandle);

    if (candle.timestamp === this.currentOpenTime) {
      // Partial update — same bar, just update OHLCV
      const last = this.buffer[this.buffer.length - 1];
      if (last) {
        last.high = Math.max(last.high, candle.high);
        last.low = Math.min(last.low, candle.low);
        last.close = candle.close;
        last.volume = candle.volume;
      }
      return;
    }

    if (candle.timestamp > this.currentOpenTime) {
      // New bar opened — previous bar is closed
      console.log(`[WS] Bar closed: ${new Date(this.currentOpenTime).toISOString()} | New bar: ${new Date(candle.timestamp).toISOString()}`);

      // Add the new bar to buffer
      this.buffer.push({
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });

      // Trim buffer to max size
      if (this.buffer.length > BUFFER_SIZE) {
        this.buffer = this.buffer.slice(-BUFFER_SIZE);
      }

      this.currentOpenTime = candle.timestamp;

      // Compute indicators and emit snapshots
      this.computeAndEmit();
    }
  }

  private computeAndEmit(): void {
    if (this.buffer.length < 100) {
      console.log(`[WS] Buffer too small for indicators (${this.buffer.length} bars)`);
      return;
    }

    // Aggregate higher timeframes from 15m buffer
    const candles1H = aggregateTo1H(this.buffer);
    const agg4H = aggregateTo4H(this.buffer);
    const agg1D = aggregateTo1D(this.buffer);

    // Merge warmup candles (pre-buffer history) with aggregated candles
    const candles4H = this.mergeWarmup(this.warmup4H, agg4H);
    const candles1D = this.mergeWarmup(this.warmup1D, agg1D);

    // Compute indicators
    const params = this.config.indicatorParams;
    const bars15m = buildBarData(this.buffer, params);
    const bars1H = buildBarData(candles1H, params);
    const bars4H = buildBarData(candles4H, params);
    const bars1D = buildBarData(candles1D, params);

    const last15m = bars15m[bars15m.length - 1];
    const last1H = bars1H[bars1H.length - 1];
    const last4H = bars4H[bars4H.length - 1];
    const last1D = bars1D[bars1D.length - 1];

    if (!last15m || !last1H || !last4H || !last1D) {
      console.log("[WS] Not enough aggregated bars for all timeframes");
      return;
    }

    this.config.onBarClose({
      snap15m: barToSnapshot(last15m, "15m"),
      snap1H: barToSnapshot(last1H, "1H"),
      snap4H: barToSnapshot(last4H, "4H"),
      snap1D: barToSnapshot(last1D, "1D"),
    });
  }

  private mergeWarmup(warmup: Candle[], aggregated: Candle[]): Candle[] {
    if (warmup.length === 0 || aggregated.length === 0) return aggregated;
    const firstAggTs = aggregated[0].timestamp;
    const historical = warmup.filter(c => c.timestamp < firstAggTs);
    return [...historical, ...aggregated];
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      if (!this.running) return;

      const staleDuration = Date.now() - this.lastMessageTime;
      if (staleDuration > STALE_TIMEOUT_MS) {
        this.reconnectAttempts++;
        console.warn(`[WS] No message in ${(staleDuration / 1000).toFixed(0)}s — reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

        if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          console.error(`[WS] ${MAX_RECONNECT_ATTEMPTS} reconnect attempts failed — exiting for pm2 restart`);
          process.exit(1);
        }

        await this.reconnect();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async reconnect(): Promise<void> {
    // Tear down old subscription
    if (this.subscription) {
      try { await this.subscription.unsubscribe(); } catch { /* ignore */ }
      this.subscription = null;
    }
    if (this.transport) {
      try { await this.transport[Symbol.asyncDispose](); } catch { /* ignore */ }
      this.transport = null;
    }
    this.subsClient = null;

    // REST gap-fill: fetch bars since last known timestamp
    const lastTs = this.buffer.length > 0
      ? this.buffer[this.buffer.length - 1].timestamp
      : Date.now() - BUFFER_SIZE * MS_15M;

    console.log("[WS] Fetching missed bars via REST...");
    try {
      const missed = await fetchCandles("15m", lastTs, Date.now());
      let added = 0;
      for (const c of missed) {
        if (c.timestamp > lastTs) {
          this.buffer.push(c);
          added++;
        }
      }
      if (this.buffer.length > BUFFER_SIZE) {
        this.buffer = this.buffer.slice(-BUFFER_SIZE);
      }
      if (added > 0) {
        this.currentOpenTime = this.buffer[this.buffer.length - 1].timestamp;
        console.log(`[WS] Gap-filled ${added} bars`);
        this.computeAndEmit();
      }
    } catch (err) {
      console.error("[WS] REST gap-fill failed:", err);
    }

    // Re-subscribe
    try {
      await this.subscribe();
    } catch (err) {
      console.error("[WS] Reconnect failed — will retry on next heartbeat:", err);
    }
  }
}
