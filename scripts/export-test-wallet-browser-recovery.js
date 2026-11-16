// Run in the main Chrome console at https://app.ai-pulse.tech.
// Downloads calculation packages and report IDs. No network, wallet calls,
// storage changes, login tokens, recovery capabilities or payment headers.
(() => {
  'use strict';
  if (location.origin !== 'https://app.ai-pulse.tech') {
    throw Error('Open https://app.ai-pulse.tech in the browser with your saved PULSE data first.');
  }
  const owner = '0xa7d827622c4f9c884ca8f751b2060dd767f18683';
  const warnings = [];
  const read = key => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      if (raw.length > 32_000_000) throw Error('size limit');
      return JSON.parse(raw);
    } catch { warnings.push('Unreadable or oversized entry: ' + key); return null; }
  };
  // These are public package fields, not the containing draft or session.
  const packageFields = ['format', 'id', 'version', 'title', 'description',
    'author', 'license', 'kernel', 'formula', 'prerequisites', 'runtime',
    'publication', 'study', 'graph'];
  const packageCopy = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !/^pulse-indicator-v[1-4]$/.test(value.format)
      || typeof value.id !== 'string' || typeof value.version !== 'string') return null;
    const copy = Object.fromEntries(packageFields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
    return JSON.parse(JSON.stringify(copy, (key, item) =>
      /token|signature|authorization|headers|private.?key|recovery/i.test(key) ? undefined : item));
  };
  const created = read('pulse-indicator-created:' + owner);
  const draft = read('pulse-indicator-draft:' + owner);
  const installed = read('pulse-indicators-v1');
  const reportReferences = [];
  for (const network of ['base', 'xlayer', 'arbitrum', 'arc', 'robinhood']) {
    for (const scope of ['prediction', 'spot', 'risk']) {
      const history = read(`pulse:report-history:${scope}:${network}`);
      const latest = read(`pulse:last-job:${scope}:${network}`);
      const seen = new Set();
      for (const item of [...(Array.isArray(history) ? history.slice(0, 30) : []), latest]) {
        if (!item || typeof item.jobId !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.jobId) || seen.has(item.jobId)) continue;
        seen.add(item.jobId);
        reportReferences.push({network, scope, jobId:item.jobId,
          ...Object.fromEntries(['createdAt', 'label', 'tier'].filter(key => typeof item[key] === 'string').map(key => [key, item[key]]))});
      }
    }
  }
  const data = {
    format:'pulse-browser-recovery-v1', owner, exportedAt:new Date().toISOString(),
    origin:location.origin,
    createdIndicators:(Array.isArray(created) ? created.slice(0, 50) : []).map(packageCopy).filter(Boolean),
    savedDraft:packageCopy(draft?.manifest ?? draft),
    installedIndicators:(Array.isArray(installed) ? installed.slice(0, 8) : []).map(packageCopy).filter(Boolean),
    reportReferences, warnings,
    attribution:'Created/draft keys are wallet-scoped. Installed packages and report references are device-wide; ownership and payment must be checked separately.',
    excludes:['login tokens', 'recovery tokens', 'payment signatures', 'pending authorizations', 'private keys']
  };
  const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], {type:'application/json'}));
  const link = document.createElement('a');
  link.href = href;
  link.download = 'PULSE-test-wallet-browser-recovery.json';
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(href), 60_000); }
  console.info('PULSE recovery file downloaded.', {
    created:data.createdIndicators.length, draft:Boolean(data.savedDraft),
    installed:data.installedIndicators.length, reportReferences:reportReferences.length, warnings:warnings.length
  });
})();
