import type {GlobalReport} from "@pulse/schemas";
import {terminalSetupEntryNotice} from "./terminalSetupEntry.js";

export type TerminalSetupEntryNoticeProps={report:GlobalReport;now?:number;quote?:{price:number;ts:number}|null};

/** Small, reusable explanation for a saved conditional plan. */
export function TerminalSetupEntryNotice({report,now,quote}:TerminalSetupEntryNoticeProps){
  const notice=terminalSetupEntryNotice(report,{now,quote});
  if(!notice)return null;
  const tone=notice.state==="qualified"?"success":notice.state==="expired"?"negative":"warning",accent=notice.state==="qualified"?"var(--terminal-positive)":notice.state==="expired"?"var(--terminal-negative)":"var(--terminal-warning)";
  return <aside className={`terminal-admission-warning terminal-entry-notice ${tone}`} style={{borderColor:accent,borderLeftColor:accent}} role="status" data-entry-state={notice.state} data-execution-mode={notice.executionMode}>
    <strong>{notice.title}</strong>
    {notice.lines.map((line,index)=><p key={index}>{line}</p>)}
  </aside>;
}
