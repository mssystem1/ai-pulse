import type { PreflightResponse } from "@pulse/schemas";

const reports = new Map<string, PreflightResponse>();

export function saveReport(report: PreflightResponse): void {
  reports.set(report.shareId, report);
  // Cap memory for long-running demos
  if (reports.size > 500) {
    const first = reports.keys().next().value;
    if (first) reports.delete(first);
  }
}

export function getReport(shareId: string): PreflightResponse | undefined {
  return reports.get(shareId);
}

export function listReports(limit = 20): PreflightResponse[] {
  return Array.from(reports.values()).slice(-limit).reverse();
}
