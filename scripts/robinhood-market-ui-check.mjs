// Isolated fixtures: no wallet, payment, signing, or external network requests.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const origin = 'http://127.0.0.1:5178';
const pair = 'AAPL.AF3D76F1834A1D42-USDG';
const token = { symbol: 'AAPL', name: 'Apple Robinhood Token', address: '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', decimals: 18, logoUrl: null };
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      const json = data => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
      if (url.origin === origin && url.pathname === '/__robinhood_market') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-pulse-theme="robinhood"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script type="module">
        import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
        await import('/src/styles.css'); await import('/src/appearance.css');
        const r=await import('/node_modules/.vite/deps/react.js'), d=await import('/node_modules/.vite/deps/react-dom_client.js'); const React=r.default||r,dom=d.default||d;
        const {ExecutionPairPicker}=await import('/src/Pickers.tsx'), {SpotMarketPreview}=await import('/src/SpotMarketPreview.tsx');
        dom.createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
          React.createElement(ExecutionPairPicker,{id:'pair',networkKey:'robinhood',value:'${pair}',custody:'erc20',onSelect:item=>window.selectedPair=item.pair}),
          React.createElement(SpotMarketPreview,{pair:'${pair}',timeframe:'1H',lang:'en',context:'autopilot'})));
      </script></body></html>` });
      if (url.origin === origin && !url.pathname.startsWith('/v1')) return route.continue();
      requests.push(url.pathname + url.search);
      if (url.pathname.endsWith('/trading/pairs')) return json({ pairs: [{ pair, analysisBase: 'AAPL', executionPair: 'AAPL/USDG', routeStatus: 'checked-when-selected', token }] });
      if (url.pathname.endsWith('/resolve-pair')) return json({ available: true });
      if (url.pathname.endsWith('/ticker')) return json({ ticker: { instId: pair, priceCurrency: 'USD', last: 340, change24hPct: 1, high24h: 345, low24h: 330, volCcy24h: 25000, ts: String(Date.now()) } });
      if (url.pathname.endsWith('/candles')) return json({ priceCurrency: 'USD', candles: Array.from({ length: 80 }, (_, i) => ({ ts: Date.now() - (80-i)*3600000, open: 339, high: 342, low: 338, close: 340, volume: 25 })) });
      return json({});
    });
    await page.goto(`${origin}/__robinhood_market`);
    await page.locator('.spot-market-price').waitFor();
    assert.match(await page.locator('.spot-market-price small').innerText(), /^USD\s/);
    assert.equal(await page.locator('.spot-market-preview header strong').innerText(), 'AAPL/USDG');
    await page.locator('#pair').click();
    await page.getByRole('button').filter({ hasText: 'Apple Robinhood Token' }).click();
    await page.waitForFunction(expected => window.selectedPair === expected, pair);
    assert.ok(requests.some(path => path.includes('custody=erc20')));
    assert.ok(requests.some(path => path.includes('resolve-pair') && path.includes(encodeURIComponent(pair))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, assetSelection: 'passed', priceCurrency: 'USD', settlement: 'USDG', overflow: false }));
    await page.close();
  }
} finally { await browser.close(); }
