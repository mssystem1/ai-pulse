/** Offline desktop/mobile review of the production web build. No remote API calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {prepareGlobalReport,globalContextTimeframe} from '../packages/analysis/dist/globalReport.js';
import {globalTradeCards,globalDecision,globalSetupWindow,globalPriceBandText} from '../packages/domain/dist/index.js';

const fixture=JSON.parse(fs.readFileSync('packages/analysis/src/globalReport.oct20-fixture.json','utf8'));
const args=process.argv.slice(2),currentIndex=args.indexOf('--current-dir'),currentDir=currentIndex<0?null:args[currentIndex+1],flowFile=args[0]&&!args[0].startsWith('--')?args[0]:null;
if(currentIndex>=0&&!currentDir)throw Error('--current-dir requires a captured source directory');
const cutoffs={'15m':fixture.observedAt,'1H':'2026-10-20T17:42:42.267Z','4H':'2026-10-20T17:40:51.719Z','1Dutc':'2026-10-20T17:38:13.365Z','1Wutc':'2026-10-20T17:44:09.991Z'};
const outputIndex=args.indexOf('--output-dir');
const out=path.resolve(outputIndex>=0?args[outputIndex+1]:currentDir?'.tmp/global-current-market-browser':'.tmp/global-setup-context-browser');assert.ok(out.startsWith(process.cwd()+path.sep));fs.mkdirSync(out,{recursive:true});
const origin='http://127.0.0.1:5268',dist=path.resolve('apps/web/dist');
const types={'.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.wasm':'application/wasm','.html':'text/html'};
const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,origin).pathname;
  const target=path.resolve(dist,'.'+decodeURIComponent(pathname));
  if(target!==dist&&!target.startsWith(dist+path.sep)){response.writeHead(403).end();return;}
  const file=fs.existsSync(target)&&fs.statSync(target).isFile()?target:path.join(dist,'index.html');
  response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream'});fs.createReadStream(file).pipe(response);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5268,'127.0.0.1',resolve);});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--disable-gpu','--disable-background-networking','--remote-debugging-port=9268',`--user-data-dir=${out}/profile-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,currentReport,navigationCancellations=0;const cases=[],errors=[],mutations=[];
try{
  let target;for(let i=0;i<60;i++){try{target=await(await fetch('http://127.0.0.1:9268/json/new?about:blank',{method:'PUT'})).json();break;}catch{await pause(200);}}
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
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}const diagnostics={frame:currentReport?.snapshot.timeframe,tier:currentReport?.tier,lang:currentReport?.lang,errors,screen:await evaluate('({width:innerWidth,stage:document.querySelector(".global-chart-stage")?.clientWidth,overlay:document.querySelector(".global-chart-overlay")?.outerHTML.slice(0,500),canvases:document.querySelectorAll("canvas").length})')};fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify(diagnostics,null,2));throw Error('Timed out: '+expression+'; '+JSON.stringify(diagnostics));};
  await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const reports=[],reportDir=args.find(a=>a.startsWith('--report-dir='))?.slice('--report-dir='.length);
  if(reportDir)for(const frame of ['15m','1H','4H','1Dutc','1Wutc'])for(const lang of ['en','zh'])reports.push({...JSON.parse(fs.readFileSync(path.join(reportDir,frame+'.json'),'utf8')),lang});
  if(currentDir)for(const asset of ['BTC','ETH','HYPE','SOL','BNB','XRP'])for(const frame of ['15m','1H','4H','1Dutc','1Wutc'])for(const lang of ['en','zh']){
    const report=JSON.parse(fs.readFileSync(path.join(currentDir,asset,frame+'.json'),'utf8'));assert.equal(report.snapshot.instId,asset+'-USDT');assert.equal(report.snapshot.timeframe,frame);reports.push({...report,lang});
  }
  if(!reportDir&&!currentDir&&!process.argv.includes('--only-flow'))for(const [frame,observedAt] of Object.entries(cutoffs))for(const tier of ['base','premium'])for(const lang of ['en','zh']){
    const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:'BTC-USDT',source:'okx-public-spot',fetchedAt:observedAt,ticker:{priceCurrency:'USDT'},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
    reports.push(prepareGlobalReport({market:markets.find(m=>m.bar===frame),contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier,lang}));
  }
  if(!reportDir&&!currentDir&&!process.argv.includes('--only-flow'))for(const frame of ['1Dutc','1Wutc'])for(const lang of ['en','zh']){
    const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:'BEARISH-SYNTHETIC-USDT',source:'synthetic-test-fixture',fetchedAt:cutoffs[frame],ticker:{priceCurrency:'USDT'},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open:300000-open,high:300000-low,low:300000-high,close:300000-close,volume,confirmed:true}))}));
    const r=prepareGlobalReport({market:markets.find(m=>m.bar===frame),contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:'premium',lang});r.snapshot.venue='Synthetic test fixture';reports.push(r);
  }
  if(flowFile){const report=JSON.parse(fs.readFileSync(flowFile,'utf8'));assert.ok(report.orderFlow);for(const lang of ['en','zh'])reports.push({...report,lang});}
  const frameFilter=args.find(a=>a.startsWith('--frames='))?.slice('--frames='.length).split(',');
  for(const report of reports.filter(r=>!frameFilter||frameFilter.includes(r.snapshot.timeframe))){
    currentReport=report;
    const frame=report.snapshot.timeframe,tier=report.tier==='pro'?'premium':'base',lang=report.lang,shotFrame=(report.snapshot.instId==='BTC-USDT'?'':report.snapshot.instId+'-')+frame;
    const card=globalTradeCards(currentReport)[0],decision=globalDecision(currentReport);
    for(const width of [1454,390])for(const theme of (args.find(a=>a.startsWith('--themes='))?.slice('--themes='.length).split(',')??['xlayer'])){
      await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<600});
      await call('Page.navigate',{url:'about:blank'});await call('Page.navigate',{url:origin+'/shared-report?pulseTheme='+theme+'#share=deployment_fixture_oct20_000000000000000000'});
      await wait('Boolean(document.querySelector("[data-global-version]"))');
      await wait('Boolean(document.querySelector(".global-chart-overlay [data-trade-price-ledger], .global-chart-overlay [data-setup-status]"))');
      assert.equal(await evaluate('document.documentElement.dataset.pulseTheme'),theme);
      if(theme==='base'){
        const contrast=await evaluate(`(()=>{
          const lum=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
          const rgb=value=>value.match(/[0-9.]+/g)?.slice(0,3).map(Number);
          return Array.from(document.querySelectorAll('.global-heading h2,.global-meta,.global-trade-plan-card dt,.global-trade-plan-card dd,.global-trade-plan-card p,.global-decision-card h3,.global-horizon-context p,.global-chart-toolbar strong')).filter(e=>e.getClientRects().length).map(e=>{let p=e,bg;while(p){const c=getComputedStyle(p).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent'){bg=rgb(c);break;}p=p.parentElement;}const fg=rgb(getComputedStyle(e).color),a=lum(fg),b=lum(bg??[255,255,255]);return {tag:e.tagName,cls:e.className,text:e.textContent.slice(0,70),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
        })()`);
        fs.writeFileSync(path.join(out,'contrast-'+shotFrame+'-'+theme+'-'+lang+'-'+width+'.json'),JSON.stringify(contrast,null,2));
        assert.ok(contrast.every(c=>c.ratio>=4.5),'Clarity text contrast: '+JSON.stringify(contrast.filter(c=>c.ratio<4.5)));
        assert.ok(['#f8fbff','#eaf0f8'].includes(await evaluate('document.querySelector(".global-mobile-overview svg>rect")?.getAttribute("fill")')));
      }
      const text=await evaluate('document.querySelector(".global-report").textContent');
      if(card){assert.ok(text.includes(card.entry)&&text.includes(card.stop));assert.ok(text.includes(card.location));}
      else assert.ok(text.includes(currentReport.setupSelection.limitations[0]));
      assert.ok(text.includes(decision.heading));
      const historyBars=globalSetupWindow(currentReport);
      assert.ok(text.includes(`${historyBars} / ${currentReport.candles.length}`),`${frame}: overview must retain broad history`);
      if(currentReport.discretionaryPlan){
        const route=await evaluate('document.querySelector(".global-moves").textContent');
        assert.ok(route.includes(card.entry)&&route.includes(card.stop),'Setup route must match chart prices');
        assert.doesNotMatch(text,/No validated entry|NO VALIDATED ENTRY/);
      }
      assert.doesNotMatch(text,/#[0-9a-f]{8}\b/);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`${frame}/${tier}/${lang}/${width}: overflow`);
      assert.equal(await evaluate('document.querySelectorAll("[data-trade-card]").length'),card?1:0);
      assert.equal(await evaluate('document.querySelectorAll(".global-chart-overlay [data-scenario-projection]").length'),0);
      if(card&&card.plan.referenceStop!==null){
        const priceZones=currentReport.discretionaryPlan?.priceZones;
        if(priceZones){
          const rendered=await evaluate('Array.from(document.querySelectorAll(".global-chart-overlay [data-trade-zone]")).map(e=>({role:e.dataset.tradeZone,lower:Number(e.dataset.lower),upper:Number(e.dataset.upper)}))');
          const expected=[{role:'Entry',lower:priceZones.entry.lower,upper:priceZones.entry.upper},{role:'SL',...priceZones.stop},...priceZones.targets.map((z,i)=>({role:'TP'+(i+1),...z}))];
          assert.deepEqual(rendered,expected,'Native zone boundaries must match the saved source-backed intervals');
          const ledger=await evaluate('document.querySelector(".global-chart-overlay [data-trade-price-ledger]").textContent');
          assert.ok(ledger.includes(card.entry)&&ledger.includes(card.stop));
          for(const z of priceZones.targets)assert.ok(ledger.includes(globalPriceBandText(currentReport,z)),'Ledger must retain the complete TP interval');
          for(const z of priceZones.targets)assert.ok(text.includes(globalPriceBandText(currentReport,z)),'Report card must match its drawn TP interval');
        }
        assert.equal(await evaluate('document.querySelector(".global-chart-overlay [data-trade-role="+JSON.stringify("SL")+"]").dataset.price'),String(card?.plan.referenceStop));
        if(currentReport.entryStudy?.status==='available'){
          const detail=await evaluate('({visible:document.querySelector(".global-entry-detail [data-entry-price-role=SL]")?.dataset.price,offscale:document.querySelector(".global-entry-detail [data-entry-local-scale]")?.dataset.entryOffscaleLevels})');
          if(detail.visible)assert.equal(detail.visible,String(card?.plan.referenceStop));else assert.ok(detail.offscale?.split(',').includes('SL'),'Distant primary protection stays in the main ledger while entry candles retain their own scale');
        }
        await evaluate('document.querySelector("[data-trade-card] button").click()');await pause(100);
        assert.equal(await evaluate('document.querySelector(".global-chart-overlay [data-trade-price-ledger]").dataset.tradePriceLedger'),card.key);
      }else assert.equal(await evaluate('document.querySelectorAll(".global-chart-overlay [data-trade-role=SL]").length'),0);
      if(tier==='premium'){
        assert.equal(await evaluate('document.querySelectorAll(".global-mobile-overview [data-setup-study=EMA12]").length'),1);
        assert.equal(await evaluate('document.querySelectorAll(".global-mobile-overview [data-setup-study=EMA25]").length'),1);
        assert.equal(await evaluate('document.querySelectorAll(".global-chart-overlay [data-wave-label]").length'),0);
        assert.equal(await evaluate('document.querySelector(".global-chart-overlay [data-horizon-context]")?.dataset.horizonContext'),currentReport.horizonContext.reading);
        const zones=await evaluate('Array.from(document.querySelectorAll(".global-chart-overlay [data-context-zone]")).map(z=>({role:z.dataset.contextZone,lower:Number(z.dataset.lower),upper:Number(z.dataset.upper),knownAt:Number(z.dataset.knownAt)}))');
        assert.ok(zones.every(z=>currentReport.horizonContext.zones.some(source=>source.role===z.role&&source.lower===z.lower&&source.upper===z.upper&&source.knownAt===z.knownAt)),`${currentReport.snapshot.instId}/${frame}: rendered zone must retain its source`);
        if(!currentDir)assert.ok(zones.some(z=>z.role==='support'));
        assert.ok((await evaluate('document.querySelector(".global-horizon-context").textContent')).includes(currentReport.horizonContext.timeframe.replace(/utc$/,' (UTC)')));
        if(['1Dutc','1Wutc'].includes(frame)){
          for(const kind of new Set(currentReport.horizonContext.ranges.map(r=>r.kind)))assert.ok(await evaluate(`document.querySelectorAll('.global-chart-overlay [data-context-range="${kind}"]').length>0`));
          assert.ok(await evaluate('document.querySelectorAll(".global-chart-overlay [data-context-range-level=low] line").length>0'));
          assert.ok((await evaluate('document.querySelector(".global-sma-readings").textContent')).includes('AVWAP'));
        }
        if(frame==='1Wutc')assert.ok(await evaluate('document.querySelectorAll(".global-chart-overlay [data-context-range=cycle]").length>0'));
        if(currentReport.horizonContext.ranges.some(r=>r.kind==='balance'))assert.ok(await evaluate('document.querySelectorAll(".global-chart-overlay [data-context-range=balance]").length>0'));
      }
      if(currentReport.orderFlow){
        assert.equal(await evaluate('document.querySelectorAll(".global-chart-overlay [data-order-flow-profile]").length'),1);
        const profile=await evaluate('({knownAt:document.querySelector(".global-chart-overlay [data-order-flow-profile]").dataset.profileKnownAt,location:document.querySelector(".global-chart-overlay [data-order-flow-profile]").dataset.profileLocation,start:Number(document.querySelector(".global-chart-overlay [data-profile-level=POC] line").getAttribute("x1"))})');
        assert.equal(profile.knownAt,String(currentReport.orderFlow.profile.knownAt),'The rebuilt web chart retains profile availability time');
        assert.ok(['source_window','recent_context'].includes(profile.location));
        if(currentReport.orderFlow.profile.start>currentReport.candles.at(-historyBars).ts&&currentReport.orderFlow.profile.start<currentReport.candles.at(-1).ts)assert.ok(profile.start>8,'An in-view short profile cannot start at the first macro-history pixel');
        if(width<600)assert.equal(await evaluate('document.querySelector(".global-footprint-detail").scrollWidth>document.querySelector(".global-footprint-detail").clientWidth'),true,'Footprint keeps readable width inside its own mobile scroll area');
        const display=await evaluate('Array.from(document.querySelectorAll(".global-entry-detail [data-footprint-cell]")).reduce((s,c)=>[s[0]+Number(c.dataset.buy),s[1]+Number(c.dataset.sell)],[0,0])');
        const expected=currentReport.orderFlow.footprints.slice(-4).reduce((s,b)=>[s[0]+b.buy,s[1]+b.sell],[0,0]);
        for(let i=0;i<2;i++)assert.ok(Math.abs(display[i]-expected[i])<1e-8*Math.max(1,expected[i]));
        await evaluate('window.qaFlowCanvas=document.querySelector(".global-chart-stage canvas")');
        for(const [label,selector] of [[lang==='zh'?'成交量分布':'Volume profile','.global-chart-overlay [data-order-flow-profile]'],[lang==='zh'?'成交足迹':'Trade footprint','.global-entry-detail [data-executed-footprint]']]){
          const click=`Array.from(document.querySelectorAll('.global-layer-controls button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`;
          await evaluate(click);await wait(`document.querySelectorAll(${JSON.stringify(selector)}).length===0`);
          await evaluate(click);await wait(`document.querySelectorAll(${JSON.stringify(selector)}).length===1`);
          assert.equal(await evaluate('window.qaFlowCanvas===document.querySelector(".global-chart-stage canvas")'),true);
        }
        await evaluate('document.querySelector("[data-executed-footprint]").scrollIntoView({block:"start"})');
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,'footprint-'+shotFrame+'-'+theme+'-'+lang+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
      }else assert.equal(await evaluate('document.querySelectorAll("[data-order-flow-profile], [data-executed-footprint]").length'),0);
      if(tier==='premium'&&lang==='en'){
        assert.equal(await evaluate('Array.from(document.querySelectorAll(".global-layer-controls button")).find(b=>b.textContent==="Range references").disabled'),false,'Every horizon retains its available context controls');
        await evaluate('Array.from(document.querySelectorAll(".global-layer-controls button")).find(b=>b.textContent==="Range references").click()');
        await wait('document.querySelectorAll(".global-chart-overlay [data-horizon-context]").length===0');
        await evaluate('Array.from(document.querySelectorAll(".global-layer-controls button")).find(b=>b.textContent==="Range references").click()');
        await wait('document.querySelectorAll(".global-chart-overlay [data-horizon-context]").length===1');
        await evaluate('document.querySelector(".global-chart-panel").scrollIntoView({block:"start"});window.qaCanvas=document.querySelector(".global-chart-stage canvas")');
        const setupShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,'setup-'+shotFrame+'-'+theme+'-'+width+'.png'),Buffer.from(setupShot.data,'base64'));
        await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Structure view").click()');
        await wait('document.querySelectorAll(".global-mobile-overview [data-setup-study]").length===0');
        assert.equal(await evaluate('window.qaCanvas===document.querySelector(".global-chart-stage canvas")'),true,'Presets keep the native chart instance');
        assert.match(await evaluate('document.querySelector(".global-sma-readings").textContent'),/SMA55/);
        await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Setup view").click()');
        await wait('document.querySelectorAll(".global-mobile-overview [data-setup-study=EMA12]").length===1');
        assert.equal(await evaluate('window.qaCanvas===document.querySelector(".global-chart-stage canvas")'),true);
        if(currentReport.indicators.vwap?.bands?.length){
          await evaluate('Array.from(document.querySelectorAll(".global-layer-controls button")).find(b=>b.textContent==="VWAP bands").click()');
          await wait('document.querySelectorAll(".global-mobile-overview [data-setup-study]").length===3');
          assert.equal(await evaluate('document.querySelectorAll(".global-mobile-overview [data-setup-study=AVWAP]").length'),1);
          await evaluate('Array.from(document.querySelectorAll(".global-layer-controls button")).find(b=>b.textContent==="VWAP bands").click()');
          await wait('document.querySelectorAll(".global-mobile-overview [data-setup-study]").length===9');
        }

        await evaluate('document.querySelector(".global-trade-plans").scrollIntoView({block:"start"})');
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,shotFrame+'-'+theme+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
      }
      cases.push({theme,instrument:currentReport.snapshot.instId,executedOrderFlow:Boolean(currentReport.orderFlow),setupPreset:currentReport.tier==='pro',frame,tier:currentReport.tier,lang,width,historyBars,overflow:false,cards:card?1:0,entry:card?.entry??null,stop:card?.stop??null,projection:false});
    }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
  const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const proofFile=process.argv.includes('--only-flow')?'profile-window-validation.json':'browser-validation.json';
  fs.writeFileSync(path.join(out,proofFile),JSON.stringify({cases,runtimeErrors:errors,navigationCancellations,mutations,remoteRequestsBlocked:true,modelCalls:0,walletPayments:0,telegramSends:0,rendererSha256:hash('packages/domain/dist/globalOrderFlow.js'),setupRendererSha256:hash('packages/domain/dist/globalDiscretionaryPlan.js'),setupSelectorSha256:hash('packages/analysis/dist/globalSetupContext.js'),webBuildIndexSha256:hash('apps/web/dist/index.html'),...(flowFile?{sourceReportSha256:hash(flowFile)}:{}),...(currentDir?{sourceVerificationSha256:hash(path.join(currentDir,'verification.json'))}:{})},null,2));
  console.log(JSON.stringify({browserCases:cases.length,runtimeErrors:errors.length,mutations:mutations.length,screenshots:out}));
}catch(error){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),instrument:currentReport?.snapshot.instId,frame:currentReport?.snapshot.timeframe,lang:currentReport?.lang,completedCases:cases,runtimeErrors:errors,mutations},null,2));throw error;}
finally{socket?.close();chrome.kill();chrome.unref();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
