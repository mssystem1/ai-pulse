// Local-only UI regression fixtures. No real wallet, payment or external request.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin = 'http://127.0.0.1:5178';
const liveChart = process.env.LIVE_CHART_CHECK === '1';
let liveMarket;
if(liveChart) {
  const read=async endpoint=>{const response=await fetch(`https://www.okx.com/api/v5/market/${endpoint}`,{signal:AbortSignal.timeout(15000)});const body=await response.json();assert.equal(response.status,200);assert.equal(body.code,'0');return body.data;};
  const [rows,tickers]=await Promise.all([read('candles?instId=ETH-USDT&bar=1H&limit=100'),read('ticker?instId=ETH-USDT')]);
  const t=tickers[0];
  liveMarket={candles:rows.map(row=>({ts:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5]),confirmed:row[8]==='1'})).reverse(),ticker:{instId:t.instId,last:Number(t.last),high24h:Number(t.high24h),low24h:Number(t.low24h),volCcy24h:Number(t.volCcy24h),change24hPct:(Number(t.last)/Number(t.open24h)-1)*100,ts:t.ts}};
  console.log('Read-only OKX chart snapshot:',liveMarket.candles.length,'candles; no wallet or payment.');
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('.codex-ui-review', { recursive: true });
try {
  for (const context of liveChart?['chart-live']:['telegram', 'telegram-offline', 'docs', 'portfolio', 'global-chart', 'chart', 'shared-global', 'shared-prediction', 'shared-revoked']) {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 650, isMobile: width < 650 });
      const errors = [];
      const historyRequests = [];
      let historyResponse = 'ok';
      page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
      page.on('response', response => { if(response.status()>=400) console.error('Browser resource:',response.status(),new URL(response.url()).pathname); });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        const json = body => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
        if (url.origin === origin && url.pathname === '/__product_review') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="root" style="max-width:1200px;margin:auto;padding:12px"></main><script type="module">
          import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
          await import('/src/styles.css');await import('/src/appearance.css');
          const r=await import('/node_modules/.vite/deps/react.js'),d=await import('/node_modules/.vite/deps/react-dom_client.js');const React=r.default||r,dom=d.default||d;
          const workspace=await import('/src/V6Workspaces.tsx'),portfolio=await import('/src/OverviewWorkspace.tsx'),chart=await import('/src/SpotMarketPreview.tsx'),shared=await import('/src/SharedReport.tsx');
          const c='${context}';if(c.startsWith('shared'))history.replaceState(null,'','#share='+'a'.repeat(40));if(c==='global-chart')history.replaceState(null,'','/global');const app=c==='global-chart'?await import('/src/App.tsx'):null;const Component=c.startsWith('telegram')?workspace.TelegramWorkspace:c==='docs'?workspace.DocsWorkspace:c==='portfolio'?portfolio.OverviewWorkspace:c==='global-chart'?app.App:c.startsWith('shared')?shared.SharedReport:chart.SpotMarketPreview;
          dom.createRoot(document.getElementById('root')).render(React.createElement(Component,{lang:'en',networkKey:'base',wallet:'0x'+'1'.repeat(40),health:'ONLINE',onNavigate:()=>{},onRefreshBalances:async()=>{},pair:'ETH-USDT',timeframe:'1H',markers:c==='chart-live'?[]:[{id:'b',side:'buy',price:106,ts:Date.now()-10*3600000,txHash:'0xfixturebuy'},{id:'s',side:'sell',price:111,ts:Date.now()-5*3600000,txHash:'0xfixturesell'}]}));
        </script></body></html>` });
        if (url.origin === origin) return route.continue();
        if (url.pathname.includes('/v1/shared/reports/')) {
          if (context === 'shared-revoked') return route.fulfill({status:404,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{}'});
          return json({report:{service:context==='shared-prediction'?'prediction_analysis_standard':'analysis_standard',tier:'standard',...(context==='shared-prediction'?{predictionContext:{markets:[]}}:{}),analysis:{headline:'Receipt-linked research',summary:'Readable report fixture',bias:'neutral',confidence:60}}});
        }
        if (url.pathname.includes('/telegram/status')) return json({ configured: context !== 'telegram-offline', botUrl: 'https://t.me/pulsemi_bot', botUsername: 'pulsemi_bot', durableDelivery: context !== 'telegram-offline' });
        if (url.pathname.includes('/ticker')) return json({ ticker: liveMarket?.ticker||{ instId: url.searchParams.get('instId')||'ETH-USDT', last: 110, change24hPct: 1, high24h: 115, low24h: 99, volCcy24h: 100000, ts: String(Date.now()) } });
        if (url.pathname.includes('/candles')) {
          if(liveMarket) return json({candles:liveMarket.candles});
          const before=Number(url.searchParams.get('before'));
          if(before) {
            historyRequests.push(before);
            if(historyResponse==='error') return route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{}'});
            if(historyResponse==='empty') return json({candles:[]});
          }
          const interval=({'15m':900000,'1H':3600000,'4H':14400000,'1D':86400000})[url.searchParams.get('bar')]||3600000;
          const anchor=Math.floor((before||Date.now())/interval)*interval;
          // Deterministic synthetic oscillations include red/green candles, wicks and varying volume.
          return json({ candles: Array.from({ length: 100 }, (_, i) => {
            const open=106+Math.sin(i*.53)*2.4+Math.cos(i*.17)*1.3, close=open+Math.sin(i*1.7)*1.1;
            return {ts:anchor-(99-i)*interval,open,high:Math.max(open,close)+.25+(i%4)*.12,low:Math.min(open,close)-.3-(i%3)*.16,close,volume:40+(i%11)*18,confirmed:true};
          }).filter(c=>!before||c.ts<before) });
        }
        if (url.pathname.includes('/activity')) return json({ activity: ['buy','sell'].map((side,i)=>({id:side,source:'spot',kind:'market_'+side,status:'confirmed',txHash:'0x'+side,pair:'ETH-USDT',fillSide:side,fillQuantity:1,fillQuoteValue:i?110:100,fillBaseAsset:'0xbase',fillQuoteAsset:'0xquote',createdAt:`2026-09-11T0${i}:00:00Z`})) });
        if (url.pathname.includes('/orders')) return json({ orders: [] });
        if (url.pathname.includes('/strategies')) return json({ strategies: [] });
        return json({}); // never forward an unknown external endpoint
      });
      await page.goto(`${origin}/__product_review`, { waitUntil: 'networkidle' });
      if (context.startsWith('telegram')) {
        await page.getByRole('heading', { name: 'Buttons, not commands' }).waitFor();
        assert.equal(await page.locator('.telegram-launch').count(), context === 'telegram' ? 1 : 0);
        if (context === 'telegram-offline') await page.getByText('Telegram is unavailable.', { exact: false }).waitFor();
      } else if (context === 'docs') {
        await page.getByRole('button', { name: 'Performance', exact: true }).click();
        assert.match(await page.locator('.docs-flow-visual').innerText(), /remaining cost is 100/);
        await page.getByRole('button', { name: 'Telegram', exact: true }).first().click();
        assert.match(await page.locator('.docs-flow-visual').innerText(), /generic Open App button/);
      } else if (context === 'portfolio') {
        await page.getByRole('heading', { name: 'Your PULSE portfolio' }).waitFor();
        await page.getByText('+10.00%', { exact: true }).waitFor();
        assert.equal(await page.locator('#reports').count(), 1);
      } else if(context==='global-chart') {
        await page.getByRole('button',{name:'Load free market data',exact:true}).click();
        await page.locator('.chart-card .candle-canvas canvas').first().waitFor();
        assert.equal(await page.locator('#pulse-chart').count(),0);
        await page.getByRole('button',{name:/Open market chart BTC-USDT/}).click();
        await page.locator('dialog .candle-canvas canvas').first().waitFor();
      } else if(context==='chart-live') {
        await page.locator('.candle-canvas canvas').first().waitFor();
        await page.getByRole('button',{name:'Open market chart ETH-USDT'}).click();
        await page.locator('dialog .candle-canvas canvas').first().waitFor();
        assert.equal(await page.locator('dialog .market-candle-chart').getAttribute('data-marker-count'),'0');
      } else if (context.startsWith('shared')) {
        await page.getByRole('heading', { name: 'Your report', exact: true }).waitFor();
        if (context === 'shared-revoked') await page.getByRole('heading', { name: 'Report unavailable' }).waitFor();
        else await page.getByText('Readable report fixture', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: /buy|connect wallet/i }).count(), 0);
      } else {
        await page.locator('.candle-canvas canvas').first().waitFor();
        assert.equal(await page.locator('.market-candle-chart').getAttribute('data-marker-count'),'2');
        await page.getByRole('button', { name: 'Open market chart ETH-USDT' }).click();
        await page.locator('dialog[open]').waitFor();
        await page.locator('dialog .candle-canvas canvas').first().waitFor();
        assert.equal(await page.locator('dialog .market-candle-chart').getAttribute('data-marker-count'),'2');
        const chart=page.locator('dialog .market-candle-chart');
        const rangeWidth=async()=>chart.evaluate(el=>Number(el.dataset.rangeTo)-Number(el.dataset.rangeFrom));
        const originalWidth=await rangeWidth();
        await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
        await page.waitForFunction(original=>{const el=document.querySelector('dialog .market-candle-chart');return Number(el?.getAttribute('data-range-to'))-Number(el?.getAttribute('data-range-from'))>original;},originalWidth);
        await page.getByRole('button',{name:'Reset view',exact:true}).click();
        await page.locator('dialog .candle-canvas').focus();
        await page.keyboard.press('ArrowLeft');
        const canvas=page.locator('dialog .candle-canvas');
        await canvas.scrollIntoViewIfNeeded();
        const bounds=await canvas.boundingBox();
        const readout=await page.locator('dialog .candle-time').textContent();
        await page.mouse.move(bounds.x+bounds.width*.4,bounds.y+bounds.height*.3);
        await page.waitForFunction(previous=>document.querySelector('dialog .candle-time')?.textContent!==previous,readout);
        const beforeGesture=await rangeWidth();
        if(width<650) {
          const cdp=await page.context().newCDPSession(page);
          const x=bounds.x+bounds.width*.4,y=bounds.y+bounds.height*.4;
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-24,y,id:1},{x:x+24,y,id:2}]});
          for(const offset of [30,36,42,48,54]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-offset,y,id:1},{x:x+offset,y,id:2}]});
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await cdp.detach();
        } else await page.mouse.wheel(0,-200);
        await page.waitForFunction(previous=>{const el=document.querySelector('dialog .market-candle-chart');return Number(el?.getAttribute('data-range-to'))-Number(el?.getAttribute('data-range-from'))<previous;},beforeGesture);
        await page.getByRole('button',{name:'Reset view',exact:true}).click();
        await page.locator('dialog summary').click();
        assert.match(await page.locator('dialog .chart-fill-history').innerText(), /BUY/);
        assert.match(await page.locator('dialog .chart-fill-history').innerText(), /SELL/);
        await page.getByRole('button',{name:'← Older',exact:true}).click();
        await page.locator('dialog .candle-canvas canvas').first().waitFor();
        assert.equal(historyRequests.length,1);
        assert.equal(await chart.getAttribute('data-marker-count'),'0');
        assert.equal(await page.locator('dialog .spot-chart-price').count(),0);
        await page.getByRole('button',{name:'← Older',exact:true}).click();
        await page.locator('dialog .candle-canvas canvas').first().waitFor();
        assert.ok(historyRequests[1]<historyRequests[0]);
        await page.getByRole('button',{name:'Newer →',exact:true}).click();
        await page.locator('dialog .candle-canvas canvas').first().waitFor();
        assert.equal(historyRequests[2],historyRequests[0]);
        await page.getByRole('button',{name:/Show buy fill/}).click();
        await page.locator('dialog .market-candle-chart[data-marker-count="1"] .candle-canvas canvas').first().waitFor();
        historyResponse='error';
        await page.getByRole('button',{name:'← Older',exact:true}).click();
        await page.getByText('Market data temporarily unavailable. Retry this range.',{exact:true}).waitFor();
        historyResponse='empty';
        await page.getByRole('button',{name:'Retry',exact:true}).click();
        await page.getByText('The provider returned no older candles for this range. Use Newer or Latest.',{exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'← Older',exact:true}).isDisabled(),true);
        await page.getByRole('button',{name:'Latest',exact:true}).click();
        await page.locator('dialog .spot-chart-price').waitFor();
        await page.locator('dialog .market-candle-chart[data-marker-count="2"] .candle-canvas canvas').first().waitFor();
        await page.screenshot({ path: `.codex-ui-review/chart-dark-${width}.png`, fullPage: true });
        await page.evaluate(()=>document.documentElement.setAttribute('data-pulse-theme','base'));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${context} overflow at ${width}`);
      assert.deepEqual(errors, [], `${context} runtime errors`);
      await page.screenshot({ path: `.codex-ui-review/${context}-${width}.png`, fullPage: true });
      console.log(`PASS ${context} ${width}px`);
      await page.close();
    }
  }
} finally { await browser.close(); }
