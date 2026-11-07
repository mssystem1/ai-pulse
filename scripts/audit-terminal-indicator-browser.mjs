import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Real application + real local API. The caller holds the test key; this module only receives a restricted message signer. */
export async function runTerminalBrowser({ apiOrigin, owner, payee, folder, sign, record, expectedExpiry }) {
  const root = process.cwd(), origin = 'http://127.0.0.1:5288', cdpOrigin = 'http://127.0.0.1:9398';
  const out = path.join(folder, 'browser'); fs.mkdirSync(out, { recursive: true });
  const checks = [], errors = [], screenshots = [], walletCalls = [];
  let vite, chrome, socket, signCount = 0;
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
          assert.equal(typeof request.message, 'string'); const signature = await sign(request.message); signCount++;
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
      assert.ok(await ev(`(()=>{const e=[...(${scope}).querySelectorAll('button')].find(e=>(e.textContent.trim()===${JSON.stringify(text)}||e.textContent.trim().startsWith(${JSON.stringify(text + ' · ')}))&&e.getBoundingClientRect().width);if(!e)return false;e.id=${JSON.stringify(id)};return true;})()`), 'Missing visible button: ' + text);
      await click('#' + id);
    };
    const field = async (label, value, scope = 'document') => {
      await ev(`(()=>{const scope=${scope},label=[...scope.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}));let e=label?.querySelector('input,select,textarea');if(!e&&label?.htmlFor)e=document.getElementById(label.htmlFor);if(!e)throw Error('Missing field '+${JSON.stringify(label)});const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(80);
    };
    const shot = async (name, selector) => { await ev('document.fonts.ready'); await ev(selector ? `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})` : 'scrollTo(0,0)'); await pause(150); const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const filename = name + '.png'; fs.writeFileSync(path.join(out, filename), Buffer.from(result.data, 'base64')); screenshots.push(filename); };
    await call('Page.enable'); await call('Runtime.enable'); await call('Runtime.addBinding', { name: '__pulseTerminalSign' });
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{
      const owner=${JSON.stringify(owner)},pending=new Map(),listeners=new Map();let serial=0;
      window.__pulseTerminalWalletCalls=[];
      window.__pulseTerminalSignReply=(id,result,error)=>{const p=pending.get(id);pending.delete(id);error?p?.reject(Error(error)):p?.resolve(result);};
      const provider={isMetaMask:true,chainId:'0x2105',selectedAddress:owner,on:(name,fn)=>{listeners.set(name,[...(listeners.get(name)||[]),fn]);},removeListener:(name,fn)=>{listeners.set(name,(listeners.get(name)||[]).filter(f=>f!==fn));},request:async({method,params=[]})=>{
        window.__pulseTerminalWalletCalls.push(method);
        if(method==='eth_accounts'||method==='eth_requestAccounts')return [owner];if(method==='eth_chainId')return '0x2105';
        if(method==='wallet_getPermissions'||method==='wallet_requestPermissions')return [{parentCapability:'eth_accounts'}];
        if(method==='wallet_getCapabilities')return {};
        if(method==='wallet_switchEthereumChain'){if(params[0]?.chainId!=='0x2105')throw Error('Only Base is enabled in this test');return null;}
        if(method==='personal_sign'){if(String(params[1]).toLowerCase()!==owner.toLowerCase())throw Error('Owner mismatch');let message=String(params[0]);if(/^0x[0-9a-f]+$/i.test(message))message=new TextDecoder().decode(Uint8Array.from(message.slice(2).match(/../g),v=>parseInt(v,16)));const id=++serial;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});window.__pulseTerminalSign(JSON.stringify({id,message}));});}
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
      await until('document.querySelector("[data-indicator-market]")', 'Indicator Market missing in actual app', 500);
      await until('document.querySelector("[data-installed-indicator] svg")', 'Live CVD calculation did not render',500);
      await button('Browse indicators');
      await ev(`(()=>{const card=[...document.querySelectorAll('.indicator-catalog-grid article')].find(e=>e.querySelector('h4')?.textContent==='Buyer participation');card.querySelector('button').click();})()`);
      await until('document.querySelectorAll(".indicator-installed").length===2','Adding indicator failed');
      checked('live_indicator_catalog_install_two_numeric_panes');
      await click('[data-installed-indicator="pulse.executed-cvd"] [data-ask-pulse]');
      await until('document.querySelector(".terminal-ai-drawer")?.textContent.includes("grok-4.7")','AI drawer model is missing');
      assert.ok(await ev('document.querySelector("#terminal-question").value.includes("cumulative executed delta")'));
      await click('.terminal-ai-drawer button[aria-label="Close Ask PULSE"]');
      checked('indicator_ask_button_prefills_context_and_exposes_model');
      for(const theme of ['base','xlayer'])for(const width of [1440,390]){
        await call('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1050,deviceScaleFactor:1,mobile:width===390});
        await ev(`document.documentElement.dataset.pulseTheme=${JSON.stringify(theme)}`);await pause(250);
        const overflow=await ev('document.documentElement.scrollWidth>innerWidth+1');assert.equal(overflow,false);
        await shot('indicator-'+theme+'-'+width,'[data-indicator-market]');checked('live_indicator_layout',{theme,width});
      }
      walletCalls.push(...await ev('window.__pulseTerminalWalletCalls??[]'));
      assert.equal(walletCalls.some(method=>/eth_send|eth_signTypedData|wallet_send/.test(method)),false);
      assert.equal(errors.length,0,errors.join('\n'));
      const result={at:new Date().toISOString(),scope:'Actual PULSE app, real Base-paid pass and restricted TEST_WALLET_ADDRESS sign-in; live market source, Indicator catalog/install, AI context, desktop/mobile in two themes; no payment signing, orders, journal mutations or Telegram sends',checks,screenshots,errors,walletCalls};
      fs.writeFileSync(path.join(out,'indicator-browser-validation.json'),JSON.stringify(result,null,2));return result;
    }
  } catch (error) {
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ at: new Date().toISOString(), message: redact(error.stack ?? error.message), checks, screenshots, errors }, null, 2)); throw error;
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })); } catch { /* owned process cleanup below */ } socket.close(); }
    chrome?.kill(); vite?.kill();
  }
}
