// Real application navigation, isolated API fixtures. No wallet or paid calls.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const origin = 'http://127.0.0.1:5178';
await mkdir('.codex-ui-review', { recursive: true });
try {
  for (const width of [390, 1440]) for (const theme of ['base', 'robinhood']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !/^\/(v1|api|healthz|robinhood)\b/.test(url.pathname)) return route.continue();
      return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(
        url.pathname.includes('instruments') ? { instruments: [{ instId: 'ETH-USDT', baseCcy: 'ETH', quoteCcy: 'USDT' }] } : {}) });
    });
    await page.goto(`${origin}/portfolio?pulseTheme=${theme}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.network-picker').waitFor();
    await page.locator('.network-picker').click();
    const option = page.getByRole('option').filter({ hasText: 'Robinhood Chain' });
    await option.waitFor();
    assert.match(await option.innerText(), /USDG/);
    assert.equal(await option.locator('svg[aria-label="Robinhood Chain"]').count(), 1);
    await option.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.codex-ui-review/robinhood-network-${theme}-${width}.png` });
    await option.click();
    assert.equal(await page.locator('.network-picker-copy>b').innerText(), 'Robinhood Chain');
    assert.equal(await page.locator('html').getAttribute('data-pulse-theme'), theme);
    assert.equal(await page.evaluate(() => localStorage.getItem('pulse:selected-network')), 'robinhood');
    for (const path of ['portfolio', 'global', 'prediction', 'safety', 'spot', 'autopilot', 'telegram', 'docs']) {
      await page.goto(`${origin}/${path}?pulseTheme=${theme}`, { waitUntil: 'domcontentloaded' });
      await page.locator('main h1:visible').waitFor();
      assert.equal(await page.locator('.network-picker-copy>b').innerText(), 'Robinhood Chain', `${path}: selection survives navigation`);
      assert.equal(await page.locator('.network-picker-state').innerText(), 'USDG');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${path}: overflow`);
    }
    await page.getByRole('button', { name: 'Choose appearance', exact: true }).click();
    await page.locator('.appearance-menu button').filter({ hasText: 'Dawn' }).click();
    assert.equal(await page.locator('html').getAttribute('data-pulse-theme'), 'robinhood');
    assert.equal(await page.locator('.network-picker-copy>b').innerText(), 'Robinhood Chain');
    assert.deepEqual(errors, []);
    console.log(`PASS Robinhood navigation ${theme} ${width}px: selectable, correct logo/USDG, persisted across eight routes, Dawn independent`);
    await page.close();
  }
} finally { await browser.close(); }
