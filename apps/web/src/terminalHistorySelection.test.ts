import test from "node:test";
import assert from "node:assert/strict";
import type {TerminalSessionHistory} from "@pulse/domain";
import {terminalCustomHistoryRange,terminalSessionEvidenceMatches} from "./terminalHistorySelection.js";

test("custom history dates are exact UTC whole minutes regardless of local timezone",()=>{
 assert.deepEqual(terminalCustomHistoryRange({start:"2026-11-01T00:00",end:"2026-11-02T00:00"}),{start:Date.UTC(2026,10,1),end:Date.UTC(2026,10,2)});
 for(const input of [{start:"2026-02-30T00:00",end:"2026-03-02T00:00"},{start:"2026-11-01T00:00:10",end:"2026-11-02T00:00"},{start:"2026-11-02T00:00",end:"2026-11-01T00:00"},{start:"2026-10-01T00:00",end:"2026-11-02T00:00"}])assert.throws(()=>terminalCustomHistoryRange(input));
});

test("retained session evidence must keep the same market, requested window and setup version",()=>{
 const source={instId:"BTC-USDT",setupVersionId:"original-plan"};
 const spot={instId:"BTC-USDT",marketType:"spot",requestedStart:1000,requestedEnd:2000} as TerminalSessionHistory;
 const futures={...spot,marketType:"perpetual"} as TerminalSessionHistory;
 const response={session:spot,perpetualSession:futures,setupVersionId:"original-plan"};
 assert.equal(terminalSessionEvidenceMatches(response,source,{start:1000,end:2000}),true);
 assert.equal(terminalSessionEvidenceMatches({...response,setupVersionId:"later-plan"},source),false);
 assert.equal(terminalSessionEvidenceMatches(response,{...source,instId:"ETH-USDT"}),false);
 assert.equal(terminalSessionEvidenceMatches({...response,perpetualSession:{...futures,requestedEnd:3000}},source),false);
 assert.equal(terminalSessionEvidenceMatches(response,source,{start:1000,end:3000}),false);
});
