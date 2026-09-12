# PULSE deployed Autopilot review

## September 12 deployment verification and local follow-up

After the owner deployed `53d4ee6`, the public site and Railway health endpoint returned HTTP 200. Redis reported online, Blob configured and mock payments disabled. The chart license asset was served as text. Global, Spot and Autopilot charts rendered on the live site at 390px and 1440px, with historical navigation and no observed render exceptions or horizontal overflow. Mobile Global zoom was rechecked after its initial range settled: 29 to 38 candles in view. These were disconnected, unpaid browser checks, not wallet-signing or trade-execution tests.

Read-only Redis snapshots around 08:10–08:23 UTC showed advancing Base and Arbitrum accounting checkpoints. Recovery is not complete; the legacy Arbitrum account has millions of blocks to scan. Base #1 had recent scheduler evaluations, with entry held by its signed pullback rule; its stored pass expires at 09:00:15 UTC on September 12. Base #2/#5's stored passes expired on September 11. These are dated observations, not entitlement changes.

X Layer had no saved checkpoint. A read-only reproduction found `block range greater than 100 max` from its public RPC; the worker requested 2,000 blocks. A local correction retains 2,000-block logical pages but splits them into contiguous 100-block requests. Unpaced concurrent reads also hit `over rate limit`, so X Layer now scans one subrange at a time, with at most two directional reads and a 500ms gap. Its worker budget is two logical pages per cycle to leave headroom within the existing lease. A paced live scan successfully covered blocks 68,972,748–68,974,747 in 24.9 seconds. That test result was not saved. Any failed subrange prevents checkpoint advancement; in-flight requests settle before retry. The full history remains unverified until the deployed worker catches up.

At the owner's request, the local UI removes the redundant **Journals by account** panel and unregistered-account **Setup status** accordions from the journal area. Actual strategy journals, trade statistics, and their native expandable headers remain. Existing-account setup/recovery stays in the account dashboard.

Verification: all nine cash-flow tests pass, including X Layer boundaries, request concurrency, resumable ranges and failed-subrange preservation. The broader API/web suites passed during this follow-up; web has 68 tests. API build and web type-check passed. Six local browser cases passed at desktop/mobile widths, including the absence of setup/navigation panels in the journal area and preserved dashboard setup controls. These follow-up changes are local and require a separate owner-controlled deployment. No payments, trades, pass changes, production database writes, pushes or deployments were performed.

## Latest results — September 11, 2026

Agent #8355's approved descriptions were saved and resubmitted successfully. The submission response reports approval status `2` (under review). Update transaction: `0xdd697538b37ed2fa061d866af2700958c35cc0a5f35b46e4d5baae547d91099e`. No additional paid service request accompanied the update. Earlier listing-status statements below describe their dated verification stage, not the current submission.

The Base aggregate **−15%** was a journal-accounting error, not a verified trading loss. Two September 9 cash flows for vault #2 were absent from the activity projection:

| Confirmed flow | UTC block time | Receipt |
| --- | --- | --- |
| Owner withdrawal, 1.00 USDC | September 9, 09:26:43 | `0x1dc43101346d7796b7de702688d7c0652a8aa3109f8383660afad0650bcdb531` |
| Owner deposit, 0.70 USDC | September 9, 10:40:11 | `0xc5eb5d9e70bb63b10dc1d927aea7ea4ee32c93681be9aeca3f03b933029a21b2` |

Base RPC receipts verified success, exact owner/vault/USDC transfer direction and amounts. Both records were restored atomically with duplicate checks and audit key `pulse:ops:cashflow-repair:base:0x2dd49a1035fcf7a951dda16609f5d33158d91bee:2026-09-09`. **No funds moved.** The subsequent live API showed 0.00% for #1, #2 and #5; #2 had 0.70 USDC current value, 2.20 USDC gross basis and 1.50 USDC withdrawals. This is a timestamped observation, not a guarantee of future PnL.

Blockscout's token-transfer listing omitted these transactions despite ending pagination. A complete cash-flow repair must verify chain receipts; an empty explorer next-page pointer is not proof of completeness. The local September 12 continuation adds automatic receipt-verified cash-flow discovery, independent of explorer pagination; it has not yet been deployed.

Local changes replace the retired Base `1rpc.io/base` fallback, including explicit legacy environment values, with the shared supported fallback configuration. Spot aggregate return now matches confirmed Market/Limit quantities rather than averaging order percentages. Confirmed chart markers, Portfolio/Telegram copy and workflow diagrams are local changes pending deployment; verification is recorded below.

### Local verification of the follow-up changes

- API and web TypeScript checks and production builds pass. Existing frontend dependency/chunk-size warnings remain.
- API unit/integration suite: 177 passed, including Telegram canonical routing, fragment-based report links, secret validation, private-chat scope, callback acknowledgements and duplicate-update handling.
- Web unit suite: 64 passed, including weighted Spot cost basis, partial sells, missing history, mixed quote currencies and chart marker filtering.
- `scripts/product-ui-check.mjs`: 16 fixture cases passed at 390px and 1440px—Telegram ready/unavailable, Docs diagrams, Portfolio return, chart zoom/markers, Global/Prediction share readers and revoked links.
- `scripts/autopilot-ui-check.mjs`: 6 fixture cases passed at 390px and 1440px—account identity, incomplete setup, same-vault recovery, owner controls and shortlist expansion on Autopilot/Global/Spot.
- The real localhost `/shared-report` entry rendered a fixture report without importing wallet connector modules. No wallet signing, report payment or vault mutation was performed by these tests.

Review setup now starts account/storage checks and jumps directly to the same vault's review summary. It shows reused capital and draft limits before wallet approval, not a new-account invitation. Telegram now has direct page buttons and a readable, read-only shared-report page instead of raw JSON; old delivered links are not rewritten.

September 12 local continuation: a separate durable cash-flow projection scans bounded chain-log ranges and verifies receipts, resumes saved checkpoints, and rebuilds on a checkpoint hash change. It distinguishes capital transfers from vault executions and withholds PnL on incomplete coverage, stale verification or unpriced non-settlement transfers. Accounting balances use the same checkpoint block as transfers; current marks value invested assets. Legacy starting values retain their original timestamp limitation. Recovery does not modify strategy permissions, passes or wallet funds. It begins after manual deployment with the automation worker enabled; no production scan or import was performed in this continuation.

Expanded charts now page backward through OKX history, return to newer/latest data, and open a confirmed fill's time window. There is no fixed page-count cutoff in PULSE; provider retention still applies. RPC/candle adapter tests and local browser fixtures do not constitute a live paid Telegram delivery or on-chain execution test.

Local verification for this continuation: API 185 tests, web 65 tests, market 11 tests; all passed. Twenty-two browser fixture cases passed at 390px and 1440px, including Older/Newer/Latest navigation, confirmed-fill jumps, provider error versus empty history, and a funded paused vault whose Resume remains available while accounting is recovering. No horizontal overflow or render exceptions were observed in those cases. Market/API/web production builds passed with existing dependency/bundle-size warnings. No new payment, signature, live database mutation, commit, push or deployment was performed.

Subsequent chart-readability update (local, September 12): replaced the SVG candle renderer and Global's custom area renderer with locally bundled TradingView Lightweight Charts 5.2.1. The shared preview/expanded chart uses fixed green/red candles, screen-aware spacing, OHLC/volume readouts, UTC timestamps, mouse/keyboard navigation and touch pinch zoom. Verified fill markers attach above/below bars without changing market-price scaling. The renderer is free; no TradingView API key or billing flag is required. Attribution and license copies ship at `/chart-licenses.txt`.

Chart verification: web suite now passes 68 tests. Eighteen product-browser fixture cases plus six Autopilot/shortlist cases passed at 390px/1440px; chart cases check native wheel/pinch zoom, crosshair readouts, fill jumps, historical navigation and error/empty states. Two additional read-only browser cases used a fresh 100-candle ETH-USDT snapshot from the public OKX feed, with no synthetic trade markers. Screenshots were inspected in light/dark themes. Production web build passed with the existing wallet-dependency and bundle-size warnings; the new renderer is a separate lazy-loaded chunk. No wallet, payment, database or deployment mutation was needed.

## Authorized confirmation correction — September 11, 2026

After the owner's explicit approval, Base Autopilot #5's existing September 10 pass was corrected from `signalsUsed=3` to `signalsUsed=2`, with `signalLimit=3` unchanged. Verification confirmed expiry remains September 11 at **15:51:55 UTC**, `pausedAt` remains absent, and the consumed-signal identities were preserved. No vault transaction or strategy change was made.

The repair checked owner, network, vault, purchase time, expiry and expected counters, then used an atomic compare-and-swap against the complete current Redis value. It preserved the existing key TTL and wrote a one-time audit record under `pulse:ops:pass-repair:base:0xce9d3473e4889214107dd32d43b535970ff8fcb9:2026-09-10:cached-confirmation`. An existing audit marker or concurrent change would reject the repair; no blind retry was performed. The restored confirmation may subsequently be consumed by the running strategy under its existing signed rules.

Agent #8355's proposed eight description corrections passed OKX listing validation with no findings. They remain unpublished pending review of [the exact description proposal](OKX_8355_DESCRIPTION_PROPOSAL.md). No new paid test or resubmission accompanied this correction.

## Post-deployment verification — September 11, 2026 UTC

Commit `a6ef751` is visible in the deployed UI: existing-account recovery, journal navigation and Last Grok signal text are present. The API reports Redis online, Blob configured and mock payments disabled. At approximately 06:15 UTC:

| Base account | Observed state | Remaining action |
| --- | --- | --- |
| #1 | Paused, no signed registration, 0 USDC settlement | Finish setup on this existing account and verify capital before activation |
| #2 | Registered DOGE-USDT breakout; unpaused; 0.70 USDC; 1/3 confirmations used | Scheduler is evaluating; buys still require the signed conditions |
| #3 | Paused, no signed registration, 0.20 USDC | Finish setup on this existing account; reuse its funds |
| #4 | Paused, no signed registration, 0.20 USDC | Finish setup on this existing account; reuse its funds |
| #5 | Registered ETH-USDT mean reversion; unpaused; 0.20 USDC; 3/3 confirmations used | New AI entries blocked by the confirmation allowance, not expiry |

All five accounts returned balance and pause telemetry. These are settlement balances, not a valuation of all possible holdings. The pass for #2 expires September 11 at 15:59:53.489 UTC; #5 expires at 15:51:55 UTC. These times and counters are a snapshot, not a promise of current state when this document is read later.

Grok is running: #2 recorded a live signal at 04:31:19.687 UTC; #5 recorded a live signal at 00:07:19.233 UTC. #5's 04:07:18.258 evaluation explicitly reported `signals_exhausted`. Its earlier September 10 records show a live result at 15:52:13.131 and a cached result at 16:08:11.903. Both consumed allowance before the deduplication fix. With the new live result, the stored total is 3 although only two distinct generated results were used. The deployed fix prevents future duplicate consumption; it does not retroactively restore the one historical confirmation. No entitlement adjustment was performed. Any repair must be narrowly scoped, preserve pause/expiry and consumed-result identities, and account for concurrent worker writes.

The non-spending production acceptance runner completed **268 checks passed, 0 failed, 12 valid-input probes skipped** across X Layer, Base and Arbitrum REST/MCP routes. Skips are the X Layer/Arbitrum Autopilot valid-input challenges, for which no verified registered vault was supplied. Missing-input rejection was checked for all eight services. This proves input validation and challenge shape, not paid delivery of every service.

The disconnected production browser showed no horizontal overflow at 390px or 1440px. Mobile shortlist expansion retained the same section and expanded from two to eight cards; no console errors were observed. Wallet signing and account recovery were not repeated in this production browser session.

Agent #8355 still has the agreed eight service URLs/prices and approved profile description. Its review feedback remains unresolved. See [the current integration notes](OKX_AI_MODERATION.md#current-integration-review--september-11-2026) before proposing a listing update. No new payment, listing update, resubmission or vault transaction was performed during this verification.

## Evidence and recovery status

Read-only observations from the Railway API and restored Railway Redis, with server timestamps on September 10, 2026 (UTC):

- Redis is online; Blob is configured; mock payments are disabled. Autopilot capability is enabled on Base.
- Redis has 7 registered strategies across networks, 5 pass records, and no ready/leased report jobs at the audit. AOF reports successful writes and no pending fsync.
- Base has 5 factory-created vaults but only 2 registered strategies. Account creation/funding and signed strategy registration are different stages.
- Base #2 (DOGE-USDT, 15m, Breakout) has a renewed pass purchased at 15:59:53.489 UTC, expiring September 11 at that time. Fresh evaluations through 20:00 UTC report unmet breakout price/volume conditions. Those cycles intentionally did not request Grok.
- Base #5 (ETH-USDT, 4H, Mean reversion) was registered at 15:51:42.817 UTC. Its initial Grok signal was recorded at 15:52:13.127 UTC. Initial Holds cite the bullish AI condition; the 20:08 evaluation cites the deterministic support condition. This is evidence of a running scheduler, not proof of profitable execution.
- Base #1, #3 and #4 have no saved registration. Settlement balances observed were respectively 0, 0.20 and 0.20 USDC; #2 held 0.70 USDC. One account response returned unknown telemetry for #5. These are point-in-time settlement balances, not a complete inventory of every token.

No pass was credited/refunded, no vault was resumed/paused, and no trading rule was changed on production during this review. Missing signed rules cannot be invented from funding transfers. Older evaluation details deleted before the Redis export remain unrecoverable from that export.

## Local corrections

1. Account discovery reads bounded multicall batches instead of parallel per-vault calls. It retains all factory accounts in their original order, does not turn failed discovery into an empty list, and preserves balance/pause evidence when token metadata fails.
2. An unfinished account has an explicit **Finish Autopilot #N setup** flow, including an action beside disabled controls. It reuses the existing vault and settlement funds. Activity can suggest a market, but every trading rule remains a reviewable draft requiring owner approval.
3. Choosing a shortlist market while recovering an unfinished account no longer switches to creating another vault.
4. Every account has a direct journal or setup-status link. Missing registrations are not shown as imaginary strategy journals.
5. Reusing the same cached Grok result no longer consumes another confirmation from the same pass. Existing historical entitlements have not been rewritten.
6. **AI today** is scoped to the current UTC day; an old daily counter no longer masquerades as a call today. The journal separately shows the last successful Grok signal.
7. All three Autopilot GET discovery probes describe the required POST body instead of returning a plain 404. Invalid POSTs return the same structured input guidance before payment. MCP Risk Guard declares its exact-token requirement.

## Verification boundaries

- API: 173 tests passing in the isolated test environment, including new discovery, cached-signal, UTC usage and endpoint-input regressions. Run with `NODE_ENV=test`, `PULSE_SKIP_DOTENV=1`, `QUEUE_PROVIDER=memory` and no inherited Redis/KV credentials. A plain local run loaded deployment `.env` settings and returned storage-unavailable errors in the automation-tick and report-history tests; those unit tests must not depend on the live database.
- Web: 55 tests passing; API and web compilation/build checked.
- Browser fixture checks: Autopilot, Global and Spot at 1440px and 390px; account recovery, direct journal navigation, local shortlist expansion, no horizontal overflow or render exceptions. No signatures, payments or production mutations occur in these tests.
- Chrome DevTools also inspected the localhost application shell. This is separate from the wallet-connected fixture checks; localhost data services were not running in that shell check.
- Live Global Quick/Pro and Risk Guard return standard version-2 payment challenges for valid inputs. MCP Global Quick also returns a challenge. Empty inputs fail before payment.
- The approved live Global Quick REST purchase completed: 0.20 USDT0 on X Layer, followed by authenticated job polling and HTTP 200 final BTC-USDT report retrieval (22,953 bytes). Other paid services and marketplace approval are not established by this one test.

## Live paid-delivery result

The Codespace ran OKX CLI 4.5.3 with its logged-in wallet. The first REST replay omitted the business body and returned HTTP 400 before payment. A subsequent balance read still showed 0.20 USDT0.

The OKX client's `pay_from_state` REST branch passes only pay-time `biz_params` to `replay_merchant`; it does not merge quote-time `known_params`. Its MCP branch handles saved arguments separately. PULSE's declared POST/body parameter plan was correctly parsed by the quote. Do not weaken PULSE's required-input validation to accommodate the missing body.

Workaround: repeat **all business parameters on both quote and pay**, including `--param instId=BTC-USDT --param timeframe=4H --param lang=en`. The corrected, approved payment returned success:

- Settlement transaction: `0x3384a205e10d72b0a8385dbd09878c64572582bb01bc62ac036ed1ffbea78868`.
- Job: `f92a6659-972b-4982-ae36-2872154484a5`.
- Observed stages: `payment_settled` → `generating_analysis` → `completed`.
- Authenticated final report: HTTP 200, `instId=BTC-USDT`, `tier=standard`; analysis, chart, market, technical and execution-plan fields present.
- Post-payment balance: 0 USDT0. One successful 0.20 USDT0 charge; no additional paid tests performed.

`scripts/okx/live-delivery-check.mjs` performs one payment and then only authenticated GET polling/report retrieval. It keeps recovery credentials in memory, never automatically retries payment, and now defaults to a non-paying dry run unless explicitly enabled after quote verification and user approval.

Client source reviewed: [REST replay](https://github.com/okx/onchainos-skills/blob/main/cli/src/commands/payment/payment_flow.rs), [quote parameter plan](https://github.com/okx/onchainos-skills/blob/main/cli/src/commands/payment/quote.rs). Source on the upstream main branch can change; the deployed CLI behavior was independently reproduced above.

## Operator next steps

Deploy the reviewed local changes yourself. For #1/#3/#4 select **Finish setup** on the existing account, review its market and risk limits, then sign registration/payment/activation as offered. Do not create a replacement account just to recover these vaults. #1 needs verified capital before activation; existing settlement funds on #3/#4 are reused. Confirm pass and runtime separately after completion.

For agent #8355, the direct Global Quick REST request-to-report test has passed. Still verify the currently registered catalog URLs and the evaluator's invocation path; this REST test does not prove all eight services or the MCP paid path. Ask the user before resubmitting. No listing update or resubmission was performed during this review.

Protocol references: [OKX A2MCP guide](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp) and [seller SDK integration](https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk).
