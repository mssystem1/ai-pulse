#!/usr/bin/env node
// Offline reconciliation of reviewed TEST-wallet recovery evidence.
// Reads only checked-in/ignored local evidence files; never contacts Redis, RPC,
// Blob storage, the app API, or a wallet. It emits aggregate findings only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const oldTestOwner = '0xa7d827622c4f9c884ca8f751b2060dd767f18683';
const currentlyAuthenticatedOwner = '0xda64eefe238283717d8ef0e2b8876b3a7643142f';
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const countBy = (values) => values.reduce((out, value) => {
  const key = String(value ?? 'unknown');
  out[key] = (out[key] ?? 0) + 1;
  return out;
}, {});
const normalizeHash = (value) => typeof value === 'string' ? value.toLowerCase() : '';

function dedupeTransactions(rows, chainId) {
  const unique = new Map();
  const conflicts = [];
  for (const row of rows) {
    const hash = normalizeHash(row.hash);
    if (!/^0x[0-9a-f]{64}$/.test(hash)) continue;
    const key = `${chainId}:${hash}`;
    const prior = unique.get(key);
    if (!prior) unique.set(key, { ...row, hash, chainId, evidenceCopies: 1 });
    else {
      prior.evidenceCopies += 1;
      // Duplicate evidence must agree on transaction identity/status/owner. Any
      // conflicting details are reported and excluded from definitive joins.
      for (const field of ['status', 'nonce', 'to', 'valueUSDC']) {
        if (String(prior[field] ?? '').toLowerCase() !== String(row[field] ?? '').toLowerCase()) {
          conflicts.push({ key, field });
        }
      }
    }
  }
  return { unique: [...unique.values()], conflicts };
}

function selfCheck() {
  const sample = { hash: `0x${'a'.repeat(64)}`, status: 'success', nonce: 3 };
  const sameHashDifferentCase = { ...sample, hash: sample.hash.toUpperCase() };
  const deduped = dedupeTransactions([sample, sameHashDifferentCase], 5042);
  assert.equal(deduped.unique.length, 1, 'same chain/hash must deduplicate');
  assert.equal(deduped.unique[0].evidenceCopies, 2);
  assert.equal(deduped.conflicts.length, 0);
  const conflict = dedupeTransactions([sample, { ...sample, nonce: 4 }], 5042);
  assert.equal(conflict.unique.length, 1);
  assert.equal(conflict.conflicts.length, 1, 'same hash with conflicting identity data must be flagged');
  const owners = [oldTestOwner, currentlyAuthenticatedOwner].map((x) => x.toLowerCase());
  assert.equal(new Set(owners).size, 2, 'old and current authenticated owners must remain separate');
}

selfCheck();

const txManifest = readJson('DB_backup/platform-recovery-2026-11-17/transaction-evidence-manifest.json');
const evidenceDir = 'DB_backup/platform-recovery-2026-11-17/transaction-evidence';
const evidenceByFile = new Map();
for (const item of txManifest.files) {
  const bytes = readFileSync(resolve(root, evidenceDir, item.file.split('/').at(-1)));
  assert.equal(bytes.length, item.bytes, `size check failed for ${item.file}`);
  assert.equal(sha256(bytes), item.sha256, `SHA-256 check failed for ${item.file}`);
  evidenceByFile.set(item.file, JSON.parse(bytes.toString('utf8')));
}

const txFileA = evidenceByFile.get('transaction-evidence/arc-usdc-movements.json');
const txFileB = evidenceByFile.get('transaction-evidence/arc-cirbtc-combined-receipts.json');
const currentTx = evidenceByFile.get('transaction-evidence/arc-current-wallet-transactions.json');
const finalState = evidenceByFile.get('transaction-evidence/arc-final-state.json');
for (const source of [txFileA, txFileB, currentTx, finalState]) {
  assert.equal(normalizeHash(source.owner), oldTestOwner, 'transaction evidence owner mismatch');
  assert.equal(source.chainId, 5042, 'unexpected chain in Arc evidence');
}
assert.equal(sha256(readFileSync(resolve(root, evidenceDir, 'arc-usdc-movements.json'))),
  sha256(readFileSync(resolve(root, evidenceDir, 'arc-cirbtc-combined-receipts.json'))),
  'the two movement/receipt exports should be identical evidence copies');

const txRows = [...txFileA.receipts, ...txFileB.receipts, ...currentTx.entries];
const txDedupe = dedupeTransactions(txRows, txFileA.chainId);
assert.equal(txDedupe.conflicts.length, 0, 'conflicting transaction evidence requires manual review');
const txByKey = new Map(txDedupe.unique.map((tx) => [`${tx.chainId}:${tx.hash}`, tx]));
const receiptTxHashes = new Set(txDedupe.unique.map((tx) => tx.hash));

const oldHistoryPlan = readJson('DB_backup/test-wallet-recovery-2026-11-16/plan.json');
const oldHistorySummary = readJson('DB_backup/test-wallet-recovery-2026-11-16/plan-summary.json');
assert.equal(oldHistoryPlan.owner.toLowerCase(), oldTestOwner);
assert.equal(sha256(readFileSync(resolve(root, 'DB_backup/test-wallet-recovery-2026-11-16/plan.json'))), oldHistorySummary.planSha256,
  'November 16 report recovery plan must match its reviewed hash');
const detailedOldPlan = readJson('.tmp/test-wallet-recovery/plan.json');
assert.equal(detailedOldPlan.owner.toLowerCase(), oldTestOwner);
assert.equal(sha256(readFileSync(resolve(root, '.tmp/test-wallet-recovery/plan.json'))), oldHistorySummary.planSha256,
  'detailed order/activity plan must be the reviewed November 16 plan');
const closedOrderApply = readJson('DB_backup/test-wallet-recovery-2026-11-16/closed-order-apply-results.json');
const platformRestorePlan = readJson('DB_backup/platform-recovery-2026-11-17/recovery-plans/plan.json');
const platformRestoreManifest = readJson('DB_backup/platform-recovery-2026-11-17/recovery-manifest.json');
const platformPlanManifestRow = platformRestoreManifest.files.find((file) => file.file === 'recovery-plans/plan.json');
assert(platformPlanManifestRow, 'platform restoration plan must be listed in its private manifest');
assert.equal(sha256(readFileSync(resolve(root, 'DB_backup/platform-recovery-2026-11-17/recovery-plans/plan.json'))), platformPlanManifestRow.sha256,
  'Autopilot evidence plan must match its reviewed archive manifest');
const oldStrategyRows = (detailedOldPlan.held.originalStrategies ?? []).filter((row) => row.owner?.toLowerCase() === oldTestOwner);
const oldStrategyVaults = new Set(oldStrategyRows.map((row) => `${row.network}:${row.vault?.toLowerCase()}`));
const oldClosedOrders = (detailedOldPlan.held.automationOrders ?? []).filter((row) =>
  row.owner?.toLowerCase() === oldTestOwner && ['filled', 'cancelled', 'failed'].includes(row.status));
const oldActivityAndEvaluationRows = detailedOldPlan.operations
  .filter((operation) => ['activity', 'evaluation-journal'].includes(operation.category))
  .flatMap((operation) => (operation.items ?? []).map(([field, raw]) => {
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    return { category: operation.category, field, network: operation.key.split(':')[4], value };
  }))
  .filter((row) => row.category === 'evaluation-journal' || row.value?.owner?.toLowerCase() === oldTestOwner);
const txReferenceFields = new Set(['txhash', 'lasttxhash', 'settlementtx', 'transactionhash', 'executiontx']);
function findTxReferences(value, path = '', out = []) {
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (typeof child === 'string' && txReferenceFields.has(key.toLowerCase()) && /^0x[0-9a-f]{64}$/i.test(child)) {
      out.push({ hash: child.toLowerCase(), path: childPath });
    } else if (child && typeof child === 'object') findTxReferences(child, childPath, out);
  }
  return out;
}
function joinScopedRecords(records) {
  const matches = [];
  for (const record of records) {
    if (String(record.network ?? '').toLowerCase() !== 'arc') continue;
    for (const reference of findTxReferences(record.value)) {
      if (txByKey.has(`5042:${reference.hash}`)) matches.push({ ...record, ...reference });
    }
  }
  return matches;
}
const activityEvaluationMatches = joinScopedRecords(oldActivityAndEvaluationRows.map((row) => ({
  category: row.category,
  status: row.value?.status,
  kind: row.value?.kind,
  source: row.value?.source,
  network: row.value?.network ?? row.network,
  value: row.value,
})));
const strategyMatches = joinScopedRecords(oldStrategyRows.map((value) => ({ category: 'strategy', status: value.status, network: value.network, value })));
const closedOrderMatches = joinScopedRecords(oldClosedOrders.map((value) => ({ category: 'closed-order', status: value.status, network: value.network, value })));
const strategyEvidenceBundles = platformRestorePlan.evidence.filter((entry) => {
  const parts = entry.key.split(':');
  return parts[0] === 'pulse' && parts[1] === 'v6' && parts[2] === 'autopilot' && parts[3] === 'evidence' &&
    oldStrategyVaults.has(`${parts[4]}:${parts[5]?.toLowerCase()}`);
});
const strategyEvidenceMatches = joinScopedRecords(strategyEvidenceBundles.map((entry) => {
  const parts = entry.key.split(':');
  return { category: 'autopilot-evidence', network: parts[4], value: typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value };
}));
const allOtherRecordMatches = [...activityEvaluationMatches, ...strategyMatches, ...closedOrderMatches, ...strategyEvidenceMatches];
const matchedOtherTxHashes = new Set(allOtherRecordMatches.map((row) => row.hash));
const recordsByMatchKind = countBy(allOtherRecordMatches.map((row) => `${row.category}:${row.kind ?? row.status ?? 'context'}`));
const unmatchedArcReceiptStatuses = countBy(txDedupe.unique.filter((tx) => !matchedOtherTxHashes.has(tx.hash)).map((tx) => tx.status));
const matchedArcReceiptStatuses = countBy(txDedupe.unique.filter((tx) => matchedOtherTxHashes.has(tx.hash)).map((tx) => tx.status));
const oldReportIds = new Set(oldHistoryPlan.reports.map((row) => row.id.toLowerCase()));
const oldJobRows = oldHistoryPlan.operations
  .filter((row) => row.category === 'job')
  .map((row) => typeof row.value === 'string' ? JSON.parse(row.value) : row.value);
const oldCompletedWithReceipt = oldJobRows.filter((job) => job.stage === 'completed' && job.receipt);
const oldManualReconciliation = oldJobRows.filter((job) => job.stage !== 'completed' || !job.receipt);

const archivePlan = readJson('DB_backup/platform-recovery-2026-11-17/recovery-plans/report-history-plan.json');
const archiveSummary = readJson('DB_backup/platform-recovery-2026-11-17/recovery-plans/report-history-summary.json');
const archiveApply = readJson('DB_backup/platform-recovery-2026-11-17/recovery-plans/report-history-apply-results.json');
assert.equal(sha256(readFileSync(resolve(root, 'DB_backup/platform-recovery-2026-11-17/recovery-plans/report-history-plan.json'))), archiveSummary.planSha256,
  'November 17 archive plan must match its reviewed hash');
const archivedRows = archivePlan.entries.map((entry) => entry.row);
const oldWalletRows = archivedRows.filter((row) => row.owner?.toLowerCase() === oldTestOwner);
const otherOwners = archivedRows.filter((row) => row.owner?.toLowerCase() !== oldTestOwner);
const otherOwnerCounts = countBy(otherOwners.map((row) => row.owner?.toLowerCase() === currentlyAuthenticatedOwner
  ? 'current-authenticated-owner (different wallet)' : 'other wallet (not target)'));
const archiveIds = oldWalletRows.map((row) => row.reportId.toLowerCase());
const archiveIdSet = new Set(archiveIds);
const duplicateArchiveIds = archiveIds.length - archiveIdSet.size;
const oldPlanOverlap = [...oldReportIds].filter((id) => archiveIdSet.has(id)).length;
const oldPlanMissingFromArchive = [...oldReportIds].filter((id) => !archiveIdSet.has(id));
const archiveEvidenceCounts = countBy(oldWalletRows.map((row) => row.evidenceKind));
const sourceNamespaceCounts = countBy(oldWalletRows.map((row) => row.sourceNamespace ?? 'unknown'));
const archiveRowsWithJob = oldWalletRows.filter((row) => row.originalJobId);
const archiveRowsWithoutJob = oldWalletRows.filter((row) => !row.originalJobId);
const reconstructedNoReceiptRows = oldWalletRows.filter((row) => row.evidenceKind === 'authenticated-history');

const laterDelivery = readJson('DB_backup/platform-recovery-2026-11-17/later-delivery-evidence.json');
const laterSettled = laterDelivery.entries.filter((entry) =>
  entry.job?.receipt?.payer?.toLowerCase() === oldTestOwner &&
  entry.job?.receipt?.settlementResult === 'settled' &&
  entry.job?.receipt?.verificationResult === 'accepted_by_middleware' &&
  entry.job?.receipt?.reportId === entry.metadata?.id &&
  entry.checksumMatches === true);
const laterReportIds = new Set(laterSettled.map((entry) => entry.metadata.id.toLowerCase()));
const laterIdsInArchive = [...laterReportIds].filter((id) => archiveIdSet.has(id)).length;
const laterSettledReceiptTxs = laterSettled.map((entry) => normalizeHash(entry.job.receipt.settlementTx)).filter(Boolean);

const oldPlanReceiptTxs = oldCompletedWithReceipt.map((job) => normalizeHash(job.receipt.settlementTx)).filter(Boolean);
const strictTransactionHashesFromReportEvidence = new Set([...laterSettledReceiptTxs, ...oldPlanReceiptTxs]);
const exactTxHashMatches = [...strictTransactionHashesFromReportEvidence].filter((hash) => receiptTxHashes.has(hash));

const transactionManifestRows = txDedupe.unique;
const txTransferCounts = countBy(transactionManifestRows.map((tx) => (tx.transfers ?? []).length));
const txWithTransfers = transactionManifestRows.filter((tx) => (tx.transfers ?? []).length > 0).length;
const txWithActionOrReportReference = transactionManifestRows.filter((tx) =>
  tx.reportId || tx.jobId || tx.paymentId || tx.action).length;
const currentTxDedupCount = new Set(currentTx.entries.map((tx) => `${currentTx.chainId}:${normalizeHash(tx.hash)}`));
const standaloneCurrentTxEntries = [...currentTxDedupCount].filter((key) => !txByKey.has(key)).length;

const deliveryProjectionCounts = countBy(archivePlan.deliveries.map((row) => `${row.service}:${row.environment}`));
const deliveryByService = countBy(archivePlan.deliveries.map((row) => row.service));
const oldWalletReceiptLinkedReports = oldWalletRows.filter((row) =>
  (row.evidenceKind === 'redis-report' && row.originalJobId) || row.evidenceKind === 'saved-delivery');
const linkedReportIdSet = new Set(oldWalletReceiptLinkedReports.map((row) => row.reportId.toLowerCase()));

const rdbInventory = readJson('.tmp/redis-repair/wallet-rdb-inventory.json');
assert.equal(rdbInventory.owner.toLowerCase(), oldTestOwner);
const legacyStatus = readJson('.tmp/redis-repair/legacy-source-status.json');
const runtimeConfig = readJson('.tmp/redis-repair/runtime-config-safe.json');

const result = {
  generatedAt: new Date().toISOString(),
  mode: 'offline-local-read-only',
  writesToApplicationStores: false,
  checkedSources: {
    reportRecoveryPlanSha256MatchesSummary: sha256(readFileSync(resolve(root, 'DB_backup/test-wallet-recovery-2026-11-16/plan.json'))) === oldHistorySummary.planSha256,
    archivePlanSha256MatchesSummary: sha256(readFileSync(resolve(root, 'DB_backup/platform-recovery-2026-11-17/recovery-plans/report-history-plan.json'))) === archiveSummary.planSha256,
    transactionEvidenceFilesHashVerified: txManifest.files.length,
    transactionEvidenceSources: txManifest.files.map((file) => file.file),
    legacySourceStatus: { source: legacyStatus.source, available: legacyStatus.available, readOnly: legacyStatus.readOnly, keyCount: legacyStatus.keys },
    productionStoreSummary: { namespace: runtimeConfig.namespace, storage: runtimeConfig.storage, reportRetentionDays: runtimeConfig.reportRetentionDays },
  },
  ownerScope: {
    target: 'previous TEST_WALLET_ADDRESS',
    targetAddress: oldTestOwner,
    currentAuthenticatedOwner: 'different wallet; kept outside target scope',
    currentAuthenticatedOwnerExactMatchInRecoveryPlan: otherOwners.some((row) => row.owner?.toLowerCase() === currentlyAuthenticatedOwner),
    oldWalletRows: oldWalletRows.length,
    excludedArchiveRows: otherOwners.length,
    excludedRowsByClass: otherOwnerCounts,
  },
  reports: {
    oldRecoveryPlanReportRows: oldHistoryPlan.reports.length,
    reportJobRows: oldJobRows.length,
    completedJobRowsWithReceipt: oldCompletedWithReceipt.length,
    manualOrNoncompletedJobRows: oldManualReconciliation.length,
    archiveRowsForTarget: oldWalletRows.length,
    uniqueArchiveReportIds: archiveIdSet.size,
    duplicateArchiveReportIds: duplicateArchiveIds,
    originalPlanReportIdsPresentInArchive: oldPlanOverlap,
    originalPlanReportIdsMissingFromArchive: oldPlanMissingFromArchive.length,
    additionalUniqueArchiveReportIdsBeyondOriginalPlan: [...archiveIdSet].filter((id) => !oldReportIds.has(id)).length,
    provenanceKinds: archiveEvidenceCounts,
    sourceNamespaces: sourceNamespaceCounts,
    withOriginalJobId: archiveRowsWithJob.length,
    withoutOriginalJobId: archiveRowsWithoutJob.length,
    originalReceiptLinkedUniqueReportIds: linkedReportIdSet.size,
    authenticatedHistoryRowsWithoutOriginalReceipt: reconstructedNoReceiptRows.length,
    laterSavedDeliveryEvidence: {
      rawCaptureEntries: laterDelivery.entries.length,
      settledAndChecksumVerifiedCaptures: laterSettled.length,
      uniqueReportIds: laterReportIds.size,
      uniqueReportIdsPresentInArchive: laterIdsInArchive,
    },
    archiveApply: {
      allOwnerRows: archiveApply.archiveRows,
      rowsAddedInFinalApply: archiveApply.archiveAdded,
      publicDeliveriesAddedInFinalApply: archiveApply.publicDeliveriesAdded,
      paymentsMade: archiveApply.paymentsMade,
      automationActivated: archiveApply.automationActivated,
    },
  },
  reportDeliveryProjection: {
    totalReceiptProvenDeliveryIdentities: archivePlan.deliveries.length,
    byService: deliveryByService,
    byServiceAndEnvironment: deliveryProjectionCounts,
    note: 'Platform-wide observed delivery projection; not attributed wholesale to the target wallet or equivalent to transaction receipts.',
  },
  transactionEvidence: {
    chainId: txFileA.chainId,
    targetOwnerMatchesAllFourSources: true,
    evidenceFiles: txManifest.files.length,
    uniqueTransactionsAfterChainHashDeduplication: txDedupe.unique.length,
    duplicateEvidenceCopiesRemoved: txRows.length - txDedupe.unique.length,
    conflictingDuplicateTransactions: txDedupe.conflicts.length,
    currentWalletAuditEntries: currentTx.entries.length,
    currentWalletAuditEntriesAlreadyInDeduplicatedReceiptSet: currentTx.entries.length - standaloneCurrentTxEntries,
    receiptsWithTransferLogs: txWithTransfers,
    receiptTransferLogCountDistribution: txTransferCounts,
    transactionsWithExplicitAppReportJobPaymentOrActionReference: txWithActionOrReportReference,
    exactHashLinksToReportPaymentReceipts: exactTxHashMatches.length,
    reportPaymentReceiptHashCount: strictTransactionHashesFromReportEvidence.size,
    rowsEligibleForTransactionToReportLink: 0,
    note: 'A USDC movement/amount alone does not identify an app report payment. No tx-to-report link was accepted without exact receipt identity.',
  },
  transactionToOtherRecords: {
    scope: 'Exact chain 5042 transaction hash joins in reviewed old-owner records only; strategies, closed orders, activity/evaluation rows, and restored Autopilot evidence keyed to the six target strategies.',
    reviewedTargetStrategies: oldStrategyRows.length,
    targetStrategyEvidenceBundles: strategyEvidenceBundles.length,
    closedOrdersInReviewedApplyPlan: oldClosedOrders.length,
    applyResults: {
      added: closedOrderApply.added,
      matched: closedOrderApply.matched,
      conflicts: closedOrderApply.conflicts,
      activeOrPausedHeld: closedOrderApply.activeOrPausedHeld,
    },
    exactHashLinkedRecordsByKind: recordsByMatchKind,
    distinctArcTransactionsLinkedToAnyReviewedActionOrOrder: matchedOtherTxHashes.size,
    linkedTransactionStatuses: matchedArcReceiptStatuses,
    unlinkedTransactionStatuses: unmatchedArcReceiptStatuses,
    evidenceBundlesWithExactTransactionHash: strategyEvidenceMatches.length,
    note: 'Joins require a chain-5042 transaction hash in a target-owner record context. Evidence bundles are bounded to vaults of the six reviewed target strategies. No amount-only association or fill inference is made.',
  },
  reconciliationDelta: {
    confirmedMissingTargetReportsRelativeToNov16Plan: oldPlanMissingFromArchive.length,
    confirmedMissingTargetReportRowsWithinReviewedArchivePlan: 0,
    unmatchedHistoricalTransactionCandidates: txDedupe.unique.length - matchedOtherTxHashes.size,
    ambiguousOrUnownedReportBlobCandidates: 70,
    nextCandidates: [
      'Request the preserved pre-November-12 Railway volume/export; no current archive evidence can replace the missing historical namespace.',
      'Obtain the scoped main-Chrome browser recovery export; match each local report/draft to existing report IDs and settlement receipts before proposing restoration.',
      'Review the 70 unassigned Blob reports only against authenticated ownership/payment evidence; do not assign by filename, amount, or content resemblance.',
      'Keep the 53 authenticated-history rows and 10 metadata-only rows marked as lacking original payment/job evidence unless new exact receipts emerge.',
    ],
  },
  limitations: [
    'The old lost Redis volume and the report decryption key are not present in this reconciliation input.',
    'The current authenticated wallet differs from the target historical TEST wallet; current-wallet records were excluded from target ownership counts.',
    'The Arc transaction evidence has no exact hash overlap with the archived report-payment receipts and cannot be treated as report payments, fills, or PnL.',
    'The 109 transaction receipts include incomplete timestamps/action context; some historical coverage remains unknown.',
  ],
};

assert.equal(result.reports.originalPlanReportIdsMissingFromArchive, 0);
assert.equal(result.reports.uniqueArchiveReportIds, result.reports.archiveRowsForTarget);
assert.equal(result.reports.originalReceiptLinkedUniqueReportIds + result.reports.authenticatedHistoryRowsWithoutOriginalReceipt + 10,
  result.reports.archiveRowsForTarget, 'expected archive provenance partition: receipt-linked + auth-history + metadata-only');
assert.equal(result.reconciliationDelta.confirmedMissingTargetReportRowsWithinReviewedArchivePlan, 0);
assert.equal(result.transactionEvidence.exactHashLinksToReportPaymentReceipts, 0);
assert.equal(result.transactionToOtherRecords.distinctArcTransactionsLinkedToAnyReviewedActionOrOrder, 2);
assert.equal(result.transactionToOtherRecords.evidenceBundlesWithExactTransactionHash, 0);
assert.equal(result.reconciliationDelta.unmatchedHistoricalTransactionCandidates, 107);

const outputPath = resolve(root, '.tmp/reconcile-test-wallet-history-2026-11-18.json');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  output: '.tmp/reconcile-test-wallet-history-2026-11-18.json',
  targetReports: result.reports.uniqueArchiveReportIds,
  receiptLinkedReports: result.reports.originalReceiptLinkedUniqueReportIds,
  authHistoryNoReceipt: result.reports.authenticatedHistoryRowsWithoutOriginalReceipt,
  metadataOnly: result.reports.withoutOriginalJobId,
  uniqueArcTransactions: result.transactionEvidence.uniqueTransactionsAfterChainHashDeduplication,
  exactTransactionToReportLinks: result.transactionEvidence.exactHashLinksToReportPaymentReceipts,
  confirmedMissingReports: result.reconciliationDelta.confirmedMissingTargetReportsRelativeToNov16Plan,
  stillUnassignedBlobCandidates: result.reconciliationDelta.ambiguousOrUnownedReportBlobCandidates,
}, null, 2));
