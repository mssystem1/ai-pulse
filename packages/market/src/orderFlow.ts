/** Executed trades, not candle-direction volume or resting liquidity. */
export type MarketTradePrint={id:string;ts:number;price:number;size:number;side:"buy"|"sell"};
export type MarketTradeCapture={
  source:string;instId:string;priceCurrency:string;marketType:"spot"|"perpetual";quantityUnit:"base"|"contracts";
  capturedAt:string;coverage:{start:number;end:number;knownAt:number;complete:boolean;sha256:string[]};
  trades:readonly MarketTradePrint[];
};

/** Public history-trades uses taker side; quantity stays in its stated unit. */
export function decodeOkxTradePrint(raw:{instId:string;tradeId:string;ts:string;px:string;sz:string;side:string},instId:string):MarketTradePrint{
  const ts=Number(raw.ts),price=Number(raw.px),size=Number(raw.sz);
  if(raw.instId!==instId||!/^\d+$/.test(raw.tradeId)||!/^\d+$/.test(raw.ts)||!Number.isSafeInteger(ts)||ts<0||!Number.isFinite(price)||price<=0||!Number.isFinite(size)||size<=0||!["buy","sell"].includes(raw.side))throw Error("Invalid trade identity or numeric data");
  return {id:raw.tradeId,ts,price,size,side:raw.side as "buy"|"sell"};
}
