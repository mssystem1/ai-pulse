import test from "node:test";
import assert from "node:assert/strict";
import {startTerminalPolling} from "./terminalPolling";
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
test("failed API polls back off and success restores the ordinary cadence",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});let calls=0;const poll=startTerminalPolling(async()=>{if(++calls===1)throw Error("service unavailable");},100,()=>true);await settle();assert.equal(calls,1);t.mock.timers.tick(199);await settle();assert.equal(calls,1);t.mock.timers.tick(1);await settle();assert.equal(calls,2);t.mock.timers.tick(100);await settle();assert.equal(calls,3);poll.stop();t.mock.timers.tick(10000);await settle();assert.equal(calls,3);
});
test("polls never overlap and hidden views make no API calls",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});let visible=true,calls=0,release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);const poll=startTerminalPolling(async()=>{calls++;if(calls===1)await held;},100,()=>visible);poll.refresh();poll.refresh();assert.equal(calls,1);visible=false;release();await settle();t.mock.timers.tick(1000);await settle();assert.equal(calls,1);visible=true;poll.refresh();await settle();assert.equal(calls,2);poll.stop();
});
