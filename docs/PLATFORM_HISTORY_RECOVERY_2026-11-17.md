# Historical record recovery — November 17, 2026

The user authorized recovery for all PULSE users, preserving newer records and keeping automation paused. TEST_WALLET_ADDRESS remains the priority. No payments, orders, pass renewals or report-generation jobs were created by this recovery.

## Recovered data

The production Redis instance contains **226 wallet-owned, read-only report archive entries**. **172 belong to TEST_WALLET_ADDRESS:** 142 Global, 20 Prediction and 10 Risk Guard reports. The other 54 belong to two other original report owners. Report bodies remain encrypted in Blob storage; the wallet-scoped index contains metadata, not plaintext reports.

| TEST-wallet source | Distinct reports | Ownership and content evidence |
| --- | ---: | --- |
| Original Redis metadata | 40 | Original owner, report UUID, URL and checksum |
| Later saved delivery responses | 77 | Completed receipt binds payer/report UUID; original encrypted Blob and stored checksum match |
| Paid captures originally held in memory | 2 | Full original jobs/receipts and checksum-matched reports; new encrypted storage copies, without recreating jobs |
| Prior wallet-authenticated history export | 53 additional | 91 authenticated captures matched uniquely to original production Blobs by exact full-body hash; 38 overlap earlier sources |

For the final 53, original Redis metadata is unavailable. The archive explicitly marks `authenticated-history` provenance. Wallet access is established by the captured authenticated history; the stored report UUID comes from the unique encrypted Blob match. Its original upload time supplies the archive timestamp. No original payment receipt, private job fields, recovery capability or original metadata timestamp is fabricated.

The original 491 stored files comprise **94 analysis reports and 397 execution lifecycle audit documents**. The audit documents are preserved privately and excluded from the report-history list and paid-delivery counters. Earlier use of “491 report files” referred to the storage collection, not 491 trading analyses.

The approved legacy merge also restored missing unexpired original jobs/metadata and **1,311 immutable Autopilot evidence bundles**, while preserving existing values. Live comparison verified 1,428 string values, 769 hash fields, 36 payer-index members and all 226 archive rows: zero missing or different values. Six recovered strategies remain paused; 16 closed orders remain historical; one formerly active order remains held outside the executable order store. The earlier two paid indicator entitlements and expired Terminal-pass history remain as previously recovered.

## Report history and deployment

Deploy the API and web changes accompanying this document. Data imports have already been applied to production Redis; deploying does not rerun them.

Open Global Market, Prediction Market or Risk Guard, connect the original wallet, choose its original payment network, then use **Report history → Sync with wallet**. Use **Load older reports** to page beyond 30. An archive entry opens the saved original without a new payment and is labeled **Recovered archive · read only**. It cannot regenerate a job or grant current setup access. Entries whose original payment network is unknown are visible only to their owner, with that limitation stated.

Archive reads require a current wallet-signed history session, validate ownership/network, restrict storage URLs, reject redirects, decrypt and verify the original body checksum. No archive-import HTTP endpoint exists. Importing is an operator task with a reviewed plan hash and insert-if-missing semantics. Newer conflicting entries are preserved by aborting the import. Original live-key expiries and paid-access dates are not extended.

## Public activity

Restoring jobs does not rebuild the separate public activity projection. Verified historical receipts and live report bodies now establish **114 Global, 19 Prediction and 6 Risk Guard observed deliveries**. The original chain/testnet classification is retained. A replay of the expanded recovery added zero deliveries.

These are observed deliveries, not a complete lifetime count or customer count. Archive opens do not count as deliveries. The additional 53 authenticated reports do not increase these counters because their original receipt identities are missing. Execution receipts, report payments and execution audit documents are not presented as confirmed trading fills.

## Private evidence and remaining gaps

The ignored, private archive is `DB_backup/platform-recovery-2026-11-17/`. It preserves the original source records, encrypted bodies, recovery plans/results and file hashes. It excludes environment credentials, private wallet keys and the report encryption key. Keep the existing encryption key separately: it is required to read the encrypted reports.

All 691 report Blobs visible in the captured storage inventory have been preserved, plus the two reconstructed encrypted copies of the original memory-only reports. Of those original Blobs, **70 have no proven owner**. They are retained in `unassigned-report-files/`, without assignment to TEST or exposure through application history. Additional original wallet metadata or an authenticated export could establish their ownership later.

Four local transaction-evidence files preserve 109 distinct historical receipts. Some lack original timestamps or sufficient transfer/action details. They support evidence preservation, not invented swaps, fills or PnL. The attempted additional Blockscout history lookup returned exhausted PRO API credits (HTTP 402); no paid top-up or alternative paid call was made.

The available legacy sources contain no later Terminal workspace, creator indicator catalog/drafts, Telegram configuration or saved Global scenario keys. Main-browser local storage has not been supplied. Recovery of every historical record is therefore **not complete**. The old lost Redis volume has not been recovered, and the cause of its missing history is not proven.

## Validation

- API build and web production build pass. The web build reports existing dependency annotation/chunk-size warnings.
- 24 focused archive, route, ownership, pagination, receipt-projection and recovery tests pass.
- Browser workflow against the new API code and live restored Redis: wallet sign-in, 30-row first page, 56 Base rows after loading older reports, and opening an original archive without setup-access credentials pass.
- A 390-pixel mobile viewport using the application styles has no horizontal overflow.
- Cross-network authenticated pagination verifies reachability of all 172 TEST-wallet reports; representative original reports open read-only.
- These archive API/browser checks use the new code locally with durable workers disabled. Production archive-UI validation must follow deployment. The production public activity API is already serving the rebuilt delivery totals.

## Operator tools

- `scripts/recover-platform-history.mjs`: preview/reviewed merge of original unexpired legacy records, preserving newer values, original namespaces and expiries.
- `scripts/recover-report-archive.ts`: prepares the owner-bound read-only archive plan and verifies encrypted bodies. `--apply --plan-sha256=<reviewed hash>` applies only that plan.
- `scripts/recover-wallet-public-activity.ts`: verifies the previously reviewed TEST-wallet plan and rebuilds only receipt-proven public delivery facts.

The private incident source files are required to run these tools. They are deliberately excluded from Git. Never run an unrestricted Redis restore over the live instance.
