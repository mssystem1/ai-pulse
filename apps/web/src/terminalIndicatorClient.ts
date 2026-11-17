import { parseIndicatorPackage, candleCloseTime, type IndicatorInput, type IndicatorKernel, type IndicatorManifest } from "@pulse/domain";
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

export type IndicatorListing = { calculation?:"nand"|"hybrid"|"host"; id: string; manifestId: string; version: string; title: string; description: string; author: string; kernel: IndicatorKernel; publisher: string | null; createdAt: string | null; canDelete: boolean; hosted: boolean; offer?: {priceUsdc:string;kind:"version-service";description:string}; entitled?:boolean; registration?: {processor:string;circuitId:string;transactionHash?:string;registeredAt?:string;observedAt?:number|string;blockNumber?:string;status?:string} };
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
  const candles=(market.report?.candles??[]).flatMap(candle=>{const end=candleCloseTime(candle.ts,market.timeframe);return candle.confirmed===true&&end&&end<=market.observedAt?[{ts:candle.ts,end,open:candle.open,high:candle.high,low:candle.low,close:candle.close,volume:candle.volume}]:[];}).slice(-1024);
  const priceInterval=candles.length?candles[0].end-candles[0].ts:0,priceGaps=candles.flatMap((candle,index)=>index&&candle.ts>candles[index-1].end?[{start:candles[index-1].end,end:candle.ts}]:[]);
  const price=candles.length?{source:market.report.snapshot.source,knownAt:market.observedAt,units:"base" as const,status:market.observedAt-candles.at(-1)!.end>priceInterval+5000?"stale" as const:priceGaps.length?"partial" as const:"available" as const,windowStart:candles[0].ts,windowEnd:candles.at(-1)!.end,intervalMs:priceInterval,candles,missingIntervals:priceGaps}:undefined;
  return { instId: market.instId, timeframe: market.timeframe, source: flow?.source ?? "unavailable-perpetual-executions", status: incomplete&&flow?.status==="available"?"partial":flow?.status??"unavailable", knownAt,
    windowStart:start,windowEnd,units:stream==="spot"?"base":"contracts",now,
    ...(flow?.displayBucketMs?{intervalMs:flow.displayBucketMs}:{}),...(missingIntervals?{missingIntervals}:{}),...(price?{price}:{}),points:unique };
}
/** Store calculation packages only, never market data or wallet credentials. */
export const INDICATOR_LIBRARY_LIMIT = 64;
export const INDICATOR_CHART_LIMIT = 8;
export const indicatorChartStorageKey = (wallet?: string | null) => `pulse-indicator-chart-v1:${wallet?.toLowerCase() ?? "local"}`;
export function loadInstalledIndicators(storage: Pick<Storage, "getItem">, defaults: IndicatorManifest[]): IndicatorManifest[] {
  const raw = storage.getItem("pulse-indicators-v1");
  if (raw === null) return defaults.slice(0, 1);
  if (raw.length > 4_800_000) throw Error("Saved indicator library is too large; remove its browser storage to reset it");
  const items: unknown = JSON.parse(raw);
  if (!Array.isArray(items) || items.length > INDICATOR_LIBRARY_LIMIT) throw Error("Saved indicator library is invalid");
  const valid = items.map(parseIndicatorPackage);
  if (new Set(valid.map(indicatorIdentity)).size !== valid.length) throw Error("Duplicate installed indicator version");
  return valid;
}
export function installIndicator(current: IndicatorManifest[], candidate: unknown): IndicatorManifest[] {
  const valid = parseIndicatorPackage(candidate), identity = indicatorIdentity(valid);
  const same = current.find(item => indicatorIdentity(item) === identity);
  if (same) { if (JSON.stringify(same) !== JSON.stringify(valid)) throw Error("This indicator version is already installed with different content"); return current; }
  if (current.length >= INDICATOR_LIBRARY_LIMIT) throw Error(`Your library has ${INDICATOR_LIBRARY_LIMIT} saved indicators. Remove an unused package before saving another.`);
  return [...current, valid];
}

/** Saving a package and displaying it are separate actions. New chart studies
 * can replace an older visible slot without deleting any saved creation. */
export function activateChartIndicator(current: readonly string[], identity: string): string[] {
  return [...current.filter(id => id !== identity), identity].slice(-INDICATOR_CHART_LIMIT);
}
export function loadChartIndicatorIds(storage: Pick<Storage, "getItem">, installed: readonly IndicatorManifest[], wallet?: string | null): string[] {
  const allowed = new Set(installed.map(indicatorIdentity));
  try {
    const raw = storage.getItem(indicatorChartStorageKey(wallet));
    if (raw !== null) {
      const saved: unknown = JSON.parse(raw);
      if (Array.isArray(saved) && saved.every(id => typeof id === "string")) return [...new Set(saved as string[])].filter(id => allowed.has(id)).slice(-INDICATOR_CHART_LIMIT);
    }
  } catch { /* A corrupt visibility preference must not discard saved packages. */ }
  return [...allowed].slice(-INDICATOR_CHART_LIMIT);
}
