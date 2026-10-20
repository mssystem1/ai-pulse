/** Offline desktop/mobile review of the production web build. No remote API calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {prepareGlobalReport,globalContextTimeframe} from '../packages/analysis/dist/globalReport.js';
import {globalTradeCards,globalDecision} from '../packages/domain/dist/index.js';

const fixture=JSON.parse(fs.readFileSync('packages/analysis/src/globalReport.oct20-fixture.json','utf8'));
const cutoffs={'1H':'2026-10-20T17:42:42.267Z','4H':'2026-10-20T17:40:51.719Z','1Dutc':'2026-10-20T17:38:13.365Z','1Wutc':'2026-10-20T17:44:09.991Z'};
const out=path.resolve('.tmp/global-oct20-browser');fs.mkdirSync(out,{recursive:true});
const origin='http://127.0.0.1:5267',dist=path.resolve('apps/web/dist');
const types={'.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.wasm':'application/wasm','.html':'text/html'};
const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,origin).pathname;
  const target=path.resolve(dist,'.'+decodeURIComponent(pathname));
  if(target!==dist&&!target.startsWith(dist+path.sep)){response.writeHead(403).end();return;}
  const file=fs.existsSync(target)&&fs.statSync(target).isFile()?target:path.join(dist,'index.html');
  response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream'});fs.createReadStream(file).pipe(response);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5267,'127.0.0.1',resolve);});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--disable-gpu','--disable-background-networking','--remote-debugging-port=9267',`--user-data-dir=${out}/profile-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,currentReport,navigationCancellations=0;const cases=[],errors=[],mutations=[];
try{
  let target;for(let i=0;i<60;i++){try{target=await(await fetch('http://127.0.0.1:9267/json/new?about:blank',{method:'PUT'})).json();break;}catch{await pause(200);}}
  assert.ok(target,'Chrome did not start');socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();
  const call=(method,params={})=>new Promise((resolve,reject)=>{const request=++id,timer=setTimeout(()=>{pending.delete(request);reject(Error('CDP timeout: '+method));},20000);pending.set(request,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id:request,method,params}));});
  socket.addEventListener('message',event=>{void(async()=>{
    const message=JSON.parse(event.data);
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.reject(Error(JSON.stringify(message.error))):p?.resolve(message.result);return;}
    if(message.method==='Runtime.exceptionThrown'){errors.push(message.params.exceptionDetails.text);return;}
    if(message.method!=='Fetch.requestPaused')return;
    const {request,requestId}=message.params,url=new URL(request.url);
    if(request.method==='GET'&&url.pathname.startsWith('/v1/shared/reports/deployment_fixture_')){
      await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin}],body:Buffer.from(JSON.stringify({report:{global:currentReport}})).toString('base64')});return;
    }
    if(!['GET','HEAD','OPTIONS'].includes(request.method)){mutations.push({method:request.method,path:url.pathname});await call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});return;}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){await call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});return;}
    await call('Fetch.continueRequest',{requestId});
  })().catch(error=>{
    // Navigation can invalidate a paused Fetch ID before its reply is sent.
    // Account for that exact CDP cancellation separately from page failures.
    let protocol;try{protocol=JSON.parse(error.message);}catch{}
    if(protocol?.code===-32602&&protocol.message==='Invalid InterceptionId.')navigationCancellations++;
    else errors.push(error.message);
  });});
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Timed out: '+expression);};
  await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  for(const [frame,observedAt] of Object.entries(cutoffs))for(const tier of ['base','premium'])for(const lang of ['en','zh']){
    const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:'BTC-USDT',source:'okx-public-spot',fetchedAt:observedAt,ticker:{priceCurrency:'USDT'},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
    currentReport=prepareGlobalReport({market:markets.find(m=>m.bar===frame),contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier,lang});
    const card=globalTradeCards(currentReport)[0],decision=globalDecision(currentReport);
    for(const width of [1454,390]){
      await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<600});
      await call('Page.navigate',{url:'about:blank'});await call('Page.navigate',{url:origin+'/shared-report#share=deployment_fixture_oct20_000000000000000000'});
      await wait('Boolean(document.querySelector("[data-global-version]"))');
      await wait('Boolean(document.querySelector(".global-chart-overlay [data-trade-price-ledger]"))');
      const text=await evaluate('document.querySelector(".global-report").textContent');
      assert.ok(text.includes(card.entry)&&text.includes(card.stop));assert.ok(text.includes(card.location));assert.ok(text.includes(decision.heading));
      assert.doesNotMatch(text,/#[0-9a-f]{8}\b/);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`${frame}/${tier}/${lang}/${width}: overflow`);
      assert.equal(await evaluate('document.querySelectorAll("[data-trade-card]").length'),1);
      assert.equal(await evaluate('document.querySelectorAll(".global-chart-overlay [data-scenario-projection]").length'),1);
      assert.equal(await evaluate('document.querySelector(".global-chart-overlay [data-scenario-projection]").dataset.projectionOrigin'),'entry');
      assert.equal(await evaluate('document.querySelector(".global-chart-overlay [data-trade-role="+JSON.stringify("SL")+"]").dataset.price'),String(currentReport.tradePlan.referenceStop));
      assert.equal(await evaluate('document.querySelector(".global-entry-detail [data-entry-price-role="+JSON.stringify("SL")+"]").dataset.price'),String(currentReport.tradePlan.referenceStop));
      await evaluate('document.querySelector("[data-trade-card] button").click()');await pause(100);
      assert.equal(await evaluate('document.querySelector(".global-chart-overlay [data-trade-price-ledger]").dataset.tradePriceLedger'),card.key);
      if(tier==='premium'&&lang==='en'){
        await evaluate('document.querySelector(".global-trade-plans").scrollIntoView({block:"start"})');
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,frame+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
      }
      cases.push({frame,tier:currentReport.tier,lang,width,overflow:false,cards:1,entry:card.entry,stop:card.stop,projectionOrigin:'entry'});
    }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
  fs.writeFileSync('docs/previews/global-oct20-audit/browser-validation.json',JSON.stringify({cases,runtimeErrors:errors,navigationCancellations,mutations,remoteRequestsBlocked:true,modelCalls:0,walletPayments:0,telegramSends:0},null,2));
  console.log(JSON.stringify({browserCases:cases.length,runtimeErrors:errors.length,mutations:mutations.length,screenshots:out}));
}finally{socket?.close();chrome.kill();await new Promise(resolve=>server.close(resolve));}
