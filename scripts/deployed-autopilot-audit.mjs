// Read-only production diagnostic; never signs, pays, reconciles or starts workers.
import { runNativeRedisCommand, closeNativeRedisConnections } from '../apps/api/dist/nativeRedis.js';
const owner = process.env.TEST_WALLET_ADDRESS;
if (!/^0x[0-9a-f]{40}$/i.test(owner || '')) throw new Error('TEST_WALLET_ADDRESS required');
const command = (...args) => runNativeRedisCommand(process.env.REDIS_PUBLIC_URL || '', args, 15000);
try {
  const raw = await command('HGETALL', 'pulse:v6:autopilot:strategy-map');
  const rows = (Array.isArray(raw) ? raw.filter((_, i) => i % 2) : Object.values(raw || {})).map(JSON.parse);
  for (const row of rows.filter(r => r.owner?.toLowerCase() === owner.toLowerCase() && r.network === 'base')) {
    const rawPass = await command('GET', `pulse:v6:autopilot:pass:base:${row.vault.toLowerCase()}`);
    const p = rawPass ? JSON.parse(rawPass) : null;
    const summary = {};
    for (const key of ['id','vault','pair','timeframe','strategyType','status','createdAt','updatedAt','lastRunAt','lastDecision','lastEvaluatedCandleTs','lastAiSignalAt','nextAiEligibleAt','aiUsageToday','evaluationCount','holdCount','failureCount']) summary[key] = row[key];
    console.log(JSON.stringify({ strategy: summary, fieldNames: Object.keys(row), latest: row.evaluations?.slice(-3).map(e => ({at:e.evaluatedAt,status:e.status,reason:e.reason,decision:e.decision,signal:e.signal})), pass: p && Object.fromEntries(['purchasedAt','expiresAt','pausedAt','signalsUsed','signalsLimit','timerBaseExpiresAt','timerInitiallyPaused'].map(k => [k,p[k]])) }));
  }
  const res = await fetch(`https://pulse-api-production-7aae.up.railway.app/v1/trading/accounts?network=base&owner=${owner}&fresh=1`, { signal: AbortSignal.timeout(30000) });
  const body = await res.json();
  console.log(JSON.stringify({accountsHttp:res.status, accounts:body}));
} catch (error) {
  console.error(String(error?.message || 'Audit failed').replace(/rediss?:\/\/\S+/g,'[redacted]'));
  process.exitCode = 1;
} finally { closeNativeRedisConnections(); }
