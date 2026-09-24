# Reported service and UI defects — 2026-09-19

Implemented and validated in the local workspace. These changes have not been deployed or published to OKX AI. Existing unrelated appearance/routing changes were preserved.

## Evidence and resulting changes

| Request | Finding | Implemented behavior | Verification |
| --- | --- | --- | --- |
| XDOG Risk Guard scored 43 | The model could penalize missing source coverage: absent holder distribution, unavailable project website and unmeasured promotion. A provider holder subscore of zero did not establish zero holders. | Canonical component weights; only measured components contribute. Unmeasured components show Unknown, with separate coverage/confidence. Metadata verification is attributed separately from contract verification/audits. No token allowlist or score floor. | `packages/analysis/src/tokenRisk.test.ts`; live read-only evidence for the supplied contract; offline normalization of the captured live model response. |
| Risk Guard has no history | Paid Risk Guard responses bypassed durable private report/job storage. | Private saved reports, this-device recovery, wallet-owned cross-device history, settled-receipt retry, idempotent replay. Risk Guard also has a Telegram destination and compatible shared-report viewer. | API recovery test verifies authorized retrieval, rejection without capability and replay without regeneration; browser history and shared-view checks. |
| Explore selection loses focus | Navigation used a fixed 430-pixel offset, independent of layout. | Close discovery, focus the report controls, scroll their actual element into view. | Browser checks at 390, 768, 1440 and 1920 pixels. |
| Global chart dominates analysis | Full chart preceded the report, which had half the page width. | Chart collapsed by default; expand a compact sparkline and open its full chart dialog when needed. Report gets the wider desktop column; mobile stacks. | Browser open/close checks and reviewed screenshots. |
| Setup score 80 vs neutral report confidence 40 | The shortlist score was a deterministic candle-condition ranking, not AI confidence. | Show actual fresh report confidence separately from technical match. Confirmed setups require bullish direction, confidence strictly above 60 and a Buy recommendation. Neutral, bearish, stale and unassessed candidates stay out of the confirmed view. | Assessment unit tests plus browser fixture with neutral BTC 40% and bullish ETH 72%. |
| Autopilot offers unavailable pairs | A global top-eight list was truncated before checking selected-network execution mappings; Autopilot also needs ERC-20 custody mappings. | Keep the complete scanned candidate list, filter against the selected network/custody catalog, then apply display limits. Spot and Autopilot present mapped pairs. | Browser includes unmapped DOGE ahead of mapped BTC/ETH and checks the ERC-20 catalog request. Existing runtime route and ownership checks remain. |
| Low-confidence reports cannot open Spot | Wait was treated as a UI trade prohibition. The supplied log also had a long stop above entry. | A supported pair can open an explicit manual market ticket at the user's risk. Invalid long levels are not prefilled. Recommended buys require confidence above 60 and valid entry/stop/target orientation. | Technical-plan regressions and browser manual-ticket assertion. |
| Copilot requires repeated correction | Discovery could lose the POST method, only pair was required, and the final payload left the caller to assemble the paid report. | REST discovery, marketplace metadata and MCP explicitly collect pair/timeframe/language together; POST/body method is repeated. Async responses describe free polling/recovery; final retrieval includes complete readable `reportMarkdown` and delivery instructions. | All eight published service contracts, network aliases and required fields covered by API tests; Markdown tests preserve material sections, future sections and Chinese headings. |
| Telegram width/workflow | Telegram inherited the narrower docs container. Initial message sends were queued only after failure. | Remove docs width inheritance; persist delivery before sending, lock attempts, retry failures and retain sent markers. Status only advertises durable delivery with the necessary configuration. | Header left/right alignment and overflow checks at four widths; bot destination, capability, retry and duplicate-delivery unit tests. |

## XDOG observation

Contract: `0x0cc24c51bf89c00c5affbfcf5e856c25ecbdb48e`, X Layer. Evidence captured at `2026-09-19T08:43:31.643Z`.

The collected GeckoTerminal packet reported verified metadata, provider score approximately 79.74, liquidity approximately $684,462, and a negative honeypot observation. OKX supplied 36,557 holders. Holder distribution was unavailable; the project website returned HTTP 403. The collected packet did not establish audited ownership or mint/freeze controls.

Applying the final normalization to the captured live model response produced **69.5 observed-component score, 55% evidence coverage and 55% confidence**. Contract and market component scores were 65 and 75; holders, project and promotion were unscored. This is an offline re-normalization of a new captured response, not reconstruction of the user's missing original 43-point report or a promise that future model outputs will be identical. Being first or metadata-verified is not a sufficient basis for assigning a high safety score.

Local evidence is in `.codex-ui-review/xdog-evidence.json`, `xdog-score.json` and `xdog-normalized.json`. The original Codespace log was treated as diagnostic evidence; its private recovery capability is not copied into this document.

## Eight published OKX AI services

| Service | Inputs discovered before payment | Delivery/validation reviewed |
| --- | --- | --- |
| Global Quick | Pair, timeframe, language | POST JSON; instrument validation; paid job, free recovery, full report. |
| Global Pro | Pair, timeframe, language | Same contract; all material technical/scenario/execution sections retained. |
| Prediction Quick | Explicit primary market, language | Selected-market eligibility and evidence checked before payment; recoverable report. |
| Prediction Pro | Explicit primary market, language | Same validation; underlying-market and additional material sections retained. |
| Token Risk Guard | Exact token contract, selected chain, language | Chain mismatch rejected; evidence-aware score; private persisted report/history. |
| Autopilot 24h | Owner, configured/funded/registered vault | Ownership/setup validation before payment; runtime pass activation/extension. |
| Autopilot 7d | Owner, configured/funded/registered vault | Same pass contract and safeguards; correct duration/price metadata. |
| Autopilot 30d | Owner, configured/funded/registered vault | Same pass contract and safeguards; correct duration/price metadata. |

The three passes do not themselves create or fund a vault. Their discovery guide explains the preceding setup and the separate owner-authorized start/resume transaction. Report generation never authorizes Spot execution.

Discovery requires explicit timeframe/language; legacy direct API callers retain server defaults for compatibility. An external agent can still ignore the delivery instructions. The service now supplies the full deliverable and unambiguous workflow, but a fresh real Codespace session against the deployed version is needed to establish that client's behavior.

## Product choices and limits

- Agreed product model: Explore defaults to free technical candidates with indicator-based ranking and reasons. The optional Recent bullish reports >60% filter uses the user's existing report assessments (15-minute freshness, exact timeframe). AI confidence comes from paid analysis. No automatic xAI screening calls or screening subscription are introduced; manual trading remains available independently of report confidence.
- A mapped pair is eligible for a ticket, not guaranteed executable liquidity. A fresh quote, route, balance and wallet authorization remain necessary. Autopilot retains its signed runtime policy.
- Risk history applies to newly persisted reports. The previous unpersisted 43-point result cannot be recovered retrospectively from this change.
- Telegram checks use mocked sends; no unsolicited message was sent. No paid mainnet trade or Autopilot activation was performed for testing.

## Validation

- Analysis: 24 passed. Payments: 8 passed. Web: 81 passed.
- API full suite: 204 passed, zero failed, one skipped local Redis TCP/Lua integration test (requires its external test service).
- Final focused API rerun: 47 passed, including service discovery, Risk Guard recovery, complete report delivery and Telegram retry.
- Browser shell: 80 route/appearance/viewport combinations, no overflow or render errors.
- Reported-flow browser suite: four widths, including focus, chart expansion, confidence filtering, mapped Spot/Autopilot candidates, manual low-confidence ticket, Risk Guard history/shared viewer, and Telegram alignment.
- Analysis, payments, API and web production builds; `git diff --check`.

Build/test outputs and reviewed screenshots are saved locally in `.codex-ui-review/`. Validation uses real browser rendering and synthetic service fixtures; production rollout and a live external-agent purchase are not claimed by these results.
