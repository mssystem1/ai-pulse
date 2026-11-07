import test from "node:test";
import assert from "node:assert/strict";
import type {TerminalSessionHistory} from "@pulse/domain";
import {terminalCustomHistoryRange,terminalHistoryDefaults,terminalHistoryPreferences,terminalHistorySelection,terminalSessionEvidenceMatches} from "./terminalHistorySelection.js";

test("window preferences restore manual choices across a chart remount and reject malformed stored ranges",()=>{
 const chosen={sessionSelection:"custom",liquiditySelection:24,custom:{start:"2026-11-01T00:00",end:"2026-11-02T00:00"},applied:{start:Date.UTC(2026,10,1),end:Date.UTC(2026,10,2)}};
 assert.deepEqual(terminalHistoryPreferences(JSON.stringify(chosen)),chosen);
 const defaults=terminalHistoryPreferences(null);
 assert.deepEqual(terminalHistoryPreferences("bad JSON"),defaults);
 assert.deepEqual(terminalHistoryPreferences('{"sessionSelection":"forever","liquiditySelection":999}'),defaults);
 for(const applied of [{start:0,end:60_001},{start:-60_000,end:60_000},{start:60_000,end:0},{start:0,end:32*86400000},{start:"0",end:60_000}])assert.equal(terminalHistoryPreferences(JSON.stringify({...chosen,applied})).applied,null);
});

test("chart horizon chooses explicit execution and liquidity windows without claiming cycle coverage",()=>{
 assert.deepEqual(terminalHistorySelection("15m"),{preset:"day",hours:1});
 assert.deepEqual(terminalHistorySelection("1H"),{preset:"week",hours:6});
 assert.deepEqual(terminalHistorySelection("4H"),{preset:"week",hours:24});
 assert.deepEqual(terminalHistorySelection("1Dutc"),{preset:"month",hours:168});
 assert.deepEqual(terminalHistorySelection("1Wutc"),{preset:"month",hours:168});
 assert.deepEqual(terminalHistoryDefaults("1D"),terminalHistoryDefaults("1Dutc"));
 assert.deepEqual(terminalHistoryDefaults("1W"),terminalHistoryDefaults("1Wutc"));
 assert.throws(()=>terminalHistoryDefaults("unknown"));
});

test("manual windows survive chart changes and follow-timeframe restores automatic selection",()=>{
 for(const frame of ["15m","1H","4H","1Dutc","1Wutc"]){
  assert.deepEqual(terminalHistorySelection(frame,"previous-day",24),{preset:"previous-day",hours:24});
  assert.deepEqual(terminalHistorySelection(frame,"custom",6),{preset:"custom",hours:6});
 }
 assert.deepEqual(terminalHistorySelection("15m","timeframe",24),{preset:"day",hours:24});
 assert.deepEqual(terminalHistorySelection("1Dutc","previous-day","timeframe"),{preset:"previous-day",hours:168});
 assert.deepEqual(terminalHistorySelection("1Wutc","timeframe","timeframe"),{preset:"month",hours:168});
});

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
