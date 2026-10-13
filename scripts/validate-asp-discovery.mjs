/** Public, non-spending discovery/contract audit. No keys or paid-fetch client. */
import { mkdirSync, writeFileSync } from 'node:fs';
const origin = (process.argv[2] || 'https://pulse-api-production-7aae.up.railway.app').replace(/\/$/, '');
const directory = '.tmp/asp-audit/public';
mkdirSync(directory, { recursive: true });
const audit = { checkedAt: new Date().toISOString(), origin, payments: 0, checks: [], challenges: [], exclusions: [] };
const check = (ok, name, detail) => audit.checks.push({ ok: !!ok, name, ...(detail === undefined ? {} : { detail }) });
async function request(path, body) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return { status: response.status, json: await response.json().catch(() => null), required: response.headers.get('payment-required'), receipt: response.headers.get('payment-response') };
}
const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 8355, method, params });
const metadata = await request('/v1/metadata'), asp = metadata.json?.asp;
check(metadata.status === 200 && asp?.product === 'PULSE', 'Public ASP metadata');
if (!asp) throw new Error('Metadata unavailable; no requests or payments continued');
writeFileSync(directory + '/metadata.json', JSON.stringify(metadata.json, null, 2));
const markets = await request('/v1/polymarket/markets?limit=100');
const market = markets.json?.markets?.find(m => m.active && !m.closed && !m.archived && m.enableOrderBook && (!m.endDate || Date.parse(m.endDate) > Date.now() + 86400000));
if (market) audit.predictionSelection = { primaryMarketId: market.id, lang: 'en', question: market.question };
const networks = [
  ['xlayer', 196, '0x779ded0c9e1022225f8e0630b35a9b54be713736'],
  ['base', 8453, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
  ['arc', 5042, '0x3600000000000000000000000000000000000000'],
  ['arbitrum', 42161, '0xaf88d065e77c8cc2239327c5edb3a432268e5831'],
];
const routes = [['spot_analysis_standard', '/v1/analysis/spot/standard'], ['spot_analysis_premium', '/v1/analysis/spot/premium'], ['prediction_analysis_standard', '/v1/analysis/prediction/standard'], ['prediction_analysis_premium', '/v1/analysis/prediction/premium'], ['preflight', '/v1/preflight']];
await Promise.all(networks.map(async ([key, chain, asset]) => {
  try {
    const prefix = '/' + key, initialize = await request(prefix + '/mcp', rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pulse-asp-audit', version: '1' } }));
    check(initialize.status === 200 && initialize.json?.result?.capabilities?.tools, key + ' MCP initialize');
    const initialized = await request(prefix + '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' });
    check(initialized.status === 204, key + ' MCP initialization notification');
    const listing = await request(prefix + '/mcp', rpc('tools/list')), tools = listing.json?.result?.tools || [];
    writeFileSync(directory + '/' + key + '-tools.json', JSON.stringify(listing.json, null, 2));
    check(listing.status === 200 && tools.length > 0, key + ' MCP discovery');
    check(tools.some(t => t.name === 'job_status') && tools.some(t => t.name === 'job_report'), key + ' free recovery tools');
    for (const [tool, path] of routes) {
      const published = tools.find(t => t.name === tool), service = asp.networkServices.find(s => s.path === prefix + path);
      check(!!published && !!service, key + ' metadata/MCP ' + tool);
      if (tool.startsWith('spot_')) check(['instId', 'timeframe', 'lang'].every(f => published?.inputSchema?.required?.includes(f)), key + ' collects pair/timeframe/language ' + tool);
      for (const mcp of [false, true]) {
        const label = key + ' ' + (mcp ? 'MCP' : 'REST') + ' ' + tool, endpoint = prefix + (mcp ? '/mcp' : path);
        const call = args => mcp ? rpc('tools/call', { name: tool, arguments: args }) : args;
        const invalid = await request(endpoint, call({}));
        check(invalid.status === 400 && !invalid.required && !invalid.receipt, label + ' invalid input before payment', invalid.status);
        const args = tool.startsWith('spot_') ? { instId: 'BTC-USDT', timeframe: '1H', lang: 'en' } : tool === 'preflight' ? { tokenAddress: asset, chainId: String(chain), lang: 'en' } : market ? { primaryMarketId: market.id, lang: 'en' } : null;
        if (!args) { audit.exclusions.push(label + ': no active market found'); continue; }
        const unpaid = await request(endpoint, call(args));
        let challenge; try { challenge = JSON.parse(Buffer.from(unpaid.required || '', 'base64').toString('utf8')); } catch {}
        const accept = challenge?.accepts?.[0];
        check(unpaid.status === 402 && challenge?.x402Version === 2 && challenge.accepts.length === 1 && !unpaid.receipt, label + ' v2 payment challenge', unpaid.status);
        if (!accept) { check(false, label + ' challenge available', unpaid.json); continue; }
        check(accept.network === 'eip155:' + chain && accept.asset?.toLowerCase() === asset && accept.scheme === 'exact', label + ' settlement chain/asset');
        check(challenge.resource?.url === origin + prefix + path, label + ' canonical resource', challenge.resource?.url);
        check(Number(accept.amount) === Math.round(service.priceUsd * 1e6) && accept.payTo?.toLowerCase() === asp.payTo.toLowerCase(), label + ' price/recipient');
        const fields = service.requestSpec?.fields || [];
        if (tool.startsWith('spot_')) check(['instId', 'timeframe', 'lang'].every(f => fields.some(x => x.name === f && x.required)), label + ' advertised input contract');
        if (key === 'xlayer') check(accept.extra?.name === 'USD₮0' && accept.extra?.version === '1', label + ' USDT0 signing domain');
        if (key === 'arc') check(accept.extra?.name === 'GatewayWalletBatched' && accept.extra?.version === '1' && accept.extra?.verifyingContract?.toLowerCase() === '0x77777777dcc4d5a8b6e418fd04d8997ef11000ee', label + ' mainnet Gateway domain');
        if (key === 'base' || key === 'arbitrum') check(!!challenge.extensions?.bazaar, label + ' Bazaar discovery extension');
        audit.challenges.push({ network: key, transport: mcp ? 'MCP' : 'REST', tool, path, price: service.priceUsd, challenge });
      }
    }
    audit.exclusions.push(key + ': Autopilot activation requires an owner-approved registered vault; no activation or trade requested');
  } catch (error) { check(false, key + ' audit exception', error.message); }
}));
audit.summary = { passed: audit.checks.filter(c => c.ok).length, failed: audit.checks.filter(c => !c.ok).length, challenges: audit.challenges.length };
writeFileSync(directory + '/discovery-audit.json', JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ ...audit.summary, predictionSelection: audit.predictionSelection, failures: audit.checks.filter(c => !c.ok), exclusions: audit.exclusions }));
process.exitCode = audit.summary.failed ? 1 : 0;
