import { pathToFileURL } from 'node:url';

export const APPROVED_STARS = Object.freeze({ 'global-quick': 10, 'risk-guard': 15, 'prediction-quick': 10, 'global-pro': 15, 'prediction-pro': 15 });
export const APPROVED_TON_STARS = Object.freeze({ 'global-quick': 10, 'global-pro': 15 });
const PRICE_KEYS = { 'global-quick': 'TELEGRAM_STARS_GLOBAL_QUICK', 'risk-guard': 'TELEGRAM_STARS_RISK_GUARD', 'prediction-quick': 'TELEGRAM_STARS_PREDICTION_QUICK', 'global-pro': 'TELEGRAM_STARS_GLOBAL_PRO', 'prediction-pro': 'TELEGRAM_STARS_PREDICTION_PRO' };
const enabled = value => ['1', 'true'].includes(String(value).toLowerCase());
const check = (id, ok, detail, severity = 'fail') => ({ id, status: ok ? 'pass' : severity, detail });
const username = value => String(value || '').replace(/^@/, '').trim();

export function surfaceConfig(env, surface = 'chat') {
  if (!['chat', 'ton'].includes(surface)) throw new Error('View must be chat or ton.');
  const ton = surface === 'ton';
  return { surface, ton, prefix: ton ? '/v1/telegram/ton' : '/v1/telegram', mode: ton ? 'ton_miniapp' : 'pulse', token: env.TELEGRAM_BOT_TOKEN?.trim(), secret: env.TELEGRAM_WEBHOOK_SECRET?.trim(), username: username(env.TELEGRAM_BOT_USERNAME), appUrl: env[ton ? 'TELEGRAM_TON_MINI_APP_URL' : 'TELEGRAM_MINI_APP_URL']?.trim(), prices: ton ? APPROVED_TON_STARS : APPROVED_STARS };
}

export function publicOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) || /^(localhost|127\.|\[::1\])/.test(url.hostname)) throw new Error('Use a public HTTPS API origin without credentials, path, query or fragment.');
  return url.origin;
}

export function inspectLocalConfig(env, { apiOrigin, stage = 'checkout', surface = 'chat' } = {}) {
  const selected = surfaceConfig(env, surface);
  const checks = [];
  let origin;
  try { origin = publicOrigin(apiOrigin || env.TELEGRAM_WEBHOOK_BASE_URL || env.BASE_URL); }
  catch { checks.push(check('api-origin', false, 'Set --api-origin to the verified public HTTPS API origin.')); }
  if (origin) {
    checks.push(check('api-origin', true, origin));
    for (const name of ['TELEGRAM_WEBHOOK_BASE_URL', 'BASE_URL', 'VITE_API_URL']) {
      if (!env[name]) { checks.push(check(`origin-${name}`, false, `${name} is absent from the operator environment; inspect its deployed value.`, 'warn')); continue; }
      let matches = false;
      try { matches = publicOrigin(env[name]) === origin; } catch {}
      checks.push(check(`origin-${name}`, matches, `${name} must use the selected API origin. Local values do not establish deployed values.`));
    }
  }
  checks.push(check('feature-telegram', enabled(env.FEATURE_TELEGRAM), 'Telegram must remain enabled for webhook fulfillment.'));
  checks.push(check('feature-jobs', enabled(env.FEATURE_JOBS), 'The durable generation worker must be enabled.'));
  if (!selected.ton) checks.push(check('prediction-analysis', enabled(env.FEATURE_PREDICTION_ANALYSIS), 'Prediction analysis is required for the five-service catalog.'));
  checks.push(check('sales-state', stage === 'paused' ? env.TELEGRAM_STARS_ENABLED === '0' : env.TELEGRAM_STARS_ENABLED === '1', `Expected Stars sales ${stage === 'paused' ? 'paused (0)' : 'enabled (1)'} in this operator configuration.`));
  for (const [id, stars] of Object.entries(selected.prices)) checks.push(check(`price-${id}`, Number(env[PRICE_KEYS[id]]) === stars, `Approved ${id} price: ${stars} Stars.`));
  checks.push(check('bot-credentials', Boolean(selected.token && selected.username), 'Selected bot token and expected username must be present; values are never printed.'));
  checks.push(check('webhook-secret', /^[A-Za-z0-9_-]{1,256}$/.test(selected.secret || '') && selected.secret !== selected.token, 'Selected webhook secret must use the allowed format and differ from the bot token.'));
  checks.push(check('payment-support', Boolean(env.TELEGRAM_SUPPORT_CONTACT?.trim()), 'Configure an actual monitored payment-support contact; staffing requires manual acceptance.'));
  if (selected.ton) checks.push(check('ton-miniapp-enabled', env.TELEGRAM_TON_MINI_APP_ENABLED === '1', 'Enable the TON Mini App on the same PULSE bot.'));
  let miniValid = false;
  try { const url = new URL(selected.appUrl); publicOrigin(url.origin); miniValid = !url.username && !url.password && (selected.ton ? url.pathname === '/ton-miniapp' : ['', '/'].includes(url.pathname)) && !url.search && !url.hash; } catch {}
  checks.push(check('miniapp-url', miniValid, selected.ton ? 'TON Mini App requires the exact public HTTPS /ton-miniapp URL.' : 'Chat history/report pages require the public HTTPS website origin.'));
  if (selected.ton) {
    let returnMatches = false;
    try { const url = new URL(env.VITE_TELEGRAM_TON_APP_RETURN_URL); returnMatches = url.origin === 'https://t.me' && url.pathname.toLowerCase() === `/${selected.username.toLowerCase()}` && !url.hash && !url.username && !url.password; } catch {}
    checks.push(check('ton-return-link', returnMatches, 'Optional TON Connect return URL should point to the selected TON bot.', env.VITE_TELEGRAM_TON_APP_RETURN_URL ? 'fail' : 'warn'));
  }
  const durableQueue = env.QUEUE_PROVIDER === 'redis' ? /^rediss?:\/\//.test(env.REDIS_URL || '') : env.QUEUE_PROVIDER === 'upstash_kv' && Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
  checks.push(check('durable-queue', durableQueue, 'Configured queue must use Redis or Upstash credentials; memory is unsuitable.'));
  checks.push(check('encrypted-reports', env.STORAGE_PROVIDER === 'vercel_blob' && Boolean(env.BLOB_READ_WRITE_TOKEN) && /^[A-Za-z0-9_-]{43}=?$/.test(env.REPORT_ENCRYPTION_KEY || ''), 'Encrypted Blob reports require storage credentials and a 32-byte base64url encryption key.'));
  checks.push(check('persistence-namespace', Boolean(env.PERSISTENCE_NAMESPACE?.trim()), 'Explicit stable production namespace required; compare it with the existing deployment.'));
  checks.push(check('report-sharing', enabled(env.REPORT_SHARE_LINK_ENABLED), 'Report sharing must be enabled for the existing Telegram delivery path.'));
  return { apiOrigin: origin || null, checks };
}

export function inspectCatalog(catalog, stage = 'checkout', surface = 'chat') {
  const prices = surfaceConfig({}, surface).prices;
  const services = Array.isArray(catalog?.services) ? catalog.services : [];
  const ids = services.map(service => service?.id);
  const exact = ids.length === 5 && new Set(ids).size === 5 && ids.every(id => Object.hasOwn(APPROVED_STARS, id));
  const checks = [check('catalog-services', exact, 'Catalog must contain each of the five known service IDs exactly once.'), check('catalog-currency', catalog?.currency === 'XTR', 'Catalog currency must be XTR.')];
  checks.push(check('deployed-checkout-state', stage === 'paused' ? catalog?.checkoutReady === false : catalog?.checkoutReady === true, `Expected deployed checkoutReady=${stage !== 'paused'}.`));
  for (const id of Object.keys(APPROVED_STARS)) {
    const service = services.find(item => item?.id === id);
    const active = stage !== 'paused' && Object.hasOwn(prices, id);
    checks.push(check(`deployed-${id}`, active ? service?.enabled === true && service?.stars === prices[id] : service?.enabled === false && service?.stars === null, active ? `${id} must be enabled at ${prices[id]} Stars.` : `${id} must be disabled with its public price hidden on this surface/stage.`));
  }
  return checks;
}

export function inspectWebhook(info, apiOrigin) {
  const expected = new URL('/v1/telegram/webhook', apiOrigin).href;
  const required = ['message', 'callback_query', 'pre_checkout_query'];
  return [check('webhook-url', info?.url === expected, 'Telegram webhook must target this selected API surface.'), check('webhook-update-types', required.every(type => info?.allowed_updates?.includes(type)), 'Webhook must accept messages, callbacks and pre-checkout queries.'), check('webhook-error', !info?.last_error_message, 'Telegram must report no last webhook delivery error.'), check('webhook-pending', Number.isInteger(info?.pending_update_count) && info.pending_update_count === 0, 'Pending Telegram updates should be zero at quiet acceptance.', 'warn')];
}

async function readJson(url, fetcher) {
  const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('HTTP response failed');
  return response.json();
}

export async function runReadiness(env, options = {}, fetcher = fetch) {
  const selected=surfaceConfig(env,options.surface);
  const local = inspectLocalConfig(env, options);
  const checks = [...local.checks];
  if (!options.offline && local.apiOrigin) {
    const endpoints = [`${selected.prefix}/status`, `${selected.prefix}/services`];
    const results = await Promise.allSettled(endpoints.map(path => readJson(new URL(path, local.apiOrigin), fetcher)));
    const [statusResult, catalogResult] = results;
    if (statusResult.status === 'fulfilled') {
      const status = statusResult.value;
      checks.push(check('deployed-configuration', status?.enabled === true && status?.configured === true, 'Deployed Telegram API must be enabled and configured.'));
      checks.push(check('deployed-delivery', status?.durableDelivery === true, 'API must report durable Telegram delivery. This does not establish storage backup or provider health.'));
      checks.push(check('deployed-bot-username', status?.botUsername === selected.username, 'Chat and Mini App use the same expected PULSE username.'));
      checks.push(check('deployed-mode',status?.mode===selected.mode,'The deployed view must use the current single-bot implementation.'));
      checks.push(check('deployed-miniapp-url', status?.miniAppUrl === (env.TELEGRAM_TON_MINI_APP_ENABLED === '1' ? env.TELEGRAM_TON_MINI_APP_URL : null), 'The Mini App URL must match the configured TON route.'));
      checks.push(check('deployed-webhook-path',status?.webhookPath==='/v1/telegram/webhook','Both views must share the single PULSE webhook.'));
    } else checks.push(check('status-request', false, 'Public Telegram status request failed; inspect routing and API availability.'));
    if (catalogResult.status === 'fulfilled') checks.push(...inspectCatalog(catalogResult.value, options.stage,selected.surface));
    else checks.push(check('catalog-request', false, 'Public Telegram service catalog request failed.'));
    if (selected.token) {
      for (const method of ['getMe', 'getWebhookInfo']) {
        try {
          const data = await readJson(`https://api.telegram.org/bot${selected.token}/${method}`, fetcher);
          if (!data?.ok) throw new Error('Bot API rejected read');
          if (method === 'getMe') checks.push(check('telegram-bot-identity', data.result?.username === selected.username, 'Telegram getMe must match the same PULSE bot username.'));
          else checks.push(...inspectWebhook(data.result, local.apiOrigin));
        } catch { checks.push(check(`telegram-${method}`, false, `Telegram ${method} read failed. Credentials, raw URLs and response bodies are intentionally omitted.`)); }
      }
    } else checks.push(check('telegram-live-inspection', false, 'Bot token absent; Telegram identity and webhook inspection were not performed.', 'warn'));
  } else checks.push(check('live-inspection', false, 'Live inspection not performed; local configuration cannot establish deployed readiness.', 'warn'));
  if(!options.offline&&selected.ton){
    try{const url=new URL('/tonconnect-manifest.json',selected.appUrl);const response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||!response.headers?.get('content-type')?.includes('application/json'))throw Error('Manifest unavailable');const manifest=await response.json();const icon=new URL(manifest.iconUrl);publicOrigin(icon.origin);checks.push(check('ton-manifest',manifest.name==='PULSE'&&manifest.url===selected.appUrl&&!icon.username&&!icon.password&&/\.(png|ico)$/i.test(icon.pathname),'Public manifest must be JSON for PULSE with the exact TON app URL and a public PNG/ICO icon. HTML fallback or SVG icon is a failure.'));}catch{checks.push(check('ton-manifest',false,'TON manifest request failed or returned an HTML fallback; deploy the actual JSON asset.'));}
  }
  const manualGates = ['Review Telegram eligibility of the combined EVM history/website links and TON Mini App on one PULSE bot.', 'Complete real five-service chat Stars purchase/recovery/refund and TON Connect client acceptance on the same bot.', 'Verify storage restore and retained account/report access.', 'Publish staffed support, purchase/privacy terms and retention handling.', 'Measure costs/net proceeds; approve a marketing budget and implement attribution before paid tests.'];
  return { generatedAt: new Date().toISOString(), mode: options.offline ? 'offline' : 'read-only-live', view:selected.surface,stage: options.stage || 'checkout', apiOrigin: local.apiOrigin, technicalChecksPassed: checks.every(item => item.status !== 'fail'), launchApproved: false, counts: { pass: checks.filter(item => item.status === 'pass').length, fail: checks.filter(item => item.status === 'fail').length, warn: checks.filter(item => item.status === 'warn').length }, checks, manualGates };
}

async function main() {
  try { process.loadEnvFile(); } catch {}
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('Read-only checks: node scripts/telegram-readiness.mjs [--view chat|ton] [--offline] [--api-origin https://verified-api] [--stage paused|checkout]\nBoth views use one PULSE bot and webhook. Uses local .env for expectations. Never writes or purchases. Exit 1 means a technical check failed; manual launch gates remain.'); return; }
  const options = { offline: false, stage: 'checkout' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--offline') options.offline = true;
    else if (['--api-origin', '--stage','--view'].includes(args[i]) && args[i + 1]) {const key=args[i++];options[key==='--stage'?'stage':key==='--view'?'surface':'apiOrigin']=args[i];}
    else throw new Error('Unknown or incomplete option. Use --help.');
  }
  if (!['paused', 'checkout'].includes(options.stage)) throw new Error('Stage must be paused or checkout.');
  const report = await runReadiness(process.env, options);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.technicalChecksPassed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Readiness inspection failed. Use --help and verify configuration; no external changes were made.'); process.exitCode = 1; });
