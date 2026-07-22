import type { SwapQuoteResponse } from "@pulse/schemas";
import { findByAddress } from "./catalog.js";
import { clamp, fnv1a, nowIso, seededUnit } from "./hash.js";
import { scoreToVerdict } from "./grades.js";

const METHODOLOGY = "pulse-v2.0.0";

export function swapQuote(opts: {
  fromToken: string;
  toToken: string;
  amount: string;
  chainId?: string;
  slippageBps?: number;
  methodologyVersion?: string;
}): SwapQuoteResponse {
  const chainId = opts.chainId ?? "196";
  const slippageBps = opts.slippageBps ?? 50;
  const from = opts.fromToken.toLowerCase();
  const to = opts.toToken.toLowerCase();
  const seed = fnv1a(`${chainId}:${from}:${to}:${opts.amount}`);

  const fromMeta = findByAddress(from);
  const toMeta = findByAddress(to);
  const amountIn = Number(opts.amount);
  const safeAmount = Number.isFinite(amountIn) && amountIn > 0 ? amountIn : 0;

  const fromPrice =
    fromMeta?.kind === "stable" ? 1 : fromMeta?.kind === "native" ? 55 : 1 + seededUnit(seed, 1) * 4;
  const toPrice =
    toMeta?.kind === "stable" ? 1 : toMeta?.kind === "native" ? 55 : 1 + seededUnit(seed, 2) * 4;

  const notional = safeAmount * fromPrice;
  const impactBps = Math.round(
    clamp(5 + Math.log10(Math.max(notional, 1)) * 8 + seededUnit(seed, 3) * 40, 1, 2500),
  );

  const grossOut = (safeAmount * fromPrice) / Math.max(toPrice, 1e-9);
  const amountOut = grossOut * (1 - impactBps / 10_000);
  const amountOutMin = amountOut * (1 - slippageBps / 10_000);

  const route =
    fromMeta?.kind === "stable" || toMeta?.kind === "stable"
      ? [fromMeta?.symbol ?? "FROM", toMeta?.symbol ?? "TO"]
      : [fromMeta?.symbol ?? "FROM", "USD₮0", toMeta?.symbol ?? "TO"];

  const gasEstimate = String(Math.floor(180_000 + seededUnit(seed, 4) * 120_000));

  let qualityScore = 90 - impactBps / 20;
  if (impactBps > 150) qualityScore -= 15;
  if (impactBps > 400) qualityScore -= 25;
  if (!fromMeta || !toMeta) qualityScore -= 10;
  qualityScore = clamp(qualityScore);

  const notes: string[] = [];
  if (impactBps > 100) notes.push("Price impact above 1% — consider splitting the order.");
  if (slippageBps < impactBps) notes.push("Configured slippage may be tighter than estimated impact.");
  if (route.length > 2) notes.push("Multi-hop route via stable intermediate.");
  if (notes.length === 0) notes.push("Route quality looks acceptable for agent execution.");

  return {
    service: "swap_quote",
    methodology_version: opts.methodologyVersion ?? METHODOLOGY,
    chainId,
    fromToken: from,
    toToken: to,
    amountIn: String(safeAmount),
    amountOut: amountOut.toFixed(6),
    amountOutMin: amountOutMin.toFixed(6),
    priceImpactBps: impactBps,
    route,
    gasEstimate,
    qualityScore: Math.round(qualityScore),
    verdict: scoreToVerdict(qualityScore),
    notes,
    limitations: [
      "Quote model is heuristic for demo; production should call OKX DEX aggregator APIs.",
    ],
    generatedAt: nowIso(),
  };
}
