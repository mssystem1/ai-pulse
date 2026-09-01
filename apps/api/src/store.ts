export type ShareableReport = Record<string, unknown> & { shareId: string };

const reports = new Map<string, ShareableReport>();

export function saveReport(report: ShareableReport): void {
  reports.set(report.shareId, report);
  // Cap memory for long-running demos
  if (reports.size > 500) {
    const first = reports.keys().next().value;
    if (first) reports.delete(first);
  }
}

export function getReport(shareId: string): ShareableReport | undefined {
  return reports.get(shareId);
}

export function listReports(limit = 20): ShareableReport[] {
  return Array.from(reports.values()).slice(-limit).reverse();
}
