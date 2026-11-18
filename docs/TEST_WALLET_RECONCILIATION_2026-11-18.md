# Historical TEST wallet reconciliation — November 18, 2026

This is an offline reconciliation of the reviewed incident evidence already retained in the workspace. It performs no API, Redis, RPC, Blob, browser, or wallet calls and writes no application data. The command writes its aggregate JSON result under the ignored `.tmp/` directory:

```powershell
node scripts/reconcile-test-wallet-history.mjs
```

The script verifies the saved SHA-256 manifests for the four transaction-evidence files and the reviewed November 16 and 17 recovery plans. It has built-in focused assertions for chain-plus-transaction-hash deduplication, conflicting duplicate detection, wallet separation, report-plan identity, and the expected evidence partition. The output intentionally omits transaction hashes and report IDs.

## Wallet scope and report records

The historical target is the previous `TEST_WALLET_ADDRESS` (`0xa7d8…8683`). The current authenticated wallet is different. The November 17 all-owner archive includes 42 rows for that current wallet and 12 rows for a third owner; the reconciliation excludes all 54 from the historical TEST-wallet totals. In particular, the file named `arc-current-wallet-transactions.json` is an October 7 evidence capture for the old target address, not evidence for the current November 18 authenticated wallet.

The reviewed November 16 plan contains 31 old-wallet report-job/payment-history records: 30 completed jobs with receipts and one manual-reconciliation record. It contains 30 unique readable report records. Fourteen were in the deployed `pulse:production` namespace and 16 remained in `pulse:local`.

The November 17 archive plan contains 172 distinct report IDs for the old wallet, with no duplicate IDs. All 30 report IDs from the November 16 plan are present; none is missing. The remaining 142 IDs are additional archive rows. Their retained provenance partitions as follows:

| Evidence | Rows | Interpretation |
| --- | ---: | --- |
| Redis report metadata | 40 | 30 have original job IDs; 10 have no original job ID |
| Saved delivery evidence | 79 | Includes 77 later delivery report IDs and two captures originally held in memory |
| Authenticated history | 53 | Wallet history and unique encrypted-Blob matches; no original payment receipt or private job fields |

Thus 109 distinct archive reports have report-job/receipt provenance (30 Redis report rows with original jobs plus 79 saved-delivery rows). The 53 authenticated-history records and 10 metadata-only records remain explicit evidence gaps; they are not converted into fabricated payment receipts. The later-delivery archive has 142 raw capture entries; repeated captures collapse to 77 unique report IDs. The independent checks found 83 entries meeting the saved-settlement and checksum predicates, again not 83 unique reports.

Among the 172 old-wallet rows, source namespace provenance is 123 `pulse:production`, 42 `pulse:local`, five `pulse-qualification-global-v8-20261102`, and two unknown. These are original source labels. The archive was restored into the production Redis report-history index; report bodies remain encrypted in Blob storage. Final archive application recorded 226 rows across all owners, added 53 rows in that final application, added zero public-delivery identities at that step, and made no payments or automation changes.

The separate platform-wide public activity projection contains 139 observed report deliveries: 114 Global, 19 Prediction, and six Risk Guard. Of these, 119 are mainnet deliveries and 20 are testnet deliveries. These projection totals are not attributed wholesale to the old wallet and are not transaction or trade counts.

## Transaction evidence and join result

The four retained Arc transaction-evidence files describe chain 5042 and consistently identify the old target wallet. The movement and combined-receipt exports are byte-identical duplicate evidence. Including those copies and the three-entry October audit, chain-plus-hash deduplication yields 109 unique successful transaction receipts, removes 112 repeated evidence rows, and finds no conflicting duplicate identity fields. Thirty-two unique receipts include transfer logs; 77 have none. None contains an explicit app report, job, payment, or action reference.

The 109 transaction hashes have zero exact matches against the settlement transaction hashes in the archived report payment receipts. Amounts or USDC movement alone cannot establish a report purchase, so no transaction was linked to a report or treated as a fill. This is a missing join, not proof that every transfer is unrelated; receipt details and timestamps are incomplete.

## Verified delta and remaining candidates

Within the reviewed report plans, the confirmed missing-report delta is zero: every November 16 report appears in the November 17 archive and the 172 target report IDs are unique. This does not establish complete lifetime recovery. The separate recovery notes identify 70 stored report blobs that remain unassigned; this reconciliation has no evidence to attribute them to the target wallet. The original Redis volume is still unavailable, and the main-browser local-storage export has not been supplied.

The next useful evidence is the pre-November-12 Railway volume/export and a scoped export from the main Chrome profile previously used for PULSE. Compare any browser report IDs and drafts to this archive and to exact settlement receipt identities. Revisit the 70 unassigned blobs only when authenticated ownership or payment evidence supports assignment. The 53 authenticated-history rows and 10 metadata-only rows should remain marked with their current provenance until an original receipt or job record is found.

The Arc transaction files contain 109 unique transaction receipts, not 109 missing app records. The separate recovery record says an additional Blockscout lookup stopped at exhausted PRO API credits; no paid lookup was made. The old report decryption key and the lost Redis volume are not part of this reconciliation input.

## Fresh production verification

A separate read-only check on November 18 matched all 226 reviewed archive rows in production Redis, including all 172 rows for the historical TEST wallet. All 226 retained encrypted report bodies matched their file hashes and decrypted plaintext checksums using the existing operator key. Six representative original live Blob objects across service/network combinations also matched the retained encrypted bytes and plaintext checksums. No application records, orders, payments or automation changed. Evidence: `.tmp/recovered-production-validation-20261118.json`; runner: `.tmp/verify-recovered-production-20261118.mts --live-read-only`.

The same read confirmed the historical expired pass and two later settled, non-simulated 24-hour grants for that owner. Radars and watches remained paused, Telegram remained off, and no journal position was open. This is production storage and content evidence. It does not substitute for a fresh wallet-authenticated archive UI check for the old owner, whose key is no longer the configured TEST key.

The deployed API was separately checked using a tightly validated Base report-history login signature from the current configured TEST owner. Its 27 expected Base/unknown-network archive entries were reachable, an original report opened read-only, and requesting an archived report of another owner returned 404. No tokens were saved, no payment was signed, and no report was regenerated. Evidence: `.tmp/deployed-archive-api-validation-20261118.json`. Those 27 entries belong to the current owner and are not added to the historical target's 172 reports.

## Exact transaction joins to restored actions and orders

The offline utility also checks exact `chainId:transactionHash` references in the reviewed old-owner restoration plan and the restored platform evidence plan. It limits Autopilot evidence to vault keys belonging to the six strategies in the reviewed historical TEST-wallet plan; it does not scan user workspaces or infer associations from amounts.

The reviewed plan contains 16 closed orders (nine cancelled and seven filled); the application record says all 16 were added, with no conflicts, and one active/paused order held. Across those orders, target-owned activity/evaluation records, strategies, and 1,309 strategy-keyed immutable evidence bundles, two distinct successful Arc receipts have exact hash references: one in a confirmed `automatic_fill` activity record and one in a `filled` closed-order record. No exact transaction hash appears in the 1,309 evidence bundles. The two matches are already-present restored records, not newly discovered missing records.

The remaining 107 of 109 successful Arc receipts have no exact transaction-hash join in the reviewed target action/order/evidence records. This is an unmatched-record count, not a missing-fill count; no fills or PnL are inferred. Together with the zero report-payment joins above, the reviewed data establishes no additional missing-record delta. It does not establish whether unmatched receipts correspond to activity outside the retained evidence.
