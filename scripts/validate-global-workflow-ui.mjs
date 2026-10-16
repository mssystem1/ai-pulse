/** Actual React components, mocked public candles/quotes. Blocks all external
 * requests and never connects a wallet or prepares a transaction. */
import fs from "node:fs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { qualifiedGlobalFixture } from "../packages/analysis/dist/globalAssessment.fixtures.js";
import { assessGlobalReport } from "../packages/analysis/dist/index.js";
import { reviewGlobalOrder } from "../packages/domain/dist/index.js";
const origin=process.env.PULSE_UI_ORIGIN??"http://127.0.0.1:5190",out=".tmp/global-workflow-ui";fs.mkdirSync(out,{recursive:true});
const fixture=qualifiedGlobalFixture();let missingFees=false,requests=0;
const chrome=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new","--no-first-run","--disable-gpu","--disable-background-networking","--remote-debugging-port=9260",`--user-data-dir=${process.cwd()}/${out}/profile-${Date.now()}`,"about:blank"],{windowsHide:true,stdio:"ignore"});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let socket;const errors=[],blocked=[];let requestId=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++requestId,timer=setTimeout(()=>{pending.delete(id);reject(Error("CDP timeout "+method));},30_000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});socket.send(JSON.stringify({id,method,params}));});
try{
  let target;for(let i=0;i<60;i++){try{target=await(await fetch("http://127.0.0.1:9260/json/new?about:blank",{method:"PUT"})).json();break;}catch{await pause(200);}}assert.ok(target);
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
  socket.addEventListener("message",async event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.reject(Error(JSON.stringify(message.error))):p?.resolve(message.result);return;}
    if(message.method==="Runtime.exceptionThrown")errors.push(message.params.exceptionDetails.text);
    if(message.method!=="Fetch.requestPaused")return;
    const {request,requestId}=message.params,url=new URL(request.url);
    const fulfill=async(body,type="application/json")=>call("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:type},{name:"Access-Control-Allow-Origin",value:origin},{name:"Access-Control-Allow-Methods",value:"GET, POST, OPTIONS"},{name:"Access-Control-Allow-Headers",value:"Content-Type, Accept"}],body:Buffer.from(body).toString("base64")});
    if(url.pathname==="/v1/global/setup-assessment"){
      if(request.method==="OPTIONS"){await fulfill("{}");return;}
      assert.equal(request.method,"POST");requests++;const body=JSON.parse(request.postData),now=Date.now();
      const assessment=assessGlobalReport(fixture.report,{...fixture.market,fetchedAt:new Date(now).toISOString()});
      const review=body.trade?reviewGlobalOrder(assessment,{observedAt:now,expiresAt:now+30_000,entry:100.3,quantity:1,roundTripLoss:.05,networkFees:missingFees?null:.01,slippageBps:10,inputBalanceSufficient:true,representationVerified:true,currencyVerified:true},now):undefined;
      const rate=.9992,executionLevels=review?{currency:"USDC",researchCurrency:"USDT",settlementToResearch:rate,entry:assessment.permittedEntry.map(p=>p/rate),referenceEntry:100.3/rate,takeProfit:assessment.targets[0]/rate,stopLoss:assessment.observedStop/rate}:undefined;
      await fulfill(JSON.stringify({assessment,...(review?{review,executionLevels}:{})}));return;
    }
    if(url.origin!==origin){blocked.push(url.origin+url.pathname);await call("Fetch.failRequest",{requestId,errorReason:"BlockedByClient"});return;}
    if(url.pathname!=="/__global-workflow"){await call("Fetch.continueRequest",{requestId});return;}
    await fulfill(`<meta name="viewport" content="width=device-width, initial-scale=1"/><div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      const {GlobalResearchReport}=await import('/src/GlobalResearchReport.tsx');const {GlobalSpotReview}=await import('/src/GlobalSpotReview.tsx');await import('/src/globalReport.css');
      const report=${JSON.stringify(fixture.report)},access={kind:'share',token:'local-fixture-capability-000000000'};
      function App(){const [intent,setIntent]=React.useState(null),[amount,setAmount]=React.useState(1);window.returnToReport=()=>setIntent(null);window.changeAmount=()=>setAmount(n=>n+1);
        return intent?React.createElement('main',null,React.createElement('h2',null,'Observed '+intent.orderType+' ticket'),React.createElement('button',{onClick:()=>setIntent(null)},'Return to report'),React.createElement('button',{onClick:()=>setAmount(n=>n+1)},'Change amount'),React.createElement(GlobalSpotReview,{intent,context:String(amount),protectionEnabled:true,trade:{network:'base',amount:String(amount)},onProtection:(a,levels)=>window.loaded={assessment:a,levels},onReview:r=>window.review=r}))
        :React.createElement(GlobalResearchReport,{report,assessmentAccess:access,onTrade:i=>{window.intent=i;setIntent(i);}});}
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
    </script><style>body{background:#0b1521;color:#dce7f2;font:14px Arial;margin:20px auto;max-width:1100px;padding:16px}button,input{padding:10px;margin:5px;border:1px solid #567088;border-radius:6px;background:#172638;color:#dce7f2}*{box-sizing:border-box}</style>`,"text/html");
  });
  await call("Page.enable");await call("Runtime.enable");await call("Fetch.enable",{patterns:[{urlPattern:"*"}]});
  const evaluate=async expression=>{const r=await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await pause(150);}throw Error("Timed out: "+expression);};
  const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  const capture=async name=>{const image=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(`${out}/${name}.png`,Buffer.from(image.data,"base64"));};
  for(const width of [1454,390]){
    await call("Emulation.setDeviceMetricsOverride",{width,height:1100,deviceScaleFactor:1,mobile:width<600});await call("Page.navigate",{url:origin+"/__global-workflow"});await wait("!!document.querySelector('[data-global-version]')");assert.equal(await evaluate("innerWidth"),width);
    for(const type of ["Market","Limit"]){
      await click("Recheck setup");await wait("document.querySelector('[data-assessment-state]').dataset.assessmentState==='technical_valid'");
      await evaluate("document.querySelector('[data-assessment-state]').scrollIntoView({block:'start'})");await capture(`${width}-${type}-technical-valid`);
      await click(`Check ${type} quote with observed TP/SL`);await wait("!!document.querySelector('[data-order-review-state]')");
      const intent=await evaluate("window.intent");assert.equal(intent.orderType,type.toLowerCase());assert.equal(intent.takeProfit,110);assert.ok(intent.stopLoss<98);assert.equal(intent.entryPrice,fixture.report.snapshot.price,"Do not default a Limit ticket to the maximum gross-only entry");assert.equal(intent.reportSetupMode,"assessment");assert.ok(intent.reportAccess);
      await click("Check report + quote for this amount");await wait("document.querySelector('[data-order-review-state]').dataset.orderReviewState==='ready_for_order_review'");assert.ok(await evaluate("window.review.expiresAt>Date.now()"));await capture(`${width}-${type}-ready`);
      await click("Load fresh observed entry, TP and SL in USDC");assert.equal(await evaluate("window.loaded.levels.currency"),"USDC");assert.ok(await evaluate("window.loaded.levels.takeProfit!==window.loaded.assessment.targets[0]"));
      await evaluate(`(()=>{const input=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0.01');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await wait("document.querySelector('[data-order-review-state]').dataset.orderReviewState==='blocked'");assert.equal(await evaluate("window.review"),null);
      await click("Change amount");await wait("document.querySelector('h4').textContent.includes('TICKET CHANGED')||document.querySelector('h4').textContent.includes('risk budget')");
      assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false);
      await click("Return to report");await wait("!!document.querySelector('[data-assessment-state]')");
    }
  }
  assert.equal(errors.length,0,JSON.stringify(errors));fs.writeFileSync(`${out}/validation.json`,JSON.stringify({widths:[1454,390],orderTypes:["market","limit"],requests,runtimeErrors:errors,externalRequestsBlocked:blocked,modelCalls:0,payments:0,transactions:0},null,2));console.log(JSON.stringify({workflows:4,requests,runtimeErrors:errors}));
}finally{socket?.close();chrome.kill();}
