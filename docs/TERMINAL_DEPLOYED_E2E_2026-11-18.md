# Deployed Trading Terminal audit — 2026-11-18

Target: https://app.ai-pulse.tech/trading-terminal; API: https://pulse-api-production-7aae.up.railway.app. The production retest verified commits 98e6197 and d467264. The landing pass-count feature in f08abaa was also deployed and verified on the live landing page.

## Production retest after deployment

Testing used isolated Chrome and a local EIP-1193 bridge to the configured Base test wallet. The bridge restricted chain changes to Base (8453), authentication to the exact Terminal challenge, and payment signing to the reviewed 24-hour Base USDC quote. Private keys, signatures, auth tokens and signed payloads were not saved in artifacts.

The configured test wallet differed from the owner used in the earlier audit. Its empty initial workspace was an owner change, not evidence of another Redis loss. The user explicitly approved the exact new wallet and one 1.50 USDC purchase. The production pass endpoint returned 201, created one non-simulated grant, and provided access through 2026-11-19 11:54:54 UTC. Reloading and reopening the private workspace restored that same grant and the paused QA Radar without another payment. The earlier audit had separately purchased one 1.50 USDC pass for its former test owner.

| Workflow | Verified deployed outcome |
| --- | --- |
| Hourly, daily and weekly charts | Native wheel zoom and horizontal drag worked. Logical range stayed unchanged through real live-quote updates; measured quote-induced drift was zero. |
| Manual price scale | Native price-axis drag disabled autoscale. Manual price and fractional time ranges survived a quote update and a completed report refresh. Axis double-click restored autoscale. |
| Mobile chart | Native swipe and pinch worked at 390px; the selected range survived quote updates, with no horizontal page overflow. |
| Selected and alternate targets | Actual reports used source-limits-v3 and structural-edge-passive-v3. The captured hourly selected plan had two targets and its alternate had three; daily and weekly selected plans each had three. The weekly alternate had three. Every captured report passed GlobalReportSchema, including target order, source, timeframe, deduplication and allocation checks. |
| Radar | Creation, persistence, inspection, pause and resume succeeded. Circuit 2 was verified on chain 196 at block 76234156. Monitoring evaluated a later completed source candle. The QA Radar was paused again in cleanup and Telegram stayed off. |
| Ask PULSE | Create indicator, Indicator Market and My indicators returned relevant workflow guidance without unrelated BTC levels. An explicit setup question inside Create indicator still retained the current numeric setup context. |
| Reload persistence | A fresh authentication signature reopened the same paid workspace and restored the one grant and paused Radar. No second pass request occurred. |

The price-axis diagnostic sampled the range 15 times during and after refresh. The source report changed from 2026-11-18T12:05:31.734Z to 2026-11-18T12:07:13.207Z. The logical range remained 383.08910382560816–422.35350436766646 and the manual price range remained 52655.37394749876–133544.62605250123 throughout. This verifies an actual new response rather than a button click alone.

Some initial assertions were corrected before these successful checks: the setup policy belongs to the report rather than its nested plan; timeframe refresh must wait for the automatic request to finish; and reload must reopen the private workspace. The first Radar refresh attempt clicked while the UI was busy and left monitoring active temporarily. The final runner waited for completion and paused the Radar in cleanup. Initial failed attempts remain in the artifacts.

Retest evidence is in .tmp/deployed-terminal-retest-20261118/:

- checkout-result.json: approved purchase and durable grant.
- retest-results.json: native hourly gestures, Radar creation/inspection and product-context Ask responses.
- retest-core-results.json: actual v3 reports, hourly/daily/weekly gestures and mobile inputs.
- target-validation.json and deployed-markets.json: canonical validation of captured targets.
- axis-results.json: successful scaling, real report refresh and reset diagnostic.
- monitor-results.json: explicit setup question inside creator context.
- monitor-final-results.json: later source evaluation, cleanup pause and reload persistence.

The signing bridge was stopped after these checks. The provider was a local bridge rather than a production wallet extension. API responses, settlement, activation, source observations and rendered workflows are production evidence; local component tests alone were not used to claim deployment success.

## Earlier full workflow audit

The earlier audit exercised all eight sidebar sections, BTC at 15m/1H/4H/1D/1W, ETH-to-BTC switching, five Market tools views, and built-in executed-flow indicators. The saved Maxim package plotted EMA 20 (443 points), EMA 50 (413) and crossover (412).

Simple Indicators and Indicators Studio each exposed nine templates. Studio preview, optional free publication, Copilot draft generation with explicit application, valid-script compilation (501 points), rejection of arbitrary_network_call, JSON export and draft restoration were exercised. The free QA marketplace listing was unpublished afterward. No eligible second creator listing was available for a paid-install test.

A current setup watch was followed and paused. An explicitly synthetic journal record used 0.00001 BTC at 65,000 with three recorded targets, then was fully closed and monitoring paused. The UI identified it as QA with unverified exchange status. This tested journal records and did not execute a venue order. Telegram stayed off.

Studio retained its right-hand preview at 1440px, and all eight sections fitted the 390px audit without horizontal page overflow. PNG export was saved as a real 1,935,357-byte PNG with the correct signature, and indicator export produced a valid pulse-indicator-v1 file. Reload restored the saved indicator and access without repurchase.

The initial Radar RPC blocker and creator Ask relevance finding were fixed by d467264 and are closed by the successful production retest above. The chart gesture finding was fixed by 98e6197 and is closed by the native production checks above. Agreement between the official X Layer RPC endpoints does not establish independent upstream operators.

Earlier artifacts remain in .tmp/deployed-terminal-audit-20261118/: workflow-results.json and workflow-phase2-results.json through workflow-phase5-results.json. Initial harness failures and corrected attempts are retained.

## Landing: Terminal purchases across chains

Trading Terminal is the fourth series after Risk Guard in the existing Research across mainnets chart and network table. Each network uses one purchase count combining its 24h, 7d and 30d passes. There is no separate Terminal card or duration breakdown. The chart identifies the combined report-delivery and pass-purchase activity; exact service counts remain in the table. A renewal is another purchase; restoration and retry of the same payment count once. Missing network coverage is a dash. Simulated and testnet grants are excluded. Public responses contain aggregate counts and date ranges, without wallet addresses or purchase identities.

After durable activation, the API projects the grant into a persistent aggregate with atomic Redis deduplication by normalized payment identity and network. Projection failure does not fail paid access. A background sweep reads at most 100 indexed owners per page to add retained historical grants and retry missing projections; public activity requests read only aggregates. Full sweeps repeat after 30 minutes. Owners can move during index pagination, so history stays explicitly incomplete; the sweep cannot prove that all lifetime purchases survived.

Local checks cover recovery deduplication, mismatched network rejection, simulated/testnet exclusion, duration totals, private-data exclusion, bounded owner pages, strict browser parsing and unavailable coverage. A localhost browser fixture uses clearly synthetic counts to check Clarity and Horizon at 1440px and 390px. The validation.json and screenshots in .tmp/landing-terminal-activity-20261118/ record zero page overflow and zero runtime exceptions. Fixture counts are not production totals; the separate live deployment retest below uses actual responses.

Final checks passed: 24 focused API tests, six landing component/parser tests, the public cross-chain aggregate endpoint regression, and API and production web builds. A separate isolated projection of the actual approved deployed grant also counted one Base purchase and ignored its replay; pass-projection-validation.json records that check without writing production data. The final chart fixture verifies the four legend entries and five table headers in order, the two Terminal bar segments, unavailable network coverage, and removal of the separate card.

## Live landing deployment verification

At 2026-11-18 14:33 UTC, the production page at https://www.ai-pulse.tech received a fresh, durable public activity response containing three paid Terminal pass purchases on Base. All three were 24-hour purchases, with purchase timestamps from November 17 through November 18. Other networks had no verified Terminal purchase coverage; their table cells remained dashes. Historical completeness remained false.

An isolated Chrome run verified the live page in Clarity and Horizon at 1440px and 390px. It checked the exact legend order (Global, Prediction, Risk Guard, Trading Terminal), the matching table columns, each network's pass count against the response, each stacked row total, and the Terminal footer total. Base correctly totaled 46 observed records: 36 Global deliveries, five Prediction deliveries, two Risk Guard deliveries, and three Terminal purchases. There was no separate Terminal card or duration-column breakdown. The four browser cases had no horizontal page overflow and no runtime exceptions. A further public API read left the purchase aggregate unchanged. These are real production counts, not the earlier local fixture.

The connected browser initially timed out navigating to the site; the successful checks used the isolated repeatable browser runner. No wallet, signatures or payments were needed for this public retest. The runner closed its temporary browser afterward. Evidence is in .tmp/deployed-landing-activity-20261118/: validation.json, public-activity.json, and desktop/mobile chart and table screenshots. The test script is .tmp/deployed-terminal-retest-20261118/landing-production.mjs.

## Limits

No paid installation of another creator's indicator, Telegram linking/message delivery, real venue order, or 24-hour wall-clock expiry wait was performed. These outcomes do not establish profitability, exhaustive lifetime data recovery, or that every possible product path has passed. See [chart and target validation](TERMINAL_CHART_TARGET_AUDIT_2026-11-18.md).
