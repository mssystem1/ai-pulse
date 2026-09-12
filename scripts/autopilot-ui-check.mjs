// Local browser regression tests. All API/RPC traffic is fulfilled by fixtures;
// no private key, signing, external API request or production write is possible.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const origin = "http://127.0.0.1:5178";
const owner = process.env.TEST_WALLET_ADDRESS || `0x${"1".repeat(40)}`;
assert.match(owner, /^0x[\da-f]{40}$/i);
const addresses = [1, 2, 3, 4].map(n => `0x${String(n + 10).repeat(20)}`);
const settlement = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const candidates = ["BTC", "ETH", "DOGE", "XRP", "ADA", "LTC", "SOL", "SHIB"].map((symbol, i) => ({ pair: `${symbol}-USDT`, timeframe: "4H", strategyType: "breakout", mark: 10 + i, change24hPct: 2, score: 80, reason: "Prior range confirmed", rsi14: 55, volumeRatio: 1.4, fetchedAt: new Date().toISOString(), priceHistory: [8, 9, 8.5, 10] }));
const browser = await chromium.launch({ channel: "msedge", headless: true });
await mkdir(".codex-ui-review", { recursive: true });
try {
  for (const [context, width] of ["autopilot", "global", "spot"].flatMap(context => [1440, 390].map(width => [context, width]))) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
    page.on("response", response => { if (response.status() >= 400) console.error("Browser resource:", response.status(), new URL(response.url()).pathname); });
    let scans = 0;
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      const json = body => route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
      if (url.origin === origin && url.pathname === "/__autopilot_ui_check") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html data-pulse-theme="base"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="root" style="max-width:1320px;margin:24px auto;padding:12px"></main><script type="module">
        import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
        await import('/src/styles.css'); await import('/src/appearance.css'); await import('/src/autopilotJournal.css');
        const ReactModule = await import('/node_modules/.vite/deps/react.js'); const React=ReactModule.default||ReactModule;
        const DomModule = await import('/node_modules/.vite/deps/react-dom_client.js'); const {createRoot}=DomModule.default||DomModule;
        const {AutopilotWorkspace,OpportunityRadar} = await import('/src/V6Workspaces.tsx');
        const Component='${context}'==='autopilot'?AutopilotWorkspace:OpportunityRadar;
        createRoot(document.getElementById('root')).render(React.createElement(Component,{networkKey:'base',wallet:'${owner}',lang:'en',context:'${context}',onAnalyze:()=>{},onPrepare:()=>{}}));
      </script></body></html>` });
      if (url.origin === origin) return route.continue();
      if (url.pathname.includes("opportunities")) { scans++; return json({ candidates }); }
      if (url.pathname.includes("capabilities")) return json({ network: "base", spot: { enabled: true }, autopilot: { enabled: true }, contracts: { autopilotFactory: addresses[0] } });
      if (url.pathname.includes("/strategies")) return json({ persistence: { state: "online" }, strategies: [{ id: "base:fixture", vault: addresses[1], owner, network: "base", pair: "DOGE-USDT", timeframe: "4H", policy: { strategy: "Breakout", maxTradePct: 50, dailyLossPct: 3 }, status: "active", runtimeState: "paused", paused: true, settlementAsset: settlement, settlementBalance: "700000", portfolioValueAtomic: "700000", pnlAtomic: null, pnlCashFlow: { state: "recovering", progressPct: 42, detail: "Historical cash-flow recovery is in progress; PnL waits for complete coverage." }, settlementDecimals: 6, settlementSymbol: "USDC", targetAsset: addresses[0], targetBalance: "0", targetDecimals: 18, targetSymbol: "DOGE", evaluations: [], aiPass: { expiresAt: new Date(Date.now() + 86400000).toISOString(), pausedAt: new Date().toISOString(), signalLimit: 3, signalsUsed: 0 } }] });
      if (url.pathname.includes("/accounts")) return json({ accounts: { protection: null, limit: null, bracket: null }, vaults: addresses.map((address, i) => ({ address, settlementAsset: settlement, settlementSymbol: "USDC", settlementDecimals: 6, balanceAtomic: i === 0 ? "0" : i === 1 ? "700000" : "200000", paused: true })) });
      if (url.pathname.includes("/activity")) return json({ activity: [], persistence: { state: "online" } });
      if (url.pathname.endsWith("/pairs")) return json({ pairs: candidates.map(item => ({ pair: item.pair, baseSymbol: item.pair.split("-")[0], quoteSymbol: "USDC" })) });
      if (url.pathname.includes("resolve-pair")) return json({ available: true, base: { address: addresses[0], symbol: "BTC", decimals: 18 }, quote: { address: settlement, symbol: "USDC", decimals: 6 } });
      // Never forward RPCs or unknown endpoints beyond localhost.
      if (route.request().method() === "POST") {
        const data = route.request().postDataJSON();
        if (data?.method) return json({ jsonrpc: "2.0", id: data.id, result: "0x1e8480" });
      }
      return json({});
    });
    await page.goto(`${origin}/__autopilot_ui_check`, { waitUntil: "networkidle" });
    await page.locator(".potential-gainer-grid>article").first().waitFor({ timeout: 45000 }).catch(async error => {
      console.error("Visible state:", (await page.locator("body").innerText()).slice(0, 1500)); throw error;
    });
    if (context === "autopilot") {
    await page.locator(".identified-vault").first().waitFor();
    assert.equal(await page.locator(".identified-vault").count(), 4);
    assert.deepEqual(await page.locator(".identified-vault .vault-identity strong").allTextContents(), ["#1", "#2", "#3", "#4"]);
    assert.equal(await page.getByRole("button", { name: "Resume · run timer", exact: true }).isDisabled(), true, "unfinished #4 cannot resume");
    assert.equal(await page.locator('.autopilot-journal-index, .autopilot-setup-journal').count(), 0, 'journal area has no duplicate navigation or setup panels');
    assert.equal(await page.locator('.autopilot-trading-reports > details').count(), 1, 'only registered strategies have trading journals');
    await page.locator('.incomplete-vault').filter({has:page.getByRole('button',{name:'Open Autopilot #4 controls',exact:true})}).getByRole('button', { name: 'Finish setup', exact:true }).click();
    await page.getByRole('heading', { name: 'Finish Autopilot #4 setup', exact: true }).waitFor();
    assert.match(await page.locator('#autopilot-setup-target').innerText(), /draft settings, not recovered trading instructions/);
    await page.getByRole('button', { name: 'Use for Autopilot', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Finish Autopilot #4 setup', exact: true }).waitFor();
    await page.locator(`#autopilot-journal-${addresses[1]} > summary`).click();
    assert.equal(await page.locator(`#autopilot-journal-${addresses[1]}`).evaluate(el => el.open), true);
    await page.getByRole("button", { name: "Open Autopilot #2 controls", exact: true }).click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Resume · run timer')?.disabled);
    assert.match(await page.locator('.cash-flow-coverage').innerText(), /Synchronizing · 42%/);
    assert.match(await page.locator('.cash-flow-coverage').innerText(), /No new payment is needed/);
    }
    const countBefore = scans;
    await page.getByRole("button", { name: /Show \d+ more candidates/ }).click();
    assert.equal(await page.locator(".potential-gainer-grid>article").count(), 8);
    const allShown = page.getByRole("button", { name: /All 8 candidates shown/ });
    assert.equal(await allShown.isDisabled(), true);
    await allShown.evaluate(button => { button.click(); button.click(); button.click(); });
    assert.equal(scans, countBefore, "expansion does not refetch market data");
    assert.equal(await page.locator(".potential-gainer-grid>article").count(), 8);
    await page.getByRole("button", { name: "Show fewer candidates", exact: true }).click();
    assert.equal(await page.locator(".potential-gainer-grid>article").count(), width < 650 ? 2 : 4);
    await page.screenshot({ path: `.codex-ui-review/${context}-${width}.png`, fullPage: true });
    if (context === "autopilot") {
    await page.locator(".order-monitor").last().screenshot({ path: `.codex-ui-review/autopilot-accounts-${width}.png` });
    await page.locator("#autopilot-dashboard-controls").screenshot({ path: `.codex-ui-review/autopilot-controls-${width}.png` });
    }
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(overflow.scroll <= overflow.width + 1, `horizontal overflow: ${JSON.stringify(overflow)}`);
    assert.deepEqual(errors, []);
    console.log(`PASS ${context} ${width}px: ${context === "autopilot" ? "four vaults ordered; incomplete setup blocks Resume; funded paused vault is eligible; " : ""}expansion stays local; no overflow or render exceptions.`);
    await page.close();
  }
} finally { await browser.close(); }
