import test from "node:test";
import assert from "node:assert/strict";
import { indicatorMarketCatalog, createFormulaIndicatorPackage, evaluateIndicatorCircuit, type IndicatorManifest } from "@pulse/domain";
import { INDICATOR_TAPEOUT_XLAYER, indicatorTapeoutCalldata, verifyIndicatorDeployment } from "./indicatorTapeout.js";
const word = (v: number | bigint) => BigInt(v).toString(16).padStart(64,"0");
const addressWord = (v: string) => `0x${v.slice(2).padStart(64,"0")}`;
const abiBytes = (v: string) => `0x${word(32)}${word(v.length/2)}${v.padEnd(Math.ceil(v.length/64)*64,"0")}`;
const processor = INDICATOR_TAPEOUT_XLAYER.defaultProcessor, beacon = `0x${"11".repeat(20)}`, implementation = `0x${"22".repeat(20)}`, hash = `0x${"ab".repeat(32)}`;
const [cvd] = indicatorMarketCatalog();
function fixture(manifest: IndicatorManifest, mode = "valid") {
  let blockReads = 0; const requests: any[]=[];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)), endpoint = String(input); requests.push({endpoint,...body});
    const data = body.params?.[0]?.data ?? "", to = body.params?.[0]?.to;
    let result: unknown;
    if (body.method === "eth_chainId") result=mode==="chain"?"0x2105":"0xc4";
    else if (body.method === "eth_blockNumber") result="0x102";
    else if (body.method === "eth_getBlockByNumber") { blockReads++; result={number:"0x100",hash: mode==="reorg"&&blockReads>2 ? `0x${"cd".repeat(32)}`:hash}; }
    else if (body.method === "eth_getCode") result=mode==="disagree"&&endpoint.includes("second")?"0x6060606060606060606061":"0x6060606060606060606060";
    else if (body.method === "eth_getStorageAt") result=addressWord(beacon);
    else if (data.startsWith("0x5f5a364f")) result=`0x${word(mode==="membership"?0:1)}`;
    else if (data==="0xc45a0155") result=addressWord(INDICATOR_TAPEOUT_XLAYER.factory);
    else if (data==="0x5c60da1b") { assert.equal(to,beacon); result=addressWord(implementation); }
    else if (data.startsWith("0x084d60f1")) result=`0x${word(manifest.runtime.inputBits)}${word(manifest.runtime.outputBits)}${word(0)}${word((manifest.runtime.netlist.length-2)/14)}`;
    else if (data.startsWith("0x3fc4be56")) result=abiBytes(mode==="netlist"?manifest.runtime.netlist.slice(2,-1)+"f":manifest.runtime.netlist.slice(2));
    else if (data.startsWith("0x934d06ea")) {
      const raw=Buffer.from(data.slice(10+64*3),"hex"), buy=raw.readUInt16LE(0),sell=raw.readUInt16LE(2),previous=manifest.runtime.inputBits===64?raw.readInt32LE(4):0;
      const value=evaluateIndicatorCircuit(manifest,{buy,sell,previousCvd:previous}), output=Buffer.alloc(Math.ceil(manifest.runtime.outputBits/8));
      if(manifest.kernel==="executed-cvd-v1"){output.writeInt32LE(value.deltaQ!,0);output.writeInt32LE(value.cvdQ!,4);}
      else if(manifest.kernel==="formula-v1") output.writeInt32LE(value.valueQ!,0);
      else output.writeUInt16LE(value.participationBps!,0);
      if(mode==="vector")output[0]^=1;result=abiBytes(output.toString("hex"));
    } else throw Error(`Unexpected RPC ${body.method} ${data}`);
    return new Response(JSON.stringify({jsonrpc:"2.0",id:body.id,result}),{status:200});
  };
  return { fetchImpl,requests };
}
const options = {rpcUrls:["https://first.example","https://second.example"],now:1234};
test("registered numerical package verifies exact ports, bytes, implementation and six outputs on both pinned RPCs",async()=>{
  for(const manifest of [cvd,createFormulaIndicatorPackage({id:"test.weighted",title:"Weighted flow",description:"An actual custom numerical formula.",author:"Tester",expression:"buy*2-sell",output:{label:"Weighted delta",unit:"volume",accumulation:"bar"}})]){
    const f=fixture(manifest),result=await verifyIndicatorDeployment(manifest,{processor,circuitId:"71"},{...options,fetchImpl:f.fetchImpl});
    assert.equal(result.verified,true);assert.equal(result.chainId,196);assert.equal(result.circuitId,"71");assert.equal(result.blockNumber,"256");assert.equal(result.beacon,beacon);assert.equal(result.implementation,implementation);assert.equal(result.vectorCount,6);assert.equal(result.observedAt,1234);assert.match(result.netlistHash,/^sha256:[a-f0-9]{64}$/);
    assert.equal(f.requests.filter(r=>r.method==="eth_call"&&r.params[0].data.startsWith("0x934d06ea")).length,12);
    assert.ok(f.requests.filter(r=>["eth_call","eth_getCode","eth_getStorageAt"].includes(r.method)).every(r=>r.params.at(-1)==="0x100"));
  }
});
test("wrong chain, membership, netlist, numeric output, implementation disagreement and reorg all reject",async()=>{
  for(const mode of ["chain","membership","netlist","vector","disagree","reorg"]){const f=fixture(cvd,mode);await assert.rejects(verifyIndicatorDeployment(cvd,{processor,circuitId:"71"},{...options,fetchImpl:f.fetchImpl}),/Indicator registration/);}
});
test("registration calldata carries actual numerical circuit and invalid identity never reaches RPC",async()=>{
  const encoded=indicatorTapeoutCalldata(cvd);assert.ok(encoded.startsWith(`0x7bd3ac1d${word(96)}${word(64)}${word(64)}`));assert.ok(encoded.includes(cvd.runtime.netlist.slice(2)));
  const f=fixture(cvd);await assert.rejects(verifyIndicatorDeployment(cvd,{processor:"0x123",circuitId:"2"},{...options,fetchImpl:f.fetchImpl}),/invalid processor/);assert.equal(f.requests.length,0);
  const tampered=JSON.parse(JSON.stringify(cvd));tampered.runtime.netlist="0x000000ff0000ff";assert.throws(()=>indicatorTapeoutCalldata(tampered),/insufficient output|noncausal/);
});
