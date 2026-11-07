import type {TerminalMarket} from "./terminalClient";

type RetainedTools = {
 source: TerminalMarket;
 result: {
  session: {totals?: {trades: number} | null};
  perpetualSession: {totals?: {trades: number} | null};
  tools: Pick<TerminalMarket["tools"], "value" | "flow" | "perpetualFlow">;
  evidenceSnapshotId?: string;
  setupVersionId?: string;
 };
};

/** Select a complete evidence binding, never fallback numbers under another ID. */
export function terminalRetainedToolSource(assessment: TerminalMarket, retained: RetainedTools | null): {market: TerminalMarket; scope: "assessment" | "session"} {
 if (!retained || !((retained.result.session.totals?.trades ?? 0) > 0 || (retained.result.perpetualSession.totals?.trades ?? 0) > 0)) return {market: assessment, scope: "assessment"};
 const {source, result} = retained;
 return {scope: "session", market: {...source, tools: {...source.tools, ...result.tools}, evidenceSnapshotId: result.evidenceSnapshotId ?? source.evidenceSnapshotId, setupVersionId: result.setupVersionId ?? source.setupVersionId}};
}
