/** Recent rows are a cache, never the retention policy for the audit journal. */
export type JournalRow = { id: string; evaluatedAt: string };
export type JournalState<T extends JournalRow> = {
  id: string;
  evaluations?: T[];
  evaluationPending?: T[];
  evaluationJournalInitialized?: boolean;
  evaluationJournalError?: string;
};
type Command = (args: unknown[]) => Promise<unknown>;
const key = (id: string) => `pulse:autopilot:evaluations:${id}`;

export function mergeJournalRows<T extends JournalRow>(...groups: readonly T[][]): T[] {
  const rows = new Map<string, T>();
  for (const group of groups) for (const row of group) rows.set(row.id, row);
  return [...rows.values()].sort((a, b) => Date.parse(a.evaluatedAt) - Date.parse(b.evaluatedAt) || a.id.localeCompare(b.id));
}

export async function persistJournalRow<T extends JournalRow>(state: JournalState<T>, row: T, command?: Command) {
  state.evaluationPending = mergeJournalRows(
    state.evaluationJournalInitialized ? [] : state.evaluations || [],
    state.evaluationPending || [], [row],
  );
  state.evaluations = mergeJournalRows(state.evaluations || [], [row]).slice(-100);
  if (!command) return; // Memory-only development retains the entire pending history.
  try {
    while (state.evaluationPending.length) {
      const batch = state.evaluationPending.slice(0, 100);
      await command(["HSET", key(state.id), ...batch.flatMap(entry => [entry.id, JSON.stringify(entry)])]);
      // Remove only acknowledged rows. An outage must not silently drop history.
      state.evaluationPending = state.evaluationPending.slice(batch.length);
    }
    state.evaluationJournalInitialized = true;
    delete state.evaluationJournalError;
  } catch {
    state.evaluationJournalError = "History storage is temporarily unavailable. Unsynced decisions are retained for retry.";
  }
}

export async function readJournal<T extends JournalRow>(state: JournalState<T>, command?: Command) {
  const local = mergeJournalRows(state.evaluations || [], state.evaluationPending || []);
  if (!command) return { rows: local, storage: "memory_only" as const };
  const persisted: T[] = [];
  try {
    let cursor = "0";
    do {
      const result = await command(["HSCAN", key(state.id), cursor, "COUNT", 250]);
      if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[1])) throw new Error("Invalid journal response");
      cursor = String(result[0]);
      if (!/^\d+$/.test(cursor)) throw new Error("Invalid journal cursor");
      const values = result[1] as unknown[];
      for (let i = 1; i < values.length; i += 2) {
        const row = JSON.parse(String(values[i])) as T;
        if (!row || typeof row.id !== "string" || typeof row.evaluatedAt !== "string") throw new Error("Invalid journal row");
        persisted.push(row);
      }
    } while (cursor !== "0");
    return { rows: mergeJournalRows(persisted, local), storage: state.evaluationPending?.length ? "pending_sync" as const : "synced" as const };
  } catch {
    // Never label a partial scan/fallback as a complete archive.
    return { rows: mergeJournalRows(persisted, local), storage: "unavailable" as const };
  }
}
