import type { Candle } from "@pulse/market";

export type AutopilotStrategyType = "trend_following" | "breakout" | "mean_reversion";
export type AutopilotRuleResult = {
  id: string;
  label: string;
  passed: boolean;
  observed: string;
  required: string;
  scope: "entry" | "exit" | "risk";
};

export const AUTOPILOT_STRATEGY_CATALOG = [
  {
    id: "trend_following" as const,
    label: "Trend following",
    purpose: "Join a confirmed directional trend and leave when trend structure fails.",
    entryRules: ["Compact AI bias is bullish", "Confidence meets the signed threshold", "Regime is trend-up", "Close is above SMA20", "SMA20 is above SMA50"],
    exitRules: ["Take-profit or stop-loss is reached", "Compact AI bias turns bearish at the threshold", "Close falls below SMA20"],
  },
  {
    id: "breakout" as const,
    label: "Breakout",
    purpose: "Enter only after price and volume confirm a break of the prior range.",
    entryRules: ["Compact AI bias is bullish", "Confidence meets the signed threshold", "Close exceeds the previous 20-candle high", "Latest volume is at least 1.15x its 20-candle average", "Regime is trend-up or transition"],
    exitRules: ["Take-profit or stop-loss is reached", "Compact AI bias turns bearish at the threshold", "Close loses SMA20"],
  },
  {
    id: "mean_reversion" as const,
    label: "Mean reversion",
    purpose: "Buy a confirmed pullback near support and exit after reversion or invalidation.",
    entryRules: ["Compact AI bias is bullish", "Confidence meets the signed threshold", "Price is within 1% of signal support or RSI14 is 42 or lower", "Regime is range or transition"],
    exitRules: ["Take-profit or stop-loss is reached", "Compact AI bias turns bearish at the threshold", "Price reverts to SMA20"],
  },
] as const;

export function identifyAutopilotStrategy(value: string | undefined): AutopilotStrategyType {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("breakout")) return "breakout";
  if (normalized.includes("mean") && normalized.includes("reversion")) return "mean_reversion";
  return "trend_following";
}

/** Maximum target-token amount whose oracle value does not exceed maxTrade. */
export function boundedTargetSellAmount(input: {
  targetBalance: bigint;
  maxTradeValue: bigint;
  priceE18: bigint;
  targetDecimals: number;
  settlementDecimals: number;
}) {
  if (input.targetBalance <= 0n || input.maxTradeValue <= 0n || input.priceE18 <= 0n) return 0n;
  const targetScale = 10n ** BigInt(input.targetDecimals);
  const settlementScale = 10n ** BigInt(input.settlementDecimals);
  const capacity = input.maxTradeValue
    * targetScale
    * 10n ** 18n
    / input.priceE18
    / settlementScale;
  if (input.targetBalance <= capacity) return input.targetBalance;

  // Split an appreciated position into balanced cap-compliant chunks. Taking
  // the full capacity first can leave a few target-token atomic units that no
  // DEX will quote, permanently preventing a complete strategy exit.
  const totalValue = input.targetBalance
    * input.priceE18
    * settlementScale
    / targetScale
    / 10n ** 18n;
  const chunkCount = (totalValue + input.maxTradeValue - 1n) / input.maxTradeValue;
  const balancedChunk = (input.targetBalance + chunkCount - 1n) / chunkCount;
  return balancedChunk < capacity ? balancedChunk : capacity;
}

/** Contract-equivalent minimum output implied by the guarded oracle price. */
export function minimumOracleOutput(input: {
  action: "buy" | "sell";
  sellAmount: bigint;
  priceE18: bigint;
  targetDecimals: number;
  settlementDecimals: number;
  slippageBps: bigint;
}) {
  if (input.sellAmount <= 0n || input.priceE18 <= 0n) return 0n;
  const targetScale = 10n ** BigInt(input.targetDecimals);
  const settlementScale = 10n ** BigInt(input.settlementDecimals);
  const oracleOut = input.action === "buy"
    ? input.sellAmount * targetScale * 10n ** 18n / input.priceE18 / settlementScale
    : input.sellAmount * input.priceE18 * settlementScale / targetScale / 10n ** 18n;
  return oracleOut * (10_000n - input.slippageBps) / 10_000n;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rsi(candles: readonly Candle[], period = 14) {
  const closes = candles.slice(-(period + 1)).map((candle) => candle.close);
  if (closes.length < period + 1) return 50;
  let gains = 0; let losses = 0;
  for (let index = 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) gains += change; else losses -= change;
  }
  if (losses === 0) return 100;
  const relative = (gains / period) / (losses / period);
  return 100 - 100 / (1 + relative);
}

const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;

/**
 * Cheap, deterministic gate evaluated on each new candle before PULSE is
 * allowed to request an AI signal. A false result can only Hold; it can never
 * authorize a trade.
 */
export function evaluateAutopilotEntryCandidate(input: {
  strategyType: AutopilotStrategyType;
  candles: readonly Candle[];
}) {
  if (input.candles.length < 50) throw new Error("Autopilot requires at least 50 candles for deterministic rules");
  const close = input.candles.at(-1)!.close;
  const prior = input.candles.slice(0, -1);
  const sma20 = average(input.candles.slice(-20).map((candle) => candle.close));
  const sma50 = average(input.candles.slice(-50).map((candle) => candle.close));
  const previous20High = Math.max(...prior.slice(-20).map((candle) => candle.high));
  const volumeAverage20 = average(prior.slice(-20).map((candle) => candle.volume));
  const volumeRatio = volumeAverage20 > 0 ? input.candles.at(-1)!.volume / volumeAverage20 : 0;
  const rsi14 = rsi(input.candles);
  const checks = input.strategyType === "trend_following"
    ? [close > sma20, sma20 > sma50]
    : input.strategyType === "breakout"
      ? [close > previous20High, volumeRatio >= 1.15]
      : [rsi14 <= 42];
  const candidate = checks.every(Boolean);
  return {
    candidate,
    reason: candidate
      ? `${AUTOPILOT_STRATEGY_CATALOG.find((item) => item.id === input.strategyType)!.label} market preconditions passed; an AI confirmation may now be requested.`
      : "Deterministic market preconditions did not pass; no AI call or entry is needed.",
    strategyType: input.strategyType,
    metrics: { close, sma20, sma50, previous20High, volumeRatio, rsi14 },
  };
}

/**
 * Fast, deterministic protection path. TP/SL and a latched partial exit do
 * not depend on a new AI confirmation, but every action still waits for the
 * on-chain cooldown and uses the normal quote/simulation/nonce path.
 */
export function evaluateAutopilotRiskExit(input: {
  strategyType: AutopilotStrategyType;
  mark: number;
  hasPosition: boolean;
  exitPending?: boolean;
  activeTakeProfit?: number | null;
  activeStopLoss?: number | null;
  cooldownReady: boolean;
  cooldownRemainingSeconds?: number;
}) {
  const takeProfit = numeric(input.activeTakeProfit);
  const stopLoss = numeric(input.activeStopLoss);
  const tpReached = input.hasPosition && takeProfit !== null && input.mark >= takeProfit;
  const slReached = input.hasPosition && stopLoss !== null && input.mark <= stopLoss;
  const exitCompletion = input.hasPosition && input.exitPending === true;
  const rules: AutopilotRuleResult[] = [
    { id: "take_profit", label: "Live take-profit reached", passed: tpReached, observed: `${input.mark}`, required: takeProfit === null ? "not configured" : `>= ${takeProfit}`, scope: "risk" },
    { id: "stop_loss", label: "Live stop-loss reached", passed: slReached, observed: `${input.mark}`, required: stopLoss === null ? "not configured" : `<= ${stopLoss}`, scope: "risk" },
    { id: "exit_completion", label: "Complete triggered bounded exit", passed: exitCompletion, observed: exitCompletion ? "partial exit remains" : "not pending", required: "a previous policy exit left target balance", scope: "risk" },
    { id: "cooldown_ready", label: "On-chain cooldown elapsed", passed: input.cooldownReady, observed: input.cooldownReady ? "ready" : `${Math.max(0, Math.ceil(input.cooldownRemainingSeconds || 0))}s remaining`, required: "ready", scope: "risk" },
  ];
  const trigger = rules.slice(0, 3).find((rule) => rule.passed);
  const action = input.hasPosition && trigger && input.cooldownReady ? "sell" as const : "hold" as const;
  const reason = action === "sell"
    ? trigger!.label
    : trigger && !input.cooldownReady
      ? "A signed exit is active; waiting for the on-chain cooldown."
      : "No live TP/SL or latched exit condition is active.";
  return {
    action,
    reason,
    strategyType: input.strategyType,
    bias: "not_required",
    confidence: 0,
    metrics: { close: input.mark, takeProfit, stopLoss, cooldownRemainingSeconds: Math.max(0, input.cooldownRemainingSeconds || 0) },
    rules,
  };
}

export function evaluateAutopilotPolicy(input: {
  strategyType: AutopilotStrategyType;
  candles: readonly Candle[];
  report: { analysis?: Record<string, unknown>; executionPlan?: { buy?: { takeProfit?: unknown; stopLoss?: unknown } } };
  minConfidence: number;
  hasPosition: boolean;
  exitPending?: boolean;
  activeTakeProfit?: number | null;
  activeStopLoss?: number | null;
}) {
  if (input.candles.length < 50) throw new Error("Autopilot requires at least 50 candles for deterministic rules");
  const analysis = input.report.analysis || {};
  const close = input.candles.at(-1)!.close;
  const prior = input.candles.slice(0, -1);
  const sma20 = average(input.candles.slice(-20).map((candle) => candle.close));
  const sma50 = average(input.candles.slice(-50).map((candle) => candle.close));
  const previous20High = Math.max(...prior.slice(-20).map((candle) => candle.high));
  const volumeAverage20 = average(prior.slice(-20).map((candle) => candle.volume));
  const volumeRatio = volumeAverage20 > 0 ? input.candles.at(-1)!.volume / volumeAverage20 : 0;
  const rsi14 = rsi(input.candles);
  const bias = String(analysis.bias || "neutral");
  const regime = String(analysis.regime || "transition");
  const confidence = Number(analysis.confidence || 0);
  const supports = Array.isArray((analysis.keyLevels as { support?: unknown } | undefined)?.support)
    ? ((analysis.keyLevels as { support: unknown[] }).support.map(numeric).filter((value): value is number => value !== null && value > 0)) : [];
  const nearestSupport = supports.filter((value) => value <= close * 1.02).sort((a, b) => b - a)[0] || null;
  const nearSupport = nearestSupport !== null && Math.abs(close - nearestSupport) / close <= .01;
  const takeProfit = input.activeTakeProfit ?? numeric(input.report.executionPlan?.buy?.takeProfit);
  const stopLoss = input.activeStopLoss ?? numeric(input.report.executionPlan?.buy?.stopLoss);
  const rules: AutopilotRuleResult[] = [];
  const add = (id: string, label: string, passed: boolean, observed: string, required: string, scope: AutopilotRuleResult["scope"]) => rules.push({ id, label, passed, observed, required, scope });

  if (input.hasPosition) {
    const tpReached = takeProfit !== null && close >= takeProfit;
    const slReached = stopLoss !== null && close <= stopLoss;
    const bearishExit = bias === "bearish" && confidence >= input.minConfidence;
    const structureExit = input.strategyType === "mean_reversion" ? close >= sma20 : close < sma20;
    const exitCompletion = input.exitPending === true;
    add("take_profit", "Take-profit reached", tpReached, `${close}`, takeProfit === null ? "not configured" : `>= ${takeProfit}`, "exit");
    add("stop_loss", "Stop-loss reached", slReached, `${close}`, stopLoss === null ? "not configured" : `<= ${stopLoss}`, "exit");
    add("bearish_report", "Compact AI bearish exit", bearishExit, `${bias} ${confidence}%`, `bearish and >= ${input.minConfidence}%`, "exit");
    add("structure_exit", input.strategyType === "mean_reversion" ? "Reversion reached SMA20" : "Trend lost SMA20", structureExit, `close ${close}; SMA20 ${sma20}`, input.strategyType === "mean_reversion" ? "close >= SMA20" : "close < SMA20", "exit");
    add("exit_completion", "Complete triggered bounded exit", exitCompletion, exitCompletion ? "partial exit remains" : "not pending", "a previous policy exit left target balance", "exit");
    const trigger = rules.find((rule) => rule.passed);
    return { action: trigger ? "sell" as const : "hold" as const, reason: trigger ? trigger.label : "No signed exit condition is active.", strategyType: input.strategyType, bias, confidence, metrics: { close, sma20, sma50, previous20High, volumeRatio, rsi14, nearestSupport, takeProfit, stopLoss }, rules };
  }

  add("bullish_bias", "Compact AI bullish bias", bias === "bullish", bias, "bullish", "entry");
  add("confidence", "Confidence threshold", confidence >= input.minConfidence, `${confidence}%`, `>= ${input.minConfidence}%`, "entry");
  if (input.strategyType === "trend_following") {
    add("trend_regime", "Trend-up regime", regime === "trend_up", regime, "trend_up", "entry");
    add("above_sma20", "Close above SMA20", close > sma20, `${close}`, `> ${sma20}`, "entry");
    add("sma_alignment", "SMA20 above SMA50", sma20 > sma50, `${sma20}`, `> ${sma50}`, "entry");
  } else if (input.strategyType === "breakout") {
    add("breakout_price", "Prior range broken", close > previous20High, `${close}`, `> ${previous20High}`, "entry");
    add("breakout_volume", "Breakout volume", volumeRatio >= 1.15, `${volumeRatio.toFixed(2)}x`, ">= 1.15x", "entry");
    add("breakout_regime", "Continuation regime", regime === "trend_up" || regime === "transition", regime, "trend_up or transition", "entry");
  } else {
    add("pullback", "Pullback at support", nearSupport || rsi14 <= 42, `support ${nearestSupport ?? "none"}; RSI ${rsi14.toFixed(1)}`, "within 1% of support or RSI <= 42", "entry");
    add("range_regime", "Mean-reversion regime", regime === "range" || regime === "transition", regime, "range or transition", "entry");
  }
  const passed = rules.every((rule) => rule.passed);
  const failed = rules.filter((rule) => !rule.passed).map((rule) => rule.label).join(", ");
  return { action: passed ? "buy" as const : "hold" as const, reason: passed ? `${AUTOPILOT_STRATEGY_CATALOG.find((item) => item.id === input.strategyType)!.label} entry rules passed.` : `Hold: ${failed}.`, strategyType: input.strategyType, bias, confidence, metrics: { close, sma20, sma50, previous20High, volumeRatio, rsi14, nearestSupport, takeProfit, stopLoss }, rules };
}
