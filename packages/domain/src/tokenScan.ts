import type { TokenScanResponse } from "@pulse/schemas";
import { findByAddress } from "./catalog.js";
import { clamp, fnv1a, nowIso, seededUnit } from "./hash.js";
import { scoreToGrade, scoreToVerdict, weightedScore } from "./grades.js";

const METHODOLOGY = "pulse-v2.0.0";

export function scanToken(
  address: string,
  chainId = "196",
  methodologyVersion = METHODOLOGY,
): TokenScanResponse {
  const seed = fnv1a(`${chainId}:${address.toLowerCase()}`);
  const known = findByAddress(address);
  const isStable = known?.kind === "stable";
  const isNative = known?.kind === "native" || address === "0x0000000000000000000000000000000000000000";
  const isKnown = Boolean(known && known.kind !== "unknown");

  const liquidityUsd = isStable || isNative
    ? 2_500_000 + seededUnit(seed, 1) * 8_000_000
    : isKnown
      ? 80_000 + seededUnit(seed, 1) * 900_000
      : 500 + seededUnit(seed, 1) * 40_000;

  const holders = isStable
    ? Math.floor(50_000 + seededUnit(seed, 2) * 200_000)
    : isKnown
      ? Math.floor(2_000 + seededUnit(seed, 2) * 40_000)
      : Math.floor(20 + seededUnit(seed, 2) * 800);

  const ageDays = isStable || isNative
    ? Math.floor(400 + seededUnit(seed, 3) * 600)
    : isKnown
      ? Math.floor(90 + seededUnit(seed, 3) * 400)
      : Math.floor(1 + seededUnit(seed, 3) * 45);

  const isVerified = isStable || isNative || isKnown || seededUnit(seed, 4) > 0.35;

  // Component scores (higher = safer)
  const liquidityScore = clamp(
    Math.log10(Math.max(liquidityUsd, 1)) * 18 - (isKnown ? 0 : 15),
  );
  const holderScore = clamp(Math.log10(Math.max(holders, 1)) * 22 - (holders < 100 ? 25 : 0));
  const ageScore = clamp(ageDays >= 180 ? 92 : ageDays >= 30 ? 70 : ageDays >= 7 ? 45 : 20);
  const verifyScore = isVerified ? 90 : 35;
  const concentrationPenalty = !isKnown && seededUnit(seed, 5) > 0.7 ? 30 : 0;
  const ownershipScore = clamp(isStable || isNative ? 95 : 78 - concentrationPenalty - seededUnit(seed, 6) * 25);

  const components = [
    {
      key: "liquidity",
      label: "Liquidity depth",
      score: Math.round(liquidityScore),
      weight: 0.28,
      reason:
        liquidityUsd >= 100_000
          ? `Liquidity ≈ $${Math.round(liquidityUsd).toLocaleString()} — tradable size available.`
          : `Thin liquidity ≈ $${Math.round(liquidityUsd).toLocaleString()} — high slippage risk.`,
    },
    {
      key: "holders",
      label: "Holder distribution",
      score: Math.round(holderScore),
      weight: 0.2,
      reason: `Estimated holders ≈ ${holders.toLocaleString()}.`,
    },
    {
      key: "age",
      label: "Contract age",
      score: Math.round(ageScore),
      weight: 0.18,
      reason: `Observed age ≈ ${ageDays} days.`,
    },
    {
      key: "verification",
      label: "Source verification",
      score: Math.round(verifyScore),
      weight: 0.16,
      reason: isVerified
        ? "Contract appears verified / known catalog entry."
        : "Unverified or unknown source — treat as higher risk.",
    },
    {
      key: "ownership",
      label: "Ownership / mint risk",
      score: Math.round(ownershipScore),
      weight: 0.18,
      reason:
        concentrationPenalty > 0
          ? "Elevated ownership concentration heuristic triggered."
          : "No strong mint/owner red flags in heuristic model.",
    },
  ];

  const riskScore = weightedScore(components);
  const flags: string[] = [];
  if (!isVerified) flags.push("UNVERIFIED");
  if (liquidityUsd < 25_000) flags.push("THIN_LIQUIDITY");
  if (ageDays < 14) flags.push("NEW_CONTRACT");
  if (holders < 100) flags.push("LOW_HOLDERS");
  if (isStable) flags.push("STABLECOIN");
  if (isNative) flags.push("NATIVE");
  if (concentrationPenalty > 0) flags.push("CONCENTRATED");

  const symbol = known?.symbol ?? `T${address.slice(2, 6).toUpperCase()}`;
  const name = known?.name ?? `Token ${address.slice(0, 8)}…`;

  return {
    service: "token_scan",
    methodology_version: methodologyVersion,
    chainId,
    address: address.toLowerCase(),
    symbol,
    name,
    riskScore,
    grade: scoreToGrade(riskScore),
    verdict: scoreToVerdict(riskScore),
    components,
    flags,
    liquidityUsd: Math.round(liquidityUsd),
    holdersEstimate: holders,
    contractAgeDays: ageDays,
    isVerified,
    limitations: [
      "Scores are deterministic heuristics for agent preflight — not investment advice.",
      "Live DEX liquidity / honeypot simulation can be wired via RPC adapters in production.",
    ],
    generatedAt: nowIso(),
  };
}
