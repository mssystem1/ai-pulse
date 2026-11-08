import { parseIndicatorPackage, type IndicatorInput, type IndicatorKernel, type IndicatorManifest } from "@pulse/domain";
import type { TerminalMarket } from "./terminalClient";
import { WEB_NETWORKS, type WebNetworkKey } from "./networks";
export type IndicatorPaymentNetwork = "xlayer" | "base" | "arbitrum";
export type IndicatorPaymentOption = { key: IndicatorPaymentNetwork; network: string; asset: string; symbol: string };
export type IndicatorServiceQuote = {id:string;listingId:string;requestId:string;title?:string;version?:string;priceUsdc:string;priceUsd?:string;amountAtomic:string;asset:string;assetSymbol?:string;payee:string;network:IndicatorPaymentNetwork;expiresAt:string;path:string;resource:string;state?:"quoted"|"authorizing"|"granted"};

export function indicatorPaymentNetwork(value: WebNetworkKey | undefined): IndicatorPaymentNetwork | null {
  return value === "xlayer" || value === "base" || value === "arbitrum" ? value : null;
}
export function indicatorPaymentLabel(network: IndicatorPaymentNetwork) {
  const selected = WEB_NETWORKS[network];
  return `${selected.payment.symbol} on ${selected.label}`;
}
/** A reviewed quote is pinned to the header's network, exact token, recipient,
 * amount and service path before the wallet can be asked to sign. */
export function validateIndicatorServiceQuote(quote: IndicatorServiceQuote, selected: WebNetworkKey | undefined): void {
  if (!quote || !indicatorPaymentNetwork(quote.network) || quote.network !== selected) throw Error("Select the quote's payment network in the app header before paying.");
  const network = WEB_NETWORKS[quote.network];
  if (!/^iqu_[a-f0-9]{32}$/.test(quote.id) || !/^pmi_[a-f0-9]{32}$/.test(quote.listingId)
    || quote.path !== `/v1/terminal/indicators/purchases/${quote.id}`
    || String(quote.asset).toLowerCase() !== network.payment.address.toLowerCase()
    || quote.assetSymbol !== undefined && quote.assetSymbol !== network.payment.symbol
    || !/^0x[\da-f]{40}$/i.test(quote.payee) || !/^[1-9]\d*$/.test(quote.amountAtomic)
    || !/^\d+(?:\.\d{1,6})?$/.test(quote.priceUsd ?? quote.priceUsdc)) throw Error("The indicator quote's payment terms could not be verified.");
  if (new URL(quote.resource, "https://pulse.invalid").pathname !== `/${quote.network}${quote.path}`) throw Error("The indicator quote's resource does not match its payment network and service.");
  const [whole, fraction = ""] = (quote.priceUsd ?? quote.priceUsdc).split(".");
  if (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")) !== BigInt(quote.amountAtomic)) throw Error("The indicator quote's displayed price does not match its payment amount.");
  if (!Number.isFinite(Date.parse(quote.expiresAt))) throw Error("The indicator quote has no valid expiry.");
}

export type IndicatorListing = { id: string; manifestId: string; version: string; title: string; description: string; author: string; kernel: IndicatorKernel; publisher: string | null; createdAt: string | null; canDelete: boolean; hosted: boolean; offer?: {priceUsdc:string;kind:"version-service";description:string}; entitled?:boolean; registration?: {processor:string;circuitId:string;transactionHash?:string;registeredAt?:string;observedAt?:number|string;blockNumber?:string;status?:string} };
export const indicatorIdentity = (manifest: IndicatorManifest) => `${manifest.id}@${manifest.version}`;
export function indicatorInputFromMarket(market: TerminalMarket, stream: "spot" | "perpetual", now = Date.now()): IndicatorInput {
  const flow = stream === "spot" ? market.tools.flow : market.tools.perpetualFlow;
  const points = flow?.displayPoints ?? flow?.points ?? [];
  const start = flow?.windowStart ?? points[0]?.ts ?? now - 60000, end = flow?.windowEnd ?? points.at(-1)?.ts! + 1;
  const windowEnd=Number.isSafeInteger(end)&&end>start?end:start+1, knownAt=flow?.knownAt??0;
  // Display buckets can overlap sample edges, or include a trailing bucket at
  // the exclusive end of a retained session. Clip labels only for overlapping
  // buckets; do not move entirely outside executions into this source window.
  const eligible=points.flatMap(point=>{
    const rawEnd="end" in point&&typeof point.end==="number"?point.end:undefined;
    if(point.ts>=windowEnd||point.ts>knownAt||(rawEnd??point.ts+1)<=start)return [];
    const ts=Math.max(start,point.ts),clippedEnd=rawEnd===undefined?undefined:Math.min(windowEnd,knownAt,rawEnd);
    if(clippedEnd!==undefined&&clippedEnd<=ts)return [];
    return [{ts,...(clippedEnd===undefined?{}:{end:clippedEnd}),buy:point.buy,sell:point.sell}];
  }).sort((a,b)=>a.ts-b.ts);
  const seen=new Set<number>(),unique=eligible.filter(point=>{if(seen.has(point.ts))return false;seen.add(point.ts);return true;});
  const missingIntervals=flow?.missingIntervals?.map(({start,end})=>({start,end}));
  const incomplete=unique.length!==points.length||Boolean(missingIntervals?.length);
  return { instId: market.instId, timeframe: market.timeframe, source: flow?.source ?? "unavailable-perpetual-executions", status: incomplete&&flow?.status==="available"?"partial":flow?.status??"unavailable", knownAt,
    windowStart:start,windowEnd,units:stream==="spot"?"base":"contracts",now,
    ...(flow?.displayBucketMs?{intervalMs:flow.displayBucketMs}:{}),...(missingIntervals?{missingIntervals}:{}),points:unique };
}
/** Store calculation packages only, never market data or wallet credentials. */
export function loadInstalledIndicators(storage: Pick<Storage, "getItem">, defaults: IndicatorManifest[]): IndicatorManifest[] {
  const raw = storage.getItem("pulse-indicators-v1");
  if (raw === null) return defaults.slice(0, 1);
  if (raw.length > 4_800_000) throw Error("Saved indicator library is too large; remove its browser storage to reset it");
  const items: unknown = JSON.parse(raw);
  if (!Array.isArray(items) || items.length > 8) throw Error("Saved indicator library is invalid");
  const valid = items.map(parseIndicatorPackage);
  if (new Set(valid.map(indicatorIdentity)).size !== valid.length) throw Error("Duplicate installed indicator version");
  return valid;
}
export function installIndicator(current: IndicatorManifest[], candidate: unknown): IndicatorManifest[] {
  const valid = parseIndicatorPackage(candidate), identity = indicatorIdentity(valid);
  const same = current.find(item => indicatorIdentity(item) === identity);
  if (same) { if (JSON.stringify(same) !== JSON.stringify(valid)) throw Error("This indicator version is already installed with different content"); return current; }
  if (current.length >= 8) throw Error("Keep up to eight installed indicators; remove one before adding another");
  return [...current, valid];
}
