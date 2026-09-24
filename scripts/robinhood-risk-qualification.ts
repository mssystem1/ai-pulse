/** Free live source checks; do not invent a token when a catalog category is absent. */
import { config } from "dotenv";
import { writeFile } from "node:fs/promises";
async function main() {
  config({ quiet: true });
  const { loadConfig, getNetwork } = await import("../packages/config/src/index.js");
  const { collectTokenRiskEvidence } = await import("../apps/api/src/tokenRiskEvidence.js");
  const { robinhoodMarketCatalog } = await import("../apps/api/src/robinhoodMarkets.js");
  const { robinhoodStockCatalog } = await import("../apps/api/src/robinhoodAssetRegistry.js");
  const { ROBINHOOD_USDG, ROBINHOOD_WETH } = await import("../apps/api/src/robinhoodExecutionAssets.js");
  const cfg = loadConfig(), network = getNetwork("robinhood");
  const [catalog, stocks] = await Promise.all([robinhoodMarketCatalog(cfg, true), robinhoodStockCatalog()]);
  const stock = stocks.find(item => item.symbol === "AAPL") || stocks[0];
  const stockAddresses = new Set(stocks.map(item => item.address));
  const ordinary = catalog.find(item => !stockAddresses.has(item.token.address.toLowerCase()) && item.token.address.toLowerCase() !== ROBINHOOD_WETH);
  if (!stock) throw new Error("Risk qualification official stock catalog unavailable");
  console.log(JSON.stringify({ catalogAssets: catalog.length, officialStocks: stocks.length, ordinaryCatalogSampleAvailable: Boolean(ordinary) }));
  const samples = [{ kind: "issuer_stablecoin", address: ROBINHOOD_USDG }, { kind: "issuer_stock_token", address: stock.address },
    { kind: "wrapped_native", address: ROBINHOOD_WETH }, ...(ordinary ? [{ kind: "ordinary_catalog_token", address: ordinary.token.address }] : [])];
  const results = [];
  for (const sample of samples) {
    const evidence = await collectTokenRiskEvidence({ cfg, network, networkKey: "robinhood", address: sample.address });
    const registry = evidence.sources.find(source => source.source === "Robinhood official stock registry");
    const listing = registry?.data as { listed?: boolean; assetClass?: string } | undefined;
    if (evidence.network.chainId !== "4663" || evidence.tokenAddress !== sample.address.toLowerCase()) throw new Error("Risk qualification identity mismatch");
    if (sample.kind === "issuer_stock_token" && (!listing?.listed || listing.assetClass !== "issuer_stock_token")) throw new Error("Risk qualification stock identity unavailable");
    if (sample.kind === "ordinary_catalog_token" && listing?.listed) throw new Error("Risk qualification ordinary token misclassified");
    const result = { ...sample, observedAt: evidence.observedAt, sourcePolicy: evidence.sourcePolicy,
      sources: evidence.sources.map(source => ({ source: source.source, status: source.status })), officialStockListed: listing?.listed ?? null };
    results.push(result); console.log(JSON.stringify(result));
  }
  await writeFile("packages/contracts/deployments/4663-risk-evidence-qualification.json", JSON.stringify({ chainId: 4663, paid: false, ordinaryCatalogSampleAvailable: Boolean(ordinary), results }, null, 2));
}
main().catch(error => { console.error(error instanceof Error && error.message.startsWith("Risk qualification ") ? error.message : "Risk qualification source check unavailable; no payment or transaction sent."); process.exitCode = 1; });
