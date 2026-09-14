// Synthetic settlement only: all external API/RPC traffic is intercepted.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const origin = "http://127.0.0.1:5178";
const owner = `0x${"1".repeat(40)}`, base = `0x${"2".repeat(40)}`, quote = `0x${"3".repeat(40)}`;
const timestamp = Math.floor(Date.now() / 3600000) * 3600000;
const candles = Array.from({ length: 100 }, (_, i) => ({ ts: timestamp - (99 - i) * 3600000, open: 2000, high: 2010, low: 1990, close: 2001, volume: 100, confirmed: i < 99 }));
const fills = ["buy", "sell"].map((side, i) => ({ id: `fill-${i}`, source: "wallet", kind: `market_${side}`, status: "confirmed", pair: "ETH-USDT", txHash: `0x${String(i + 4).repeat(64)}`, fillSide: side, fillPrice: 2000 + i, fillQuantity: 1, fillQuoteValue: 2000 + i, fillBaseAsset: base, fillQuoteAsset: quote, fillObservedAt: new Date(timestamp - (2 - i) * 3600000).toISOString(), createdAt: new Date(timestamp - (2 - i) * 3600000).toISOString() }));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    let settled = false, reads = 0;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      const json = body => route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
      if (url.origin === origin && url.pathname === "/__spot_settlement") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
        await import('/src/styles.css'); await import('/src/appearance.css');
        const ReactModule=await import('/node_modules/.vite/deps/react.js'); const React=ReactModule.default||ReactModule;
        const DomModule=await import('/node_modules/.vite/deps/react-dom_client.js'); const {createRoot}=DomModule.default||DomModule;
        const {SpotWorkspace}=await import('/src/V6Workspaces.tsx');
        createRoot(document.getElementById('root')).render(React.createElement(SpotWorkspace,{networkKey:'base',wallet:'${owner}',lang:'en',initialPair:'ETH-USDT',onAnalyze:()=>{}}));
      </script></body></html>` });
      if (url.origin === origin) return route.continue();
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
      if (url.pathname.endsWith("/capabilities")) return json({ network: "base", spot: { visible: true, enabled: true }, autopilot: { visible: true, enabled: true }, contracts: {} });
      if (url.pathname.endsWith("/resolve-pair")) return json({ available: true, base: { address: base, symbol: "WETH", name: "Wrapped Ether", decimals: 18 }, quote: { address: quote, symbol: "USDC", name: "USD Coin", decimals: 6 } });
      if (url.pathname.endsWith("/quote")) return json({ toTokenAmount: "2000000", route: ["fixture"] });
      if (url.pathname.endsWith("/activity")) return json({ activity: settled ? fills : [], persistence: { state: "online" } });
      if (url.pathname.endsWith("/orders")) return json({ orders: [] });
      if (url.pathname.endsWith("/accounts")) return json({ accounts: { protection: null, limit: null, bracket: null }, vaults: [] });
      if (url.pathname.endsWith("/ticker")) return json({ ticker: { instId: "ETH-USDT", last: 2001, high24h: 2010, low24h: 1990, change24hPct: 1, volCcy24h: 200000, ts: String(Date.now()) } });
      if (url.pathname.endsWith("/candles")) return json({ candles });
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        if (body?.method === "eth_call") {
          reads++;
          const balance = body.params[0].to.toLowerCase() === base ? (settled ? 0n : 10n ** 18n) : (settled ? 2000001n : 2000000n);
          return json({ jsonrpc: "2.0", id: body.id, result: `0x${balance.toString(16)}` });
        }
        throw new Error("Unexpected write in read-only settlement fixture");
      }
      return json({});
    });
    await page.goto(`${origin}/__spot_settlement`);
    await page.getByRole("button", { name: "Sell WETH", exact: true }).click();
    const amount = page.locator('#spot-trade-ticket input[placeholder="0.00"]');
    await amount.fill("1");
    await page.getByText("Available 1 WETH", { exact: true }).waitFor();
    const before = reads;
    settled = true;
    await page.getByRole("button", { name: "Refresh status", exact: true }).click();
    await page.getByText("Available 0 WETH", { exact: true }).waitFor();
    assert.ok(reads >= before + 2, "manual/post-settlement refresh reads both assets again");
    assert.equal(await page.getByRole("button", { name: "Use WETH balance first", exact: true }).isDisabled(), true);
    await page.locator('.market-candle-chart[data-marker-count="2"]').waitFor();
    assert.equal(await page.locator('.market-candle-chart[data-marker-count="2"]').count(), 1);
    assert.deepEqual(errors, []);
    console.log(`PASS Spot settlement ${width}px: fresh balances, empty sell blocked, verified Buy/Sell chart markers`);
    await page.close();
  }
} finally { await browser.close(); }
