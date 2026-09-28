// Public catalog fixtures only: no wallet, real quotes, or external requests.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin='http://127.0.0.1:5178';
const catalog=[['XBSP','tokenized_stock'],['XBE','tokenized_stock'],['CRV','crypto'],['COMP','crypto'],['XSPY','tokenized_etf'],['PAXG','rwa']].map(([base,assetClass],index)=>({pair:base+'-USDT',analysisBase:base,assetClass,executionPair:base+'/USDC',token:{address:'0x'+String(index+1).repeat(40),symbol:base,name:base,decimals:18}}));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 for(const width of [390,1440]) for(const mode of ['global','spot','autopilot']) {
  const page=await browser.newPage({viewport:{width,height:950}}); const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   const json=data=>route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
   if(url.origin===origin&&url.pathname==='/__catalog_test')return route.fulfill({contentType:'text/html',body:`<!doctype html><html data-pulse-theme="base"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    await import('/src/styles.css');await import('/src/appearance.css');
    const R=await import('/node_modules/.vite/deps/react.js'),D=await import('/node_modules/.vite/deps/react-dom_client.js');const React=R.default||R,dom=D.default||D;
    const {MarketPairPicker,ExecutionPairPicker}=await import('/src/Pickers.tsx');
    function App(){const [network,setNetwork]=React.useState('arbitrum');return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>setNetwork('base')},'Switch to Base'),React.createElement('${mode}'==='global'?MarketPairPicker:ExecutionPairPicker,{id:'pair',networkKey:network,lang:'en',value:'CRV-USDT',custody:'${mode}'==='autopilot'?'erc20':'wallet',onSelect:item=>{window.selected=item.pair||item.instId;}}));}
    dom.createRoot(document.getElementById('root')).render(React.createElement(App));</script></body></html>`});
   if(url.origin===origin)return route.continue();
   if(url.pathname.endsWith('/pairs'))return json({pairs:catalog});
   if(url.pathname.endsWith('/instruments')){
    requests.push(url.search);
    const rows=[...Array.from({length:85},(_,i)=>({instId:`TEST${i}-USDT`,baseCcy:`TEST${i}`,quoteCcy:'USDT',assetClass:'crypto'})),...catalog.map(p=>({instId:p.pair,baseCcy:p.analysisBase,quoteCcy:'USDT',assetClass:p.assetClass}))];
    return json({instruments:rows.slice(0,Number(url.searchParams.get('limit')))});
   }
   if(url.pathname.endsWith('/resolve-pair')){
    requests.push(url.search);
    await new Promise(resolve=>setTimeout(resolve,url.searchParams.get('pair')==='CRV-USDT'?80:10));
    return json({available:url.searchParams.get('network')==='arbitrum'&&!['XBSP-USDT','XBE-USDT'].includes(url.searchParams.get('pair')),reason:'No route fixture'});
   }
   return json({});
  });
  await page.goto(origin+'/__catalog_test'); await page.locator('#pair').click();
   const rows=page.locator('.picker-results .pair-item');
   const routeFilters=page.getByRole('group',{name:'Route availability'});
   assert.equal(await routeFilters.getByRole('button',{name:/^Route available/}).getAttribute('aria-pressed'),'true','route availability is selected by default');
   await page.getByText(/Route scan complete/).waitFor();
   assert.equal(await rows.count(),4,'default view includes only verified routes');
   await routeFilters.getByRole('button',{name:'All assets',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.picker-results .pair-item')?.textContent.includes('CRV')&&document.querySelector('.picker-results .pair-item [data-status="available"]'));
  assert.match(await rows.first().innerText(),/CRV/,'available crypto moves ahead of unavailable stock');
  const categories=page.getByRole('group',{name:'Asset class'});
  await categories.getByRole('button',{name:/^Tokenized stock/}).click();
  assert.equal(await rows.count(),2);
  assert.match(await rows.first().innerText(),/XBSP/);
  await categories.getByRole('button',{name:/^Tokenized ETF/}).click();
  assert.equal(await rows.count(),1);assert.match(await rows.first().innerText(),/XSPY/);
  await page.locator('.picker-results [data-status="available"]').waitFor();
  await categories.getByRole('button',{name:/^RWA/}).click();
  assert.equal(await rows.count(),1);assert.match(await rows.first().innerText(),/PAXG/);
  await categories.getByRole('button',{name:/^All/}).click();
   if(mode==='global')assert.equal(await rows.count(),91,'category assets after the old 80-row cutoff remain accessible');
   await routeFilters.getByRole('button',{name:/^Route available/}).click();
   await page.getByText(/Route scan complete/).waitFor();
   assert.equal(await rows.count(),4,'route filter scans hidden pairs and excludes unavailable routes');
   await categories.getByRole('button',{name:/^Tokenized stock/}).click();
   assert.equal(await rows.count(),0,'asset class and route availability filters combine');
   await categories.getByRole('button',{name:/^Tokenized ETF/}).click();
   assert.equal(await rows.count(),1);assert.match(await rows.first().innerText(),/XSPY/);
   await categories.getByRole('button',{name:/^All/}).click();
  await page.screenshot({path:`.codex-ui-review/catalog-${mode}-${width}.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.locator('.picker-header .icon-button').click();
   await page.getByRole('button',{name:'Switch to Base'}).click();await page.locator('#pair').click();
   await page.getByText(/Route scan complete/).waitFor();
   assert.equal(await rows.count(),0,'route-only filter does not reuse another chain results');
   await routeFilters.getByRole('button',{name:'All assets',exact:true}).click();
  await categories.getByRole('button',{name:/^Tokenized stock/}).click();
  await page.locator('.picker-results [data-status="unavailable"]').first().waitFor();
  assert.equal(await page.locator('.picker-results [data-status="available"]').count(),0,'other-chain results cannot leak');
  if(mode==='autopilot')assert.ok(requests.some(query=>query.includes('custody=erc20')));
  assert.deepEqual(errors,[]);console.log(`PASS ${mode} ${width}px: route-first order, all categories, broad catalog, chain isolation`);
  await page.close();
 }
} finally {await browser.close();}
