/** Real wheel/axis gestures against the chart component under parent polling.
 * Uses saved data only; blocks external requests and never submits an order. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {build} from 'esbuild';
const baseline=process.argv.includes('--baseline'),file=process.argv.slice(2).find(a=>!a.startsWith('--'));
assert.ok(file,'Provide a saved report JSON');const report=JSON.parse(fs.readFileSync(file,'utf8'));
const out=path.resolve('.tmp/global-chart-viewport'+(baseline?'-baseline':''));fs.mkdirSync(out,{recursive:true});
const component=path.resolve('apps/web/src/GlobalMarketChart.tsx');
const plugins=baseline?[{name:'retained-baseline',setup(b){
 b.onLoad({filter:/GlobalMarketChart\.tsx$/},()=>({contents:execFileSync('git',['show','69c19c1:apps/web/src/GlobalMarketChart.tsx'],{encoding:'utf8'}).replace('previousWidth = width; previousRange = chart.timeScale().getVisibleLogicalRange();','previousWidth = width; previousRange = chart.timeScale().getVisibleLogicalRange(); if(ref.current){ref.current.dataset.viewportFrom=String(previousRange?.from??0);ref.current.dataset.viewportTo=String(previousRange?.to??0);}'),loader:'tsx',resolveDir:path.dirname(component)}));
 b.onLoad({filter:/global-chart-viewport\.tsx$/},args=>({contents:fs.readFileSync(args.path,'utf8').replace('},300);','},1200);'),loader:'tsx',resolveDir:path.dirname(args.path)}));
}}]:[];
await build({entryPoints:['scripts/fixtures/global-chart-viewport.tsx'],outfile:path.join(out,'app.js'),bundle:true,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins,logLevel:'silent'});
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:#0d1420}</style><div id="root"></div><script>window.__viewportReport=${JSON.stringify(report).replaceAll('<','\\u003c')}</script><script src="/app.js"></script>`;
const origin='http://127.0.0.1:5271',server=http.createServer((req,res)=>{if(req.url==='/app.js'||req.url==='/app.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/css');res.end(fs.readFileSync(path.join(out,req.url.slice(1))));}else{res.setHeader('Content-Type','text/html');res.end(html);}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5271,'127.0.0.1',resolve);});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--disable-gpu','--disable-background-networking','--remote-debugging-port=9271',`--user-data-dir=${out}/profile-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let socket;const cases=[],errors=[];
try{
 let target;for(let i=0;i<60;i++){try{target=await(await fetch('http://127.0.0.1:9271/json/new?about:blank',{method:'PUT'})).json();break;}catch{await pause(100);}}assert.ok(target);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const pending=new Map();const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
 socket.addEventListener('message',event=>{void(async()=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);else if(m.method==='Fetch.requestPaused'){const {requestId,request}=m.params;await call(new URL(request.url).origin===origin&&['GET','HEAD'].includes(request.method)?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...(new URL(request.url).origin===origin&&['GET','HEAD'].includes(request.method)?{}:{errorReason:'BlockedByClient'})});}})().catch(e=>errors.push(String(e)));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Timeout '+expression);};
 const read=()=>evaluate(`(()=>{const s=document.querySelector('[data-viewport-from]');return s?{from:Number(s.dataset.viewportFrom),to:Number(s.dataset.viewportTo),priceFrom:Number(s.dataset.priceFrom),priceTo:Number(s.dataset.priceTo),auto:s.dataset.priceAutoscale,ticks:Number(document.querySelector('[data-qa-refreshes]').textContent)}:null})()`);
 const same=(a,b)=>Math.abs(a.from-b.from)<1e-4&&Math.abs(a.to-b.to)<1e-4;
 const samePrices=(a,b)=>Math.abs(a.priceFrom-b.priceFrom)<1e-5&&Math.abs(a.priceTo-b.priceTo)<1e-5;
 const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
 await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 for(const width of [1454,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:1200,deviceScaleFactor:1,mobile:width<600});await call('Page.navigate',{url:origin});await wait('Boolean(document.querySelector("[data-viewport-from]"))');
  if(width<600)await click('Inspect candles');await evaluate('document.querySelector(".global-chart-stage").scrollIntoView({block:"center"})');await pause(350);
  const before=await read(),box=await evaluate('(()=>{const b=document.querySelector(".global-chart-stage canvas").getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}})()');
  await evaluate('window.qaCanvas=document.querySelector(".global-chart-stage canvas")');
  await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:box.x+box.width*.55,y:box.y+150,deltaX:0,deltaY:-300});await pause(80);const zoomed=await read();
  assert.ok(zoomed.to-zoomed.from<before.to-before.from,'Actual wheel gesture must zoom');await pause(1200);const refreshed=await read();assert.ok(refreshed.ticks>zoomed.ticks);
  if(baseline){assert.equal(same(zoomed,refreshed),false,'The retained original must reproduce the parent-refresh reset');cases.push({width,baselineResetReproduced:true});break;}
  assert.ok(same(zoomed,refreshed),'Parent report parsing must preserve zoom');assert.equal(await evaluate('window.qaCanvas===document.querySelector(".global-chart-stage canvas")'),true,'Polling must preserve the native chart instance');
  for(const label of ['EMA 12 / 25','Structure view','Setup view','Reset studies']){await click(label);await pause(150);assert.ok(same(zoomed,await read()),label+' changed time zoom');}
  const axis=await evaluate('(()=>{const b=document.querySelector(".global-chart-stage").getBoundingClientRect();return {x:b.right-18,y:b.top+220}})()');
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:axis.x,y:axis.y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:axis.x,y:axis.y+90,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:axis.x,y:axis.y+90,button:'left',clickCount:1});await pause(250);
  const scaled=await read();assert.equal(scaled.auto,'false','Price-axis drag must produce a manual price scale');
  await click('Value context');await pause(200);assert.ok(same(scaled,await read()));assert.ok(samePrices(scaled,await read()),'Study changes must preserve manual price zoom');
  await evaluate('document.querySelector("[data-qa-language]").click()');await pause(650);const translated=await read();assert.ok(same(scaled,translated),'Language refresh changed time zoom');assert.ok(samePrices(scaled,translated),'Language refresh changed manual price scale');
  await call('Emulation.setDeviceMetricsOverride',{width:width===1454?1150:430,height:1200,deviceScaleFactor:1,mobile:width<600});await pause(650);const resized=await read();assert.ok(same(translated,resized),'Resize changed time zoom');assert.ok(samePrices(translated,resized),'Resize changed manual price scale');
  const double=await evaluate('(()=>{const b=document.querySelector(".global-chart-stage").getBoundingClientRect();return {x:b.right-18,y:b.top+220}})()');
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...double,button:'left',clickCount:2});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...double,button:'left',clickCount:2});await pause(200);assert.ok(same(resized,await read()));assert.ok(samePrices(resized,await read()),'Axis double-click must not reset the view');
  const reset=await evaluate('Array.from(document.querySelectorAll(".global-chart-toolbar button")).find(b=>b.textContent.includes("重置")||b.textContent==="Reset view").textContent');await click(reset);await pause(250);const restored=await read();assert.equal(restored.auto,'true');assert.ok(restored.to-restored.from>zoomed.to-zoomed.from,'Reset view must restore default history');
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,width+'.png'),Buffer.from(shot.data,'base64'));cases.push({width,parentRefreshes:restored.ticks,timeZoomPreserved:true,priceZoomPreserved:true,indicatorsPreserveZoom:true,presetsPreserveZoom:true,resizePreservesZoom:true,resetRestoresDefault:true});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({baseline,cases,errors,source:file,remoteRequestsBlocked:true,orders:0},null,2));console.log(JSON.stringify({baseline,cases,errors}));
}finally{socket?.close();chrome.kill();chrome.unref();server.closeAllConnections();await new Promise(r=>server.close(r));}
