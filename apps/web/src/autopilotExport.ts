import type { DecisionEntry } from "./AutopilotDecisionJournal";

/** Quoting alone does not prevent spreadsheet formula execution. */
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
}

export function decisionAuditColumns(entry: DecisionEntry) {
  return [entry.evidenceHash || "", JSON.stringify(entry.metrics), JSON.stringify(entry.rules), entry.context ? JSON.stringify(entry.context) : ""];
}

export function serializeAuditCsv(rows: unknown[][]) {
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
