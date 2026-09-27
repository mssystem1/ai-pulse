// Exercises the actual Reown modal, not a replacement network-picker fixture.
// No wallet connection, signatures, payments or chain transactions.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => {
      // Match API roots only; /src/api.ts is a real application module.
      if (!/^\/(v1|api|healthz)\b/.test(new URL(route.request().url()).pathname)) return route.continue();
      return route.fulfill({ contentType: 'application/json', body: '{}',
        headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.goto('http://127.0.0.1:5178/portfolio', { waitUntil: 'domcontentloaded' });
    await page.locator('.network-picker').waitFor().catch(async error => {
      throw Error(`${error.message}\nPage errors: ${JSON.stringify(pageErrors)}\nRendered: ${(await page.locator('body').innerText()).slice(0, 1000)}`);
    });
    const networks = await page.evaluate(async () => {
      const { appKit, appKitEnabled } = await import('/src/appkit.tsx');
      if (!appKitEnabled) throw Error('Enable local AppKit configuration to test its real modal');
      await appKit.ready();
      await appKit.open({ view: 'Networks' });
      return appKit.getCaipNetworks('eip155').map(chain => chain.id);
    });
    assert.ok(networks.includes(4663), 'AppKit must recognize Robinhood');
    const modal = page.locator('w3m-modal');
    await modal.getByRole('button', { name: 'Robinhood Chain', exact: true }).click();
    const selected = await page.evaluate(async () => {
      // Keep SDK access in the application's main JS world. Importing it in
      // waitForFunction's isolated world creates another AppKit instance.
      const { appKit } = await import('/src/appkit.tsx');
      for (let attempt = 0; attempt < 100 && appKit.getChainId() !== 4663; attempt++)
        await new Promise(resolve => setTimeout(resolve, 100));
      return { id: appKit.getChainId(), caip: appKit.getCaipNetwork()?.caipNetworkId };
    });
    assert.deepEqual(selected, { id: 4663, caip: 'eip155:4663' });
    assert.equal(await page.getByText('This app doesn’t support your current network.', { exact: false }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    console.log(`PASS actual AppKit ${width}px: Robinhood listed and selected without unsupported-network rejection`);
    await page.close();
  }
} finally { await browser.close(); }
