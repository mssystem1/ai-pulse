// Local recovery/context regressions. Synthetic handles only; no real signing or payments.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const origin='http://127.0.0.1:5178';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
try {
  for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}}), errors=[],reportRequests=[],posts=[];
    let holdBase=false,baseReleases=[],baseStarted=()=>{};
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      const json=data=>route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body:JSON.stringify(data)});
      if(url.origin===origin && url.pathname==='/__portfolio_state')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      await import('/src/styles.css');const r=await import('/node_modules/.vite/deps/react.js'),d=await import('/node_modules/.vite/deps/react-dom_client.js');const React=r.default||r,dom=d.default||d;const {OverviewWorkspace}=await import('/src/OverviewWorkspace.tsx');
      localStorage.setItem('pulse:report-history:spot:base',JSON.stringify(${JSON.stringify(ids.map((jobId,index)=>({jobId,recoveryToken:`fixture-token-${String(index).repeat(40)}`,label:`Saved ${index?'beta':'alpha'}`,createdAt:'2026-09-12T10:00:00Z',tier:'standard'})))}));
      const balance=async()=>{};function Harness(){const [context,setContext]=React.useState({networkKey:'base',wallet:'0x'+'1'.repeat(40)});window.switchContext=setContext;return React.createElement(OverviewWorkspace,{...context,health:'…',lang:'en',onRefreshBalances:balance,onNavigate:tab=>{window.lastNavigation=tab;}})}dom.createRoot(document.getElementById('root')).render(React.createElement(Harness));</script></body></html>`});
      if(url.origin===origin)return route.continue();
      if(request.method()==='POST')posts.push(url.pathname);
      if(url.pathname.includes('/v1/jobs/')){
        reportRequests.push({url:url.href,token:request.headers()['pulse-recovery-token']});
        return json({report:{service:'spot_analysis_standard',tier:'standard',instId:'ETH-USDT',analysis:{headline:'Exactly selected beta',summary:'Only the selected saved deliverable is shown.',bias:'neutral',confidence:60}}});
      }
      const network=url.searchParams.get('network');
      if(network==='base' && holdBase){baseStarted();await new Promise(resolve=>{baseReleases.push(resolve);});}
      if(url.pathname.includes('/activity'))return json({activity:[{id:network,kind:'vault_fund',source:'autopilot',status:'confirmed',pair:network==='base'?'OLD-BASE':'NEW-ARB',createdAt:'2026-09-12T10:00:00Z'}]}).catch(()=>{});
      if(url.pathname.includes('/orders'))return json({orders:[]}).catch(()=>{});
      if(url.pathname.includes('/strategies'))return json({strategies:network==='base'?[{id:'allocation-a',vault:'0x'+'3'.repeat(40),pair:'ETH-USDT',network:'base',portfolioValueAtomic:'300000',settlementDecimals:6,settlementSymbol:'USDC',paused:true},{id:'allocation-b',vault:'0x'+'4'.repeat(40),pair:'BTC-USDT',network:'base',portfolioValueAtomic:'700000',settlementDecimals:6,settlementSymbol:'USDC',paused:true}]:[]}).catch(()=>{});
      return json({});
    });
    await page.goto(`${origin}/__portfolio_state`,{waitUntil:'networkidle'});
    assert.equal(await page.getByText('API is unavailable.',{exact:false}).count(),0);
    await page.locator('.portfolio-allocation').waitFor();
    assert.match(await page.locator('.portfolio-allocation').innerText(),/0.3 USDC/);
    assert.match(await page.locator('.portfolio-allocation').innerText(),/70.0%/);
    assert.equal(await page.locator('.allocation-bar>span').count(),2);
    assert.equal(await page.locator('.portfolio-allocation').innerText().then(text=>text.includes('300000')),false,'no atomic units in allocation');
    await page.locator('.overview-report-list button').filter({hasText:'Saved beta'}).click();
    await page.getByRole('dialog',{name:'Saved research report'}).waitFor();
    await page.getByText('Exactly selected beta',{exact:true}).waitFor();
    assert.equal(reportRequests.length,1);assert.ok(reportRequests[0].url.includes(ids[1]));
    assert.equal(reportRequests[0].url.includes('fixture-token'),false);assert.equal(reportRequests[0].token,`fixture-token-${'1'.repeat(40)}`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog').count(),0);
    assert.match(await page.evaluate(()=>document.activeElement?.textContent),/Saved beta/);
    assert.deepEqual(posts,[],'opening a saved report creates no payment or job');
    // Hold one old-network response; new context must be visible before it resolves.
    holdBase=true;
    const started=new Promise(resolve=>{baseStarted=resolve;});
    await page.getByRole('button',{name:/Refresh/}).first().click();await started;
    await page.evaluate(()=>window.switchContext({networkKey:'arbitrum',wallet:'0x'+'2'.repeat(40)}));
    await page.getByText('NEW-ARB',{exact:true}).waitFor();
    holdBase=false;for(const release of baseReleases)release();
    await page.waitForTimeout(200);
    assert.equal(await page.getByText('OLD-BASE',{exact:true}).count(),0);
    assert.equal(await page.locator('.portfolio-allocation').count(),0,'old-chain allocation does not survive context change');
    await page.locator('.overview-activity-list button').first().click();assert.equal(await page.evaluate(()=>window.lastNavigation),'autopilot');
    assert.deepEqual(errors,[]);
    console.log(`PASS Portfolio state ${width}px: exact report, header-only capability, no payment, focus restored, stale wallet/network response rejected, correct activity destination`);
    await page.close();
  }
}finally{await browser.close();}
