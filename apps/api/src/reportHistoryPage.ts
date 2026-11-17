import type { ArchivedReport } from "./recoveredReportArchive.js";

export type ReportHistoryRow = {
  id: string; mode: string; tier: string | null; stage: string; label: string;
  createdAt: string; updatedAt: string; ready: boolean; reportId?: string | null;
  archived?: boolean; networkUnknown?: boolean;
};

/** A live job wins over an archive of the same report; older distinct reports remain readable. */
export function reportHistoryPage(live: ReportHistoryRow[], archive: ArchivedReport[], scope: string | undefined, offset = 0, limit = 30) {
  const seen = new Set(live.flatMap(row => row.reportId ? [row.reportId] : []));
  const recovered: ReportHistoryRow[] = archive.filter(row => !seen.has(row.reportId)).map(row => ({
    id: row.id, mode: row.mode, tier: row.tier, stage: "recovered", label: row.label,
    createdAt: row.createdAt, updatedAt: row.createdAt, ready: true, archived: true,
    networkUnknown: row.networkKey === null,
  }));
  const rows = [...live, ...recovered].filter(row => !scope || row.mode === scope)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  const reports = rows.slice(offset, offset + limit).map(({ reportId: _reportId, ...row }) => row);
  return { reports, total: rows.length, nextOffset: offset + reports.length < rows.length ? offset + reports.length : null };
}
