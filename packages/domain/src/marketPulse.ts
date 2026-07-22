import type { MarketPulseResponse } from "@pulse/schemas";
import { findByAddress, resolveQuery } from "./catalog.js";
import { clamp, fnv1a, nowIso, seededUnit } from "./hash.js";

const METHODOLOGY = "pulse-v2.0.0";

export function marketPulse(opts: {
  address?: string;
  symbol?: string;
  chainId?: string;
  methodologyVersion?: string;
}): MarketPulseResponse {
  const chainId = opts.chainId ?? "196";
  let address = opts.address?.toLowerCase();
  let symbol = opts.symbol?.toUpperCase();

  if (!address && symbol) {
    const hit = resolveQuery(symbol, chainId)[0];
    address = hit?.address ?? `0x${fnv1a(symbol).toString(16).padStart(40, "0").slice(0, 40)}`;
  }
  if (!address) address = "0x0000000000000000000000000000000000000000";

  const known = findByAddress(address);
  symbol = known?.symbol ?? symbol ?? `T${address.slice(2, 6).toUpperCase()}`;

  const seed = fnv1a(`${chainId}:mkt:${address}`);
  const isStable = known?.kind === "stable";
  const isNative = known?.kind === "native";

  const priceUsd = isStable
    ? 0.999 + seededUnit(seed, 1) * 0.002
    : isNative
      ? 40 + seededUnit(seed, 1) * 30
      : 0.01 + seededUnit(seed, 1) * 12;

  const change24hPct = isStable
    ? (seededUnit(seed, 2) - 0.5) * 0.4
    : (seededUnit(seed, 2) - 0.45) * 28;

  const volume24hUsd = isStable || isNative
    ? 1_000_000 + seededUnit(seed, 3) * 20_000_000
    : 5_000 + seededUnit(seed, 3) * 2_000_000;

  const liquidityUsd = volume24hUsd * (0.2 + seededUnit(seed, 4) * 0.5);

  let momentum: MarketPulseResponse["momentum"] = "warm";
  if (Math.abs(change24hPct) > 12 && volume24hUsd > 100_000) momentum = "hot";
  else if (volume24hUsd < 10_000) momentum = "frozen";
  else if (Math.abs(change24hPct) < 1.5) momentum = "cold";

  const pulseScore = clamp(
    50 +
      Math.min(25, Math.log10(Math.max(volume24hUsd, 1)) * 4) +
      (momentum === "hot" ? 15 : momentum === "warm" ? 8 : momentum === "cold" ? 0 : -20) -
      (Math.abs(change24hPct) > 20 ? 10 : 0),
  );

  const summary =
    momentum === "hot"
      ? `${symbol} is moving with elevated volume and volatility — size carefully.`
      : momentum === "frozen"
        ? `${symbol} shows thin activity — execution risk is elevated.`
        : momentum === "cold"
          ? `${symbol} is quiet; expect wider spreads relative to busy pairs.`
          : `${symbol} shows moderate market activity suitable for routine agent routing.`;

  return {
    service: "market_pulse",
    methodology_version: opts.methodologyVersion ?? METHODOLOGY,
    chainId,
    address,
    symbol,
    priceUsd: Math.round(priceUsd * 1e6) / 1e6,
    change24hPct: Math.round(change24hPct * 100) / 100,
    volume24hUsd: Math.round(volume24hUsd),
    liquidityUsd: Math.round(liquidityUsd),
    momentum,
    pulseScore: Math.round(pulseScore),
    summary,
    limitations: [
      "Demo prices are deterministic seeds; production should stream CEX/DEX oracles.",
    ],
    generatedAt: nowIso(),
  };
}
