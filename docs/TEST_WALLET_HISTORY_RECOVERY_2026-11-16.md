# TEST wallet history recovery — November 16, 2026 UTC

A verified portion of the TEST wallet's history has been restored to the live Redis database. This is **partial recovery**, not recovery of the missing Railway volume. Later browser drafts, publications, Radars, notifications and position journals remain unproven or unavailable.

Wallet: `0xa7d827622c4f9c884ca8f751b2060dd767f18683`.

## Sources and restored records

The original September 10 RDB export and the still-readable legacy Upstash database supplied owner-scoped records. The legacy source was read without changing the app's backend or importing unrelated customers/projects. Original report bodies were decrypted and checked against their saved SHA-256 digests before restoring their metadata.

| Record type | Restored | Conditions |
| --- | ---: | --- |
| Report job/payment-history records | 31 | 30 completed; one manual-reconciliation record. No jobs requeued. |
| Report metadata and readable bodies | 30 | 14 in the deployed production namespace; 16 in their original local namespace. |
| Original idempotency bindings / payer-index entries | 31 each | Original job identities and namespaces retained. |
| Confirmed activity records | 149 | Only this wallet's terminal activity states. |
| Strategy evaluation rows | 590 | 390 journal rows and 200 surviving embedded evaluations. |
| Strategy definitions | 6 | Restored **paused**, with original definitions archived privately. |
| Closed order records | 16 | Nine cancelled and seven filled. One formerly active order remains archived. |
| Purchased indicator versions | 2 | Exact original package bytes and confirmed original Base settlement evidence. |
| Expired Terminal pass history | 1 | Original November 4–5 interval retained; no new paid access. |

These categories overlap; they are not a count of unique trades or purchases. The 31 job records produce 15 history entries and 14 readable reports in the deployed API. The 16 local reports were not relabelled as production purchases.

Original key expiries were retained where known. Inserts and compare-and-set merges preserved existing/newer records and existing TTLs. Ready/leased job queues, runnable orders and notification deliveries were not reconstructed. The runtime may reconcile a paused order back to active, so the formerly active order was not restored even as paused.

## Paid indicator and pass evidence

The two paid versions are **QA weighted execution service v2.0.0 and v4.0.0**, published by the QA creator, not the wallet's missing own creations. Each original purchase cost 0.001 USDC on Base. Recovery checked the exact asset, payer, creator recipient, amount, successful transfer, unique authorization nonce and settlement time against the original quote. No payment was repeated.

| Version | Original settlement | Canonical package SHA-256 |
| --- | --- | --- |
| 2.0.0 | `0x3971aac2543075b6fcb3f0a3bc399b5796cb501c095547492bf85fbbbb21d044` | `3a36f2610e1aa66e4823f72490baecfb2f251a31a2d827f2f6bb9c806e2871dd` |
| 4.0.0 | `0x00d8a5fae4090004b70957c49821904583fa3dfabeca02082193a0e24c003f15` | `b7ac3768a663ffb5fd89bb885be7e2879b385f2bb84fc7821080f1cc217f0df1` |

The funded acceptance runner originally used `pulse:local`. Its proven portable entitlements were also explicitly migrated to `pulse:production`, with source provenance retained. The catalog listings were not republished; purchased versions remain retrievable after delisting. The exact historical grant time was unavailable, so the reconstructed purchase records use settlement time and explicitly mark that limitation. An older attempted v1 purchase without a consumed authorization was excluded.

The 1.50 USDC Base Terminal pass settlement is `0xc53667c601dd8806eade5c883a2ac7cb53b35012abb1ef852d3a6ccf913314ac`. Its documented interval was **2026-11-04 05:22:46.446 UTC to 2026-11-05 05:22:46.446 UTC**. The original acceptance marker, documentation and chain settlement agree. Its original opaque payment/grant identity was unavailable: recovery uses an explicitly reconstructed identity and preserves that provenance. Expired access remains inactive and Telegram remains disabled.

## Validation

- Nine local tests passed: wallet filtering, expiry, namespace/identity checks, report dependencies, paused strategies, closed-order merging, and browser-export credential exclusion/corrupt storage handling.
- Isolated Redis merge checks passed for conflicts, missing records, original expiry, unchanged existing TTLs, repeat application and incorrect types. Temporary test keys were removed.
- The actual deployed API accepted TEST-wallet sign-in, listed 15 restored report-history entries and opened all 14 corresponding reports.
- Both paid indicator versions were restored through the authenticated deployed API with **byte-for-byte original package equality**, without payment. Unauthenticated purchase-history access returned HTTP 401.
- Direct read-only Redis verification matched **all 868 planned record/field values**, with zero missing or different values. The 16 closed orders remained present and the formerly active order remained absent.
- The deployed workspace reported the recovered expired grant, inactive access and Telegram disabled.

This validates live authentication, API retrieval and stored data. It does **not** claim an end-to-end visual check in the user's main Chrome profile. No payments were signed, orders placed, reports regenerated or automation resumed during recovery.

## Private archive and tools

The ignored directory `DB_backup/test-wallet-recovery-2026-11-16/` contains reviewed plans, apply outcomes, validation evidence, original encrypted report envelopes, two user-supplied report text exports, and a SHA-256 manifest. It deliberately excludes environment files, private keys, raw payment signatures and login sessions. The original report encryption key is still needed to decrypt the archived envelopes; it is not copied into the archive. The text exports are archived as documents, not fabricated server jobs or payment receipts.

Original RDB: `DB_backup/9615a8e6-7d88-414d-95d3-9402d9097406.rdb`, SHA-256 `aa712b7b962efe4927bda78e3a978523754d19c7275d83be1980fd2774c9933f`.

Reviewed history plan SHA-256: `96e190fed8ca99c6a41344bab849d8ae9f6f2884edce60e36b13b831588d1da8`.

Reviewed receipt plan SHA-256: `48ee7012853d0c240d9c7c462eba1edf51ac414b219269ce724282cd4ddee0ee`.

Tools are incident-specific and depend on private evidence, not a general database restore interface:

- [wallet-history-recovery.mjs](../scripts/wallet-history-recovery.mjs): prepare a private plan; applying requires its exact reviewed hash.
- [recover-closed-order-history.mjs](../scripts/recover-closed-order-history.mjs): restore only closed orders while retaining existing rows.
- [recover-test-wallet-receipts.ts](../scripts/recover-test-wallet-receipts.ts): verify original chain settlements and reconstruct proven receipts without signing.
- [audit-wallet-history-recovery.ts](../scripts/audit-wallet-history-recovery.ts): bounded authenticated read checks; signs only validated login messages.

Do not rerun a write operation with newly generated plans merely to repeat verification. The saved validation and archive record the applied evidence.

## Remaining recovery paths

1. In the **main Chrome profile previously used for PULSE**, open `https://app.ai-pulse.tech` and Trading Terminal → My Indicators. Check Created indicators and saved drafts. Do not clear site data or reinstall the browser.
2. Existing indicator Export buttons can preserve individual packages. For one recovery file containing all surviving wallet drafts, installed packages and report job IDs, open Chrome DevTools → Console on that app page and run the contents of [export-test-wallet-browser-recovery.js](../scripts/export-test-wallet-browser-recovery.js). It downloads `PULSE-test-wallet-browser-recovery.json` locally, without network requests, wallet prompts or storage changes. Review the script first; the browser may require its own paste confirmation. Share the resulting JSON for evidence-based reconciliation. Do not export all localStorage or payment/signature/session entries.
3. The helper reads only the TEST wallet's created/draft keys and explicitly allowed device-wide package/report-reference keys. It strips report recovery tokens and exports no pending payment authorizations. Device-wide records still need ownership and settlement checks; finding a job ID does not itself prove payment.
4. Ask Railway for a separate pre-November-12 recovery export/volume using the [prepared support request](RAILWAY_REDIS_RECOVERY_SUPPORT_REQUEST_2026-11-16.md). No older volume or current backup was available through the inspected API. The request has not been sent on the user's behalf.

The user has not yet checked the main browser. Its surviving drafts are therefore unknown, not declared lost. Later server records cannot be inferred from transaction history alone, and the historical Railway volume is still needed for complete recovery.
