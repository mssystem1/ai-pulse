import { formatUnits, parseAbi, parseUnits } from "viem";
import { z } from "zod";
import { executionPublicClient } from "./onchainDiscovery.js";

const decimal = z.string().max(100).regex(/^\d+(?:\.\d+)?$/);
const quotesSchema = z.object({ quotes: z.array(z.object({
  tokenSymbol: z.string(), currency: z.literal("USD"), bid: decimal, ask: decimal,
  generatedAt: z.string(), isTradingHalt: z.boolean(),
  deployments: z.array(z.object({ chainId: z.number().int(), contractAddress: z.string().regex(/^0x[\da-f]{40}$/i) })),
})).max(1000) });
const tokenAbi = parseAbi(["function oraclePaused() view returns(bool)", "function uiMultiplier() view returns(uint256)"]);

/** Raw issuer bid/ask are per share; apply the current token multiplier once. */
export function parseRobinhoodIssuerPrice(value: unknown, stock: { address: string; symbol: string }, multiplier: bigint, now = Date.now()) {
  const quotes = quotesSchema.parse(value).quotes.filter(quote => quote.tokenSymbol === stock.symbol && quote.deployments.some(deployment =>
    deployment.chainId === 4663 && deployment.contractAddress.toLowerCase() === stock.address.toLowerCase()));
  if (quotes.length !== 1) throw Error("Robinhood issuer quote identity is missing or ambiguous");
  const quote = quotes[0], ts = Date.parse(quote.generatedAt);
  if (quote.isTradingHalt) throw Error("Robinhood stock price is unavailable during a trading halt");
  if (!Number.isSafeInteger(ts) || now - ts > 180_000 || ts > now + 30_000) throw Error("Robinhood issuer quote is stale or invalid");
  const bid = parseUnits(quote.bid, 18), ask = parseUnits(quote.ask, 18);
  if (bid <= 0n || ask < bid || multiplier <= 0n) throw Error("Robinhood issuer bid/ask or multiplier is invalid");
  const close = Number(formatUnits((bid + ask) * multiplier / (2n * 10n ** 18n), 18));
  if (!Number.isFinite(close) || close <= 0) throw Error("Robinhood issuer token price is invalid");
  return { ts, close, source: "robinhood-issuer-reference" as const };
}

export async function robinhoodIssuerPrice(stock: { address: string; symbol: string; multiplier: string }) {
  const client = executionPublicClient("robinhood");
  if (await client.getChainId() !== 4663) throw Error("Robinhood issuer-price RPC returned the wrong chain");
  const blockNumber = await client.getBlockNumber();
  const [response, paused, multiplier] = await Promise.all([
    fetch(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(stock.symbol)}`, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(12_000) }),
    client.readContract({ blockNumber, address: stock.address as `0x${string}`, abi: tokenAbi, functionName: "oraclePaused" }),
    client.readContract({ blockNumber, address: stock.address as `0x${string}`, abi: tokenAbi, functionName: "uiMultiplier" }),
  ]);
  if (paused) throw Error("Robinhood stock oracle is paused for a corporate action");
  if (multiplier !== parseUnits(stock.multiplier, 18)) throw Error("Robinhood corporate-action multiplier changed; refresh before trading");
  if (!response.ok) throw Error("Robinhood issuer price is temporarily unavailable");
  return parseRobinhoodIssuerPrice(await response.json(), stock, multiplier);
}
