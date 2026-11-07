import test from "node:test";
import assert from "node:assert/strict";
import type {AppConfig} from "@pulse/config";
import {startTerminalMarketHistoryWorker} from "./terminalMarketHistoryWorker.js";

test("Terminal flags alone start independent public-data loops and a held archive cannot pause live sampling",async t=>{
 const callbacks:(()=>void)[]=[],cleared:unknown[]=[];
 t.mock.method(globalThis,"setInterval",((fn:()=>void)=>{callbacks.push(fn);return{unref(){}};}) as unknown as typeof setInterval);
 t.mock.method(globalThis,"clearInterval",((timer:unknown)=>{cleared.push(timer);}) as typeof clearInterval);
 const oldAutomation=process.env.AUTOMATION_WORKER_ENABLED;process.env.AUTOMATION_WORKER_ENABLED="0";t.after(()=>{if(oldAutomation===undefined)delete process.env.AUTOMATION_WORKER_ENABLED;else process.env.AUTOMATION_WORKER_ENABLED=oldAutomation;});
 let historyCalls=0,bookCalls=0,finish!:()=>void;const held=new Promise<void>(resolve=>{finish=resolve;});
 const cfg={FEATURE_TRADING_TERMINAL:true,TERMINAL_HISTORY_ENABLED:true,TERMINAL_HISTORY_POLL_MS:15000,TERMINAL_HISTORY_BOOK_SAMPLE_MS:60000} as AppConfig;
 const stop=startTerminalMarketHistoryWorker(cfg,{history:async()=>{historyCalls++;await held;},books:async()=>{bookCalls++;}});
 await Promise.resolve();await Promise.resolve();assert.equal(historyCalls,1);assert.equal(bookCalls,1);assert.equal(callbacks.length,2);
 callbacks[0]();callbacks[1]();await Promise.resolve();await Promise.resolve();assert.equal(bookCalls,2);assert.equal(historyCalls,1);
 stop();callbacks[0]();await Promise.resolve();assert.equal(bookCalls,2);assert.equal(cleared.length,2);finish();
});

test("either disabled Terminal flag prevents all collector timers",t=>{
 let timers=0;t.mock.method(globalThis,"setInterval",(()=>{timers++;return{unref(){}};}) as unknown as typeof setInterval);
 for(const flags of [{FEATURE_TRADING_TERMINAL:false,TERMINAL_HISTORY_ENABLED:true},{FEATURE_TRADING_TERMINAL:true,TERMINAL_HISTORY_ENABLED:false}])startTerminalMarketHistoryWorker(flags as AppConfig,{history:async()=>{},books:async()=>{}})();
 assert.equal(timers,0);
});
