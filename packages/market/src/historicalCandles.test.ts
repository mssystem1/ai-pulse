import test from "node:test";
import assert from "node:assert/strict";
import { getHistoricalCandles, buildMarketContext, toOkxBar } from "./index.js";

test("weekly Pro context requests a real monthly bar without silently falling back to 1H",()=>{
  assert.equal(toOkxBar("1Mutc"),"1Mutc");assert.equal(toOkxBar("1M"),"1M");assert.equal(toOkxBar("1m"),"1m");
});

test("older candle requests use history-candles with OKX's after cursor", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async input => {
    urls.push(String(input));
    return new Response(JSON.stringify({ code: "0", data: [["2000","10","12","9","11","1","1","1","1"],["1000","9","11","8","10","1","1","1","1"]] }));
  }) as typeof fetch;
  try {
    const rows = await getHistoricalCandles("HISTORYTEST-USDT", "1H", 100, 2000);
    assert.match(urls[0], /history-candles\?.*after=2000/);
    assert.deepEqual(rows.map(row => row.ts), [1000]);
    assert.equal(rows[0].confirmed, true);
    await assert.rejects(getHistoricalCandles("HISTORYTEST-USDT", "1H", -1, 2000));
    await assert.rejects(getHistoricalCandles("HISTORYTEST-USDT", "1H", 100, NaN));
    await assert.rejects(getHistoricalCandles("HISTORYCURSORTEST-USDT", "1H", 100, 500), /did not advance/);
    globalThis.fetch = (async () => new Response(JSON.stringify({code:"0",data:[["bad","10","12","9","11"]]}))) as typeof fetch;
    await assert.rejects(getHistoricalCandles("HISTORYINVALIDTEST-USDT", "1H", 100, 2000), /Invalid historical candle data/);
  } finally { globalThis.fetch = original; }
});
test("Global history pagination retains 520 completed candles even when the latest bar is still forming",async()=>{const original=globalThis.fetch,urls:string[]=[];globalThis.fetch=(async input=>{const url=new URL(String(input));urls.push(url.href);if(url.pathname.endsWith("ticker"))return Response.json({code:"0",data:[{instId:"PAGINATION-USDT",last:"100",open24h:"100",high24h:"102",low24h:"98",vol24h:"1",volCcy24h:"100",ts:"1"}]});const history=url.pathname.includes("history-candles"),limit=Number(url.searchParams.get("limit")),after=Number(url.searchParams.get("after")||600*3600000);const data=Array.from({length:limit},(_,i)=>[String(after-(i+1)*3600000),"100","102","98","101","1","100","100",!history&&i===0?"0":"1"]);return Response.json({code:"0",data});}) as typeof fetch;try{const report=await buildMarketContext({instId:"PAGINATION-USDT",timeframe:"1H",candleLimit:520,completedOnly:true});assert.equal(report.candles.length,520);assert.ok(report.candles.every(c=>c.confirmed));assert.ok(report.candles.every((c,i)=>i===0||c.ts>report.candles[i-1].ts));assert.equal(urls.filter(url=>url.includes("history-candles")).length,1);assert.ok(urls.some(url=>url.includes("limit=221")));urls.length=0;await buildMarketContext({instId:"LEGACY-PAGE-USDT",candleLimit:80});assert.ok(!urls.some(url=>url.includes("history-candles")));}finally{globalThis.fetch=original;}});
