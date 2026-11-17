import test from "node:test";
import assert from "node:assert/strict";
import {indicatorMarketCatalog} from "@pulse/domain";
import {activateChartIndicator,indicatorChartStorageKey,indicatorIdentity,installIndicator,loadChartIndicatorIds,loadInstalledIndicators} from "./terminalIndicatorClient";

test("a ninth creation is saved and shown without deleting any existing indicator",()=>{
  const base=indicatorMarketCatalog()[0];
  const saved=Array.from({length:8},(_,i)=>({...structuredClone(base),id:`trader.saved-${i}`}));
  const created={...structuredClone(base),id:"trader.maxim-new",author:"Maxim",title:"Maxim flow"};
  const library=installIndicator(saved,created),active=activateChartIndicator(saved.map(indicatorIdentity),indicatorIdentity(created));
  assert.equal(library.length,9);assert.equal(active.length,8);
  assert(active.includes(indicatorIdentity(created)));assert(!active.includes(indicatorIdentity(saved[0])));
  assert(library.some(item=>item.id===saved[0].id));
  assert.equal(loadInstalledIndicators({getItem:()=>JSON.stringify(library)},[]).length,9);
});
test("visible chart preferences preserve explicit none and are scoped to the wallet",()=>{
  const library=indicatorMarketCatalog(),ids=library.map(indicatorIdentity);
  assert.deepEqual(loadChartIndicatorIds({getItem:()=>"[]"},library,"0x123"),[]);
  assert.deepEqual(loadChartIndicatorIds({getItem:()=>JSON.stringify([ids[1],"missing",ids[1]])},library),[ids[1]]);
  assert.equal(indicatorChartStorageKey("0xABC"),indicatorChartStorageKey("0xabc"));
  assert.notEqual(indicatorChartStorageKey("0xabc"),indicatorChartStorageKey("0xdef"));
});
