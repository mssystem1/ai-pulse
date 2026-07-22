import type { RiskGrade, Verdict } from "@pulse/schemas";
import { clamp } from "./hash.js";

export function scoreToGrade(score: number): RiskGrade {
  const s = clamp(score);
  if (s >= 85) return "A";
  if (s >= 70) return "B";
  if (s >= 55) return "C";
  if (s >= 40) return "D";
  return "F";
}

export function scoreToVerdict(score: number): Verdict {
  const s = clamp(score);
  if (s >= 70) return "PASS";
  if (s >= 45) return "WARN";
  return "FAIL";
}

export function weightedScore(
  parts: Array<{ score: number; weight: number }>,
): number {
  const totalW = parts.reduce((a, p) => a + p.weight, 0) || 1;
  const raw = parts.reduce((a, p) => a + p.score * p.weight, 0) / totalW;
  return Math.round(clamp(raw) * 10) / 10;
}
