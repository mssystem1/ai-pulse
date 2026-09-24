import { z } from "zod";

export const ROBINHOOD_ASSET_REGISTRY = "https://api.robinhood.com/rhj/assets";
const addressSchema = z.string().regex(/^0x[\da-f]{40}$/i);
const decimal = z.string().max(100).regex(/^\d+(?:\.\d+)?$/);
const assetSchema = z.object({
  id: z.string().max(100), tokenSymbol: z.string().min(1).max(80), tokenName: z.string().max(300),
  deployments: z.array(z.object({ chainId: z.number().int(), contractAddress: addressSchema })).max(100),
  currentMultiplier: decimal.refine(value => Number(value) > 0 && Number.isFinite(Number(value))),
  pendingMultiplier: z.union([decimal, z.literal("")]).optional(),
  pendingMultiplierEffectiveTime: z.string().datetime({ offset: true }).optional(),
  status: z.string().max(100),
  // The live registry also returns nested session statuses. Preserve the bounded
  // upstream object without interpreting it as DEX execution permission.
  tradingCapabilities: z.record(z.unknown()).nullish(),
});
const registrySchema = z.object({ assets: z.array(assetSchema).max(20_000) });

export function robinhoodStockEvidence(value: unknown, address: string) {
  addressSchema.parse(address);
  const registry = registrySchema.parse(value);
  const matches = registry.assets.filter(asset => asset.deployments.some(deployment =>
    deployment.chainId === 4663 && deployment.contractAddress.toLowerCase() === address.toLowerCase()));
  if (matches.length > 1) throw new Error("Ambiguous Robinhood stock registry identity");
  const asset = matches[0];
  return {
    chainId: 4663, address: address.toLowerCase(), sourceUrl: ROBINHOOD_ASSET_REGISTRY,
    listed: Boolean(asset), assetClass: asset ? "issuer_stock_token" : "unclassified_by_stock_registry",
    ...(asset ? { assetId: asset.id, symbol: asset.tokenSymbol, name: asset.tokenName,
      status: asset.status, currentMultiplier: asset.currentMultiplier,
      pendingMultiplier: asset.pendingMultiplier || null,
      pendingMultiplierEffectiveTime: asset.pendingMultiplierEffectiveTime ?? null,
      underlyingTradingCapabilities: asset.tradingCapabilities ?? null } : {}),
    limitations: [
      "Registry identity is not proof of direct share ownership, redemption eligibility, unrestricted transfers or available DEX liquidity.",
      "Underlying session trading statuses do not authorize token swaps. Missing fields remain unknown.",
      "REST underlying quotes need the corporate-action multiplier; adjusted on-chain oracle prices must not be multiplied again.",
      ...(!asset ? ["Not found in this registry snapshot; this alone is not evidence of fraud or an unsafe token."] : []),
    ],
  };
}

let cached: { value: unknown; observedAt: string; until: number } | undefined;
let pending: Promise<NonNullable<typeof cached>> | undefined;
async function registrySnapshot() {
  if (cached && cached.until > Date.now()) return cached;
  pending ||= (async () => {
    const response = await fetch(ROBINHOOD_ASSET_REGISTRY, {
      headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Robinhood asset registry HTTP ${response.status}`);
    if (!response.body) throw new Error("Robinhood asset registry body unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 5_000_000) throw new Error("Robinhood asset registry response too large");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel(); }
    const value = registrySchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    cached = { value, observedAt: new Date().toISOString(), until: Date.now() + 60_000 };
    return cached;
  })().finally(() => { pending = undefined; });
  return pending;
}

export async function collectRobinhoodStockEvidence(address: string) {
  addressSchema.parse(address);
  const snapshot = await registrySnapshot();
  return { ...robinhoodStockEvidence(snapshot.value, address), observedAt: snapshot.observedAt };
}

export async function robinhoodStockCatalog() {
  const snapshot = await registrySnapshot();
  return registrySchema.parse(snapshot.value).assets.flatMap(asset =>
    asset.status !== "ASSET_STATUS_ACTIVE" ? [] : asset.deployments.filter(deployment => deployment.chainId === 4663).map(deployment => ({
      address: deployment.contractAddress.toLowerCase(), symbol: asset.tokenSymbol, name: asset.tokenName,
      multiplier: asset.currentMultiplier, observedAt: snapshot.observedAt,
    })));
}
