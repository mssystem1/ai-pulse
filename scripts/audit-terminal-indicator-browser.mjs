import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Real application + real local API. The caller holds the test key; this module only receives a restricted message signer. */
export async function runTerminalBrowser({ apiOrigin, owner, payee, folder, sign, record, expectedExpiry, commerce }) {
  const root = process.cwd(), origin = 'http://127.0.0.1:5288', cdpOrigin = 'http://127.0.0.1:9398';
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
    vite = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', '5288', '--strictPort'], { cwd: path.join(root, 'apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin, VITE_ENABLED_NETWORKS: 'base', VITE_PAY_TO_ADDRESS: payee, VITE_PUBLIC_LANDING_ENABLED: '1' }, windowsHide: true, stdio: 'ignore' });
    for (let i = 0; i < 160; i++) { try { if ((await fetch(origin)).ok) break; } catch { /* starting */ } await pause(150); }
    const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
    assert.ok(chromePath, 'Installed Chrome is required');
    chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--disable-gpu', '--disable-background-networking', '--remote-debugging-port=9398', '--user-data-dir=' + path.join(out, 'profile-' + Date.now()), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
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
      await ev(`(()=>{const scope=${scope},label=[...scope.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}));let e=label?.querySelector('input,select,textarea');if(!e&&label?.htmlFor)e=document.getElementById(label.htmlFor);if(!e)throw Error('Missing field '+${JSON.stringify(label)});const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(80);
    };
    const shot = async (name, selector, fullElement=false) => { await ev('document.fonts.ready'); await ev(selector ? `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})` : 'scrollTo(0,0)'); await pause(150); if(fullElement)await ev("(()=>{const style=document.createElement('style');style.id='qa-capture-header';style.textContent='header{visibility:hidden!important}';document.head.append(style);window.__qaCaptureOverlays=[...document.querySelectorAll('body *')].filter(element=>['fixed','sticky'].includes(getComputedStyle(element).position)&&!element.closest('.global-chart-stage')).map(element=>[element,element.style.visibility]);for(const [element] of window.__qaCaptureOverlays)element.style.visibility='hidden';})()");const clip=fullElement?await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1};})()`):undefined;const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullElement,...(clip?{clip}:{}) }); const filename = name + '.png'; fs.writeFileSync(path.join(out, filename), Buffer.from(result.data, 'base64')); screenshots.push(filename);if(fullElement)await ev("(()=>{document.getElementById('qa-capture-header')?.remove();for(const [element,visibility] of window.__qaCaptureOverlays??[])element.style.visibility=visibility;delete window.__qaCaptureOverlays;})()"); };
    await call('Page.enable'); await call('Runtime.enable'); await call('Runtime.addBinding', { name: '__pulseTerminalSign' });
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{
      const owner=${JSON.stringify(owner)},pending=new Map(),listeners=new Map();let serial=0;
      window.__pulseTerminalWalletCalls=[];
      const realFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await realFetch(...args);const url=String(args[0]?.url??args[0]);if(response.ok&&url.includes('/indicators/')&&url.endsWith('/quote')){try{window.__pulseLastIndicatorQuote=(await response.clone().json()).quote;}catch{}}return response;};
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
    await until('document.querySelector(".terminal-chart canvas")', 'The current shared chart did not render', 500);
    assert.equal(signCount, 1); checked('real_owner_signin_paid_access_current_chart', { walletSignatures: signCount });
    await until('document.querySelector(".terminal-access-countdown [role=timer]")?.dataset.remainingSeconds', 'Paid access countdown did not render');
    const timerStart = await ev('Number(document.querySelector(".terminal-access-countdown [role=timer]").dataset.remainingSeconds)');
    if (expectedExpiry) assert.ok(Math.abs(timerStart - (Date.parse(expectedExpiry) - Date.now()) / 1000) < 4, 'Countdown disagrees with the original server grant');
    assert.equal(await ev('document.querySelector(".terminal-access-countdown [role=timer]").getAttribute("aria-live")'), 'off');
    await pause(1400);
    const timerLater = await ev('Number(document.querySelector(".terminal-access-countdown [role=timer]").dataset.remainingSeconds)');
    assert.ok(timerLater < timerStart && timerLater >= timerStart - 4, 'Countdown did not advance in real time');
    checked('paid_access_countdown_matches_original_grant_and_ticks', { timerStart, timerLater, expiry: expectedExpiry });
    {
      assert.equal(await ev('document.querySelectorAll(".terminal-workspace-nav button").length'),7);checked('seven_dedicated_terminal_sidebar_destinations');
      const destinations=[['market','.terminal-chart'],['tools','.terminal-retained-tools'],['radar','.terminal-radar'],['creator','[data-indicator-builder]'],['indicators','[data-indicator-market]'],['positions','.terminal-position-list,.terminal-empty'],['activity','.terminal-activity-guide']];
      const selectedMarket=await ev('document.querySelector(".terminal-market-clock strong").textContent');
      for(let index=0;index<destinations.length;index++){
        const [destination,selector]=destinations[index];await click(`.terminal-workspace-nav button:nth-of-type(${index+1})`);
        await until(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0)`,`The ${destination} destination did not open`);
        assert.equal(await ev('new URL(location.href).searchParams.get("terminalSection")'),destination);
        assert.equal(await ev('document.querySelector(".terminal-workspace-nav [aria-current=page]").textContent.includes('+JSON.stringify(index===5?'My open positions':index===6?'Alerts & activity':index===0?'Trading Terminal':index===1?'Market tools':index===2?'Market Radar':index===3?'Create indicator':'Indicator Market')+')'),true);
        assert.equal(await ev('document.querySelector(".terminal-market-clock strong").textContent'),selectedMarket);
        checked('sidebar_destination_opens_and_preserves_market',{destination});
      }
      await click('.terminal-workspace-nav button:nth-of-type(5)');
      await until('document.querySelector("[data-indicator-market]")', 'Indicator Market missing in actual app', 500);
      await until('document.querySelector("[data-installed-indicator] svg")', 'Live CVD calculation did not render',500);
      if(await ev('[...document.querySelectorAll("button")].some(b=>!b.hidden&&b.textContent.trim()==="Browse indicators")'))await button('Browse indicators');
      await until('document.querySelectorAll(".indicator-catalog-grid .indicator-registration").length===3','Registered built-in circuit metadata did not render',80).catch(async()=>{assert(await ev('document.querySelector(".indicator-catalog-grid").textContent.includes("753060")'),'Registered built-in circuit block evidence is missing');});
      checked('actual_xlayer_registration_proofs_visible_in_catalog');
      await ev(`(()=>{const card=[...document.querySelectorAll('.indicator-catalog-grid article')].find(e=>e.querySelector('h4')?.textContent==='Buyer participation');card.querySelector('button').click();})()`);
      await until('document.querySelectorAll(".indicator-installed").length===2','Adding indicator failed');
      checked('live_indicator_catalog_install_two_numeric_panes');
      await click('[data-installed-indicator="pulse.executed-cvd"] [data-ask-pulse]');
      await until('document.querySelector(".terminal-ai-drawer")?.textContent.includes("grok-4.7")','AI drawer model is missing');
      assert.ok(await ev('document.querySelector("#terminal-question").value.includes("cumulative executed delta")'));
      await click('.terminal-ai-drawer button[aria-label="Close Ask PULSE"]');
      checked('indicator_ask_button_prefills_context_and_exposes_model');
      await click('.terminal-workspace-nav button:nth-of-type(4)');
      await until('document.querySelector("[data-indicator-builder]")?.getBoundingClientRect().height','Dedicated in-app builder is missing');
      await click('[data-indicator-template="weighted-flow"]');
      await field('Indicator name','Browser weighted flow','document.querySelector("[data-indicator-builder]")');
      await until('Number(document.querySelector("[data-builder-plotted-points]")?.dataset.builderPlottedPoints)>0','Builder real market preview has no numerical series',600);
      assert.equal(await ev('document.querySelector("[data-indicator-builder]").textContent.includes("Package ID")'),false);
      await button('Save draft','document.querySelector("[data-indicator-builder]")');
      for(const width of [1440,390]){
        await call('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1050,deviceScaleFactor:1,mobile:width===390});
        assert.equal(await ev('document.documentElement.scrollWidth>innerWidth+1'),false);
        await shot('native-creator-preview-'+width,'[data-indicator-builder]');
      }
      await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
      checked('native_builder_template_real_source_preview_and_private_draft');
      await button('Add & view on chart','document.querySelector("[data-indicator-builder]")');
      let customManifest=await ev('JSON.parse(localStorage.getItem("pulse-indicators-v1")).find(item=>item.title==="Browser weighted flow")');
      assert.equal(customManifest.format,'pulse-indicator-v3');assert(customManifest.id.startsWith('trader.'));
      await until(`Number(document.querySelector('[data-chart-indicator="${customManifest.id}@${customManifest.version}"]')?.dataset.plottedPoints)>0`,'Actual chart series has no plotted custom values');
      const plotted=await ev(`({...document.querySelector('[data-chart-indicator="${customManifest.id}@${customManifest.version}"]').dataset})`);
      assert.equal(plotted.plottedUnits,'BTC');assert(Number(plotted.plottedTo)>=Number(plotted.plottedFrom));
      checked('created_indicator_has_nonempty_native_chart_series_and_auto_identity',{manifestId:customManifest.id,plottedPoints:Number(plotted.plottedPoints),units:plotted.plottedUnits});
      await click('.terminal-workspace-nav button:nth-of-type(4)');
      await button('Publish','document.querySelector(".indicator-builder-tabs")');
      await button('Publish indicator','document.querySelector("[data-indicator-builder]")');
      await until('document.querySelector("[data-indicator-market]").textContent.includes("Published. Other Terminal users")','Publishing the created native study failed');
      await click('.terminal-workspace-nav button:nth-of-type(5)');
      await until(`[...document.querySelectorAll('[data-indicator-listing]')].some(e=>e.querySelector('h4')?.textContent==='Browser weighted flow')`,'Published custom indicator is not discoverable');
      const ownListing=await ev(`(()=>{const e=[...document.querySelectorAll('[data-indicator-listing]')].find(e=>e.querySelector('h4')?.textContent==='Browser weighted flow');return e.dataset.indicatorListing;})()`);
      await button('Unpublish',`document.querySelector('[data-indicator-listing="${ownListing}"]')`);
      await until(`!document.querySelector('[data-indicator-listing="${ownListing}"]')`,'Unpublish did not finish removing the exact listing',500);
      checked('native_builder_publish_discover_and_unpublish_exact_version',{manifestId:customManifest.id});
      await click('.terminal-workspace-nav button:nth-of-type(4)');
      await button('Publish','document.querySelector(".indicator-builder-tabs")');
      await field('Installation','paid','document.querySelector("[data-indicator-builder]")');
      await field('Creator price',0.002,'document.querySelector("[data-indicator-builder]")');
      await button('Add & view on chart','document.querySelector("[data-indicator-builder]")');
      const revisedManifest=await ev('JSON.parse(localStorage.getItem("pulse-indicators-v1")).find(item=>item.title==="Browser weighted flow")');
      assert.equal(revisedManifest.id,customManifest.id);assert.equal(revisedManifest.version,'1.0.1');
      customManifest=revisedManifest;
      checked('edited_commercial_terms_advance_automatic_version_without_a_publication_or_payment');
      await click('.terminal-workspace-nav button:nth-of-type(4)');
      await click('[data-indicator-template="participation"]');
      await field('Indicator name','Browser buyer share','document.querySelector("[data-indicator-builder]")');
      await field('Threshold',60,'document.querySelector("[data-indicator-builder]")');
      await button('Save draft','document.querySelector("[data-indicator-builder]")');
      await field('Indicator name','Unsaved temporary edit','document.querySelector("[data-indicator-builder]")');
      await button('Open saved draft','document.querySelector("[data-indicator-builder]")');
      assert.equal(await ev('document.querySelector("[data-indicator-builder] input").value'),'Browser buyer share');
      await until('[...document.querySelectorAll("[data-indicator-builder] button")].some(button=>button.textContent.trim()==="Add & view on chart"&&!button.disabled)','The restored draft is not ready to add');
      await button('Add & view on chart','document.querySelector("[data-indicator-builder]")');
      const participationManifest=await ev('JSON.parse(localStorage.getItem("pulse-indicators-v1")).find(item=>item.title==="Browser buyer share")');
      await until(`document.querySelector('[data-chart-indicator="${participationManifest.id}@${participationManifest.version}"]')?.dataset.condition==='Above 60 %'`,'Edited condition was not carried to the real chart');
      assert.equal(await ev(`document.querySelector('[data-chart-indicator="${participationManifest.id}@${participationManifest.version}"]').dataset.plottedUnits`),'%');
      await until('[...document.querySelectorAll(".terminal-chart [data-chart-pane=indicator]")].length===4&&[...document.querySelectorAll(".terminal-chart [data-chart-pane=indicator]")].every(pane=>Number(pane.dataset.paneHeight)>=100)','Native indicator panes were compressed below a readable height');await pause(300);await button('Inspect execution window on chart','document.querySelector(".terminal-chart")');await pause(400);await shot('native-chart-created-condition-1440','.terminal-chart .global-chart-stage',true);
      await until('Number(document.querySelector(".terminal-chart [data-execution-price-points]")?.dataset.executionPricePoints)>0','Captured Spot price context is missing at execution zoom');checked('private_draft_restore_and_custom_percentage_condition_on_native_chart');
      for(const frame of ['1D','1W']){
        await button(frame,'document.querySelector(".terminal-frames")');
        await until('document.querySelector(".terminal-market-clock strong")?.textContent.endsWith('+JSON.stringify(frame)+')','Timeframe did not switch',800);
        await until('document.querySelector(".terminal-chart [data-visible-time-from]")','Native viewport metadata missing');
        await button('Reset view','document.querySelector(".terminal-chart")');await pause(250);
        const reset=await ev('({...document.querySelector(".terminal-chart [data-visible-time-from]").dataset})');
        assert(Number(reset.visibleTimeTo)>Number(reset.visibleTimeFrom));
        assert(Number(reset.visibleTimeTo)-Number(reset.visibleTimeFrom)>86400,'Reset collapsed the primary chart into minute indices');
        await button('Inspect execution window on chart','document.querySelector(".terminal-chart")');await pause(250);
        const inspect=await ev('({...document.querySelector(".terminal-chart [data-visible-time-from]").dataset})');
        assert(Number(inspect.visibleTimeTo)>Number(inspect.visibleTimeFrom));
        assert(Number(inspect.visibleTimeTo)-Number(inspect.visibleTimeFrom)<Number(reset.visibleTimeTo)-Number(reset.visibleTimeFrom),'Inspect must focus the actual execution timestamps');
        await shot('native-chart-'+frame+'-execution-window','.terminal-chart');
        checked('daily_weekly_reset_and_actual_execution_time_inspection',{frame,resetFrom:Number(reset.visibleTimeFrom),resetTo:Number(reset.visibleTimeTo),inspectFrom:Number(inspect.visibleTimeFrom),inspectTo:Number(inspect.visibleTimeTo)});
      }
      await click('.terminal-workspace-nav button:nth-of-type(5)');
      await field('Indicator inputs','perpetual','document.querySelector("[data-indicator-market]")');
      await button('View chart with indicators','document.querySelector("[data-indicator-market]")');
      await until(`document.querySelector('[data-chart-indicator="${customManifest.id}@${customManifest.version}"]')?.dataset.plottedUnits==='contracts'`,'Spot to Futures kept the BTC price formatter');
      checked('same_installed_indicator_switches_native_chart_formatter_to_contracts');
      await click('.terminal-workspace-nav button:nth-of-type(5)');
      await field('Indicator inputs','spot','document.querySelector("[data-indicator-market]")');
      for(const theme of ['base','xlayer'])for(const width of [1440,390]){
        await call('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1050,deviceScaleFactor:1,mobile:width===390});
        await ev(`document.documentElement.dataset.pulseTheme=${JSON.stringify(theme)}`);await pause(250);
        const overflow=await ev('document.documentElement.scrollWidth>innerWidth+1');assert.equal(overflow,false);
        await shot('indicator-'+theme+'-'+width,'[data-indicator-market]');checked('live_indicator_layout',{theme,width});
      }
      if(commerce){
        await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
        await click('.terminal-workspace-nav button:nth-of-type(5)');
        const listingSelector=`[data-indicator-listing="${commerce.listingId}"]`;
        await until(`document.querySelector(${JSON.stringify(listingSelector)})`,'The paid QA creator listing is missing');
        if(!commerce.alreadyPurchased){
          await button('Review 0.001 USDC on Base',`document.querySelector(${JSON.stringify(listingSelector)})`);
          await until('document.querySelector(".indicator-purchase-review")','Creator purchase review did not open');
          assert(await ev('document.querySelector(".indicator-purchase-review").textContent.includes('+JSON.stringify(commerce.recipient.toLowerCase())+')'));
          await shot('creator-checkout-review-1440','.indicator-purchase-review');
          await button('Approve 0.001 USDC on Base','document.querySelector(".indicator-purchase-review")');
          await until(`document.querySelector('[data-installed-indicator="${commerce.manifestId}"]')`,'Paid browser checkout did not install the purchased indicator',1200);
          assert.equal(typedSignCount,1);checked('funded_creator_checkout_from_browser_review_to_installed_indicator',{listingId:commerce.listingId,typedSignatures:typedSignCount});
        }else{
          await button('Restore to chart',`[...document.querySelectorAll('.indicator-receipts article')].find(e=>e.textContent.includes(${JSON.stringify(commerce.title)})&&e.textContent.includes(${JSON.stringify(commerce.version)}))`);
        }
        await ev(`window.__pulseAcceptanceAction('delist',{listingId:${JSON.stringify(commerce.listingId)}})`);
        await button('Remove',`document.querySelector('[data-installed-indicator="${commerce.manifestId}"]')`);
        assert.equal(await ev(`Boolean(document.querySelector('[data-installed-indicator="${commerce.manifestId}"]'))`),false);
        await button('Restore to chart',`[...document.querySelectorAll('.indicator-receipts article')].find(e=>e.textContent.includes(${JSON.stringify(commerce.title)})&&e.textContent.includes(${JSON.stringify(commerce.version)}))`);
        await until(`document.querySelector('[data-installed-indicator="${commerce.manifestId}"]')`,'Purchased indicator failed to restore after actual delisting');
        assert.equal(typedSignCount,commerce.alreadyPurchased?0:1);checked('delisted_paid_indicator_restores_through_browser_without_another_signature');
        await shot('creator-purchase-restored-1440',`[data-installed-indicator="${commerce.manifestId}"]`);
      }
      walletCalls.push(...await ev('window.__pulseTerminalWalletCalls??[]'));
      const {runIndicatorPortabilityBrowser}=await import('./audit-indicator-portability-browser.mjs');
      await runIndicatorPortabilityBrowser({call,ev,until,field,button,click,checked,shot,origin,manifestId:customManifest.id});
      await call('Page.navigate',{url:origin+'/docs#docs-indicator-market'});
      await until('document.getElementById("docs-indicator-market")','Dedicated indicator guide anchor is missing');
      assert(await ev('document.getElementById("docs-indicator-market").textContent.includes("Add to chart")'));
      await shot('indicator-guide-390','#docs-indicator-market');
      await ev('location.hash="docs-create-indicator"');await until('document.getElementById("docs-create-indicator")','Creator guide anchor is missing');
      await ev('[...document.querySelectorAll("#docs-create-indicator img[src*=live-example]")].forEach(image=>image.loading="eager")');
      await until('[...document.querySelectorAll("#docs-create-indicator img[src*=live-example]")].length===2&&[...document.querySelectorAll("#docs-create-indicator img[src*=live-example]")].every(image=>image.complete&&image.naturalWidth>0)','The actual builder and chart screenshots did not load');
      await shot('creator-guide-390','#docs-create-indicator');checked('illustrated_indicator_and_creator_docs_direct_links');
      await call('Page.navigate',{url:origin+'/landing'});
      await until('document.getElementById("indicator-market")','Dedicated public landing indicator section is missing');
      assert(await ev('document.getElementById("indicator-market").textContent.includes("Indicator Market")'));
      assert(await ev('[...document.getElementById("indicator-market").querySelectorAll("a")].some(a=>a.href.includes("terminalSection=indicators"))'));
      assert.equal(await ev('document.documentElement.scrollWidth>innerWidth+1'),false);
      await shot('indicator-landing-390','#indicator-market');checked('public_landing_indicator_market_and_direct_terminal_link');
      walletCalls.push(...await ev('window.__pulseTerminalWalletCalls??[]'));
      assert.equal(walletCalls.some(method=>/eth_send|wallet_send/.test(method)),false);
      assert.equal(walletCalls.filter(method=>method==='eth_signTypedData_v4').length,typedSignCount);
      assert.equal(errors.length,0,errors.join('\n'));
      const result={at:new Date().toISOString(),scope:commerce?'Actual PULSE browser, real Base-paid pass and one guarded 0.001 USDC creator checkout when not already purchased; no exchange orders or Telegram sends':'Actual PULSE app and real Base-paid pass; payment signing disabled',checks,screenshots,errors,walletCalls,typedSignCount};
      fs.writeFileSync(path.join(out,'indicator-browser-validation.json'),JSON.stringify(result,null,2));return result;
    }
  } catch (error) {
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ at: new Date().toISOString(), message: redact(error.stack ?? error.message), checks, screenshots, errors }, null, 2)); throw error;
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })); } catch { /* owned process cleanup below */ } socket.close(); }
    chrome?.kill(); vite?.kill();
  }
}
