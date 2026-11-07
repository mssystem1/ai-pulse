import test from "node:test";
import assert from "node:assert/strict";
import { indicatorPaymentLabel, indicatorPaymentNetwork, validateIndicatorServiceQuote, type IndicatorServiceQuote } from "./terminalIndicatorClient";
import { WEB_NETWORKS } from "./networks";

function quote(network: "xlayer" | "base" | "arbitrum"): IndicatorServiceQuote {
  const id="iqu_"+"1".repeat(32);
  return {id,listingId:"pmi_"+"2".repeat(32),requestId:"reviewed-request",network,asset:WEB_NETWORKS[network].payment.address,assetSymbol:WEB_NETWORKS[network].payment.symbol,payee:"0x"+"3".repeat(40),priceUsdc:"0.001",priceUsd:"0.001",amountAtomic:"1000",expiresAt:new Date(Date.now()+60000).toISOString(),path:`/v1/terminal/indicators/purchases/${id}`,resource:`/${network}/v1/terminal/indicators/purchases/${id}`};
}
test("Creator checkout pins X Layer USDT0, Base USDC and Arbitrum USDC to the selected header network",()=>{
  for(const network of ["xlayer","base","arbitrum"] as const){
    assert.equal(indicatorPaymentNetwork(network),network);
    assert.doesNotThrow(()=>validateIndicatorServiceQuote(quote(network),network));
    assert.match(indicatorPaymentLabel(network),new RegExp(WEB_NETWORKS[network].payment.symbol));
    assert.match(indicatorPaymentLabel(network),new RegExp(WEB_NETWORKS[network].label));
  }
  assert.equal(indicatorPaymentNetwork("arc"),null);
  assert.equal(indicatorPaymentNetwork("robinhood"),null);
  assert.equal(indicatorPaymentNetwork(undefined),null);
});
test("Creator checkout rejects a changed chain, token, displayed price, payee or purchase path before signing",()=>{
  const original=quote("xlayer");
  assert.throws(()=>validateIndicatorServiceQuote(original,"base"),/payment network/);
  for(const replacement of [
    {asset:WEB_NETWORKS.base.payment.address}, {assetSymbol:"USDC"}, {payee:"wrong"}, {amountAtomic:"1001"},
    {priceUsd:"0.002"}, {path:original.path+"other"}, {expiresAt:"invalid"}, {network:"arc"}, {resource:original.resource.replace("/xlayer/","/base/")},
  ]) assert.throws(()=>validateIndicatorServiceQuote({...original,...replacement} as IndicatorServiceQuote,"xlayer"));
  assert.doesNotThrow(()=>validateIndicatorServiceQuote({...quote("base"),assetSymbol:undefined,priceUsd:undefined},"base"));
});
