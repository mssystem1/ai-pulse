import { Router, type Request } from "express";
import { z } from "zod";
import { erc20Abi, formatUnits } from "viem";
import { getNetwork, type AppConfig } from "@pulse/config";
import { assessGlobalReport, globalContextTimeframe, GLOBAL_HISTORY_LIMIT } from "@pulse/analysis";
import { readGlobalReport, reviewGlobalOrder, type GlobalExecutionLevels } from "@pulse/domain";
import { getTicker, type buildMarketContext } from "@pulse/market";
import { executionPublicClient } from "./onchainDiscovery.js";
import { getGenericOkxQuote, getOkxTradeTokens, executionAssetAliases, reviewedExecutionRepresentation } from "./okxDex.js";
import { TradeSchema } from "./v6Routes.js";
import { asyncRoute } from "./httpResilience.js";

export const GlobalAccessSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("job"),id:z.string().min(1).max(200),token:z.string().min(16).max(512)}).strict(),
  z.object({kind:z.literal("history"),id:z.string().min(1).max(200),token:z.string().min(16).max(512)}).strict(),
  z.object({kind:z.literal("share"),token:z.string().min(24).max(256)}).strict(),
]);
export type GlobalAccess=z.infer<typeof GlobalAccessSchema>;
type Quote=Awaited<ReturnType<typeof getGenericOkxQuote>>;
type Dependencies={
  resolveReport:(access:GlobalAccess,req:Request)=>Promise<unknown>;
  market:typeof buildMarketContext;
  quote?:(input:Parameters<typeof getGenericOkxQuote>[1])=>Promise<Quote>;
  balance?:(network:Parameters<typeof executionPublicClient>[0],token:string,wallet:string)=>Promise<bigint>;
  tokens?:typeof getOkxTradeTokens;
  settlementRate?:()=>Promise<{last:number;ts:string}>;
};

export async function recheckSavedGlobalReport(raw:unknown,loadMarket:typeof buildMarketContext){
  const saved=readGlobalReport(raw);
  if(!saved)throw new Error("A saved Global report is required");
  const contextFrame=saved.decisionVersion||saved.tier==="pro"?saved.context.timeframe??globalContextTimeframe(saved.snapshot.timeframe):null;
  const entryFrame=["decision-v2","decision-v3","decision-v4"].includes(saved.decisionVersion??"")?saved.entryStudy?.timeframe:null;
  const load=(timeframe:string)=>loadMarket({instId:saved.snapshot.instId,timeframe,candleLimit:GLOBAL_HISTORY_LIMIT,completedOnly:true});
  const [market,context,entry]=await Promise.all([load(saved.snapshot.timeframe),contextFrame?load(contextFrame).catch(()=>null):null,entryFrame?load(entryFrame).catch(()=>null):null]);
  return assessGlobalReport(saved,market,context,entry);
}

/** Capability-authenticated, read-only assessments. No payment middleware,
 * persistence mutation, model calls or transaction preparation. */
export function createGlobalAssessmentRouter(cfg:AppConfig,deps:Dependencies){
  const router=Router(),inflight=new Set<string>();
  const quote=deps.quote??(input=>getGenericOkxQuote(cfg,input)),tokens=deps.tokens??getOkxTradeTokens;
  const balance=deps.balance??(async(network,token,wallet)=>executionPublicClient(network).readContract({address:token as `0x${string}`,abi:erc20Abi,functionName:"balanceOf",args:[wallet as `0x${string}`]}));
  const body=z.object({access:GlobalAccessSchema,trade:TradeSchema.extend({takeProfit:z.number().positive().optional(),stopLoss:z.number().positive().optional(),orderType:z.enum(["market","limit"]).default("market"),limitPrice:z.number().positive().optional(),minimumOutputAmount:z.string().regex(/^[1-9]\d{0,77}$/).optional()}).strict().optional()}).strict();
  router.post("/v1/global/setup-assessment",asyncRoute(async(req,res)=>{
    res.setHeader("Cache-Control","private, no-store");
    const parsed=body.safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:"Valid saved-report access and trade inputs are required",issues:parsed.error.issues.map(issue=>({path:issue.path,message:issue.message}))});
    const input=parsed.data,raw=await deps.resolveReport(input.access,req),saved=readGlobalReport(raw);
    if(!saved)return res.status(404).json({error:"An accessible saved Global report is required"});
    const key=`${input.access.kind}:${"id" in input.access?input.access.id:input.access.token}`;
    if(inflight.has(key)||inflight.size>=100)return res.status(429).json({error:"A recheck is already running. Retry shortly."});
    inflight.add(key);
    try{
      const assessment=await recheckSavedGlobalReport(saved,deps.market);
      if(!input.trade)return res.json({assessment});
      const trade=input.trade,network=getNetwork(trade.network),now=Date.now();
      const blocked=(reason:string)=>res.json({assessment,review:{state:"blocked",sourceRef:assessment.sourceRef,assessedAt:assessment.assessedAt,expiresAt:now,entry:null,takeProfit:assessment.targets[0]??null,stopLoss:assessment.observedStop,quantity:0,cashRisk:null,netRewardRisk:null,costsBps:null,blockers:[reason],lines:[reason]}});
      if(assessment.state!=="technical_valid"||assessment.side!=="long")return blocked(assessment.side==="short"?"Short research supports a manual owned-Spot sell only.":"Fresh technical conditions are not valid; review the assessment blockers.");
      if(!trade.userWalletAddress)return blocked("Connect the wallet whose settlement balance will be checked.");
      if(trade.network==="robinhood"||saved.snapshot.source!=="okx-public-spot")return blocked("This representation needs its own execution-currency assessment. Continue with explicit manual review.");
      const chainId=String(network.chainId),settlement=network.paymentAsset;
      if(!settlement.address||trade.fromTokenAddress.toLowerCase()!==settlement.address.toLowerCase())return blocked("The input asset is not the network's verified settlement token.");
      const base=saved.snapshot.instId.split("-")[0],aliases=executionAssetAliases(base,chainId,"crypto");
      const catalog=(await Promise.all(aliases.map(alias=>tokens(cfg,chainId,alias,100)))).flat();
      const token=catalog.find(t=>t.address.toLowerCase()===trade.toTokenAddress.toLowerCase()&&aliases.includes(t.symbol.toUpperCase()));
      if(!token||!reviewedExecutionRepresentation(chainId,base,token))return blocked("The output contract is not a reviewed representation of this research asset. Continue with explicit manual review if appropriate.");
      const request={...trade,chainId,slippagePercent:String(trade.slippagePercent)};
      const [entry,available]=await Promise.all([quote(request),balance(trade.network,trade.fromTokenAddress,trade.userWalletAddress)]);
      const identity=(q:Quote,from:string,to:string,amount:string)=>q.chainId===chainId&&q.fromToken.address.toLowerCase()===from.toLowerCase()&&q.toToken.address.toLowerCase()===to.toLowerCase()&&q.fromTokenAmount===amount&&/^[1-9]\d*$/.test(q.toTokenAmount);
      if(!identity(entry,trade.fromTokenAddress,trade.toTokenAddress,trade.amount))return blocked("The quote's contracts or exact amount do not match the ticket.");
      if(entry.fromToken.decimals!==settlement.decimals||entry.toToken.decimals!==token.decimals)return blocked("Quote decimals disagree with verified token metadata.");
      const exit=await quote({chainId,fromTokenAddress:trade.toTokenAddress,toTokenAddress:trade.fromTokenAddress,amount:entry.toTokenAmount,slippagePercent:String(trade.slippagePercent)});
      if(!identity(exit,trade.toTokenAddress,trade.fromTokenAddress,entry.toTokenAmount)||exit.fromToken.decimals!==token.decimals||exit.toToken.decimals!==settlement.decimals)return blocked("The reverse route does not match the observed position.");
      let rate=1;
      if(saved.snapshot.priceCurrency==="USDT"&&settlement.symbol==="USDC"){
        const fx=await (deps.settlementRate??(()=>getTicker("USDC-USDT")))();
        if(!Number.isFinite(fx.last)||fx.last<=0||!Number.isFinite(Number(fx.ts))||Math.abs(Date.now()-Number(fx.ts))>30_000)return blocked("A fresh USDC/USDT conversion is unavailable.");
        rate=fx.last;
      }else if(!(saved.snapshot.priceCurrency==="USDT"&&trade.network==="xlayer"))return blocked("The research and settlement currency conversion is unsupported.");
      const inputAmount=Number(formatUnits(BigInt(trade.amount),settlement.decimals)),quantity=Number(formatUnits(BigInt(entry.toTokenAmount),token.decimals)),returned=Number(formatUnits(BigInt(exit.toTokenAmount),settlement.decimals));
      const settlementUsd=Number(entry.fromToken.priceUsd),fees=[entry.networkFeeUsd,exit.networkFeeUsd];
      const knownFees=fees.every(f=>f!==null&&f.trim()!==""&&Number.isFinite(Number(f))&&Number(f)>=0)&&Number.isFinite(settlementUsd)&&settlementUsd>0;
      const currentEntry=inputAmount*rate/quantity;
      const minimumQuantity=trade.minimumOutputAmount?Number(formatUnits(BigInt(trade.minimumOutputAmount),token.decimals)):null;
      if(trade.orderType==="limit"&&(!minimumQuantity||!Number.isFinite(minimumQuantity)))return blocked("A positive minimum output is required to review a protected Limit order.");
      const pricedEntry=trade.orderType==="limit"&&trade.limitPrice?Math.max(trade.limitPrice*rate,inputAmount*rate/minimumQuantity!):currentEntry;
      if(!pricedEntry)return blocked("A Limit entry price is required.");
      // A quote far from a limit does not verify that hypothetical route or fee.
      if(trade.orderType==="limit"&&(!trade.limitPrice||Math.abs(trade.limitPrice*rate/currentEntry-1)>.002))return blocked("The limit is away from the current route. Keep the conditional ticket and refresh its review near execution.");
      const effectiveSlippage=trade.slippageMode==="manual"?trade.slippagePercent:trade.maxAutoSlippagePercent;
      const executionLevels:GlobalExecutionLevels={currency:settlement.symbol,researchCurrency:assessment.priceCurrency,settlementToResearch:rate,entry:[assessment.permittedEntry![0]/rate,assessment.permittedEntry![1]/rate],referenceEntry:currentEntry/rate,stopLoss:assessment.observedStop!/rate,takeProfit:assessment.targets[0]/rate};
      const tick=10**-saved.snapshot.pricePrecision;
      const protectionMatches=trade.stopLoss!==undefined&&trade.takeProfit!==undefined&&Math.abs(trade.stopLoss*rate-assessment.observedStop!)<=tick&&Math.abs(trade.takeProfit*rate-assessment.targets[0])<=tick;
      const conservative=protectionMatches?{...assessment,observedStop:Math.min(assessment.observedStop!,trade.stopLoss!*rate),targets:[Math.min(assessment.targets[0],trade.takeProfit!*rate),...assessment.targets.slice(1)]}:assessment;
      const at=Date.now(),review=reviewGlobalOrder(conservative,{observedAt:now,expiresAt:now+30_000,entry:pricedEntry,quantity:inputAmount*rate/pricedEntry,roundTripLoss:Math.max(0,inputAmount-returned)*rate,networkFees:knownFees?fees.reduce((s,f)=>s+Number(f),0)/settlementUsd*rate:null,slippageBps:effectiveSlippage*200,inputBalanceSufficient:available>=BigInt(trade.amount),representationVerified:true,currencyVerified:true},at);
      if(!protectionMatches){
        review.state="blocked";review.blockers.push("ticket_protection");review.lines.unshift("Ticket TP/SL differ from the fresh observed protection. Load the new levels and recheck; edited levels remain manual.");
      }
      return res.json({assessment,review,executionLevels,quote:entry,quoteExpiresAt:new Date(now+30_000).toISOString(),network:trade.network,amount:trade.amount,fromTokenAddress:trade.fromTokenAddress,toTokenAddress:trade.toTokenAddress});
    }finally{inflight.delete(key);}
  }));
  return router;
}
