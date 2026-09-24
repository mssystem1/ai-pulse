// Deterministic local fixtures only. Blocks all non-local requests; never connects a wallet.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin = 'http://127.0.0.1:5178';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('.codex-ui-review', { recursive: true });
const bucket = {count:3,partial:1,firstAt:'2026-09-10T00:00:00Z',lastAt:'2026-09-12T00:00:00Z'};
const fixture = {version:1,scope:'platform',persistence:'durable',asOf:'2026-09-12T12:00:00Z',stale:false,research:{global:{...bucket,count:12},prediction:{...bucket,count:12},risk:{...bucket,count:12}},networks:[['196','X Layer'],['8453','Base'],['42161','Arbitrum'],['5042002','Arc Testnet']].map(([chain,label])=>({chain:`eip155:${chain}`,label,environment:label==='Arc Testnet'?'testnet':'mainnet',research:{global:bucket,prediction:bucket,risk:bucket}}))};
for (const service of ['global','prediction','risk']) fixture.research[service].partial=4;
fixture.execution={spot:{count:2,byChain:[{count:2,firstAt:bucket.firstAt,lastAt:bucket.lastAt,amount:'12.340000',symbol:'USDC',chain:'eip155:8453',label:'Base'}]},autopilot:null};
try {
  for (const width of process.env.UI_WIDTHS?.split(',').map(Number)||[360,390,768,1440]) for (const theme of process.env.UI_THEMES?.split(',')||['xlayer','base','arbitrum','arc-testnet','robinhood']) {
    const page = await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    const errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>requests.push(request.url()));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/v1/public/activity') return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(fixture)});
      if(url.origin===origin)return route.continue();
      return route.abort();
    });
    await page.goto(`${origin}/landing?pulseTheme=${theme}`,{waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Read the market. Trade your way.'}).waitFor();
    await page.getByRole('table').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-pulse-theme'),theme);
    assert.equal(await page.locator('.landing-research-services article').count(),3);
    assert.match(await page.locator('.landing-activity-table').innerText(),/Arc Testnet/);
    assert.equal(await page.locator('.landing-research-count>strong').first().innerText(),'12');
    assert.match(await page.locator('.landing-execution-stats').innerText(),/12.34 USDC/);
    const launch=await page.getByRole('link',{name:'Launch app',exact:false}).first().getAttribute('href');
    assert.equal(new URL(launch).pathname,'/portfolio');
    assert.equal(new URL(launch).searchParams.get('pulseTheme'),theme);
    assert.equal(await page.locator('.nav-right,.network-picker,.wallet-trigger').count(),0);
    assert.equal(requests.some(url=>/\/src\/(wallet|appkit)\.|\/v1\/(autopilot|report-history|activity|account)/.test(url)),false);
    await page.getByRole('button',{name:'Autopilot',exact:true}).click();
    assert.match(await page.locator('.landing-mode-copy').innerText(),/Working autonomously/);
    await page.getByRole('button',{name:'Spot trading',exact:true}).click();
    assert.match(await page.locator('.landing-mode-copy').innerText(),/Your decision/);
    assert.equal(await page.locator('.signal-strands').evaluate(el=>getComputedStyle(el).animationName),'none');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    assert.equal(overflow,false,`${theme} ${width} overflow`);
    assert.deepEqual(errors,[]);
    if(width===360 && theme==='xlayer'){
      await page.locator('.landing-skip').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>document.activeElement?.id),'landing-main');
      await page.getByRole('button',{name:'Choose appearance',exact:true}).click();
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Choose appearance');
      const outcomes=await page.evaluate(async snapshot=>{
        const {parsePublicActivity}=await import('/src/PublicActivity.tsx');
        const invalid=change=>{const copy=structuredClone(snapshot);change(copy);return parsePublicActivity(copy)===null;};
        return [invalid(copy=>copy.persistence='memory'),invalid(copy=>copy.research.global.count++),invalid(copy=>copy.networks.push(copy.networks[0])),invalid(copy=>copy.execution.spot.byChain[0].chain='eip155:5042002'),invalid(copy=>copy.execution.spot.count++),invalid(copy=>copy.execution.spot.byChain[0]=null),invalid(copy=>copy.stale='false')];
      },fixture);
      assert.deepEqual(outcomes,Array(7).fill(true),'malformed, duplicate, testnet execution and mismatched counts are rejected');
    }
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`.codex-ui-review/landing-${theme}-${width}.png`,fullPage:width===390});
    if(width===390)await page.screenshot({path:`.codex-ui-review/landing-hero-${theme}-390.png`});
    console.log(`PASS landing ${theme} ${width}px: cross-chain research, CTA, motion, no wallet initialization or overflow`);
    await page.close();
  }
  const unavailable=await browser.newPage();
  await unavailable.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('storage blocked');};Storage.prototype.setItem=()=>{throw new Error('storage blocked');};});
  await unavailable.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/v1/public/activity')return route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{}'});
    return url.origin===origin ? route.continue() : route.abort();
  });
  await unavailable.goto(`${origin}/landing?pulseTheme=base`,{waitUntil:'networkidle'});
  assert.equal(await unavailable.locator('html').getAttribute('data-pulse-theme'),'base','incoming theme survives blocked preference storage');
  await unavailable.getByRole('button',{name:'Retry statistics'}).waitFor();
  assert.deepEqual(await unavailable.locator('.landing-research-count>strong').allTextContents(),['—','—','—']);
  assert.equal(await unavailable.locator('.landing-activity-table').count(),0);
  await unavailable.close();
  console.log('PASS unavailable activity: no fabricated zero totals; retry remains available');
} finally { await browser.close(); }
