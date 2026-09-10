# PULSE deployed Autopilot review

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
