import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Real application + real local API. The caller holds the test key; this module only receives a restricted message signer. */
export async function runTerminalStudioBrowser({ apiOrigin, owner, payee, folder, sign, record, expectedExpiry, commerce }) {
  const root = process.cwd(), origin = 'http://127.0.0.1:5289', cdpOrigin = 'http://127.0.0.1:9399';
  const out = path.join(folder, 'browser'); fs.mkdirSync(out, { recursive: true });
  const checks = [], errors = [], screenshots = [], walletCalls = [];
  let vite, chrome, socket, signCount = 0, typedSignCount = 0;
  const checked = (name, details = {}) => { checks.push({ name, ...details }); record(`browser_${name}`, details); };
  const redact = value => String(value).replace(/0x[\da-f]{100,}/gi, '[redacted-long-hex]').slice(0, 1200);
  try {
    for (const [url, label] of [[origin, 'Vite'], [cdpOrigin + '/json/version', 'CDP']]) {
      let occupied = false; try { await fetch(url, { signal: AbortSignal.timeout(700) }); occupied = true; } catch { /* isolated port is free */ }
      assert.equal(occupied, false, `${label} acceptance port is already in use; leave existing helpers untouched`);
    }
    const vitePath = [path.join(root, 'node_modules/vite/bin/vite.js'), path.join(root, 'apps/web/node_modules/vite/bin/vite.js')].find(fs.existsSync);
    assert.ok(vitePath, 'Use the installed Vite; no dependency installation is allowed');
    vite = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', '5289', '--strictPort'], { cwd: path.join(root, 'apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin, VITE_ENABLED_NETWORKS: 'base', VITE_PAY_TO_ADDRESS: payee, VITE_PUBLIC_LANDING_ENABLED: '1' }, windowsHide: true, stdio: 'ignore' });
    for (let i = 0; i < 160; i++) { try { if ((await fetch(origin)).ok) break; } catch { /* starting */ } await pause(150); }
    const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
    assert.ok(chromePath, 'Installed Chrome is required');
    chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--disable-gpu', '--disable-background-networking', '--remote-debugging-port=9399', '--user-data-dir=' + path.join(out, 'profile-' + Date.now()), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let target; for (let i = 0; i < 120; i++) { try { target = await (await fetch(cdpOrigin + '/json/new?about:blank', { method: 'PUT' })).json(); if (target.webSocketDebuggerUrl) break; } catch { /* starting */ } await pause(150); }
    assert.ok(target?.webSocketDebuggerUrl, 'Chrome CDP did not start');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let sequence = 0; const pending = new Map();
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 80_000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.addEventListener('message', async event => {
      const message = JSON.parse(event.data);
      if (message.id) { const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter?.reject(Error(message.error.message)) : waiter?.resolve(message.result); return; }
      if (message.method === 'Runtime.exceptionThrown') errors.push(redact(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text));
      if (message.method === 'Runtime.bindingCalled' && message.params.name === '__pulseTerminalSign') {
        const request = JSON.parse(message.params.payload);
        try {
          let signature;
          if(request.kind==='typedData'){
            assert(commerce?.signTypedData,'Payment signing is disabled for this browser run');
            signature=await commerce.signTypedData(request.data,request.quote);typedSignCount++;
          }else if(request.kind==='delist'){
            assert(commerce?.delist);assert.equal(request.listingId,commerce.listingId);await commerce.delist();signature='delisted';
          }else{
            assert.equal(typeof request.message, 'string');signature=await sign(request.message);signCount++;
          }
          await call('Runtime.evaluate', { expression: `window.__pulseTerminalSignReply(${JSON.stringify(request.id)},${JSON.stringify(signature)},null)` });
        } catch (error) { await call('Runtime.evaluate', { expression: `window.__pulseTerminalSignReply(${JSON.stringify(request.id)},null,${JSON.stringify(redact(error.message))})` }); }
      }
    });
    const ev = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(redact(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)); return result.result.value; };
    const until = async (expression, label, attempts = 240) => { for (let i = 0; i < attempts; i++) { if (await ev(`Boolean(${expression})`)) return; await pause(150); } throw Error(label); };
    const click = async selector => {
      const point = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing element '+${JSON.stringify(selector)});if(e.disabled)throw Error('Disabled element '+e.textContent);e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }); await pause(120);
    };
    const button = async (text, scope = 'document') => {
      const id = 'qa-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      assert.ok(await ev(`(()=>{const e=[...(${scope}).querySelectorAll('button')].find(e=>(e.textContent.trim()===${JSON.stringify(text)}||e.textContent.trim().startsWith(${JSON.stringify(text + ' · ')}))&&e.getBoundingClientRect().width);if(!e)return false;e.dataset.qaAction=${JSON.stringify(id)};return true;})()`), 'Missing visible button: ' + text);
      await click('[data-qa-action="' + id + '"]');
    };
    const field = async (label, value, scope = 'document') => {
      await ev(`(()=>{const scope=${scope},label=[...scope.querySelectorAll('label')].find(l=>l.getBoundingClientRect().width&&l.textContent.trim().startsWith(${JSON.stringify(label)}));let e=label?.querySelector('input,select,textarea');if(!e&&label?.htmlFor)e=document.getElementById(label.htmlFor);if(!e)throw Error('Missing field '+${JSON.stringify(label)});const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(80);
    };
    const shot = async (name, selector, fullElement=false) => { await ev('document.fonts.ready'); await ev(selector ? `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})` : 'scrollTo(0,0)'); await pause(150); if(fullElement)await ev(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});window.__qaCaptureOverlays=[...document.querySelectorAll('body *')].filter(element=>['fixed','sticky'].includes(getComputedStyle(element).position)&&!element.closest('.global-chart-stage')).map(element=>[element,element.style.visibility,element.style.position]);for(const [element] of window.__qaCaptureOverlays){if(target.contains(element))element.style.position='static';else if(!element.contains(target))element.style.visibility='hidden';}})()`);const clip=fullElement?await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1};})()`):undefined;const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullElement,...(clip?{clip}:{}) }); const filename = name + '.png'; fs.writeFileSync(path.join(out, filename), Buffer.from(result.data, 'base64')); screenshots.push(filename);if(fullElement)await ev("(()=>{document.getElementById('qa-capture-header')?.remove();for(const [element,visibility,position] of window.__qaCaptureOverlays??[]){element.style.visibility=visibility;element.style.position=position;}delete window.__qaCaptureOverlays;})()"); };
    await call('Page.enable'); await call('Runtime.enable'); await call('Runtime.addBinding', { name: '__pulseTerminalSign' });
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{
      const owner=${JSON.stringify(owner)},pending=new Map(),listeners=new Map();let serial=0;
      window.__pulseTerminalWalletCalls=[];
      window.__qaRequests={};window.__qaFailFirstMarket=true;const realFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const requestPath=new URL(String(args[0]?.url??args[0]),location.href).pathname;window.__qaRequests[requestPath]=(window.__qaRequests[requestPath]??0)+1;if(window.__qaFailFirstMarket&&String(args[0]?.url??args[0]).includes('/v1/terminal/market?')){window.__qaFailFirstMarket=false;return new Response(JSON.stringify({error:'Market source temporarily unavailable (offline fault fixture)',code:'terminal_market_source_unavailable',recoverable:true}),{status:503,headers:{'content-type':'application/json'}});}const response=await realFetch(...args);const url=String(args[0]?.url??args[0]);if(response.ok&&url.includes('/indicators/')&&url.endsWith('/quote')){try{window.__pulseLastIndicatorQuote=(await response.clone().json()).quote;}catch{}}return response;};
      window.__pulseAcceptanceAction=(kind,extra={})=>{const id=++serial;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});window.__pulseTerminalSign(JSON.stringify({id,kind,...extra}));});};
      window.__pulseTerminalSignReply=(id,result,error)=>{const p=pending.get(id);pending.delete(id);error?p?.reject(Error(error)):p?.resolve(result);};
      const provider={isMetaMask:true,chainId:'0x2105',selectedAddress:owner,on:(name,fn)=>{listeners.set(name,[...(listeners.get(name)||[]),fn]);},removeListener:(name,fn)=>{listeners.set(name,(listeners.get(name)||[]).filter(f=>f!==fn));},request:async({method,params=[]})=>{
        window.__pulseTerminalWalletCalls.push(method);
        if(method==='eth_accounts'||method==='eth_requestAccounts')return [owner];if(method==='eth_chainId')return '0x2105';
        if(method==='wallet_getPermissions'||method==='wallet_requestPermissions')return [{parentCapability:'eth_accounts'}];
        if(method==='wallet_getCapabilities')return {};
        if(method==='wallet_switchEthereumChain'){if(params[0]?.chainId!=='0x2105')throw Error('Only Base is enabled in this test');return null;}
        if(method==='personal_sign'){if(String(params[1]).toLowerCase()!==owner.toLowerCase())throw Error('Owner mismatch');let message=String(params[0]);if(/^0x[0-9a-f]+$/i.test(message))message=new TextDecoder().decode(Uint8Array.from(message.slice(2).match(/../g),v=>parseInt(v,16)));const id=++serial;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});window.__pulseTerminalSign(JSON.stringify({id,message}));});}
        if(method==='eth_signTypedData_v4'){if(String(params[0]).toLowerCase()!==owner.toLowerCase())throw Error('Payment owner mismatch');return window.__pulseAcceptanceAction('typedData',{data:JSON.parse(params[1]),quote:window.__pulseLastIndicatorQuote});}
        throw Error('Acceptance wallet forbids '+method);
      }};Object.defineProperty(window,'ethereum',{value:provider});
      window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'pulse-terminal-acceptance',name:'Test EOA',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'tech.ai-pulse.qa'},provider}})));
      localStorage.setItem('pulse:selected-network','base');localStorage.setItem('pulse:appearance','xlayer');
    })();` });
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: origin + '/trading-terminal' });
    await until('document.querySelector(".trading-terminal h1")', 'Terminal route did not render');
    await until('[...document.querySelectorAll(".terminal-access button")].some(b=>b.textContent.includes("Open my workspace"))', 'Existing wallet auto-connect did not restore the public test owner');
    const nav = await ev(`[...document.querySelectorAll('.service-tabs button,.service-nav button,.app-nav button,nav.tabs button')].map(b=>b.textContent.trim())`);
    const actualNav = nav.length ? nav : await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Portfolio');return b?[...b.parentElement.querySelectorAll('button')].map(b=>b.textContent.trim()):[];})()`);
    assert.equal(actualNav[0], 'Portfolio'); assert.equal(actualNav[1], 'Trading Terminal'); checked('existing_header_and_terminal_second_tab', { tabs: actualNav });
    await button('Open my workspace');
    await until('document.querySelector(".terminal-access")?.textContent.includes("Pass active until")', 'The real paid pass did not appear after owner signature');
    await until('document.querySelector(".terminal-error")?.textContent.includes("source temporarily unavailable")','Initial source error was not shown');
    await click('[data-terminal-view="creator"]');
    await field('Publisher name','PULSE QA Offline','document.querySelector("[data-indicator-studio]")');
    await button('Save to My indicators','document.querySelector("[data-indicator-studio]")');
    assert(await ev('document.querySelector("[data-indicator-studio]").textContent.includes("Saved to My indicators")'));
    assert(await ev('[...document.querySelector("[data-indicator-studio]").querySelectorAll("button")].find(b=>b.textContent==="Add & view on chart").disabled'));
    await click('[data-terminal-view="market"]');await button('Retry market');
    await until('document.querySelector(".terminal-chart canvas")','Retry did not restore market chart',500);
    checked('source_failure_keeps_drafts_editable_and_retry_restores_real_market');

    assert.equal(signCount,1);checked('wallet_owner_signature_memory_api_access');
    const go=async id=>click('[data-terminal-view="'+id+'"]');
    assert.equal(await ev('document.querySelectorAll("[data-terminal-view]").length'),8);checked('eight_sidebar_destinations');
    await go('creator');
    await field('Publisher name','PULSE QA Studio','document.querySelector("[data-indicator-studio]")');
    await until('document.querySelectorAll("[data-studio-plot]").length===3','EMA previews did not resolve',300);
    assert.equal(await ev('document.querySelector("[data-indicator-studio]").textContent.includes("Package ID")'),false);
    assert(await ev('document.querySelector("[data-indicator-studio]").textContent.includes("Calculation reference")'));
    await button('Script editor','document.querySelector("[data-indicator-studio]")');
    const initial=await ev('document.querySelector("[data-indicator-script]").value');
    await field('Indicator script',initial.replace('ema(close,20)','ema(close,10)').replace('EMA 20','EMA 10'),'document.querySelector("[data-indicator-studio]")');
    assert(await ev('[...document.querySelector("[data-indicator-studio]").querySelectorAll("button")].find(b=>b.textContent==="Add & view on chart").disabled'));
    await button('Compile script & update preview','document.querySelector("[data-indicator-studio]")');
    await until('document.querySelectorAll("[data-studio-plot]").length===3','Compiled script outputs missing');
    await field('Indicator name','EMA 10 / 50 study','document.querySelector("[data-indicator-studio]")');
    await button('Save to My indicators','document.querySelector("[data-indicator-studio]")');
    checked('studio_script_dirty_guard_compile_real_ohlcv_and_save');
    await shot('studio-1440','[data-indicator-studio]',true);
    fs.copyFileSync(path.join(out,'studio-1440.png'),path.join(root,'apps/web/public/docs/indicator-studio-live-example.png'));
    await go('my-indicators');
    await until('document.querySelector("[data-created-indicator]")','Saved creation did not appear');
    assert(await ev('document.querySelector("[data-created-indicator]").textContent.includes("PULSE QA Studio")'));
    await button('Open in builder','document.querySelector("[data-created-indicator]")');
    await until('document.querySelector("[data-indicator-studio]")?.getBoundingClientRect().width','Saved creation did not open Studio');
    await until('document.querySelectorAll("[data-studio-plot]").length===3','Restored creation preview did not resolve');
    await button('Add & view on chart','document.querySelector("[data-indicator-studio]")');
    await until('document.querySelectorAll("[data-chart-indicator]").length>=4','Price overlays and crossover output not applied',500);
    assert.equal(await ev('document.querySelectorAll(".terminal-price-overlay-labels span").length'),2);
    assert(await ev('document.querySelector(".terminal-price-overlay-labels").textContent.includes("PULSE QA Studio")'));
    await until('document.querySelector(".terminal-chart-indicator-key").textContent.includes("Primary candle overview")','Applying an indicator must preserve the primary candle clock');
    await shot('studio-price-overlays','[data-chart-indicator]');checked('restored_graph_native_price_overlays_publisher_and_primary_clock');
    await button('Inspect execution window on chart');
    await until('document.querySelector(".terminal-chart-indicator-key").textContent.includes("Execution inspection")','Micro inspection did not open');
    await button('Return to primary candles');checked('micro_inspection_and_primary_candles_return');
    await go('my-indicators');
    await shot('my-library-1440','[data-indicator-market]',true);
    fs.copyFileSync(path.join(out,'my-library-1440.png'),path.join(root,'apps/web/public/docs/indicator-my-library-live-example.png'));
    await go('indicators');
    await until('[...document.querySelectorAll(".indicator-catalog article")].some(c=>c.textContent.includes("QA paid EMA study"))','Local paid listing missing');
    await ev(`(()=>{const card=[...document.querySelectorAll('.indicator-catalog article')].find(c=>c.textContent.includes('QA paid EMA study'));const action=[...card.querySelectorAll('button')].find(b=>/review|buy|purchase/i.test(b.textContent));if(!action)throw Error('Paid review action missing');action.click();})()`);
    await until('document.querySelector(".indicator-purchase-review")','Paid service review did not open');
    const review=await ev('document.querySelector(".indicator-purchase-review").textContent');
    for(const term of ['QA paid EMA study','PULSE Fixture Publisher','0.001','USDC','Base','1.0.0'])assert(review.includes(term),'Missing payment review term '+term);
    await button('Cancel quote');checked('buyer_reviews_exact_publisher_version_base_usdc_amount_then_cancels_without_signing');
    await go('creator');
    await button('Executed-flow builder');
    await click('[data-indicator-template="weighted-flow"]');
    await field('Publisher name','PULSE QA Flow','document.querySelector("[data-flow-builder]")');
    await until('Number(document.querySelector("[data-builder-plotted-points]")?.dataset.builderPlottedPoints)>0','Real flow preview missing',300);
    await until('[...document.querySelector("[data-flow-builder]").querySelectorAll("option")].some(o=>o.textContent.includes("Recommended:"))','Exact matching registered weighted-flow core not recommended');checked('legacy_executed_flow_builder_and_creation_circuit_recommendations');
    await go('creator');await button('Visual & script Studio');
    for(const template of ['bollinger','rsi','atr','sweep-reclaim','tap-flow']){
      await click('[data-studio-template="'+template+'"]');
      await until('document.querySelectorAll("[data-studio-plot]").length>0','No actual preview '+template,300);
      checked('professional_template_preview',{template});
    }
    for(const width of [1440,390]){
      await call('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1050,deviceScaleFactor:1,mobile:width===390});
      assert.equal(await ev('document.documentElement.scrollWidth>innerWidth+1'),false,'Horizontal overflow at '+width);
      await shot('studio-'+width,'[data-indicator-studio]');
    }
    assert.equal(await ev('window.__qaRequests["/v1/terminal/history/collect"]??0'),0);assert.equal(await ev('window.__qaRequests["/v1/terminal/history/session"]??0'),0);checked('hidden_market_tools_do_not_read_sessions_or_launch_background_backfills');checked('studio_desktop_mobile_no_page_overflow');
    await call('Page.navigate',{url:origin+'/docs#docs-create-indicator'});
    await until('document.querySelectorAll("img[src*=indicator-studio-live-example]").length>0','Updated Studio guide missing');
    const guides=await ev('[...document.querySelectorAll("img[src*=live-example]")].map(i=>i.getAttribute("src"))');
    for(const src of guides){const selector=JSON.stringify('img[src="'+src+'"]');await ev(`document.querySelector(${selector}).scrollIntoView({block:"center"})`);await until(`document.querySelector(${selector}).complete&&document.querySelector(${selector}).naturalWidth>0`,'Guide image failed '+src,150);}
    assert.equal(await ev('document.documentElement.scrollWidth>innerWidth+1'),false);checked('illustrated_guides_load_on_mobile');
    await call('Page.navigate',{url:origin+'/landing'});await until('document.querySelector("#indicator-market")?.textContent.includes("visual blocks")','Landing page does not explain Studio');assert.equal(await ev('document.documentElement.scrollWidth>innerWidth+1'),false);checked('public_landing_explains_studio_and_my_indicators');
    walletCalls.push(...await ev('window.__pulseTerminalWalletCalls??[]'));
    assert.equal(typedSignCount,0);assert.equal(walletCalls.some(method=>/eth_send|wallet_send|eth_signTyped/.test(method)),false);assert.equal(errors.length,0,errors.join('\n'));
    const result={at:new Date().toISOString(),scope:'Offline replay: actual PULSE app, local memory API and captured genuine BTC market input; simulated pass; no Railway/Redis, paid calls, trades, Telegram or payment signatures',checks,screenshots,errors};
    fs.writeFileSync(path.join(out,'studio-browser-validation.json'),JSON.stringify(result,null,2));if(fs.existsSync(path.join(out,'failure.json')))fs.unlinkSync(path.join(out,'failure.json'));return result;
  } catch (error) {
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ at: new Date().toISOString(), message: redact(error.stack ?? error.message), checks, screenshots, errors }, null, 2)); throw error;
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })); } catch { /* owned process cleanup below */ } socket.close(); }
    chrome?.kill(); vite?.kill();
  }
}
