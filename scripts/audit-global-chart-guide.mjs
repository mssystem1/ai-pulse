/** Capture the real chart controls and validate the current offline docs build.
 * Reuses report/export regression checks; no remote requests, payments or orders.
 * Run after building web/API and rendering guide illustrations:
 * node scripts/audit-global-chart-guide.mjs --report-dir=PATH
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

async function captureGuideFigure(name,selector,{call,evaluate},controls=false){
  const clip=await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing capture element');const rect=element.getBoundingClientRect();let height=rect.height;if(${controls}){const chart=document.querySelector('.global-chart-scroll').getBoundingClientRect();height=Math.min(height,chart.top-rect.top+110);}return{x:rect.left+scrollX,y:rect.top+scrollY,width:rect.width,height,scale:2};})()`);
  assert.ok(clip.width>300&&clip.height>20);
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
  const bytes=Buffer.from(shot.data,'base64');
  for(const dir of ['apps/web/public/docs/global-chart','apps/web/dist/docs/global-chart']){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),bytes);}
  guideScreenshots.push({name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),scale:2});
}

async function captureGuideControls({frame,lang,theme,width},bridge){
  if(process.argv.includes('--no-public-captures')||frame!=='1Wutc'||width!==1454)return;
  const appearance=theme==='base'?'light':'dark';
  await captureGuideFigure(`chart-controls-20261027-${appearance}-${lang}.png`,'.global-chart-panel',bridge,true);
  await captureGuideFigure(`chart-text-download-20261027-${appearance}-${lang}.png`,'.global-heading',bridge);
}

async function captureGuideSave({frame,lang,theme,width,format},bridge){
  if(process.argv.includes('--no-public-captures')||frame!=='1Wutc'||width!==1454||format!=='png')return;
  await captureGuideFigure(`chart-save-20261027-${theme==='base'?'light':'dark'}-${lang}.png`,'.report-download-dialog',bridge);
}

// The following browser function measures computed solid-color text contrast.
function guideContrast(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
  const rgba=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
  const blend=(front,back)=>front.slice(0,3).map((v,i)=>v*front[3]+back[i]*(1-front[3]));
  const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  return [...document.querySelectorAll('[data-global-guide-version] p,[data-global-guide-version] li,[data-global-guide-version] th,[data-global-guide-version] td,[data-global-guide-version] h2,[data-global-guide-version] h3,[data-global-guide-version] a,[data-global-guide-version] button')].filter(e=>e.getClientRects().length).map(element=>{
    const ancestors=[];for(let p=element;p;p=p.parentElement)ancestors.unshift(p);
    let background=[255,255,255];for(const p of ancestors)background=blend(rgba(getComputedStyle(p).backgroundColor),background);
    const foreground=blend(rgba(getComputedStyle(element).color),background),a=luminance(foreground),b=luminance(background);
    return{text:element.textContent.slice(0,85),tag:element.tagName,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  });
}

async function checkGuideDocs({call,evaluate,wait}){
  if(process.argv.includes('--docs-only')||process.argv.includes('--no-public-captures'))for(const appearance of ['light','dark'])for(const lang of ['en','zh'])for(const kind of ['chart-controls','chart-text-download','chart-save']){
    const name=`${kind}-20261027-${appearance}-${lang}.png`,file=path.join('apps/web/public/docs/global-chart',name);
    assert.ok(fs.existsSync(file),'Reusing captures requires existing public UI captures: '+file);
    const bytes=fs.readFileSync(file);guideScreenshots.push({name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),scale:2,reused:true});
    fs.mkdirSync('apps/web/dist/docs/global-chart',{recursive:true});fs.copyFileSync(file,path.join('apps/web/dist/docs/global-chart',name));
  }
  assert.equal(guideScreenshots.length,12,'Expected three UI captures for each language and appearance');
  for(const lang of ['en','zh'])for(const theme of ['base','xlayer'])for(const width of [1454,390]){
    const appearance=theme==='base'?'light':'dark';
    console.log(JSON.stringify({phase:'docs',lang,theme,width}));
    await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<600});
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`try{localStorage.setItem('pulse:language',${JSON.stringify(lang)})}catch{}`});
    await call('Page.navigate',{url:'about:blank'});
    await call('Page.navigate',{url:origin+'/docs?pulseTheme='+theme+'#docs-global-chart'});
    await wait('Boolean(document.querySelector("[data-global-guide-version]"))');
    assert.equal(await evaluate('document.documentElement.dataset.pulseTheme'),theme);
    assert.equal(await evaluate('document.querySelector("[data-global-guide-version]").dataset.globalGuideVersion'),'20261028');
    assert.equal(await evaluate('document.querySelector("[data-global-guide-version] h2").textContent'),lang==='en'?'Use the Global chart':'\u4f7f\u7528Global\u56fe\u8868');
    await evaluate('document.querySelectorAll("[data-global-guide-version] img").forEach(image=>image.loading="eager")');
    await wait('Array.from(document.querySelectorAll("[data-global-guide-version] img")).every(image=>image.complete&&image.naturalWidth>0)');
    assert.equal(await evaluate('document.querySelectorAll(".global-guide-examples button").length'),5);
    const examples=[];
    for(const [index,frame] of ['15m','1H','4H','1Dutc','1Wutc'].entries()){
      await evaluate(`document.querySelectorAll('.global-guide-examples button')[${index}].click()`,true);
      const expected=`chart-guide-20261028-${frame}-${appearance}-${lang}.png`;
      await wait(`(()=>{const image=document.querySelector('.global-guide-figure img[src*="chart-guide-"]');return image?.src.endsWith(${JSON.stringify(expected)})&&image.complete&&image.naturalWidth>=1800;})()`);
      assert.equal(await evaluate('document.querySelectorAll(".global-guide-examples button[aria-pressed=true]").length'),1);
      examples.push({frame,path:expected,width:await evaluate('document.querySelector(".global-guide-figure img[src*=chart-guide-]").naturalWidth')});
    }
    const images=await evaluate('Array.from(document.querySelectorAll("[data-global-guide-version] img")).map(image=>({src:new URL(image.src).pathname,width:image.naturalWidth,height:image.naturalHeight,loaded:image.complete}))');
    assert.ok(images.length>=3&&images.every(image=>image.loaded&&image.width>=1000&&(image.src.includes('/chart-guide-20261028-')||/\/chart-(?:controls|text-download|save)-20261027-/.test(image.src))&&image.src.endsWith(`-${appearance}-${lang}.png`)));
    const contrast=await evaluate('('+guideContrast.toString()+')()');
    assert.ok(contrast.length>20&&contrast.every(item=>item.ratio>=4.5),'Guide contrast: '+JSON.stringify(contrast.filter(item=>item.ratio<4.5)));
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Docs overflow');
    await evaluate(`document.querySelector(${JSON.stringify(width<600?'.global-guide-figure':'[data-global-guide-version]')}).scrollIntoView({block:"start"})`);
    await evaluate('Promise.all(Array.from(document.querySelectorAll("[data-global-guide-version] img")).map(image=>image.decode())).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    const paintedImage=await evaluate('(()=>{const image=document.querySelector(".global-guide-figure img"),style=getComputedStyle(image),rect=image.getBoundingClientRect();return{display:style.display,visibility:style.visibility,opacity:Number(style.opacity),width:rect.width,height:rect.height,inViewport:rect.top<innerHeight&&rect.bottom>0&&rect.left<innerWidth&&rect.right>0};})()');
    assert.ok(paintedImage.display!=='none'&&paintedImage.visibility==='visible'&&paintedImage.opacity>0&&paintedImage.width>0&&paintedImage.height>0&&paintedImage.inViewport,'Guide image is not visibly presented: '+JSON.stringify(paintedImage));
    const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(out,`docs-${lang}-${theme}-${width}.png`),Buffer.from(screenshot.data,'base64'));
    guideCases.push({lang,theme,width,version:'20261028',examples,images,paintedImage,minTextContrast:Math.min(...contrast.map(item=>item.ratio)),overflow:false});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
  fs.writeFileSync(path.join(out,'guide-validation.json'),JSON.stringify({mode:process.argv.includes('--docs-only')?'docs-only':'full',cases:guideCases,screenshots:guideScreenshots,blockedTelemetry,remoteRequestsBlocked:true,physicalDevices:false,modelCalls:0,walletPayments:0,telegramSends:0},null,2));
}

function augmentGuideRunner(source){
  const replace=(needle,value)=>{assert.ok(source.includes(needle),'Missing runner hook: '+needle);source=source.replace(needle,value);};
  replace('},20000);pending.set(request','},60000);pending.set(request');
  const reportCase=source.match(/for\(const width of \[1454,390\]\)for\(const theme of [^\n]+\)\{/)?.[0];
  assert.ok(reportCase,'Missing report-case progress hook');
  replace(reportCase,reportCase+"\n      console.log(JSON.stringify({phase:'report',frame,lang,theme,width}));");
  const helpers=[captureGuideFigure,captureGuideControls,captureGuideSave,guideContrast,checkGuideDocs].map(String).join('\n');
  replace('const server=http.createServer','const guideScreenshots=[],guideCases=[],blockedTelemetry=[];\n'+helpers+'\nconst server=http.createServer');
  replace("if(!['GET','HEAD','OPTIONS'].includes(request.method))",`if(request.method==='POST'&&['https://cca-lite.coinbase.com/amp','https://cca-lite.coinbase.com/metrics','https://pulse.walletconnect.org/batch'].includes(url.origin+url.pathname)){
      blockedTelemetry.push({method:request.method,origin:url.origin,path:url.pathname});await call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});return;
    }
    if(!['GET','HEAD','OPTIONS'].includes(request.method))`);
  replace('mutations.push({method:request.method,path:url.pathname})','mutations.push({method:request.method,origin:url.origin,path:url.pathname})');
  replace('navigationCancellations,mutations,remoteRequestsBlocked:true','navigationCancellations,mutations,blockedTelemetry,remoteRequestsBlocked:true');
  replace("await evaluate('('+installFileBridges.toString()+')();');","await captureGuideControls({frame,lang,theme,width},{call,evaluate,wait});\n  await evaluate('('+installFileBridges.toString()+')();');");
  replace('const nativeBefore=await evaluate','await captureGuideSave({frame,lang,theme,width,format},{call,evaluate,wait});\n    const nativeBefore=await evaluate');
  const navigation="await call('Page.navigate',{url:'about:blank'});await call('Page.navigate',{url:origin+'/shared-report?";
  replace(navigation,"await call('Page.addScriptToEvaluateOnNewDocument',{source:`try{localStorage.setItem('pulse:language',${JSON.stringify(lang)})}catch{}`});\n      "+navigation);
  if(process.argv.includes('--docs-only')){
    replace('for(const report of reports.filter(r=>!frameFilter||frameFilter.includes(r.snapshot.timeframe))){','for(const report of []){');
    replace('assert.ok(downloadCases.length>=40);','assert.equal(downloadCases.length,0);');
  }
  replace('const proofFile=',"fs.writeFileSync(path.join(out,'report-checkpoint.json'),JSON.stringify({reportPhaseComplete:true,cases,downloadCases,exportRequests,runtimeErrors:errors,mutations,blockedTelemetry,remoteRequestsBlocked:true,modelCalls:0,walletPayments:0},null,2));\n  await checkGuideDocs({call,evaluate,wait});\n  const proofFile=");
  return source;
}

const args=process.argv.slice(2);
assert.ok(args.some(arg=>arg.startsWith('--report-dir=')),'Supply --report-dir with saved JSON reports for all five timeframes');
if(!args.some(arg=>arg.startsWith('--themes=')))args.push('--themes=base,xlayer');
assert.ok(args.includes('--themes=base,xlayer'),'Guide captures require --themes=base,xlayer');
if(!args.includes('--output-dir'))args.push('--output-dir',args.includes('--docs-only')?'.tmp/global-chart-guide-docs-only':'.tmp/global-chart-guide-browser');
let wrapper=fs.readFileSync('scripts/audit-global-mobile-exports.mjs','utf8');
const entry='const result=spawnSync';assert.ok(wrapper.includes(entry));
wrapper=wrapper.replace(entry,'fs.writeFileSync(runner,augmentGuideRunner(fs.readFileSync(runner,"utf8")));\n'+entry);
wrapper=[captureGuideFigure,captureGuideControls,captureGuideSave,guideContrast,checkGuideDocs,augmentGuideRunner].map(String).join('\n')+'\n'+wrapper;
fs.mkdirSync('.tmp',{recursive:true});
const wrapperFile='.tmp/global-chart-guide-wrapper.mjs';fs.writeFileSync(wrapperFile,wrapper);
const result=spawnSync(process.execPath,[wrapperFile,...args],{stdio:'inherit',windowsHide:true,env:{...process.env,NODE_ENV:'test',PULSE_SKIP_DOTENV:'1'}});
process.exitCode=result.status??1;
