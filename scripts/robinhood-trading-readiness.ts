/** Read-only live quote/calldata discovery. No wallet signing or broadcasting. */
import { config } from "dotenv";
import { createPublicClient, http, formatUnits, parseEther, parseUnits, parseAbi } from "viem";
import { ROBINHOOD_PAYMENT as CHAIN } from "../packages/payments/src/robinhoodPayment.js";
if (!process.argv.includes("--run")) { console.log("Read-only quotes and transaction targets; use --run. No transactions sent."); process.exit(0); }
async function main() {
  config({ quiet: true }); process.env.DOTENV_CONFIG_QUIET = "true";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { getGenericOkxQuote, getGenericOkxSwap } = await import("../apps/api/src/okxDex.js");
  const cfg = loadConfig();
  const { robinhoodMarketCatalog, robinhoodMarketContext, executionSettlementTicker } = await import("../apps/api/src/robinhoodMarkets.js");
  const catalog = await robinhoodMarketCatalog(cfg, true);
  console.log(JSON.stringify({ catalogAssets: catalog.length, sample: catalog.slice(0, 8).map(item => ({ pair: item.pair, symbol: item.token.symbol, address: item.token.address })) }));
  const ethMarket = catalog.find(item => item.token.address.toLowerCase() === "0x0bd7d308f8e1639fab988df18a8011f41eacad73");
  if (ethMarket) {
    try { const market = await robinhoodMarketContext(cfg, { instId: ethMarket.pair, timeframe: "1H", candleLimit: 100 }); console.log(JSON.stringify({ market: ethMarket.pair, candles: market.candles.length, last: market.ticker.last, source: market.source })); }
    catch { console.log(JSON.stringify({ market: ethMarket.pair, marketDataAvailable: false })); }
  }
  if (process.argv.includes("--catalog-only")) {
    for (const item of [ethMarket, catalog.find(item => item.token.symbol === "AAPL")].filter(Boolean)) {
      try {
        const ticker = await executionSettlementTicker(cfg, item!.pair);
        console.log(JSON.stringify({ pair: item!.pair, settlementMarkAvailable: true, price: ticker.last, currency: ticker.priceCurrency, observedAt: ticker.ts }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        console.log(JSON.stringify({ pair: item!.pair, settlementMarkAvailable: false,
          reason: message.startsWith("Robinhood ") ? message : message.match(/HTTP \d+(?: code=\d+)?/)?.[0] || "Provider unavailable" }));
      }
    }
    return;
  }
  const { validateRobinhoodFunding } = await import("../apps/api/src/robinhoodFunding.js");
  const client = createPublicClient({ transport: http(cfg.ROBINHOOD_RPC_URL, { timeout: 12_000, retryCount: 0 }) });
  if (await client.getChainId() !== 4663) throw new Error();
  const { executionContracts, executionContractAddress } = await import("../apps/api/src/executionContracts.js");
  const contracts = executionContracts("robinhood");
  const registryAbi = parseAbi(["function automationPaused() view returns(bool)", "function admin() view returns(address)"]);
  const balance = await client.readContract({ address: CHAIN.asset, abi: parseAbi(["function balanceOf(address) view returns(uint256)"]), functionName: "balanceOf", args: [cfg.TEST_WALLET_ADDRESS as `0x${string}`] });
  console.log(JSON.stringify({ wallet: cfg.TEST_WALLET_ADDRESS, ETH: formatUnits(await client.getBalance({ address: cfg.TEST_WALLET_ADDRESS as `0x${string}` }), 18), USDG: formatUnits(balance, 6),
    automationPaused: await client.readContract({ address: contracts.registry, abi: registryAbi, functionName: "automationPaused" }) }));
  for (const [role, address] of Object.entries({ router: executionContractAddress("robinhood", "okxRouter"), spender: executionContractAddress("robinhood", "okxApproval"), multicall: "0xcA11bde05977b3631167028862bE2a173976CA11" })) {
    const code = await client.getCode({ address: address as `0x${string}` });
    console.log(JSON.stringify({ role, address, hasBytecode: Boolean(code && code !== "0x") }));
  }
  const native = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
  for (const pair of [
    { name: "ETH → USDG", from: native, to: CHAIN.asset, amount: parseEther("0.0001").toString() },
    { name: "USDG → WETH", from: CHAIN.asset, to: weth, amount: parseUnits("0.10", 6).toString() },
    { name: "WETH → USDG", from: weth, to: CHAIN.asset, amount: parseEther("0.00004").toString() },
  ]) {
    try {
      const input = { chainId: "4663", fromTokenAddress: pair.from.toLowerCase(), toTokenAddress: pair.to.toLowerCase(), amount: pair.amount };
      const quote = await getGenericOkxQuote(cfg, input);
      const correct = quote.fromToken.address.toLowerCase() === pair.from.toLowerCase() && quote.toToken.address.toLowerCase() === pair.to.toLowerCase()
        && quote.fromTokenAmount === pair.amount && BigInt(quote.toTokenAmount) > 0n;
      if (!correct) throw new Error("QuoteIdentityMismatch");
      console.log(JSON.stringify({ pair: pair.name, quoteAvailable: true, fromAmount: formatUnits(BigInt(quote.fromTokenAmount), quote.fromToken.decimals),
        toAmount: formatUnits(BigInt(quote.toTokenAmount), quote.toToken.decimals), priceImpactPercent: quote.priceImpactPercent, route: quote.route }));
      const swap = await getGenericOkxSwap(cfg, { ...input, userWalletAddress: cfg.TEST_WALLET_ADDRESS, slippagePercent: "0.5" });
      const code = await client.getCode({ address: swap.tx.to as `0x${string}` });
      if (pair.from === native) {
        const funding = validateRobinhoodFunding(swap, pair.amount, cfg.TEST_WALLET_ADDRESS);
        const tx = { account: cfg.TEST_WALLET_ADDRESS as `0x${string}`, to: swap.tx.to as `0x${string}`, data: swap.tx.data as `0x${string}`, value: BigInt(swap.tx.value) };
        await client.call(tx);
        const gas = await client.estimateGas(tx);
        console.log(JSON.stringify({ pair: pair.name, calldataValidated: true, simulationPassed: true,
          minimumUSDG: formatUnits(BigInt(funding.minToAmount), 6), estimatedGas: gas.toString(), broadcast: false }));
      }
      console.log(JSON.stringify({ pair: pair.name, preparationAvailable: true, router: swap.tx.to, routerHasBytecode: !!code && code !== "0x",
        valueETH: formatUnits(BigInt(swap.tx.value), 18), calldataBytes: (swap.tx.data.length - 2) / 2, broadcast: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      console.log(JSON.stringify({ pair: pair.name, available: false, reason: message.match(/HTTP \d+(?: code=\d+)?/)?.[0]
        || (message === "QuoteIdentityMismatch" ? message : "Provider unavailable or no executable route"), broadcast: false }));
    }
  }
}
main().then(() => process.exit(0)).catch(() => { console.error("Robinhood read-only trading check stopped; no transaction signed or sent."); process.exit(1); });
