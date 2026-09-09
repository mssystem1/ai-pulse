# PULSE — local UI and runtime verification

Date: 2026-09-07. Scope: local implementation and localhost verification only. No GitHub push, Vercel/Railway deployment, paid report, pass renewal or signed trade was performed. The local API ran with `AUTOMATION_WORKER_ENABLED=0` and `FEATURE_TELEGRAM=0`.

## Changes

- Spot shortlist: **Trade this pair** now selects the Spot ticket instead of calling the Global callback. It clears stale quote/price inputs, focuses and scrolls to the ticket, and confirms selection. **Research in Global** opens Global for the selected pair. Neither action authorizes payment or trading.
- Mobile: compact two-row header, independent appearance control, flat page switcher, compact journey steps, vertically arranged action buttons, clearer separation of shortlist, setup and dashboard. The setup heading belongs to the form, not the shortlist. Light-theme section boundaries are stronger.
- Global, Spot and Autopilot paths precede their page introduction. Autopilot does not require a Global report. The Global radar precedes Global intelligence.
- Vault numbers identify accounts in the runtime table and journals. Older fills cannot overwrite a newer evaluation. Skipped/unavailable AI checks are labeled explicitly instead of presenting an invented 0% score; new CSV rows leave confidence blank for those states.
- The market adapter preserves OKX's candle confirmation flag. Autopilot entry checks consume closed candles only. Provider failures are distinguished from downstream execution failures, retaining the valid AI decision when execution fails. Buy size is bounded by balance, the signed per-trade cap and remaining oracle-valued exposure; at most one smaller re-quote is attempted.
- New-vault setup no longer unconditionally sends an unnecessary stale-native-asset configuration transaction. The UI explains that six setup steps can require more than six wallet confirmations.
- Token Risk evidence adds a cached GeckoTerminal fallback, keeps declared but inaccessible website URLs, distinguishes market cap from FDV and pool age from contract age, and avoids attributing base-token metrics to a quote token.
- REST and MCP argument validation runs before payment challenges. Public Global input schemas advertise the supported candle intervals and instrument syntax. MCP pass challenges verify registered vault ownership/network first.

## Evidence from live read-only data

The X Layer runtime snapshot for the configured test address showed:

| Vault | Observed runtime | Confirmed historical fills |
| --- | --- | --- |
| Autopilot 1 — BTC | Paused | 2 buys, 2 sells |
| Autopilot 2 — ETH | Entry pass expired | 1 buy, 2 sells |
| Autopilot 3 — XAMD | Entry pass expired | No fills |
| Autopilot 4 — XAAPL | Protecting an existing position | 1 buy, 1 sell |

These are dated observations, not a claim about future runtime. A sell count includes partial exits and does not prove the position is empty. XAAPL's journal also contained exposure, stale-oracle and OKX route errors. A broader BTC rally does not itself satisfy another asset's signed SMA, volume, regime and AI entry conditions.

The old BTC journal exposes a lifetime total of 101 evaluations with 100 retained rows. Previously discarded historical rows cannot be reconstructed by a UI fix. Confirmed on-chain fills are reconciled separately and must not be reported as zero just because the retained decision journal contains mostly failures.

For XDOG's exact X Layer contract, DexScreener returned no matching rows while GeckoTerminal returned token, pool and profile evidence, including market cap, liquidity and the declared website. The project website returned HTTP 503 in the local check. The report must distinguish “website discovered, content unavailable” from “no website found.” No paid Grok report was generated, and no safety score was forced to 90 from a bullish chart.

## Checks performed

- API test suite: 134 tests passed, including input validation, policy sizing and strategy reconciliation.
- Market test suite: 10 tests passed, including incomplete-candle exclusion.
- Web test suite: 37 tests passed.
- API and web production builds passed. Existing large-bundle and wallet-dependency warnings remain; these are not proof of mobile performance readiness.
- Chrome localhost checks: 320px and 390px phone widths and 1440px desktop CSS width; no horizontal document overflow on checked views. Checked Spot ticket selection, Global pair handoff, independent network/theme selection and responsive header/section order. Browser emulation is not an actual iOS/Android wallet-signing test.
- With Base selected, clicking LTC's Spot action loaded the verified cbLTC/USDC ticket, focused it and displayed the no-transaction confirmation. Global research opened ADA/USDT. Changing Daybreak to Neon Pulse left Base selected.

## Follow-up: Spot market context (2026-09-08)

Issue 15 adds lightweight chart/price snapshots to the existing shortlist response, without multiplying provider calls per card. The selected ticket has an automatically loaded market panel above the order form. Both chart entry points open a native modal dialog with keyboard close, focus restoration, timeframe selection and zoom-in/out controls. Chart coordinates adapt to the phone viewport so axis labels remain readable. Global and Spot use the same bounded in-flight cache; failed requests have a short negative cache and a 12-second timeout.

Verified live BTC and SOL market panels locally; opening a shortlist chart did not change the trade ticket. The chart's zoom changed the visible candle window from 48 to 24 and Escape closed it. Web suite now has **41 passing tests**, including cache coalescing, expiry/recovery, wrong-pair rejection and flat/micro-price chart data. No wallet key or paid request was needed.

## Agent 8355: deployment and resubmission boundary

### Further verification on 2026-09-08

- The non-spending compliance script now checks the actual eight-service catalog across X Layer, Base and Arbitrum, never loads `.env`/keys, and cannot run a paid replay. With an active market ID and the owner's registered vault addresses, **280 checks passed with no failures or skipped valid-input probes**. These used the localhost API with its configured production payment middleware, without a payment signature. They prove challenge/validation behavior, not settlement.
- MCP now goes through the same in-process REST validation and settlement middleware, preserving network selection and response headers. Recovery tools read jobs from the serving API instead of a potentially different configured public origin. A fixture test covers paid MCP acceptance, report recovery and rejection of a wrong recovery capability; it does not call xAI or pay a real asset.
- Invalid Spot instruments, unsupported inputs, unavailable prediction evidence, wrong Risk Guard chains, and unverifiable vault ownership are rejected before charging. Ownership lookup outages return an actionable 503 rather than leaving an asynchronous middleware request hanging.
- Corrected the stale local `PRICE_PREFLIGHT=0.15` override to **0.20**, restarted the local API with workers/Telegram disabled, and verified the advertised price. Canonical metadata and current marketplace instructions use **mssystem1/ai-pulse**. No cloud environment, repository remote, marketplace record or deployment was modified.
- The old “read-only” Autopilot audit still invoked a full Premium report. It now runs only deterministic policy checks against confirmed OKX candles, without loading `.env` or calling an AI provider. A live ETH/4H audit returned 119 closed candles and zero AI calls.

The refreshed runtime shows Base DOGE and Arbitrum BTC paused with zero target and settlement balances. Their historical detail is incomplete: Base exposes 101 retained rows against 321 evaluations; Arbitrum exposes 100 against 155. Neither has confirmed fills in the available reconciled ledger. X Layer BTC still exposes 2 buys/2 sells and ETH 1 buy/2 sells. XAMD has no fills. XAAPL has 1 buy/1 sell and a raw residual of **one target atomic unit**. The sell count alone did not prove an empty balance.

The code treated that XAAPL residual as a tradable position, consistent with the repeated route failures in its journal; this is not proof that every historical provider error had the same cause. The new valuation check ignores only amounts worth less than one settlement atomic unit for position/entry/exit classification. The raw token balance stays visible and withdrawable; invalid valuations remain conservative and real positions are not ignored. Local runtime now correctly reports an expired entry pass, with the residual disclosed separately. No live worker was run to sell or buy anything.

Browser checks used the public test address with a read-only injected provider that rejects signing and transaction methods. X Layer setup and dashboard both showed **0.001128 USDT0**, and Base showed **1.531471 USDC** during the check. Shared balance reads now coalesce requests, time out, distinguish missing data from zero, recover periodically and prevent old-network responses from changing the header. Routine refreshes no longer blank a valid same-wallet snapshot. Existing-vault selection loads the saved market and strategy; a shortlist candidate opens a clearly marked new draft instead of silently editing the selected existing account.

All eight main pages were checked for horizontal overflow at **320, 390 and 1440 CSS px**. Expired/no-pass timers, light-theme borders, vault identity/fills, dust disclosure and market-preparation feedback were checked locally. These checks are not a claim that every paid report, modal and wallet interaction has passed on real iOS/Android devices.

Latest suite results: **API 140, web 44, market 10 and payments 6 passed**. One earlier API run had an intermittent failure not captured with sufficient detail to establish its cause; subsequent full runs passed. Ownership tests now inject a deterministic lookup rather than depending on live storage, including the outage path. Production build warnings concerning wallet dependency exports and bundle size remain.

The validation audit follows the official [OKX MCP integration](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp) and [service seller SDK integration](https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk) documentation. Invalid arguments should produce an actionable input error, not an x402 payment request. A valid unpaid request should still receive a challenge; a paid replay must preserve the request body.

Agent 8355 has **not** been resubmitted. Its public endpoint still depends on the owner's deployment. After deployment, repeat the unpaid REST/MCP probes on the published endpoint: missing arguments, invalid contract addresses, malformed pair IDs, unsupported intervals, unknown tools, and unregistered vaults must have no `PAYMENT-REQUIRED` header. Verify a valid request still returns the expected challenge, then perform the separately authorized paid workflow and resubmit the existing agent through the authenticated marketplace session. Do not change the repository identity or replace the catalog to accomplish this.

Remaining live work: verify the deployed worker's next eligible closed-candle cycle, recheck third-party route/oracle availability, test paid report delivery and real mobile wallet confirmations, and complete marketplace resubmission after owner deployment. Local builds and mocked payment tests do not establish those outcomes.

### Operator handoff: public endpoint recheck

On 2026-09-08, read-only `GET /v1/metadata` requests to localhost and `https://pulse-api-production-7aae.up.railway.app` returned different repository/input-contract metadata. Localhost advertises `mssystem1/ai-pulse` and the supported Global timeframe enum. Railway still advertises `mssystem1/Pulse` and no timeframe enum. Both advertise eight public services and $0.20 Token Risk Guard. This is direct evidence that the served metadata has not caught up with the local changes; it is not a blanket assertion that every public route is broken.

Next acceptance steps, in order:

1. The owner reviews and deploys the local changes. The coding agent must not push or deploy without explicit instruction.
2. Recheck public metadata and run the non-spending REST/MCP validation against the deployed API. Verify failures return useful input errors without payment challenges, and valid requests advertise the intended network, asset, recipient and price.
3. Obtain a fresh quote and explicit approval for each live paid-report test. Recover the delivered report, inspect its evidence/language/layout, and verify replay does not charge twice. Do not run legacy payment scripts on an assumed historical price.
4. Agree the vault, network, capital, pass duration and signing actions before a real activation/funding test. Test pause/resume/pass timing, withdrawal and the next eligible worker cycle without changing signed risk limits to force a trade.
5. Complete real-device wallet checks and then resubmit the existing agent 8355 through its authenticated marketplace session. Do not register a duplicate agent.

These are outstanding acceptance gates, not completed work or authorization to spend/deploy.

## Scope update and follow-up: tasks A, 16 and 17 (2026-09-08)

The owner explicitly deferred agent 8355 resubmission to a later GitHub Codespaces session after manual deployment. It is not part of the current local delivery. No marketplace or deployment changes were made.

- Dashboard identity: a dedicated Autopilot number control now sits beside runtime status. X Layer #1–#4 remain distinct even for repeated pairs; clicking #2 selects its ETH controls. Desktop and 390/320px layouts were inspected in Chrome. Historical ETH 1 Buy/2 Sell and BTC 2 Buy/2 Sell remain visible.
- Human amounts: the live Spot advanced section no longer prints raw integer amounts. Autopilot residuals use a plain-language explanation and a readable token threshold. No “atomic” text appeared in the tested rendered Autopilot page.
- History bugs: failed journal writes previously retained a row only in the short cache and did not replay it when later appends succeeded. Live RPC/ticker failures also returned the short strategy cache instead of the full journal. New pending rows survive in the strategy snapshot for retry; only acknowledged batches are removed. History reads scan all archive pages, merge pending/recent rows, report degraded coverage and remain independent of current market telemetry.
- Limits: pending rows are not proof of durability during a total storage outage plus process loss. Memory-only development is explicitly labelled. Already deleted legacy records cannot be recovered by this change.
- Decision usefulness: outcome/search filters and 25-row browsing pages do not limit retention/export. Every row can expose rules, observed/required values, metrics, AI status and saved policy context. Legacy 0% without provenance is marked unverified. CSV includes all retained decisions and account-matched activity, rule/metric evidence, context, fill price and coverage. It escapes spreadsheet formula prefixes. Events from an unidentified same-pair vault are not attributed to another account.
- Scheduler visibility: protection-check and repeated-candle-skip counters begin when this telemetry is deployed; missing old counters show a dash, not invented lifetime totals. Additional pre-execution waits (owner pause, another execution, already-open/already-closed position) are journalled. Viewing charts or logs does not call AI or start trading.
- Autopilot previews: shortlist sparklines, setup snapshot and selected runtime market context share the Spot market loader. Live ETH/XAAPL price, daily high/low, volume and candle views loaded locally. At 390px, the expanded ETH chart changed from 48 to 24 candles on zoom. The selected market and dashboard had no horizontal document overflow at 320px.
- Storage tests: 321-row outage retention, full paged retrieval, legacy migration and partial-batch retry passed. The localhost ETH journal exposed 130 available records; Next changed its browsing range from 1–25 to 26–50. That is distinct from its retained historical failure count.

No new production worker cycle, signed wallet action, paid report or provider charge was executed for this follow-up. README and in-app Docs explain the new journal and market previews.

Final follow-up suites: API **146 passed**, web **47 passed**. API/web type checks passed. Header token-balance formatting was also corrected: the positive test balance `0.001128 USDT0` no longer rounds to `0.00`; this was verified in the localhost browser.

## Follow-up: tasks 18–20 — docs, renewal and payment challenges (2026-09-08)

- Three supplied HAR exports were inspected without replaying signatures. They omit response bodies. Mainnet report/pass requests show initial challenges followed by signed 402 responses of 37 bytes; `Payment resource mismatch` is consistent with that size, but is not claimed as a recovered HAR body. The localhost-origin mismatch was independently reproduced against the signed-request validator.
- OKX and CDP SDK routes now explicitly publish `BASE_URL` plus the selected network/service path. The validator still rejects substituted origin, route, chain, token, amount and payee. The legacy unprefixed X Layer alias remains compatible. A live unpaid browser probe to `127.0.0.1:4000` returned the configured `localhost:4000` canonical resource.
- `asp-compliance.mjs --check-local-binding` passed **376 checks, zero failures, zero skipped valid-input probes** using registered public test-wallet vaults on X Layer/Base/Arbitrum and a valid Prediction market. This checks eight services through REST and MCP, missing-input rejection, real SDK challenge terms and the local settlement-terms validator. No signature, facilitator settlement, payment replay, AI generation or transaction was performed. It does not prove live paid delivery.
- The owner confirmed Arc Prediction Base/Premium now work. The old Arc failure has no reproducible body; no speculative Circle-flow change was made.
- Dashboard renewal pays once, reads the paid vault's current pause state, and prompts owner-signed Resume if paused. Tests cover already-running vaults, failed payment, failed Resume and unverifiable/changed context. Duplicate clicks and competing owner actions are guarded during checkout; wallet/network/vault changes prevent a stale follow-up. A confirmed Resume is not relabelled failed solely because activity indexing fails. Live signed renewal/Resume remains unverified.
- In-app Docs gained selectable Research & Spot, independent Autopilot runtime, and Payment & recovery diagrams, plus an illustrative running/paused/resumed timer. Added EN/中文 workflow copy, all eight prices, and retained-payment recovery guidance. Corrected corrupted arrows/separators in agent docs and clarified that a Global report is not an Autopilot prerequisite. These are workflow visuals, not invented price/performance data.
- Chrome localhost checks: **1440px desktop, 390px and 320px mobile**; workflow controls switch content, cards stack vertically, touch controls exceed 44px and document width does not overflow. Appearance selection through the actual picker verified Daybreak blue styling independent of the selected X Layer network; Neon Pulse dark styling was also inspected.
- Regression suites: **146 API, 50 web, 8 payment tests passed**. Web type check passed. Production build passed with existing wallet dependency and large-bundle warnings. No production deployment, GitHub push, marketplace resubmission or live wallet mutation was performed.

Remaining acceptance: controlled live payment settlement, durable paid report delivery/recovery, and owner-signed pass renewal/Resume on supported mainnets. Previous signed funding/withdrawal and deployed-worker acceptance items remain listed in [the 20-issue tracker](ISSUES_15_STATUS.md); local non-spending checks do not close them.

### Pre-commit verification (2026-09-08)

The full root `npm test` run passed **254 tests**: contracts 8, config 6, domain 5, market 10, analysis 19, payments 8, SDK 2, API 146 and web 50. Contract behavior tests used a local Hardhat chain, not a funded mainnet wallet. `npm run build:vercel` completed the full dependency, API and web production build locally; it did not contact a deployment service. Existing wallet dependency and bundle-size warnings remain. The staged diff passed whitespace checks; a scoped credential-literal check found no obvious secrets, and local `.env` files remain ignored. These checks support committing the implementation, not a claim that all live acceptance items are complete.
### Post-deployment regression fixes (2026-09-09)

Local changes only; no deployment, push, marketplace update or wallet transaction.

| Reported issue | Change and evidence |
| --- | --- |
| Global research offered an unmapped Spot action | Selected-network mapping is shown in Global pair search, shortlist cards and report handoff. Research remains available; unmapped execution buttons do not authorize a Spot ticket. Live local catalogs returned 18 Base, 98 X Layer and 99 Arbitrum pairs. WIF was not mapped on any of these networks. Mapping is distinct from fresh quote availability. |
| Spot shortlist disappeared after a report Buy | Shortlist remains visible. Browser fixture: restore BTC report, open its Market Buy action, select XRP from the shortlist; XRP ticket and market snapshot load, BTC levels/banner clear. Direct pair selection is retained when leaving/reopening Spot. |
| AERO Risk Guard appeared in Global | Report state and payment captions are separated by service family. Browser fixture: show AERO Risk Guard, navigate to Global without reloading; no AERO report appears there. Async free evidence is also rejected after a superseding request/network change. |
| GeckoTerminal/Blockscout evidence gaps | GeckoTerminal is primary for token/pool/profile evidence; no DexScreener calls in paid Risk Guard, including X Layer. Shared cache, one bounded 5xx retry, no immediate quota retry, exact token/pool identity checks. Blockscout v2 contract 500 reproduced; documented legacy getsourcecode returned verified Aero source. The adapter uses that fallback only for transient failures and caches requests. Later live v2 verification also recovered. Holder endpoint still intermittently fails; this is explicitly unknown. |
| Base Autopilot #2 behavior/history | Read-only deployed check at 2026-09-09 02:10:59 UTC: DOGE-USDT 15m Breakout running, 381 lifetime evaluations / 161 saved details, storage synced, zero confirmed buys/sells. Close 0.09026 was below required 0.09094; volume 2.29x passed 1.15x, so price still blocked AI/entry. The constant 220-row gap is legacy deletion, not current UI pagination. Configured buy amount is now visible in human units. Its earlier inspected signed amount was 0.05 USDC; no live policy was changed. |

Live AERO evidence: GeckoTerminal token, pools and profile returned data, score approximately 91.04, roughly $600M circulating market cap and $27–28M liquidity during checks, declared aerodrome.finance website and holder count. Website content was fetched. Provider rating is separate from PULSE's assessment and is not a contract audit. Cached historical reports are not rewritten; new reports use the new evidence pipeline.

Chrome localhost verification used 1440px desktop and 390px/320px mobile. No horizontal document overflow in tested Global/Spot/Risk Guard views. Pair-search layout conflict fixed. Report fixtures were explicitly synthetic; live market/pair requests were real. No new paid Grok report or payment settlement was performed.

Deployed public metadata returned product PULSE, repository mssystem1/ai-pulse and eight featured services. Authenticated agent-8355 lookup could not complete because the OKX session expired. Codespaces login, deployment of these changes and explicit resubmission approval remain separate acceptance steps.

Final local checks: **259 tests passed** (150 API, 51 web, 58 other workspace tests), `npm run build:vercel` exited 0, web type check and whitespace validation passed. Existing wallet-library `waitForTempoBlock` export and large-bundle warnings remain. Synthetic browser recovery entries were removed after verification.
