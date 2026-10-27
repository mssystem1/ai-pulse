/** Exercise the production report view with a local authenticated exporter.
 * Telegram and Web Share bridges are simulated; no remote requests or payments. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function installFileBridges(){
  window.__exportDownloads=[];window.__exportBrowserLinks=[];window.__exportShares=[];
  Object.defineProperty(navigator,'canShare',{configurable:true,value:data=>Boolean(data.files?.length)});
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{const file=data.files[0],record={name:file.name,type:file.type,size:file.size,active:navigator.userActivation?.isActive};window.__exportShares.push(record);record.bytes=[...new Uint8Array(await file.arrayBuffer()).slice(0,8)];}});
  if(innerWidth<600)window.Telegram={WebApp:{initData:'fixture-only-no-real-telegram-session',ready(){},expand(){},isVersionAtLeast(){return true;},downloadFile(params,callback){window.__exportDownloads.push({...params,active:navigator.userActivation?.isActive});callback?.(true);},openLink(url){window.__exportBrowserLinks.push(url);}}};
}

async function checkExports({width,theme,frame,lang,card},{call,evaluate,wait}){
  // Install device bridges after the SDK initializes during navigation.
  await evaluate('('+installFileBridges.toString()+')();');
  for(const format of ['png','txt']){
    const folder=path.join(out,'downloads',downloadRun,`${frame}-${lang}-${theme}-${width}-${format}`);fs.mkdirSync(folder,{recursive:true});
    await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:folder});
    const before=new Set(fs.readdirSync(folder));
    await evaluate(`document.querySelector('[data-global-export="${format}"]').click()`,true);
    await wait('Boolean(document.querySelector(".report-download-dialog [data-save-report]"))');
    assert.equal(await evaluate('document.querySelector(".report-download-dialog [role=alert]")?.textContent??""'),'');
    assert.ok(await evaluate('Boolean(document.querySelector(".report-download-actions a"))'),JSON.stringify({dialog:await evaluate('document.querySelector(".report-download-dialog").textContent'),requests:exportRequests}));
    const name=await evaluate('document.querySelector(".report-download-filename").textContent');assert.ok(name.endsWith('.'+format));
    if(format==='png'){await wait('document.querySelector(".report-download-preview img")?.complete');assert.ok(await evaluate('document.querySelector(".report-download-preview img").naturalWidth')>2600);}
    else assert.ok((await evaluate('document.querySelector(".report-download-dialog textarea").value')).includes(card.entry));
    const nativeBefore=await evaluate('window.__exportDownloads.length+window.__exportBrowserLinks.length');
    await evaluate('document.querySelector(".report-download-dialog [data-save-report]").click()',true);
    let bytes,bridge='browser-file';
    if(width<600){
      await wait(`window.__exportDownloads.length+window.__exportBrowserLinks.length>${nativeBefore}`);
      const native=await evaluate('window.__exportDownloads.at(-1)??{url:window.__exportBrowserLinks.at(-1)}');
      if(native.file_name){assert.equal(native.file_name,name);assert.equal(native.active,true);bridge='telegram-native-simulated';}else bridge='telegram-browser-fallback-simulated';
      const response=await fetch(origin+new URL(native.url).pathname);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);bytes=Buffer.from(await response.arrayBuffer());
    }else{
      let file;for(let attempt=0;attempt<100;attempt++){file=fs.readdirSync(folder).find(f=>!before.has(f)&&f.endsWith('.'+format));if(file)break;await pause(100);}assert.ok(file,'Browser did not save the report file');bytes=fs.readFileSync(path.join(folder,file));
    }
    if(format==='png'){assert.equal(bytes.subarray(1,4).toString(),'PNG');const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);assert.ok(w>2600&&w*h<=16_000_000);}
    else{assert.ok(bytes.toString('utf8').includes(card.entry));assert.ok(!bytes.toString('utf8').includes('deployment_fixture_'));}
    downloadCases.push({frame,lang,theme,width,format,bridge,bytes:bytes.length,name});
    if(width<600&&frame==='15m'&&lang==='en'){
      const count=await evaluate('window.__exportShares.length');
      await evaluate('Array.from(document.querySelectorAll(".report-download-actions button")).find(b=>b.textContent.includes("Share")).click()',true);
      await wait(`window.__exportShares.length>${count}&&window.__exportShares.at(-1).bytes`);const shared=await evaluate('window.__exportShares.at(-1)');assert.equal(shared.active,true);assert.equal(shared.name,name);
      downloadCases.push({frame,lang,theme,width,format,bridge:'web-share-simulated',active:true,bytes:shared.size});
    }
    await evaluate('document.querySelector(".report-download-heading button").click()',true);await wait('!document.querySelector(".report-download-dialog")');
    if(width<600&&frame==='15m'&&lang==='en'){
      await evaluate(`window.__originalExportFetch=window.fetch;window.fetch=(url,options)=>String(url).endsWith('/v1/global/export')?Promise.resolve(new Response('{"error":"Audit offline fixture"}',{status:503,headers:{'Content-Type':'application/json'}})):window.__originalExportFetch(url,options)`);
      await evaluate(`document.querySelector('[data-global-export="${format}"]').click()`,true);await wait('Boolean(document.querySelector(".report-download-dialog [data-save-report]"))');
      assert.ok(!(await evaluate('document.querySelector(".report-download-dialog [role=alert]")')));
      assert.ok((await evaluate('document.querySelector(".report-download-dialog").textContent')).includes('Secure download is unavailable'));
      const count=await evaluate('window.__exportShares.length');await evaluate('document.querySelector("[data-save-report]").click()',true);await wait(`window.__exportShares.length>${count}&&window.__exportShares.at(-1).bytes`);
      const shared=await evaluate('window.__exportShares.at(-1)');assert.equal(shared.active,true);assert.ok(shared.size>0);assert.equal(shared.type,format==='png'?'image/png':'text/plain');
      downloadCases.push({frame,lang,theme,width,format,bridge:'offline-local-file-share-simulated',active:true,bytes:shared.size});
      await evaluate('document.querySelector(".report-download-heading button").click()',true);await wait('!document.querySelector(".report-download-dialog")');
      if(format==='png'){
        await evaluate('window.__originalExportContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=()=>null');
        await evaluate('document.querySelector("[data-global-export=png]").click()',true);await wait('Boolean(document.querySelector(".report-download-dialog [role=alert]"))');
        assert.ok((await evaluate('document.querySelector(".report-download-dialog [role=alert]").textContent')).includes('Image saving is unavailable'));
        downloadCases.push({frame,lang,theme,width,format,bridge:'canvas-failure-visible-error'});
        await evaluate('document.querySelector(".report-download-heading button").click()',true);await wait('!document.querySelector(".report-download-dialog")');await evaluate('HTMLCanvasElement.prototype.getContext=window.__originalExportContext');
      }
      await evaluate('window.fetch=window.__originalExportFetch');
    }
  }
}

assert.ok(process.argv.some(arg=>arg.startsWith('--report-dir=')),'Supply --report-dir with saved JSON reports for all five timeframes');
let source=fs.readFileSync('scripts/audit-global-setup-context-browser.mjs','utf8');
const addBefore=(needle,addition)=>{assert.ok(source.includes(needle),needle);source=source.replace(needle,addition+'\n'+needle);};
const replace=(needle,value)=>{assert.ok(source.includes(needle),needle);source=source.replace(needle,value);};
replace('for(let i=0;i<60;i++){try{target=', 'for(let i=0;i<300;i++){try{target=');
replace("windowsHide:true,stdio:'ignore'", "windowsHide:true,stdio:['ignore','ignore',fs.openSync(path.join(out,'chrome-stderr.log'),'a')]");
addBefore('const server=http.createServer',`const downloadCases=[],exportRequests=[],downloadRun=String(Date.now());let apiOrigin=origin;
const {default:express}=await import('express');
const {createGlobalExportRouter}=await import('../apps/api/dist/globalExportRoutes.js');
const fileApi=express();fileApi.use(express.json());
fileApi.use(createGlobalExportRouter({BASE_URL:'https://internal-export-origin.invalid',REPORT_ENCRYPTION_KEY:'browser-audit-only-key'},{resolveReport:async access=>access.kind==='share'&&access.token.startsWith('deployment_fixture_')?{global:currentReport}:null}));
${installFileBridges.toString()}
${checkExports.toString()}`);
replace("const pathname=new URL(request.url,origin).pathname;","const pathname=new URL(request.url,origin).pathname; if(pathname.startsWith('/v1/global/export')){fileApi(request,response);return;}");
replace("if(request.method==='GET'&&url.pathname.startsWith('/v1/shared/reports/deployment_fixture_')){","if(request.method==='GET'&&url.pathname.startsWith('/v1/shared/reports/deployment_fixture_')){apiOrigin=url.origin;");
addBefore("if(!['GET','HEAD','OPTIONS'].includes(request.method))",`if(url.pathname.startsWith('/v1/global/export')){
 if(request.method==='OPTIONS'){await call('Fetch.fulfillRequest',{requestId,responseCode:204,responseHeaders:[{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Headers',value:'content-type'},{name:'Access-Control-Allow-Methods',value:'POST,GET,OPTIONS'}]});return;}
 const response=await fetch(origin+url.pathname,{method:request.method,headers:{'Content-Type':'application/json'},...(request.method==='POST'?{body:request.postData}:{})});
 const bytes=Buffer.from(await response.arrayBuffer()),headers=[...response.headers].filter(([key])=>!['content-length','content-encoding','connection','transfer-encoding','access-control-allow-origin'].includes(key)).map(([name,value])=>({name,value}));headers.push({name:'Access-Control-Allow-Origin',value:origin});
 exportRequests.push({method:request.method,status:response.status,...(response.status!==200?{error:bytes.toString('utf8')}:{}),path:url.pathname.includes('/file/')?'/v1/global/export/file/[opaque]':url.pathname});
 await call('Fetch.fulfillRequest',{requestId,responseCode:response.status,responseHeaders:headers,body:bytes.toString('base64')});return;
}`);
replace('const evaluate=async expression=>','const evaluate=async (expression,userGesture=false)=>');
replace('expression,returnByValue:true,awaitPromise:true','expression,returnByValue:true,awaitPromise:true,userGesture');
const push=source.match(/^[ \t]*cases\.push\(/m)?.[0];assert.ok(push);addBefore(push,"      await checkExports({width,theme,frame,lang,card},{call,evaluate,wait});");
addBefore('const proofFile=',`assert.ok(downloadCases.length>=40);assert.ok(exportRequests.every(r=>r.status===200));fs.writeFileSync(path.join(out,'download-validation.json'),JSON.stringify({cases:downloadCases,exportRequests,physicalDevices:false,simulatedBridges:true,modelCalls:0,walletPayments:0,telegramSends:0},null,2));`);
fs.mkdirSync('.tmp',{recursive:true});const runner='.tmp/mobile-export-browser-runner.mjs';fs.writeFileSync(runner,source);
const result=spawnSync(process.execPath,[runner,...process.argv.slice(2)],{stdio:'inherit',windowsHide:true,env:{...process.env,NODE_ENV:'test',PULSE_SKIP_DOTENV:'1'}});process.exitCode=result.status??1;
