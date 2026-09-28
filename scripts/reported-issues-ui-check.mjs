// Synthetic API fixtures, no wallet connection or paid request.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel:'msedge', headless:true });
const origin='http://127.0.0.1:5178';
const report={service:'spot_analysis_premium',tier:'premium',instId:'BTC-USDT',timeframe:'1H',analysis:{bias:'neutral',confidence:40,headline:'Neutral report',summary:'Wait for confirmation'},executionPlan:{version:'test',pair:'BTC-USDT',timeframe:'1H',observedPrice:100,recommendation:{action:'wait'},buy:{trigger:99,stopLoss:110,takeProfit:120}}};
try {
  for(const width of [390,768,1440,1920]) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],pairRequests=[],routeRequests=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      const json=data=>route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
      if(url.origin===origin&&url.pathname==='/__report_harness')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script type="module">
        import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
        await import('/src/styles.css');const r=await import('/node_modules/.vite/deps/react.js'),d=await import('/node_modules/.vite/deps/react-dom_client.js');const React=r.default||r,dom=d.default||d;const {AnalysisReport}=await import('/src/Report.tsx');dom.createRoot(document.getElementById('root')).render(React.createElement(AnalysisReport,{data:${JSON.stringify(report)},nfa:'',onTrade:intent=>window.tradeIntent=intent}));</script></body></html>`});
      if(url.origin===origin&&!/^\/(v1|healthz)/.test(url.pathname))return route.continue();
      if(url.pathname.includes('telegram/status'))return json({configured:true,botUrl:'https://t.me/test_bot',botUsername:'test_bot',durableDelivery:true});
      if(url.pathname.includes('/shared/reports/'))return json({report:{service:'preflight',headline:'XDOG saved risk report',overallScore:69.5,grade:'C',verdict:'WARN',intelligence:{confidence:55,evidenceCoverage:55,components:[],unknowns:['Holder distribution unknown']},checklist:[]}});
      if(url.pathname.includes('/trading/pairs')){pairRequests.push(url.search);return json({pairs:['BTC','ETH'].map(symbol=>({pair:`${symbol}-USDT`,analysisBase:symbol,executionPair:`${symbol}/USDC`,token:{address:'0x'+'1'.repeat(40),symbol,name:symbol}}))});}
      if(url.pathname.includes('/resolve-pair')){routeRequests.push(url.search);return json({available:url.searchParams.get('pair')==='BTC-USDT',reason:'No liquidity for this pair',base:{address:'0x'+'1'.repeat(40),symbol:'BTC',decimals:18},quote:{address:'0x'+'2'.repeat(40),symbol:'USDC',decimals:6}});}
      if(url.pathname.includes('/opportunities'))return json({candidates:['DOGE-USDT','BTC-USDT','ETH-USDT'].map((pair,i)=>({pair,timeframe:'1H',score:90-i*5,strategyType:'trend_following',technicalReady:true,reason:'Candle condition',mark:100,change24hPct:1,rsi14:55,volumeRatio:1.3,fetchedAt:new Date().toISOString(),priceHistory:[90,95,100]}))});
      if(url.pathname.includes('/instruments'))return json({instruments:['BTC-USDT','ETH-USDT'].map(instId=>({instId,baseCcy:instId.split('-')[0],quoteCcy:'USDT'}))});
      if(url.pathname.includes('/ticker'))return json({ticker:{instId:url.searchParams.get('instId'),last:100,change24hPct:1,high24h:105,low24h:95,volCcy24h:1000,ts:String(Date.now())}});
      if(url.pathname.includes('/candles'))return json({candles:Array.from({length:80},(_,i)=>({ts:Date.now()-(80-i)*3600000,open:99,close:100,high:101,low:98,volume:100}))});
      return json({});
    });
    await page.goto(`${origin}/telegram`);await page.locator('.telegram-user-guide').waitFor();
    const alignment=await page.evaluate(()=>{const nav=document.querySelector('.app .nav').getBoundingClientRect(),body=document.querySelector('.telegram-user-guide').getBoundingClientRect();return {left:Math.abs(nav.left-body.left),right:Math.abs(nav.right-body.right),overflow:document.documentElement.scrollWidth>innerWidth+1};});
    assert.ok(alignment.left<3&&alignment.right<3,JSON.stringify({width,alignment}));assert.equal(alignment.overflow,false);
    await page.screenshot({path:`.codex-ui-review/issues-telegram-${width}.png`});
    await page.goto(`${origin}/global`);await page.locator('.global-market-reference').waitFor();
    await page.locator('.global-market-reference .shortlist-sparkline').waitFor();
    await page.locator('.global-market-workspace [data-status="available"]').waitFor();
    await page.locator('#market-pair').click();
    await page.locator('.picker-layer [data-status="available"]').waitFor();
    await page.locator('.picker-layer [data-status="unavailable"]').waitFor();
    assert.equal(await page.locator('.picker-layer .live-chip').filter({hasText:/^LIVE$/}).count(),0);
    assert.equal(routeRequests.filter(query=>new URLSearchParams(query).get('pair')==='BTC-USDT').length,1,'selected market and visible catalog share the route check');
    await page.locator('.picker-header .icon-button').click();
    assert.equal(await page.getByRole('button',{name:/Load free market data/}).count(),0);
    await page.locator('#market-timeframe').click();
    const weekly=page.getByRole('option',{name:/1 week/});await weekly.scrollIntoViewIfNeeded();
    assert.equal(await weekly.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'weekly option is not clipped or covered');
    await weekly.click();await page.waitForFunction(()=>document.querySelector('.global-market-workspace .chart-head')?.textContent.includes('1W'));
    await page.locator('.global-market-reference .shortlist-sparkline').waitFor();
    await page.locator('#market-timeframe').click();await page.getByRole('option',{name:/1 hour/}).click();
    await page.locator('.workspace-discovery>summary').click();
    assert.match(await page.getByRole('button',{name:/Explore technical candidates/}).getAttribute('class'),/active/);
    await page.locator('.potential-gainer-grid article').first().scrollIntoViewIfNeeded();
    await page.locator('.potential-gainer-grid article [data-status="available"]').first().waitFor();
    assert.match(await page.locator('.potential-gainer-grid article').first().innerText(),/BTC-USDT/,'mapped markets precede higher-ranked research-only markets');
    await page.getByRole('button',{name:'Select for analysis',exact:true}).nth(1).click();
    await page.waitForFunction(()=>document.activeElement?.id==='global-report-controls');
    assert.equal(await page.locator('.workspace-discovery').evaluate(el=>el.open),false);
    await page.locator('.global-market-reference .shortlist-sparkline').click();
    await page.locator('dialog[open]').waitFor();await page.getByRole('button',{name:'Close chart',exact:true}).click();
    assert.equal(await page.locator('dialog[open]').count(),0);
    await page.screenshot({path:`.codex-ui-review/issues-global-${width}.png`});
    await page.goto(`${origin}/spot`);await page.locator('.workspace-discovery>summary').click();
    assert.match(await page.getByRole('button',{name:/Explore technical candidates/}).getAttribute('class'),/active/);
    await page.getByRole('button',{name:'Load BTC-USDT in Spot ticket'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Load DOGE-USDT in Spot ticket'}).count(),0);
    await page.evaluate(()=>{localStorage.setItem('pulse:opportunity-assessments:xlayer',JSON.stringify([{pair:'BTC-USDT',timeframe:'1H',bias:'neutral',confidence:40,recommended:false,generatedAt:new Date().toISOString()},{pair:'ETH-USDT',timeframe:'1H',bias:'bullish',confidence:72,recommended:true,generatedAt:new Date().toISOString()}]));window.dispatchEvent(new Event('pulse:opportunity-assessment'));});
    assert.match(await page.locator('.potential-gainer-grid article').filter({hasText:'BTC-USDT'}).innerText(),/40%/);
    await page.getByRole('button',{name:/Recent bullish reports/}).click();
    await page.getByRole('button',{name:'Load ETH-USDT in Spot ticket'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Load BTC-USDT in Spot ticket'}).count(),0);
    await page.getByRole('navigation',{name:'Spot trading navigation'}).getByRole('button',{name:'Dashboard',exact:true}).click();
    assert.equal(await page.locator('section[aria-label="Trade setup workspace"]').isVisible(),false);
    assert.equal(await page.locator('section[aria-label="Spot dashboard"]').isVisible(),true);
    await page.screenshot({path:`.codex-ui-review/rework-spot-${width}.png`});
    await page.goto(`${origin}/autopilot`);
    await page.getByRole('button',{name:'Create new Autopilot',exact:true}).click();
    await page.getByRole('button',{name:'Use for Autopilot',exact:true}).first().waitFor();
    await page.locator('#autopilot-execution-pair').click();
    await page.locator('.picker-layer [data-status="available"]').waitFor();
    await page.locator('.picker-layer [data-status="unavailable"]').waitFor();
    assert.equal(await page.getByText('VERIFY ROUTE',{exact:true}).count(),0);
    await page.locator('.picker-header .icon-button').click();
    assert.equal(await page.locator('.opportunity-radar.autopilot .potential-gainer-grid article').filter({hasText:'DOGE-USDT'}).count(),0);
    assert.ok(pairRequests.some(query=>query.includes('custody=erc20')));
    await page.screenshot({path:`.codex-ui-review/rework-autopilot-${width}.png`});
    await page.getByRole('button',{name:'On-chain activity',exact:true}).click();
    assert.equal(await page.locator('#autopilot-configuration').isVisible(),false);
    assert.equal(await page.locator('.autopilot-chain-activity').isVisible(),true);
    await page.goto(`${origin}/safety`);await page.getByRole('heading',{name:'Paid report history'}).waitFor();
    await page.goto(`${origin}/shared-report#share=${'a'.repeat(32)}`);await page.getByRole('heading',{name:'XDOG saved risk report'}).waitFor();
    await page.goto(`${origin}/__report_harness`);const manual=page.getByRole('button',{name:/Open manual market ticket/});await manual.click();
    const intent=await page.evaluate(()=>window.tradeIntent);assert.equal(intent.pair,'BTC-USDT');assert.equal(intent.stopLoss,undefined);assert.equal(intent.takeProfit,undefined);assert.match(intent.rationale,/own risk/);
    assert.deepEqual(errors,[]);console.log(`PASS reported flows ${width}px`);await page.close();
  }
} finally { await browser.close(); }
