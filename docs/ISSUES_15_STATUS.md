# PULSE — 20-issue acceptance tracker

Goal: complete all requested fixes, with evidence. Updated 2026-09-08.

Scope update: agent 8355 resubmission is explicitly deferred by the owner until after manual deployment, using GitHub Codespaces. It is not a blocker for the current local implementation. No push, deployment, marketplace update or live purchase is authorized by this scope update.

The original list repeated some numbers. This tracker keeps the named requirements explicit; item 6 includes the carried-forward funding/balance bug. **Local verified** does not mean deployed or verified with a real signed transaction.

| # | Requirement | Current status / remaining acceptance |
| --- | --- | --- |
| 1 | XDOG risk evidence, website and GeckoTerminal fallback | Implemented, provider data checked. Website returned 503; full live Grok report not yet verified. No forced safety score. |
| 2 | Global path/radar before introduction | Local UI verified. |
| 3 | Spot path/eyebrow before introduction | Local UI verified. |
| 4 | Autopilot path/eyebrow before introduction | Local UI verified. |
| 5 | Six setup steps versus wallet confirmation count | Redundant new-vault call removed; confirmation explanation added. Full signed activation still unverified. |
| 6 | Correct wallet funding balances and understandable deposit/top-up flow | Shared bounded balance reads, missing-value rejection, refresh recovery and network-race protection implemented. X Layer/Base localhost balances checked with the public test-wallet address. Selecting an existing vault loads its saved market/strategy; shortlist preparation explicitly creates a new draft. Signed funding/withdrawal remains unverified. |
| 7 / A | Vault numbers identify repeated-pair strategies | Dedicated Autopilot number column beside status; responsive identity cards link to the selected account's controls. X Layer #1–#4 checked locally; retained fills remain visible. |
| 8 | Distinguish missing AI from a genuine 0% score | Implemented and policy-tested; retained legacy records remain explicitly identified. |
| 9 | Inspect new/restarted strategy logs across networks | Cross-chain snapshot inspected: Base DOGE and Arbitrum BTC paused/empty; X Layer fills retained. Legacy history gaps explicitly reported. Current X Layer entry passes expired; XAAPL has one atomic unit of residual dust. |
| 10 | Missed entries, closed candles and failed execution | Closed-candle, exposure-size and sub-atomic residual fixes tested. Cost-free audit no longer calls Premium. Provider/oracle availability and the next live eligible worker cycle still need deployment verification. |
| 11 | Separate network/RPC selection from appearance | Local UI verified; independent themes and stronger light borders implemented. |
| 12 | Validate before charging | REST/MCP parity and local job recovery implemented; 280 non-spending mainnet checks passed with all eight services and no skipped valid-input probes. Production SDK challenge paths checked locally. Marketplace resubmission is deferred by the owner, not required now. |
| 13 | Full desktop/mobile UX audit, docs and report clarity | All eight main pages checked for overflow at 320/390/1440 CSS px, plus prior 768px checks. Added truthful timers, residual labels, distinct page guidance, saved-vault selection and balance recovery. Real-device signing, live generated report rendering and the complete paid interaction audit remain open. |
| 14 | Spot shortlist actually loads the pair; clarify buttons | Local UI verified. Stale quotes and old amounts are cleared; delayed quote responses are ignored. |
| 15 | Automatic Spot market data and expandable charts | Local UI verified; caching, wrong-pair rejection and chart tests pass. |
| 16 | Complete, useful Autopilot history | Journal reads scan all persisted pages; failed writes retain pending rows for retry instead of discarding them from a 100-row cache. History is fetched independently of live market telemetry. Search/filter/pagination, per-event rule and metric details, policy/AI context, monitoring counters and expanded CSV added. Old deleted records remain explicitly unavailable. Local 321-row and partial-write recovery tests pass; localhost ETH exposes 130 retained records. |
| 17 | Extend automatic market previews to Autopilot | Shortlist sparklines, selected setup market snapshot and selected runtime market chart added. Price/OHLC/volume refresh while visible; expanded timeframe/zoom controls reuse the existing market cache. No AI report or activation is triggered by viewing charts. |
| 18 | Update README and visual in-app documentation | Added three selectable workflow maps with responsive step cards and an Autopilot pause/resume timer diagram. README explains canonical payment resources, pass renewal and recovery. These are behavior diagrams, not invented performance charts. |
| 19 | Base Autopilot pass checkout and automatic Resume | Mainnet resource mismatch fixed (see item 20). After payment, paused vaults automatically request owner-signed Resume; already-running vaults do not. Failed Resume retains purchased time, duplicate clicks are guarded, and changed wallet/network/vault prevents a stale follow-up. Unit tests pass; a live signed renewal/Resume remains unverified. |
| 20 | Cross-network report and pass payments | HAR initial challenges used the request origin, while signed validation expected configured BASE_URL. This mismatch was reproduced locally and fixed in OKX/CDP SDK challenge generation without relaxing origin validation. 376 non-spending REST/MCP checks pass, including real challenge resources checked against the local settlement-terms validator. HAR response bodies are absent, so exact historical error bodies cannot be asserted. Owner confirms Arc Prediction Quick and Pro now work; Circle flow left unchanged. Live paid settlement/delivery still requires separate acceptance. |

Amounts are displayed in human token units. The live Spot advanced panel no longer displays raw integers; tiny residual Autopilot balances are described in plain language instead of raw-unit terminology.

## Boundaries

- No push or deployment without the owner's explicit instruction.
- No report is called “live verified” on the basis of fixtures alone.
- No discarded historical database rows are claimed to have been recovered.
- Wallet test authorization does not justify changing a strategy's signed limits or forcing trades.
- Payment and wallet guidance requires a specific confirmation before a real charge or state-changing wallet command; read-only checks proceed first.

Detailed prior evidence: [UI/runtime verification](UI_RUNTIME_VERIFICATION.md).

Latest local suites: API **146 passed**, web **50 passed**, payments **8 passed**; prior market **10 passed**. API/web type checks and production builds passed; existing wallet dependency/bundle warnings remain. One earlier API run had an intermittent failure; later full runs passed. Ownership checks are now dependency-injected in tests, including a deterministic storage-outage case; do not treat the historical failure as a proven provider diagnosis.

## Deployment gate rechecked (2026-09-08)

A read-only comparison of `/v1/metadata` confirmed that the Railway API is not serving the same metadata as localhost:

| Field | Localhost | Railway API |
| --- | --- | --- |
| Repository | `mssystem1/ai-pulse` | `mssystem1/Pulse` |
| Global timeframe input enum | Advertised | Missing |
| Public service count | 8 | 8 |
| Token Risk Guard price | $0.20 | $0.20 |

This proves a served-metadata mismatch, not the behavior of every deployed route. No deployment or marketplace update was attempted. The owner must deploy the reviewed local changes before the new deployed-worker behavior and agent 8355 readiness can be accepted. Paid report delivery and signed activation still require their own controlled acceptance runs; an unpaid metadata probe cannot establish them.
