import test from "node:test";
import assert from "node:assert/strict";
import {decodeOkxTradePrint} from "./orderFlow.js";

test("OKX print decoding preserves taker side and rejects a different instrument",()=>{
  const raw={instId:"HYPE-USDT",tradeId:"31911856",ts:"1783180801087",px:"60.25",sz:"2.5",side:"sell"};
  assert.deepEqual(decodeOkxTradePrint(raw,"HYPE-USDT"),{id:"31911856",ts:1783180801087,price:60.25,size:2.5,side:"sell"});
  for(const change of [{instId:"BTC-USDT"},{side:"up"},{sz:"0"},{px:"NaN"},{ts:""}])assert.throws(()=>decodeOkxTradePrint({...raw,...change},"HYPE-USDT"));
});
