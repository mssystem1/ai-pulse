/** Inspect saved paid report Web/PNG/Telegram surfaces with all external requests blocked.
 * Run a production preview on 127.0.0.1:5264; --root defaults to the authorized X Layer batch. */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const paid=true,rootArg=process.argv.indexOf('--root'),root=path.resolve(rootArg<0?'.tmp/global-xlayer-audit-2026-10-18':process.argv[rootArg+1]);assert.ok(root.startsWith(path.resolve('.tmp')+path.sep),'QA artifacts must stay in .tmp');const out=path.join(root,'browser');fs.mkdirSync(out,{recursive:true});
let fixtureFrame='4H';const snapshots=Object.fromEntries(['1H','4H','1D','1W'].map(frame=>['pro-'+frame,JSON.parse(fs.readFileSync(path.join(root,'private',frame+(process.argv.includes('--reviewed')?'-reviewed':'')+'-delivery.json'),'utf8')).report]));const reports=new Proxy({}, {get:(_,tier)=>snapshots[tier+'-'+fixtureFrame]});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--disable-gpu','--disable-background-networking','--remote-debugging-port=9264',`--user-data-dir=${out}/profile-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket,fixtureTier='quick',miniMock=false;const cases=[],errors=[],mutations=[],apiOrigins=new Set();
try{
  let target;for(let i=0;i<40;i++){try{target=await(await fetch('http://127.0.0.1:9264/json/new?about:blank',{method:'PUT'})).json();break;}catch{await pause(250);}}assert.ok(target,'Chrome did not start');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();const call=(method,params={})=>new Promise((resolve,reject)=>{const request=++id,timer=setTimeout(()=>{pending.delete(request);reject(Error('CDP timeout '+method));},20000);pending.set(request,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id:request,method,params}));});
  socket.addEventListener('message',async event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.reject(Error(JSON.stringify(message.error))):p?.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);else if(message.method==='Fetch.requestPaused'){
    const {request,requestId}=message.params,url=new URL(request.url);
    if(url.pathname.startsWith('/v1/'))apiOrigins.add(url.origin);
    if(miniMock&&request.method==='OPTIONS'&&url.pathname.startsWith('/v1/telegram/ton/')){
      await call('Fetch.fulfillRequest',{requestId,responseCode:204,responseHeaders:[{name:'Access-Control-Allow-Origin',value:'http://127.0.0.1:5264'},{name:'Access-Control-Allow-Methods',value:'GET, OPTIONS'},{name:'Access-Control-Allow-Headers',value:'Content-Type, PULSE-TELEGRAM-INIT-DATA'}]}).catch(()=>{});return;
    }
    if(miniMock&&request.method==='GET'&&url.pathname.startsWith('/v1/telegram/ton/')){
      const catalog={services:[{id:'global-quick',stars:20,enabled:false},{id:'global-pro',stars:30,enabled:false}],checkoutReady:false};
      const orders={orders:[{id:'qa-read-only-report',serviceId:'global-'+fixtureTier,subject:'BTC-USDT',timeframe:fixtureFrame,stars:null,status:'completed',hasReport:true,createdAt:Date.now()}]};
      const report={orderId:'qa-read-only-report',serviceId:'global-'+fixtureTier,status:'completed',context:{serviceId:'global-'+fixtureTier},report:reports[fixtureTier]};
      const body=url.pathname.endsWith('/services')?catalog:url.pathname.endsWith('/orders')?orders:report;
      await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'http://127.0.0.1:5264'}],body:Buffer.from(JSON.stringify(body)).toString('base64')}).catch(()=>{});return;
    }
    if(url.pathname.startsWith('/v1/shared/reports/deployment_fixture_')){await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'http://127.0.0.1:5264'}],body:Buffer.from(JSON.stringify({report:reports[fixtureTier]})).toString('base64')}).catch(()=>{});return;}
    if(!['GET','HEAD','OPTIONS'].includes(request.method)){mutations.push({method:request.method,origin:url.origin,path:url.pathname});await call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}).catch(()=>{});return;}
    if(url.origin!=='http://127.0.0.1:5264'&&!['data:','blob:'].includes(url.protocol)){await call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}).catch(()=>{});return;}
    await call('Fetch.continueRequest',{requestId}).catch(()=>{});
  }});
  const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!value.exceptionDetails,JSON.stringify(value.exceptionDetails));return value.result.value;};
  const wait=async expression=>{for(let i=0;i<160;i++){if(await evaluate(expression))return;await pause(200);}throw Error('Timed out: '+expression);};
  const settle=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const capture=async file=>{await settle();const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(`${out}/${file}.png`,Buffer.from(shot.data,'base64'));};
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(out,'downloads')});await call('Page.enable');await call('Page.bringToFront');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});

  for(const frame of ['1H','4H','1D','1W'])for(const tier of ['pro'])for(const width of [1454,390]){
    fixtureFrame=frame;fixtureTier=tier;
    await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<600});
    await call('Page.navigate',{url:'about:blank'});await call('Page.navigate',{url:'http://127.0.0.1:5264/shared-report#share=deployment_fixture_'+tier+'_000000000000000000'});
    await wait('Boolean(document.querySelector("[data-global-version]"))');await pause(200);await settle();
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    assert.equal(await evaluate('document.querySelector(".global-directional-plan").dataset.planSide'),reports[tier].global.tradePlan.side);
    const text=await evaluate('document.querySelector(".global-report").textContent');assert.ok(text.includes(frame));assert.ok(text.includes('Selected entry evidence')); assert.ok(text.includes('Reference: last completed'));assert.ok(!text.includes('The original narrative predates this correction'));assert.ok(!['WAIT','EXPIRED','INVALIDATED','NO TRADE'].includes(await evaluate('document.querySelector(".global-current-action strong").textContent')));assert.ok(await evaluate('Boolean(document.querySelector(".global-entry-detail [data-entry-study]"))'));
    if(width>600){
      await pause(200);
      const rails=await evaluate('Array.from(document.querySelectorAll(".global-chart-overlay [data-channel]")).map(g=>({scope:g.dataset.channel,edge:g.dataset.edge}))');
      for(const c of reports[tier].global.indicators.channels??[])assert.ok(rails.some(r=>r.scope===c.scope&&r.edge==='lower')&&rails.some(r=>r.scope===c.scope&&r.edge==='upper'),'Both native rails: '+frame+' '+c.scope);
      assert.ok(await evaluate('Boolean(document.querySelector(".global-chart-overlay [data-fib-ratio]"))'),"Fibonacci appears by default");
      for(const name of ["Fibonacci retracement","SMA 21/55/89/144/233","Regression 120 ±2σ"])assert.equal(await evaluate('Array.from(document.querySelectorAll(".global-layer-controls button")).find(b=>b.textContent==='+JSON.stringify(name)+').getAttribute("aria-pressed")'),"true",name+" default");
      await evaluate('Array.from(document.querySelectorAll(".global-layer-controls button")).find(b=>b.textContent==="Fibonacci retracement").click()');await pause(100);
      assert.equal(await evaluate('Boolean(document.querySelector(".global-chart-overlay [data-fib-ratio]"))'),false,"Fibonacci can be turned off");
      for(const c of reports[tier].global.indicators.channels??[])assert.ok(await evaluate('Boolean(document.querySelector('+JSON.stringify('.global-chart-overlay [data-channel="'+c.scope+'"]')+'))'),'Preset retains '+c.scope);
      await evaluate('Array.from(document.querySelectorAll(".global-chart-presets button")).find(b=>b.textContent==="Reset studies").click()');await pause(100);
    }
    await evaluate('window.qaDownloadSvg=null;window.qaCreateObjectURL=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type.startsWith("image/svg+xml"))blob.text().then(text=>window.qaDownloadSvg=text);return window.qaCreateObjectURL.call(URL,blob)}');
    const cards=await evaluate('Array.from(document.querySelectorAll("[data-trade-card]")).map(c=>({key:c.dataset.tradeCard,text:c.textContent}))');
    assert.equal(cards.length,1,'Each report publishes one setup');
    for(const card of cards){
      assert.ok(card.text.includes('SL')&&card.text.includes('TP1')&&card.text.includes('Entry'));
      await evaluate('document.querySelector('+JSON.stringify('[data-trade-card="'+card.key+'"] button')+').click()');await pause(100);
      assert.equal(await evaluate('document.querySelector(".global-chart-overlay [data-trade-price-ledger]").dataset.tradePriceLedger'),card.key);
      assert.equal(await evaluate('document.querySelector(".global-chart-overlay [data-price-labels]").dataset.priceLabels'),'exact');
      await evaluate('window.qaDownloadSvg=null;Array.from(document.querySelectorAll(".global-chart-toolbar button")).find(b=>b.textContent==="Download chart PNG").click()');
      await wait('typeof window.qaDownloadSvg==="string"');
      const exported=await evaluate('window.qaDownloadSvg');assert.ok(exported.includes('data-trade-price-ledger="'+card.key+'"'),'Downloaded PNG uses the selected side');assert.ok(exported.includes('TRADE PLAN'));assert.ok(exported.includes('TIMING SCHEMATIC'));assert.equal((exported.match(/data-scenario-projection=/g)||[]).length,1);

      assert.equal(await evaluate('document.querySelector(".global-chart-overlay [data-trade-role="+JSON.stringify("SL")+"]").dataset.price'),await evaluate('document.querySelector(".global-entry-detail [data-entry-price-role="+JSON.stringify("SL")+"]").dataset.price'),'Main and entry chart use the same SL');
    }
    await evaluate('document.querySelector("[data-trade-card] button").click()');await pause(100);
    await evaluate('document.querySelector(".global-trade-plans").scrollIntoView({block:"start"})');await capture('plan-cards-'+frame+'-'+width);
    await evaluate('document.querySelector(".global-chart-panel").scrollIntoView({block:"start"})');await capture('main-chart-'+frame+'-'+width);
    const height=await evaluate('Math.ceil(document.querySelector("main").getBoundingClientRect().bottom)');await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await evaluate('scrollTo(0,0)');await capture(tier+'-'+frame+'-'+width);
    cases.push({frame,tier,width,view:paid?'Fresh paid local BTC report; live OKX candles and Grok':'Public historical candle replay; no model request',overflow:false});
  }
  fixtureFrame='1D';fixtureTier='pro';
  for(const width of [1454,390]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await call('Page.navigate',{url:'about:blank'});await call('Page.navigate',{url:'http://127.0.0.1:5264/shared-report#share=deployment_fixture_pro_000000000000000000'});
    await wait('Boolean(document.querySelector(".global-chart-presets"))');
    await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Structure view").click();document.querySelector(".global-study-options").open=true;window.qaCanvas=document.querySelector(".global-chart-stage canvas")');
    await pause(250);await evaluate('document.querySelector(".global-chart-panel").scrollIntoView({block:"start"})');await capture('setup-focus-'+width);
    await evaluate('document.querySelectorAll(".global-layer-controls button").forEach(b=>{if(!b.disabled&&b.getAttribute("aria-pressed")!=="true")b.click()})');await pause(250);await settle();
    assert.equal(await evaluate('window.qaCanvas===document.querySelector(".global-chart-stage canvas")'),true);assert.equal(await evaluate('document.querySelector(".global-chart-overlay").innerHTML.includes("NaN")'),false);assert.ok(await evaluate('Boolean(document.querySelector(".global-chart-overlay [data-fib-ratio]"))'));await capture('all-indicators-'+width);
    cases.push({view:'Studies on focused chart',width,canvasPreserved:true,fibonacci:true});
  }
  miniMock=true;await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.Telegram={WebApp:{initData:"qa-read-only-host",ready(){},expand(){},openInvoice(){throw Error("QA forbids checkout")}}}'});
  for(const frame of ['1H','4H','1D','1W'])for(const tier of ['pro'])for(const width of [1454,390]){
    fixtureFrame=frame;fixtureTier=tier;await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<600});
    await call('Page.navigate',{url:'about:blank'});await call('Page.navigate',{url:'http://127.0.0.1:5264/miniapp'});
    await wait('Array.from(document.querySelectorAll(".tg-mini-nav button")).some(b=>b.textContent==="Reports")');await evaluate('Array.from(document.querySelectorAll(".tg-mini-nav button")).find(b=>b.textContent==="Reports").click()');await wait('Boolean(document.querySelector(".tg-mini-service"))');await evaluate('document.querySelector(".tg-mini-service").click()');await wait('Boolean(document.querySelector("[data-global-version]"))');await pause(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);assert.equal(await evaluate('document.querySelector(".global-directional-plan").dataset.planSide'),reports[tier].global.tradePlan.side);
    await evaluate('document.querySelector(".global-report").scrollIntoView({block:"start"})');await capture('telegram-'+tier+'-'+frame+'-'+width);
    await evaluate('document.querySelector(".global-directional-plan").scrollIntoView({block:"start"})');await capture('telegram-plan-'+tier+'-'+frame+'-'+width);
    cases.push({view:'Telegram Mini App',frame,tier,width,hostMock:true,libraryReadMock:true,overflow:false});
  }

  for(const width of [1454,390]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<600});await call('Page.navigate',{url:'http://127.0.0.1:5264/docs#docs-global-chart'});await wait('Boolean(document.querySelector(".global-chart-reading"))');
    const images=await evaluate('(async()=>{const imgs=Array.from(document.querySelectorAll(".global-guide-figure img"));for(const img of imgs){img.scrollIntoView({block:"center"});await img.decode()}return imgs.map(img=>({width:img.naturalWidth,display:img.getBoundingClientRect().width}))})()');assert.equal(images.length,9);assert.ok(images.every(img=>img.width>=2000&&img.display<=width));assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await evaluate('document.querySelector(".global-guide-figure").scrollIntoView({block:"start"})');await capture('directional-guide-'+width);cases.push({view:'Illustrated chart guide',width,images:9,overflow:false});
  }
  assert.deepEqual(mutations.filter(m=>m.path.startsWith('/v1/')),[],'Browser review must not attempt application payments or writes');assert.equal(errors.length,0,JSON.stringify(errors));fs.writeFileSync(out+'/validation.json',JSON.stringify({cases,runtimeErrors:errors,mutationsBlocked:mutations,modelCalls:0,walletPayments:0,telegramSends:0},null,2));console.log(JSON.stringify({cases:cases.length,runtimeErrors:errors}));
}finally{socket?.close();chrome.kill();}
