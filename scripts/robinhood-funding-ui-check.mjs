// Synthetic browser only. Blocks external requests; never uses a real wallet.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const origin = 'http://127.0.0.1:5178';
const owner = '0x1111111111111111111111111111111111111111';
await mkdir('.codex-ui-review', { recursive: true });
try {
  for (const width of [390, 1440]) for (const theme of ['xlayer', 'base', 'arbitrum', 'arc-testnet', 'robinhood']) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors = [], calls = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'rpc.mainnet.chain.robinhood.com') {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' } });
        const request = route.request().postDataJSON();
        const result = request.method === 'eth_chainId' ? '0x1237' : request.method === 'eth_blockNumber' ? '0x65' : request.method === 'eth_getTransactionReceipt' ? {
          transactionHash: `0x${'a'.repeat(64)}`, blockHash: `0x${'b'.repeat(64)}`, blockNumber: '0x64', transactionIndex: '0x0', from: owner,
          to: '0x6e2a35a7ad683cf634d91492d73bb7ff774c6919', contractAddress: null, cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', effectiveGasPrice: '0x5f5e100',
          logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: width === 390 ? '0x1' : '0x0', type: '0x2',
        } : null;
        return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
      }
      if (url.origin === origin && url.pathname === '/__funding') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-pulse-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
        window.fundingCalls=[];window.ethereum={request:async({method,params})=>{window.fundingCalls.push(method);const values={eth_chainId:'0x1237',eth_accounts:['${owner}'],eth_call:'0x',eth_estimateGas:'0x186a0',eth_gasPrice:'0x5f5e100',eth_getBalance:'0x38d7ea4c68000',eth_sendTransaction:'0x${'a'.repeat(64)}'};return values[method]}};
        await import('/src/styles.css');await import('/src/appearance.css');const r=await import('/node_modules/.vite/deps/react.js'),d=await import('/node_modules/.vite/deps/react-dom_client.js');const React=r.default||r,dom=d.default||d;const {SwapPanel}=await import('/src/SwapPanel.tsx');
        dom.createRoot(document.getElementById('root')).render(React.createElement(SwapPanel,{lang:'en',open:true,address:'${owner}',walletName:'Fixture wallet',networkKey:'robinhood',balances:{native:.001,payment:.5},gatewayBalance:null,loadingBal:false,onClose:()=>{},onDisconnect:()=>{},onRefresh:()=>{},onOkxConnect:()=>{},onOtherWalletConnect:()=>{},onCircleConnect:async()=>{}}));
      </script></body></html>` });
      if (url.pathname === '/v1/dex/robinhood/native-usdg') {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' } });
        calls.push(url.pathname); const input = route.request().postDataJSON();
        return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ network: 'robinhood', chainId: 4663,
          fromAmount: input.amount, toAmount: '300000', minToAmount: '298500', toToken: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
          priceImpactPercent: '0.01', route: ['Uniswap V3'], expiresAt: Date.now() + 45000,
          transaction: { from: owner, to: '0x6e2a35a7ad683cf634d91492d73bb7ff774c6919', value: input.amount, data: '0xf2c4269600' } }) });
      }
      if (url.origin === origin) return route.continue();
      return route.abort();
    });
    await page.goto(`${origin}/__funding`);
    await page.getByRole('heading', { name: 'Swap ETH → USDG' }).waitFor();
    assert.equal(await page.getByText('Get live native-USDC quote').count(), 0);
    const input = page.getByLabel('ETH to USDG funding amount');
    await input.fill('0'); await page.getByRole('button', { name: 'Get live ETH → USDG quote' }).click();
    await page.getByRole('alert').filter({ hasText: 'positive ETH' }).waitFor(); assert.equal(calls.length, 0);
    await input.fill('0.0001'); await page.getByRole('button', { name: 'Get live ETH → USDG quote' }).click();
    await page.getByText('0.2985 USDG', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.fundingCalls)).includes('eth_sendTransaction'), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await page.locator('.robinhood-funding').evaluate(el => {
      const cards = el.querySelectorAll('.swap-asset-card');
      const arrow = el.querySelector('.swap-arrow').getBoundingClientRect();
      return arrow.top >= cards[0].getBoundingClientRect().bottom && arrow.bottom <= cards[1].getBoundingClientRect().top;
    }), true, 'funding arrow must sit between assets, not over explanatory text');
    await page.screenshot({ path: `.codex-ui-review/robinhood-funding-${theme}-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Review & swap in wallet' }).click();
    await page.getByRole('status').filter({ hasText: width === 390 ? 'Swap confirmed; balances refreshed' : 'Swap reverted; check the transaction details' }).waitFor();
    assert.equal((await page.evaluate(() => window.fundingCalls)).filter(x => x === 'eth_sendTransaction').length, 1);
    assert.deepEqual(errors, []);
    console.log(`PASS Robinhood funding ${theme} ${width}px: USDG quote, validation, wallet simulation, one synthetic submission, no overflow`);
    await page.close();
  }
} finally { await browser.close(); }
