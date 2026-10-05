import test from "node:test";
import assert from "node:assert/strict";
import { NETWORK_REGISTRY, LEGACY_ARC_TESTNET } from "@pulse/config";
import { publicExecution } from "./publicExecution.js";
import type { Activity } from "./v6Store.js";
import type { OnchainAccountSnapshot } from "./onchainDiscovery.js";
const owner=`0x${"1".repeat(40)}`,vault=`0x${"2".repeat(40)}`;
const fill: Activity = {id:"record",owner,network:"base",source:"spot",kind:"market_buy",status:"confirmed",txHash:`0x${"a".repeat(64)}`,fillObservedAt:"2026-09-12T12:00:00Z",fillSide:"buy",fillQuoteAsset:NETWORK_REGISTRY.base.paymentAsset.address!,fillQuoteValue:2,fillQuantity:1,fillInputAmount:"2000000",fillOutputAmount:"1000000000000000000",createdAt:"2026-09-12T12:00:00Z",updatedAt:"2026-09-12T12:00:00Z"};
test("only confirmed receipt-enriched fills count; pending, funding and arbitrary accounts do not",()=>{
  assert.equal(publicExecution(fill,null)?.service,"spot");
  assert.equal(publicExecution({...fill,status:"pending"},null),null);
  assert.equal(publicExecution({...fill,kind:"vault_fund"},null),null);
  assert.equal(publicExecution({...fill,kind:"market_buy_cancelled"},null),null);
  assert.equal(publicExecution({...fill,fillObservedAt:undefined},null),null);
  assert.equal(publicExecution({...fill,account:vault},null),null);
  assert.equal(publicExecution({...fill,network:"arc-testnet"},null),null);
});
test("autopilot classification requires an owner-matched PULSE factory account, not the announced source",()=>{
  const accounts: OnchainAccountSnapshot={network:"base",owner,accounts:{protection:null,limit:null,bracket:null},vaults:[{address:vault,settlementAsset:null,settlementSymbol:null,settlementDecimals:null,balanceAtomic:null,paused:false}],stale:false,observedAt:fill.createdAt};
  assert.equal(publicExecution({...fill,account:vault},accounts)?.service,"autopilot");
  assert.equal(publicExecution({...fill,account:vault},{...accounts,stale:true}),null);
  assert.equal(publicExecution({...fill,account:vault},{...accounts,owner:vault}),null);
});
test("legacy wallet Spot and protected limit entries are included without accepting unrelated events",()=>{
  assert.equal(publicExecution({...fill,source:"wallet"},null)?.service,"spot");
  assert.equal(publicExecution({...fill,source:"wallet",kind:"market_buy_with_protection"},null)?.service,"spot");
  assert.equal(publicExecution({...fill,source:"autopilot"},null),null);
  assert.equal(publicExecution({...fill,source:"wallet",kind:"market_buy_with_protection_cancelled"},null),null);
  assert.equal(publicExecution({...fill,fillQuoteValue:-1},null),null);
  assert.equal(publicExecution({...fill,fillQuantity:NaN},null),null);
  const accounts: OnchainAccountSnapshot={network:"base",owner,accounts:{protection:null,limit:vault,bracket:null},vaults:[],stale:false,observedAt:fill.createdAt};
  assert.equal(publicExecution({...fill,account:vault,kind:"automatic_entry_protected"},accounts)?.service,"spot");
  assert.equal(publicExecution({...fill,account:vault,kind:"automatic_entry_protected"},null),null);
});
