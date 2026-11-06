import test from "node:test";
import assert from "node:assert/strict";
import {loadConfig} from "@pulse/config";
import {newTerminalRadar} from "@pulse/analysis";
import type {TerminalPriceObservation,TerminalRadarDefinition,TerminalTapeoutComponent} from "@pulse/domain";
import {TerminalRuntime} from "./terminalRuntime.js";
import {MemoryTerminalStorage,TerminalStore,emptyTerminalWorkspace,grantTerminalPass,type TerminalRadar} from "./terminalStore.js";
import {coalesceTerminalIncident,formatTerminalNotification,terminalDependencyIssue,terminalRadarNotification,type TerminalNotificationActivity} from "./terminalNotifications.js";

const NOW=Date.parse("2026-11-06T08:00:00Z"),OWNER=`0x${"11".repeat(20)}`;
const component:TerminalTapeoutComponent={version:"tapeout-xlayer-nand-v1",chainId:196,processor:"0x839bdd6fa7a66416a609a735e11de5411b98574e",circuitId:"2",factory:"0x1f09daefa827f02cbb40967cc91b259763760761",blockNumber:"1",blockHash:`0x${"a".repeat(64)}`,observedAt:NOW,netlist:"0x000000020000030000000400000400000005000005",codeHash:"sha256:fixture",truthTable:[1,1,1,0],verified:true,endpoints:[]};
const definition=(id="tr_12345678-0000"):TerminalRadarDefinition=>({version:"terminal-radar-v1",id,instId:"BTC-USDT",timeframe:"15m",detector:"sweep_reclaim",boundary:80000,side:"below",tolerance:20,createdAt:NOW,expiresAt:NOW+6*3600000});
function radar(d=definition()):TerminalRadar{return{id:d.id,instId:d.instId,timeframe:"1H",detector:d.detector,boundary:d.boundary,createdAt:new Date(d.createdAt).toISOString(),expiresAt:new Date(d.expiresAt).toISOString(),paused:false,telegram:true,state:"developing",reason:"Waiting",nextEvent:"Waiting",definition:d,snapshot:newTerminalRadar(d),lastObservedAt:new Date(d.createdAt).toISOString()};}

test("Radar Telegram content freezes exact rule, candle, execution frame and event-time next step",()=>{
 const d=definition(),r=radar(d),observation:TerminalPriceObservation={id:"candle-1",instId:d.instId,timeframe:"15m",source:"okx-public-spot",start:NOW,at:NOW+900000,knownAt:NOW+900020,open:80100,high:80120,low:79950,close:79980,complete:true,sequence:1};
 const event={id:"stage1",observationId:observation.id,at:observation.at,kind:"first_stage" as const,reason:"New sweep beyond the selected boundary."},snapshot={...newTerminalRadar(d),stage:3 as const,status:"completed" as const,observations:[observation]};
 const activity:TerminalNotificationActivity={id:"event",at:new Date(observation.knownAt).toISOString(),sourceAt:new Date(observation.at).toISOString(),kind:"radar_first_stage",subjectId:r.id,instId:r.instId,timeframe:r.timeframe,message:event.reason,notification:terminalRadarNotification(r,event,snapshot)};
 snapshot.definition.boundary=99999;snapshot.observations[0].close=99999;r.timeframe="1Wutc";
 const text=formatTerminalNotification(activity);assert.match(text,/BTC-USDT · prices in USDT/);assert.match(text,/#12345678 · Sweep & reclaim · Stage 1\/3/);assert.match(text,/below 80,000 USDT; tolerance ±20 USDT/);assert.match(text,/Primary 1H · evaluates completed 15m candles/);assert.match(text,/O 80,100 · H 80,120 · L 79,950 · C 79,980 USDT/);assert.match(text,/later completed candle close above 80,000/);assert.doesNotMatch(text,/99,999|Stage 3\/3/);assert.match(text,/Event close above is not a current quote/);assert.match(text,/https:\/\/app.ai-pulse.tech\/trading-terminal\?subject=tr_12345678-0000/);assert.match(text,/no order, position fill or automatic trade/);
});

test("dependency notices explain the rejected check without exposing provider exception details",()=>{
 for(const [text,code]of[["Tapeout read bound exceeded https://private.test?token=secret","tapeout_verification_timeout"],["Tapeout endpoints disagree at pinned block","tapeout_consensus_unavailable"],["Tapeout NAND truth mismatch secret-key","tapeout_verification_rejected"],["Failed fetch private-redis-key","tapeout_verification_unavailable"]]){
  const issue=terminalDependencyIssue(new Error(text),"component");assert.equal(issue.code,code);assert.doesNotMatch(JSON.stringify(issue),/secret|private|redis/);
 }
});

test("coalescing keeps per-Radar activity while separating market, cause and recovery episodes",()=>{
 const workspace=emptyTerminalWorkspace(OWNER),issue=terminalDependencyIssue(undefined,"component"),create=(id:string,instId="BTC-USDT",kind="source_interruption"):TerminalNotificationActivity=>{const r=radar(definition(id)),event={id,at:NOW,kind:"data_needed" as const,reason:issue.message};return{id,at:new Date(NOW).toISOString(),kind,subjectId:id,instId,timeframe:"1H",message:issue.message,notification:terminalRadarNotification(r,event,r.snapshot as ReturnType<typeof newTerminalRadar>,issue)};};
 const a=create("tr_11111111"),b=create("tr_22222222");assert.equal(coalesceTerminalIncident(workspace,a),false);workspace.activity.push(a);workspace.deliveries.push({id:"delivery",eventId:a.id,subjectId:a.subjectId,recipientId:123,state:"queued",createdAt:a.at});
 assert.equal(coalesceTerminalIncident(workspace,b),true);workspace.activity.push(b);assert.equal(a.notification?.affected?.length,2);assert.equal(workspace.activity.length,2);assert.equal(coalesceTerminalIncident(workspace,create("eth","ETH-USDT")),false);
 const recovered=create("recover", "BTC-USDT","source_recovered");assert.equal(coalesceTerminalIncident(workspace,recovered),false);workspace.activity.push(recovered);assert.equal(coalesceTerminalIncident(workspace,create("new-incident")),false);
  const optedOut=emptyTerminalWorkspace(OWNER),unwanted=create("unwanted"),wanted=create("wanted");optedOut.activity.push(unwanted);assert.equal(coalesceTerminalIncident(optedOut,wanted),false,"An activity created without delivery consent cannot suppress the first wanted notice");
  optedOut.deliveries.push({id:"cancelled",eventId:unwanted.id,subjectId:unwanted.subjectId,recipientId:123,state:"cancelled",createdAt:unwanted.at});assert.equal(coalesceTerminalIncident(optedOut,wanted),false,"A cancelled queued notice does not count as an incident delivery");
  optedOut.deliveries[0].state="uncertain";assert.equal(coalesceTerminalIncident(optedOut,wanted),true,"A potentially delivered notice is not automatically repeated");
  optedOut.activity.push(recovered);assert.equal(coalesceTerminalIncident(optedOut,create("after-undelivered-recovery")),false,"An undelivered recovery still closes the prior interruption episode");
});

test("three Radars send one safe dependency incident, no repeated poll notices and one recovery",async()=>{
 let now=NOW,failing=false;const sent:string[]=[],store=new TerminalStore(new MemoryTerminalStorage(),`notifications-${Math.random()}`,180),cfg={...loadConfig(),NODE_ENV:"test" as const,FEATURE_TRADING_TERMINAL:true,FEATURE_TELEGRAM:true,TERMINAL_MONITOR_INTERVAL_MS:15000};
 const runtime=new TerminalRuntime(cfg,{store,now:()=>now,telegramRecipient:async()=>123,telegramSend:async(_chat,text)=>{sent.push(text);return sent.length;},tapeout:async()=>{if(failing)throw Error("Tapeout read bound exceeded private://secret-token");return component;},snapshot:async(instId,timeframe)=>({version:"terminal-market-v1",instId,timeframe,observedAt:now,observations:[],sources:[],tools:{} as any,report:{} as any})});
 await store.mutate(OWNER,value=>{grantTerminalPass(value,{requestId:"grant",duration:"24h",priceUsd:"1.5",amountAtomic:"1500000",network:"base",asset:"USDC",paymentId:"fixture",purchasedAt:new Date(NOW).toISOString(),simulated:true});value.telegram={enabled:true,events:["source_interruption","radar_first_stage","radar_second_stage","radar_completed"]};});
 for(const timeframe of["15m","1H","4H"])await runtime.createRadar(OWNER,{instId:"BTC-USDT",timeframe,detector:"sweep_reclaim",boundary:80000,side:"below",tolerance:20,expiresAt:new Date(NOW+6*3600000).toISOString(),telegram:true});
 failing=true;now+=300001;await runtime.cycleOwner(OWNER);let saved=await store.get(OWNER);assert.equal(saved.activity.filter(event=>event.kind==="source_interruption").length,3);assert.equal(sent.length,1);assert.match(sent[0],/Affected Radars \(3\)/);assert.match(sent[0],/timed out/);assert.match(sent[0],/WAIT/);assert.doesNotMatch(sent[0],/secret|private/);assert.equal(saved.deliveries.filter(item=>item.state==="acknowledged").length,1);
 now+=15000;await runtime.cycleOwner(OWNER);assert.equal(sent.length,1,"identical outage polls do not resend per-Radar notices");
 failing=false;now+=15000;await runtime.cycleOwner(OWNER);saved=await store.get(OWNER);assert.equal(sent.length,2);assert.match(sent[1],/Monitoring source recovered/);assert.match(sent[1],/Affected Radars \(3\)/);assert.equal(saved.activity.filter(event=>event.kind==="source_recovered").length,3);assert.ok(saved.radars.every(item=>item.state==="developing"));
 now+=15000;await runtime.cycleOwner(OWNER);assert.equal(sent.length,2);assert.equal(saved.positions.length,0,"a notification never records a position");
});
