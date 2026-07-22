import type { PreflightRequest, PreflightResponse } from "@pulse/schemas";
import { marketPulse } from "./marketPulse.js";
import { scanToken } from "./tokenScan.js";
import { scanWallet } from "./walletScan.js";
import { swapQuote } from "./swapQuote.js";
import { clamp, nowIso, shortId } from "./hash.js";
import { scoreToGrade, scoreToVerdict } from "./grades.js";

const METHODOLOGY = "pulse-v2.0.0";

export function runPreflight(
  req: PreflightRequest,
  methodologyVersion = METHODOLOGY,
): PreflightResponse {
  const chainId = req.chainId ?? "196";
  const tokenAddr = req.tokenAddress ?? req.toToken ?? req.fromToken;
  const walletAddr = req.walletAddress ?? req.counterparty;

  const token = tokenAddr
    ? scanToken(tokenAddr, chainId, methodologyVersion)
    : undefined;
  const wallet = walletAddr
    ? scanWallet(walletAddr, chainId, methodologyVersion)
    : undefined;
  const market = tokenAddr
    ? marketPulse({ address: tokenAddr, chainId, methodologyVersion })
    : undefined;
  const quote =
    req.intent === "swap" && req.fromToken && req.toToken && req.amount
      ? swapQuote({
          fromToken: req.fromToken,
          toToken: req.toToken,
          amount: req.amount,
          chainId,
          methodologyVersion,
        })
      : undefined;

  const scores: number[] = [];
  if (token) scores.push(token.riskScore);
  if (wallet) scores.push(wallet.riskScore);
  if (market) scores.push(market.pulseScore);
  if (quote) scores.push(quote.qualityScore);
  if (scores.length === 0) scores.push(50);

  const overallScore = Math.round(
    clamp(scores.reduce((a, b) => a + b, 0) / scores.length) * 10,
  ) / 10;

  const checklist: PreflightResponse["checklist"] = [
    {
      id: "token",
      title: "Token risk",
      status: !token ? "skip" : token.verdict === "PASS" ? "pass" : token.verdict === "WARN" ? "warn" : "fail",
      detail: token
        ? `${token.symbol} grade ${token.grade} (${token.riskScore}) — ${token.flags.join(", ") || "no flags"}`
        : "No token provided for this intent.",
    },
    {
      id: "wallet",
      title: "Counterparty / wallet",
      status: !wallet ? "skip" : wallet.verdict === "PASS" ? "pass" : wallet.verdict === "WARN" ? "warn" : "fail",
      detail: wallet
        ? `Grade ${wallet.grade} (${wallet.riskScore}) — labels: ${wallet.labels.join(", ")}`
        : "No wallet / counterparty provided.",
    },
    {
      id: "market",
      title: "Market conditions",
      status: !market
        ? "skip"
        : market.momentum === "frozen"
          ? "fail"
          : market.momentum === "hot"
            ? "warn"
            : "pass",
      detail: market ? market.summary : "Market pulse not requested.",
    },
    {
      id: "route",
      title: "Execution route",
      status: !quote
        ? req.intent === "swap"
          ? "warn"
          : "skip"
        : quote.verdict === "PASS"
          ? "pass"
          : quote.verdict === "WARN"
            ? "warn"
            : "fail",
      detail: quote
        ? `Impact ${quote.priceImpactBps} bps · route ${quote.route.join(" → ")}`
        : req.intent === "swap"
          ? "Swap intent missing from/to/amount."
          : "Route check not applicable.",
    },
  ];

  const recommendations: string[] = [];
  if (token?.verdict === "FAIL") {
    recommendations.push("Block autonomous spend on this token until a human reviews flags.");
  } else if (token?.verdict === "WARN") {
    recommendations.push("Cap position size and require confirmation before executing.");
  }
  if (wallet?.labels.includes("fresh_wallet")) {
    recommendations.push("Counterparty is young — use escrow or staged settlement if hiring.");
  }
  if (quote && quote.priceImpactBps > 100) {
    recommendations.push("Split the swap or widen deadline to reduce impact.");
  }
  if (market?.momentum === "hot") {
    recommendations.push("Volatility elevated — prefer limit-style or smaller clips.");
  }
  if (recommendations.length === 0) {
    recommendations.push("All systems nominal — safe to proceed with standard agent limits.");
  }

  const verdict = scoreToVerdict(overallScore);
  const grade = scoreToGrade(overallScore);
  const headline =
    verdict === "PASS"
      ? `CLEAR TO PROCEED · ${grade} (${overallScore})`
      : verdict === "WARN"
        ? `PROCEED WITH CAUTION · ${grade} (${overallScore})`
        : `HOLD · DO NOT EXECUTE · ${grade} (${overallScore})`;

  const shareSeed = [
    req.intent,
    tokenAddr ?? "",
    walletAddr ?? "",
    req.amount ?? "",
    String(overallScore),
  ].join(":");

  return {
    service: "preflight",
    methodology_version: methodologyVersion,
    intent: req.intent,
    chainId,
    overallScore,
    grade,
    verdict,
    headline,
    checklist,
    token,
    wallet,
    market,
    quote,
    recommendations,
    shareId: shortId(shareSeed),
    limitations: [
      "Composite preflight aggregates module scores; each module lists its own limitations.",
      "Always attach methodology_version when caching or auditing agent decisions.",
    ],
    generatedAt: nowIso(),
  };
}
