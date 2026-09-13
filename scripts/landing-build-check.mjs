// Run against a local production preview, never a deployed service.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const origin='http://127.0.0.1:5190';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),requests=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(request.url()));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/v1/public/activity')return route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{}'});
    return url.origin===origin?route.continue():route.abort();
  });
  await page.goto(`${origin}/landing`,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Read the market. Trade your way.'}).waitFor();
  const resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(item=>new URL(item.name).origin===location.origin).map(item=>({path:new URL(item.name).pathname,bytes:item.encodedBodySize,durationMs:Math.round(item.duration)})));
  const scripts=resources.filter(item=>item.path.endsWith('.js'));
  assert.equal(scripts.some(item=>/\/(App-|appkit|wallet|SharedReport-|Report-)/i.test(item.path)),false,'landing must not load application, wallet or report bundles');
  assert.equal(requests.some(url=>/\/v1\/(autopilot|account|activity|jobs|report-history)/.test(url)),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.deepEqual(errors,[]);
  await page.locator('.landing-control-account').screenshot({path:'.codex-ui-review/landing-controls-production-390.png'});
  await page.locator('.landing-research-services article').first().screenshot({path:'.codex-ui-review/landing-research-production-390.png'});
  const bytes=scripts.reduce((sum,item)=>sum+item.bytes,0);
  assert.ok(bytes<500_000,`public JS payload unexpectedly grew: ${bytes} bytes`);
  console.log(JSON.stringify({check:'local production landing, cold browser, external fonts blocked',scriptBytes:bytes,scripts,paint:await page.evaluate(()=>performance.getEntriesByType('paint').map(item=>({name:item.name,startTimeMs:Math.round(item.startTime)}))),note:'Local unthrottled measurements, not a Lighthouse score or mobile-network benchmark.'},null,2));
}finally{await browser.close();}
