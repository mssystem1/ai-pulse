// One explicitly approved Codespace payment, then read-only report recovery.
// Never retries a payment. Recovery credentials remain in memory, not console output.
import { spawn } from 'node:child_process';
const [codespace, paymentId, approvalFlag] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(codespace || '') || !/^pay_[a-f0-9]+$/.test(paymentId || '')) throw new Error('Codespace and approved payment ID required');
const origin = 'https://pulse-api-production-7aae.up.railway.app';
if (approvalFlag !== '--execute-approved-payment') {
  console.log(JSON.stringify({ dryRun: true, request: 'Global Quick BTC-USDT 4H en', amount: '0.20 USDT0', network: 'X Layer', instruction: 'First quote and verify the exact amount, asset, network, recipient and parameters; obtain user approval. Only then add --execute-approved-payment. Never reuse a settled payment ID.' }));
  process.exit(0);
}
const output = await new Promise((resolve, reject) => {
  // OKX CLI 4.5.3 REST replay does not merge quote-time knownParams.
  // Repeat the exact approved business parameters; never rely on the quote alone.
  const child = spawn('gh', ['codespace', 'ssh', '-c', codespace, '--', `onchainos payment pay --payment-id ${paymentId} --selected-index 0 --yes --param instId=BTC-USDT --param timeframe=4H --param lang=en`], { windowsHide: true });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', () => {}); // No unsanitized CLI diagnostics or credentials.
  child.on('error', reject);
  child.on('close', code => resolve({ code, stdout }));
});
const line = output.stdout.split(/\r?\n/).reverse().find(line => line.trim().startsWith('{'));
if (!line) throw new Error('No structured payment result. Do not retry payment before reconciliation.');
const result = JSON.parse(line);
const objects = [];
function walk(value, depth = 0) {
  if (depth > 12) return;
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) { try { walk(JSON.parse(value), depth + 1); } catch {} }
  else if (value && typeof value === 'object') {
    objects.push(value);
    for (const [key, child] of Object.entries(value)) if (!/signature|authorization|secret|session|certificate/i.test(key)) walk(child, depth + 1);
  }
}
walk(result);
const hashes = [...new Set(objects.flatMap(value => ['txHash','transaction','transactionHash'].map(key => value[key])).filter(value => typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value)))];
console.log(JSON.stringify({ cliExit: output.code, ok: result.ok, status: result.data?.status, dataFields: Object.keys(result.data || {}), transactionHashes: hashes }));
const recovery = objects.find(value => typeof value.recoveryToken === 'string' && value.job?.id);
if (!recovery) {
  console.log(JSON.stringify({ delivery: 'no_recovery_handle', errors: objects.flatMap(value => ['error','message','reason'].map(key => value[key])).filter(value => typeof value === 'string').map(value => value.replace(/0x[a-fA-F0-9]{128,}/g,'[redacted]').replace(/https?:\/\/\S+/g,'[URL]').slice(0,500)).slice(0,8), shapes: objects.slice(0,12).map(value => Object.keys(value)) }));
  process.exitCode = 1;
} else {
  const jobId = recovery.job.id;
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error('Invalid job ID');
  const headers = { 'PULSE-RECOVERY-TOKEN': recovery.recoveryToken };
  const request = async path => {
    const response = await fetch(origin + path, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
    return { status: response.status, body: await response.json() };
  };
  console.log(JSON.stringify({ jobId, initialStage: recovery.job.stage, paymentReplays: 1 }));
  for (let attempt = 0; attempt < 45; attempt++) {
    const status = await request(`/v1/jobs/${jobId}`);
    const stage = status.body.job?.stage || status.body.stage;
    console.log(JSON.stringify({ jobId, httpStatus: status.status, stage }));
    if (['completed','completed_partial'].includes(stage)) {
      const report = await request(`/v1/jobs/${jobId}/report`);
      const value = report.body.report || report.body;
      if (report.status !== 200 || value.instId !== 'BTC-USDT' || value.timeframe !== '4H' || value.lang !== 'en' || value.tier !== 'standard' || !value.analysis) {
        console.log(JSON.stringify({ delivery: 'report_validation_failed', reportHttpStatus: report.status, reportKeys: Object.keys(value) }));
        process.exitCode = 1;
        break;
      }
      console.log(JSON.stringify({ delivery: 'report_received', reportHttpStatus: report.status, reportKeys: Object.keys(value), mode: value.mode, tier: value.tier, instId: value.instId, reportBytes: Buffer.byteLength(JSON.stringify(value)), recoveryRead: true }));
      break;
    }
    if (status.status >= 400 || ['failed_terminal','manual_reconciliation'].includes(stage)) { console.log(JSON.stringify({ delivery: 'not_completed', stage })); process.exitCode = 1; break; }
    if (attempt === 44) { console.log(JSON.stringify({ delivery: 'still_processing' })); process.exitCode = 1; break; }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
