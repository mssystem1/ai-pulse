// Read-only browser regression: render the real saved-report component and click
// its manual ticket action. No wallet provider or external requests are allowed.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.PULSE_UI_ORIGIN || 'http://localhost:5181';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname !== '/__report-handoff') return route.continue();
    return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const {AnalysisReport}=await import('/src/Report.tsx');
      const data={instId:'XADBE-USDT',tier:'premium',analysis:{bias:'bearish',confidence:35},
        executionPlan:{version:'pulse-spot-plan-v1',pair:'XADBE-USDT',timeframe:'1H',observedPrice:229.24,recommendation:{action:'wait'},
          buy:{trigger:229.07,takeProfit:236.6,stopLoss:228.742437}}};
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AnalysisReport,{data,nfa:'Test fixture',onTrade:intent=>{window.handoff=intent;}}));
    </script>` });
  });
  await page.goto(`${origin}/__report-handoff`);
  await page.locator('.report-execution-launcher').waitFor({ timeout: 15_000 });
  for (const kind of ['market', 'limit']) {
    await page.getByRole('button', { name: kind === 'market' ? /Market buy.*Fresh quote/ : /Limit buy/ }).click();
    await page.getByRole('button', { name: new RegExp(`Open manual ${kind} ticket`) }).click();
    const intent = await page.evaluate(() => window.handoff);
    assert.equal(intent.entryPrice, 229.07);
    assert.equal(intent.takeProfit, 236.6);
    assert.equal(intent.stopLoss, 228.742437);
    assert.equal(intent.orderType, kind);
    assert.match(intent.rationale, /risk acceptance/);
    assert.doesNotMatch(intent.rationale, /\bWAIT\b/);
  }
  console.log('PASS: actual saved-report Market and Limit actions preserve conditional levels after manual risk acceptance');
} finally { await browser.close(); }
