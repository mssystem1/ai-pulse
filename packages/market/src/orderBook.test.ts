import test from "node:test";
import assert from "node:assert/strict";
import {decodeOkxArchiveBookRecord,MarketOrderBook} from "./orderBook.js";
const decode=(action="snapshot",ts=1000,asks=[["101","2","1"],["102","3","1"]],bids=[["100","4","1"],["99","5","1"]])=>decodeOkxArchiveBookRecord({instId:"HYPE-USDT",action,ts:String(ts),asks,bids},"HYPE-USDT");

test("archive decoding retains the three-column format and rejects unsupported identity/rows",()=>{
  const r=decode();assert.deepEqual(r.asks[0],{price:101,size:2,orders:1});
  assert.throws(()=>decodeOkxArchiveBookRecord({instId:"BTC-USDT",action:"snapshot",ts:"1000",asks:[],bids:[]},"HYPE-USDT"),/identity/);
  assert.throws(()=>decode("snapshot",1000,[["101","2","0","1"]]),/format/);
  assert.throws(()=>decode("snapshot",1000,[["101","2","1"],["101.0","3","1"]]),/duplicate/);
  assert.throws(()=>decode("snapshot",1000,[["101","-2","1"]]),/Invalid/);
});

test("book reconstruction applies removals and replacements before trimming the retained depth",()=>{
  const b=new MarketOrderBook("HYPE-USDT",2);b.apply(decode());
  b.apply(decode("update",1010,[["100.5","7","2"],["101","0","0"]],[["98","2","1"]]));
  const s=b.snapshot();assert.equal(s.bestAsk,100.5);assert.deepEqual(s.asks.map(r=>r.price),[100.5,102]);assert.deepEqual(s.bids.map(r=>r.price),[100,99]);assert.equal(s.sequenceVerified,false);
  s.asks[0].size=999;assert.equal(b.snapshot().asks[0].size,7);
});

test("updates require a valid snapshot and cannot reverse instrument or source time",()=>{
  const b=new MarketOrderBook("HYPE-USDT");assert.throws(()=>b.apply(decode("update")),/snapshot/);
  b.apply(decode());assert.throws(()=>b.apply({...decode("update"),instId:"ETH-USDT"}),/identity/);
  assert.throws(()=>b.apply(decode("update",999)),/chronology/);assert.equal(b.timestamp,1000);
});

test("crossed depth cannot escape as a valid state; a fresh snapshot restores it",()=>{
  const b=new MarketOrderBook("HYPE-USDT");b.apply(decode());
  assert.throws(()=>b.apply(decode("update",1010,[],[["101.5","3","1"]])),/crossed/);
  assert.throws(()=>b.snapshot(),/not valid/);assert.throws(()=>b.apply(decode("update",1020,[],[])),/snapshot/);
  b.apply(decode("snapshot",1030));assert.equal(b.timestamp,1030);
});
