import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPROVED_STARS, inspectCatalog, inspectWebhook, publicOrigin, runReadiness } from './telegram-readiness.mjs';

const env = { FEATURE_TELEGRAM: '1', FEATURE_JOBS: '1', FEATURE_PREDICTION_ANALYSIS: '1', TELEGRAM_STARS_ENABLED: '1', TELEGRAM_BOT_TOKEN: 'secret-token-do-not-print', TELEGRAM_BOT_USERNAME: 'pulsemi_bot', TELEGRAM_WEBHOOK_SECRET: 'distinct_secret', TELEGRAM_MINI_APP_URL: 'https://pulse.example', TELEGRAM_TON_MINI_APP_ENABLED:'1', TELEGRAM_TON_MINI_APP_URL:'https://pulse.example/ton-miniapp',TELEGRAM_SUPPORT_CONTACT:'@fixture_support',VITE_TELEGRAM_TON_APP_RETURN_URL:'https://t.me/pulsemi_bot?startapp', TELEGRAM_WEBHOOK_BASE_URL: 'https://api.example', BASE_URL: 'https://api.example', VITE_API_URL: 'https://api.example', TELEGRAM_STARS_GLOBAL_QUICK: '10', TELEGRAM_STARS_RISK_GUARD: '15', TELEGRAM_STARS_PREDICTION_QUICK: '10', TELEGRAM_STARS_GLOBAL_PRO: '15', TELEGRAM_STARS_PREDICTION_PRO: '15', QUEUE_PROVIDER: 'upstash_kv', KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'kv-secret', STORAGE_PROVIDER: 'vercel_blob', BLOB_READ_WRITE_TOKEN: 'blob-secret', REPORT_ENCRYPTION_KEY: 'A'.repeat(43), PERSISTENCE_NAMESPACE: 'pulse:production', REPORT_SHARE_LINK_ENABLED: '1' };
const catalog = { currency: 'XTR', checkoutReady: true, services: Object.entries(APPROVED_STARS).map(([id, stars]) => ({ id, stars, enabled: true })) };
const webhook = { url: 'https://api.example/v1/telegram/webhook', allowed_updates: ['message', 'callback_query', 'pre_checkout_query'], pending_update_count: 0 };
const status = { enabled: true, configured: true, durableDelivery: true, botUsername: 'pulsemi_bot', mode:"pulse",webhookPath:"/v1/telegram/webhook",miniAppUrl:env.TELEGRAM_TON_MINI_APP_URL };

test('public origins reject credentials, insecure protocols and non-origin URLs', () => {
  for (const url of ['http://api.example', 'https://u:p@api.example', 'https://api.example/api', 'https://api.example?token=secret', 'https://api.example#secret', 'https://localhost']) assert.throws(() => publicOrigin(url));
  assert.equal(publicOrigin('https://api.example/'), 'https://api.example');
});
test('catalog cannot pass with wrong IDs, duplicate IDs or approved-price mismatch', () => {
  for (const services of [catalog.services.slice(1), [...catalog.services.slice(1), catalog.services[1]], catalog.services.map((row, i) => i ? row : { ...row, stars: 11 })]) assert.ok(inspectCatalog({ ...catalog, services }).some(row => row.status === 'fail'));
});
test('paused stage expects hidden prices and cannot approve an active checkout', () => {
  const paused = { ...catalog, checkoutReady: false, services: catalog.services.map(row => ({ ...row, enabled: false, stars: null })) };
  assert.ok(inspectCatalog(paused, 'paused').every(row => row.status === 'pass'));
  assert.ok(inspectCatalog(catalog, 'paused').some(row => row.status === 'fail'));
});
test('webhook missing payment update type or wrong API fails', () => {
  assert.ok(inspectWebhook({ ...webhook, allowed_updates: ['message', 'callback_query'] }, 'https://api.example').some(row => row.status === 'fail'));
  assert.ok(inspectWebhook(webhook, 'https://other.example').some(row => row.status === 'fail'));
});
test('offline inspection never makes network requests and reports manual launch gates', async () => {
  const report = await runReadiness(env, { offline: true }, () => { throw new Error('Network must not run'); });
  assert.equal(report.technicalChecksPassed, true);
  assert.equal(report.launchApproved, false);
  assert.ok(report.counts.warn > 0);
  assert.ok(report.manualGates.length >= 5);
  const printed = JSON.stringify(report);
  for (const secret of [env.TELEGRAM_BOT_TOKEN, env.KV_REST_API_TOKEN, env.BLOB_READ_WRITE_TOKEN]) assert.ok(!printed.includes(secret));
});
test('live inspector uses only GET and never confuses technical success with launch approval', async () => {
  const calls = [];
  const report = await runReadiness(env, {}, async (url, init) => {
    calls.push(String(url));
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    const payload = String(url).endsWith('/services') ? catalog : String(url).endsWith('/status') ? status : { ok: true, result: String(url).endsWith('/getMe') ? { username: 'pulsemi_bot' } : webhook };
    return { ok: true, json: async () => payload };
  });
  assert.equal(report.technicalChecksPassed, true); assert.equal(report.launchApproved, false); assert.equal(calls.length, 4);
  assert.ok(calls.every(url => !/setWebhook|sendMessage|Invoice|refund/.test(url)));
});
test('all provider error details including credential URLs are suppressed', async () => {
  const report = await runReadiness(env, {}, async () => { throw new Error(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`); });
  assert.equal(report.technicalChecksPassed, false);
  assert.ok(!JSON.stringify(report).includes(env.TELEGRAM_BOT_TOKEN));
});
test('frontend/backend origin drift fails independently of healthy remote endpoints', async () => {
  const report = await runReadiness({ ...env, VITE_API_URL: 'https://other.example' }, { offline: true });
  assert.equal(report.technicalChecksPassed, false);
  assert.equal(report.checks.find(row => row.id === 'origin-VITE_API_URL').status, 'fail');
});
test('single-bot readiness rejects an old deployment and TON manifest HTML fallback',async()=>{
  const tonCatalog={...catalog,services:catalog.services.map(row=>['global-quick','global-pro'].includes(row.id)?row:{...row,enabled:false,stars:null})};
  const inspect=async(mode='ton_miniapp',html=false)=>runReadiness(env,{surface:'ton'},async url=>{
    const value=String(url);
    if(value.endsWith('/tonconnect-manifest.json'))return new Response(html?'<html>SPA fallback</html>':JSON.stringify({name:'PULSE',url:env.TELEGRAM_TON_MINI_APP_URL,iconUrl:'https://pulse.example/tonconnect-icon.png'}),{headers:{'Content-Type':html?'text/html':'application/json'}});
    return {ok:true,json:async()=>value.endsWith('/services')?tonCatalog:value.endsWith('/status')?{...status,mode}:{ok:true,result:value.endsWith('/getMe')?{username:'pulsemi_bot'}:webhook}};
  });
  assert.equal((await inspect()).technicalChecksPassed,true);
  assert.equal((await inspect('legacy_miniapp')).technicalChecksPassed,false);
  const fallback=await inspect('ton_miniapp',true);assert.equal(fallback.technicalChecksPassed,false);assert.equal(fallback.checks.find(row=>row.id==='ton-manifest').status,'fail');
  assert.ok(inspectCatalog(catalog,'checkout','ton').some(row=>row.status==='fail'),'TON Mini App must not enable EVM services');
});
