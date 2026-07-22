import type { WalletScanResponse } from "@pulse/schemas";
import { clamp, fnv1a, nowIso, seededUnit } from "./hash.js";
import { scoreToGrade, scoreToVerdict, weightedScore } from "./grades.js";

const METHODOLOGY = "pulse-v2.0.0";

export function scanWallet(
  address: string,
  chainId = "196",
  methodologyVersion = METHODOLOGY,
): WalletScanResponse {
  const seed = fnv1a(`${chainId}:wallet:${address.toLowerCase()}`);
  const ageDays = Math.floor(1 + seededUnit(seed, 1) * 900);
  const txCount = Math.floor(seededUnit(seed, 2) * 12_000);
  const balanceOkb = seededUnit(seed, 3) * (seededUnit(seed, 4) > 0.85 ? 500 : 12);

  const ageScore = clamp(ageDays >= 180 ? 90 : ageDays >= 30 ? 72 : ageDays >= 7 ? 48 : 22);
  const activityScore = clamp(
    txCount === 0 ? 15 : txCount < 5 ? 40 : txCount < 50 ? 65 : txCount < 500 ? 82 : 90,
  );
  const balanceScore = clamp(balanceOkb < 0.001 ? 25 : balanceOkb < 0.1 ? 50 : balanceOkb < 5 ? 75 : 88);

  const labels: string[] = [];
  if (ageDays < 7) labels.push("fresh_wallet");
  if (txCount > 1000) labels.push("high_activity");
  if (balanceOkb > 100) labels.push("whale_candidate");
  if (seededUnit(seed, 5) > 0.92) labels.push("mixer_proximity_heuristic");
  if (seededUnit(seed, 6) > 0.88) labels.push("contract_deployer");
  if (labels.length === 0) labels.push("unlabeled");

  const labelPenalty = labels.includes("mixer_proximity_heuristic")
    ? 40
    : labels.includes("fresh_wallet")
      ? 18
      : 0;
  const reputationScore = clamp(82 - labelPenalty + seededUnit(seed, 7) * 10);

  const components = [
    {
      key: "age",
      label: "Wallet age",
      score: Math.round(ageScore),
      weight: 0.25,
      reason: `Approx. age ${ageDays} days.`,
    },
    {
      key: "activity",
      label: "Onchain activity",
      score: Math.round(activityScore),
      weight: 0.3,
      reason: `Estimated tx count ≈ ${txCount.toLocaleString()}.`,
    },
    {
      key: "balance",
      label: "Native balance signal",
      score: Math.round(balanceScore),
      weight: 0.15,
      reason: `Native balance ≈ ${balanceOkb.toFixed(4)} OKB.`,
    },
    {
      key: "reputation",
      label: "Label / cluster risk",
      score: Math.round(reputationScore),
      weight: 0.3,
      reason: `Labels: ${labels.join(", ")}.`,
    },
  ];

  const riskScore = weightedScore(components);

  return {
    service: "wallet_scan",
    methodology_version: methodologyVersion,
    chainId,
    address: address.toLowerCase(),
    riskScore,
    grade: scoreToGrade(riskScore),
    verdict: scoreToVerdict(riskScore),
    components,
    labels,
    txCountEstimate: txCount,
    ageDays,
    nativeBalance: balanceOkb.toFixed(6),
    limitations: [
      "Label heuristics are synthetic in demo mode; production should plug chain indexers.",
      "Not a KYC/AML determination.",
    ],
    generatedAt: nowIso(),
  };
}
