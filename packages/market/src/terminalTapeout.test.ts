import test from "node:test";
import assert from "node:assert/strict";
import {fetchTerminalTapeoutComponent,evaluateTerminalTapeoutNand,TERMINAL_TAPEOUT_XLAYER} from "./terminalTapeout.js";
const word=(n:number)=>n.toString(16).padStart(64,"0"),netlist="000000020000030000000400000400000005000005";
const encoded=(hex:string)=>`0x${word(32)}${word(hex.length/2)}${hex.padEnd(Math.ceil(hex.length/64)*64,"0")}`;
function source(change=false){const calls:{method:string;params:any[]}[]=[];const fetchImpl:typeof fetch=async(_url,init)=>{const req=JSON.parse(String(init?.body));calls.push(req);let result:any;
  if(req.method==="eth_chainId")result="0xc4";
  else if(req.method==="eth_blockNumber")result="0x100";
  else if(req.method==="eth_getBlockByNumber")result={number:"0xfe",hash:`0x${"a".repeat(64)}`};
  else if(req.method==="eth_getCode")result="0x600060001234";
  else {const data=req.params[0].data as string;
    if(data.startsWith("0x4bc7cbbd"))result=`0x${"0".repeat(24)}${TERMINAL_TAPEOUT_XLAYER.processor.slice(2)}`;
    else if(data.startsWith("0x084d60f1"))result=`0x${word(2)}${word(1)}${word(0)}${word(3)}`;
    else if(data.startsWith("0x3fc4be56"))result=encoded(change?netlist.replace(/05$/,"04"):netlist);
    else if(data.startsWith("0x934d06ea")){const n=Number.parseInt(data.slice(202,204),16);result=encoded(n===3?"00":"01");}
  }
  return new Response(JSON.stringify({jsonrpc:"2.0",id:req.id,result}),{status:200});};return {fetchImpl,calls};}
test("registered XLayer netlist is imported at one agreed block and actually evaluated",async()=>{
  const s=source(),component=await fetchTerminalTapeoutComponent({fetchImpl:s.fetchImpl,now:100});
  assert.equal(component.chainId,196);assert.equal(component.circuitId,"2");assert.equal(component.blockNumber,"254");assert.equal(component.verified,true);
  for(let n=0;n<4;n++)assert.equal(evaluateTerminalTapeoutNand(component,Boolean(n&1),Boolean(n&2)),n!==3);
  assert.ok(s.calls.every(c=>["eth_chainId","eth_blockNumber","eth_getBlockByNumber","eth_getCode","eth_call"].includes(c.method)));
  assert.ok(s.calls.filter(c=>c.method==="eth_call").every(c=>c.params[1]==="0xfe"));
});
test("changed circuit is rejected and cannot become a local fallback",async()=>{await assert.rejects(fetchTerminalTapeoutComponent({fetchImpl:source(true).fetchImpl}),/shape changed/);assert.throws(()=>evaluateTerminalTapeoutNand({verified:true,netlist:"0x00"},true,false),/Unverified/);});
test("one transient HTTP or timeout read is retried without changing the pinned component",async()=>{
  for(const kind of ["http","timeout"]){const fixture=source();let failed=false,retries=0;
    const fetchImpl:typeof fetch=async(url,init)=>{const req=JSON.parse(String(init?.body));if(req.method==="eth_getCode"&&!failed){failed=true;retries++;if(kind==="http")return new Response("retry later",{status:503});const error=new Error("source timeout");error.name="TimeoutError";throw error;}return fixture.fetchImpl(url,init);};
    const component=await fetchTerminalTapeoutComponent({fetchImpl});assert.equal(component.verified,true);assert.equal(component.blockNumber,"254");assert.equal(retries,1);assert.equal(component.netlist,`0x${netlist}`);
  }
});
test("persistent transport failure stays unavailable after at most one retry per request",async()=>{
  const perEndpoint=new Map<string,number>();
  const fetchImpl:typeof fetch=async url=>{const key=String(url);perEndpoint.set(key,(perEndpoint.get(key)??0)+1);return new Response("unavailable",{status:503});};
  await assert.rejects(fetchTerminalTapeoutComponent({fetchImpl}),/HTTP 503/);assert.ok([...perEndpoint.values()].every(count=>count<=2));assert.ok([...perEndpoint.values()].some(count=>count===2));
});
test("semantic RPC rejection is not retried",async()=>{
  const counts=new Map<string,number>(),fetchImpl:typeof fetch=async url=>{counts.set(String(url),(counts.get(String(url))??0)+1);return new Response(JSON.stringify({jsonrpc:"2.0",error:{code:-32602,message:"invalid parameters"}}),{status:200});};
  await assert.rejects(fetchTerminalTapeoutComponent({fetchImpl}),/public view failed/);assert.ok([...counts.values()].every(count=>count===1));
});
