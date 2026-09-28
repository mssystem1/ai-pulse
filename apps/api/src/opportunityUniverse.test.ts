import { test } from "node:test";
import assert from "node:assert/strict";
import { opportunityUniverse } from "./opportunityUniverse.js";
test("Arbitrum shortlist includes mapped altcoins and xStocks outside the old twelve-pair scan", () => {
  const result=opportunityUniverse({chainId:"42161",erc20:true,researchPairs:["DOGE-USDT"],tokens:[{symbol:"WBTC",name:"Wrapped Bitcoin",address:"0x1"},{symbol:"ARB",name:"Arbitrum",address:"0x2"},{symbol:"AAPLx",name:"Apple xStock",address:"0x3"}],instruments:[{instId:"BTC-USDT",baseCcy:"BTC",quoteCcy:"USDT",assetClass:"crypto"},{instId:"ARB-USDT",baseCcy:"ARB",quoteCcy:"USDT",assetClass:"crypto"},{instId:"XAAPL-USDT",baseCcy:"XAAPL",quoteCcy:"USDT",assetClass:"tokenized_stock"}]});
  assert.deepEqual(result.pairs,["BTC-USDT","ARB-USDT","XAAPL-USDT","DOGE-USDT"]);
  assert.equal(result.mappedCount,3);
});
test("native assets and settlement coins are excluded for ERC20 custody", () => {
  const result=opportunityUniverse({chainId:"42161",erc20:true,researchPairs:[],tokens:[{symbol:"ETH",name:"Ether",address:`0x${"e".repeat(40)}`},{symbol:"USDC",name:"USD Coin",address:"0x1"}],instruments:[{instId:"ETH-USDT",baseCcy:"ETH",quoteCcy:"USDT"},{instId:"USDC-USDT",baseCcy:"USDC",quoteCcy:"USDT"}]});
  assert.deepEqual(result.pairs,[]);
});
