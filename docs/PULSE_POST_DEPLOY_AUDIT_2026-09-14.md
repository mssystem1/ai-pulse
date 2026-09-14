# PULSE deployment audit — 13–14 September 2026

## Scope and boundaries

Reviewed the deployed landing page and all eight app workspaces, local code, historical persistence, desktop/mobile layouts, four appearance themes, chart interactions, report recovery, and representative paid/mainnet workflows. Real tests used the authorized test wallet; private keys stayed in the local signer, never in the browser or committed artifacts.

This is a bounded product audit, not a guarantee that every market condition, wallet extension, device or third-party outage has been exercised. No hosting settings, production deployment, agent listing, existing strategy policy or existing Autopilot account was changed. New test Autopilot #2 on Arbitrum was isolated from the original account.

## Findings fixed in this change

| Finding | Resolution and verification |
| --- | --- |
| Global shortlist omitted charts although Spot/Autopilot showed them | Shared chart cards now render in all three contexts; expansion remains local and preserves selected candidates. |
| Global market chart stayed empty until manually loaded | Automatic, scoped free-market loading and visible-page refresh; free data has independent loading/errors and cannot overwrite paid report state. |
| Landing totals excluded surviving historical reports | Explicit source/target namespace backfill; checksum-verified live reports and settled receipt identities deduplicate historical publications. No trading jobs were copied or moved. |
| Legacy direct Spot fills were omitted from public volume | Accept server-verified `wallet` activity and protected entry variants; continue to require confirmed receipts, allowed execution accounts and correct settlement assets. |
| Open landing page retained old totals indefinitely | Visible-page refresh every 60 seconds and refresh when returning to the tab. |
| Spot ticket balances stayed unchanged after a confirmed sell | Refresh both token balances with account/history refresh, bypassing stale cached balances. Regression checks zero spendable balance and disabled repeat Sell. |
| Autopilot rule evidence exposed floating-point noise | Format numeric evidence for reading; retain original evaluation and CSV values. |
| Prediction introduction still called reports Base/Premium | Align English and Chinese introduction with Quick/Pro terminology. |
| Paid Prediction report failed after Redis migration | Redis Lua `cjson` converted the validated empty `additionalMarketIds` array to `{}` when binding the receipt. Store immutable request JSON as an opaque string through Lua mutations and restore it on reads/claims. |
| Existing affected paid requests could not recover | Restore only the known empty-array corruption when the reconstructed request matches its original payment-bound hash. Do not guess or relax request validation. |
| Two memory-based unit tests reached local Redis credentials | Explicitly isolate test queue, storage and session configuration from `.env`. |
| Legacy diagnostic printed fragments of a private key | Removed key-fragment logging. |

## Live mainnet evidence

### Arbitrum Autopilot

- Created test Autopilot #2: `0x43147964253E68fFdB8c2FA69e816987cFc275dD`.
- ETH-USDT, 1H, trend following, conservative profile; deposit **0.20 USDC**, maximum Buy **0.05 USDC**, confidence threshold **80%**.
- The app completed create, asset configuration, risk limits, funding, strategy authorization, 24-hour pass purchase and automatic resume.
- Pass payment: `0xc0a02300852ade355ab4da11a0401d58e1bd5599e6702fcdd25453381a82df5d` — **1.50 USDC**, successful on-chain receipt.
- Activation: `0x3b3de1fcb2817e4c8d390c490b02e64e35742cd6e4eb4a6cbfdbcf9ea05a04b7`.
- The account remained active overnight during the conversation pause. Its journal recorded **13 evaluations, 13 Holds, zero failures, zero fills**. SMA20 never exceeded SMA50; Grok was therefore not requested. This verifies scheduling and entry gates, not a live autonomous Buy/Sell branch.
- Owner pause: `0x81de5d7b335c3b11f9fb03e168723322a87be05b0f8fa022b25df4e080cf0119`.
- Full **0.20 USDC** withdrawal: `0x61ceec471b62bbaee771134346a0930c33f455975b989ffd1f50d262e73d830f`.
- Final vault state: paused, zero USDC, zero WETH; Resume correctly disabled until funded. Its remaining pass time was **12h 42m 31s**, unchanged at subsequent checks, with all three confirmations unused.

### Arbitrum Spot without analysis

- Chose ETH-USDT in the live pair picker; PULSE verified WETH/USDC, loaded its chart, obtained a quote and requested an exact token allowance.
- Buy: `0x703a30d62bc80942335eeed312a0c6fbc21339f4a61ec43768634a545649d8b2` — **0.10 USDC** exchanged for **0.000039995146754704 WETH**.
- Sell: `0xd219d9ec0248827f53629303434d43e062c0bc95e50eb533045dd07eec690f9b` — closed that entire test position.
- Both transactions were independently confirmed and appeared as two chart markers and separate execution-history rows. Final wallet WETH balance: zero.
- Aggregate lifetime Spot P&L correctly remains unavailable where older sells lack a verified matching cost basis. The tiny test round trip is not a profitability benchmark; network gas is separate from fill-based P&L.

### Arbitrum Global report / Spot boundary

- Global Quick ETH-USDT 1H payment: `0x6f260e25946aa86ec486364409435640c9ed3ee3d7a45f6d64de05ab5618cb8f` — **0.20 USDC**.
- Live report delivered successfully, with a neutral/Wait conclusion. The prefilled Buy action remained disabled, as required.
- Did **not** change the report to manufacture a Buy. Bullish report-to-Spot Market/Limit prefill and switching to a different direct pair were covered with local browser fixtures, not a live bullish-report trade in this audit.

### Arbitrum Prediction report and recovery

- Selected a live BTC question, loaded outcomes, bid/ask, spread, liquidity and resolution information. Trading restriction remained disclosed; no Polymarket position was opened.
- Quick payment: `0x12bbcec2077b9dd18ad986ad209973cb6babe756e72bc437bca9f7bf0a8dabef` — **0.20 USDC**.
- Original job `65f61fce-e07a-4426-bf6f-ce941a89814a` failed because of the Redis empty-array corruption described above. A retry reproduced the failure without a new payment.
- Repaired only this test job using compare-and-set after verifying the original request hash and settled transaction. Receipt, event history, queue and TTL were preserved. The complete fix for future and legacy requests is in code and requires API deployment.
- Browser receipt-bound recovery then delivered the live Grok report at **09:20:09 UTC on 14 September**, with no additional charge.
- A fresh browser session then signed the wallet-owned history challenge and reopened this completed report at **09:26 UTC**, without another payment. This verifies cross-session recovery, not automatic report rendering after every reload.

### Base Risk Guard

- Paid AERO Risk Guard: `0x77db21c978547eacbe3297bef45c8df40ad92752815634d56fa265cdbb06679f` — **0.20 USDC**.
- Live report returned successfully, recognizing Aerodrome's verified contract and substantial liquidity; seven source-coverage entries were observed, one not applicable.

Total analysis/pass charges in this audit: **2.10 USDC** across Base and Arbitrum, plus network gas. Autopilot principal was returned and Spot test exposure closed. Original strategies were left untouched.

## Public statistics recovery

At 09:22 UTC on 14 September, the live public API reported:

| Network | Global reports | Prediction reports | Risk Guard reports | Verified Spot fills | Verified Autopilot fills |
| --- | ---: | ---: | ---: | ---: | ---: |
| X Layer | 14 | 3 | Unavailable | 4 | 9 |
| Base | 16 | 1 | 1 | 7 | Unavailable |
| Arbitrum One | 11 | 1 | Unavailable | 3 | Unavailable |
| Arc Testnet | 16 | 3 | Unavailable | Not offered | Not offered |
| Observed totals | **57** | **8** | **1** | **14** | **9** |

These are observed surviving deliveries/confirmed fills, not fabricated lifetime totals. Genuine developer mainnet tests are included. Arc remains explicitly labelled testnet. Historical inline Risk Guard reports could not be reconstructed from queued-job records. Missing evidence is not counted as zero. Mainnet trading volume remains separated by chain and settlement token.

## Verification matrix

- Deployed routes: Portfolio, Global, Prediction, Risk Guard, Spot, Autopilot, Telegram, Docs at 390/1440px — HTTP success, no render errors or horizontal overflow.
- Local app shell: eight routes × four themes × two widths.
- Landing: four themes × 360/390/768/1440px; unavailable-statistics handling; public page does not initialize the wallet.
- Browser regressions: Global automatic chart loading; all shortlist contexts; chart expansion/zoom/history failures; report-to-Spot context changes; Autopilot account ordering and controls; no duplicated setup/journal navigation; Portfolio recovery/stale response protection; Telegram configured/unconfigured states; Docs; shared and revoked reports; post-settlement balances and confirmed chart markers.
- Unpaid endpoint matrix: malformed requests rejected before payment across four networks and five report routes; Global Quick/Pro challenge prices/networks checked across all four networks.
- Web unit tests: **76 passed**. API suite: **200 passed, one skipped, zero failures**.
- Web and API production builds passed. Existing third-party wallet bundle warnings remain; they did not prevent builds.
- Real Redis integration: request arrays through Lua receipt binding/claims/report attachment, idempotency, leases, reconnects, atomic budgets and paused pass timing.
- Existing Blob integration: encrypted save/read, checksum verification, sharing and revocation. Isolated test keys/Blob objects cleaned up; no user records deleted.

## Rollout and remaining limits

Deploy **both API and web**. Historical public counts and the targeted paid test-job recovery are already live; new serialization, balance-refresh and UI fixes are not live until deployment.

After API deployment, affected older Prediction purchases should use **Recover without paying again** or wallet history **Retry**, not another purchase. Hash-mismatched or otherwise malformed legacy inputs still fail closed and need individual investigation.

Not live-exercised in this pass: every Pro/network payment combination, a bullish report-authorized Spot execution, autonomous Buy/Sell fills, triggered Limit/TP/SL fills, external wallet-extension/device variants and an outbound Telegram delivery. Those branches have code/unit/local-fixture coverage where noted, but are not represented as new mainnet successes. The audit did not resubmit agent 8355 or alter its listing.
