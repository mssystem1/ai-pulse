# Trading Terminal acceptance — 4 November 2026

## Release status

Later workflow corrections and the requested access countdown are recorded in the [5 November follow-up](TRADING_TERMINAL_WORKFLOW_ACCEPTANCE_2026-11-05.md). The market figures and test counts below describe the original acceptance checkpoints.

**Local implementation and connected acceptance passed on 4 November 2026.** The full connected run completed at 13:18 UTC with the source-profile adapter correction, 26 API/browser acceptance checks, 18 browser screenshots and zero browser runtime errors. Independent review passed all ten delivered/refreshed BTC captures across five timeframes. A final live AI qualification check at 13:59 UTC also passed after the explanation-context correction. This establishes the checked local behavior, not production deployment or trading profitability.

Implementation is a separate Trading Terminal at `/trading-terminal`, immediately after Portfolio in the existing app navigation. Existing header controls and Global Market remain in place. The main website, Portfolio entry, in-app guide and README describe the separate product. There is no $0.50 report bundle.

## Approved funded test

Exactly one real Terminal pass purchase is recorded for `TEST_WALLET_ADDRESS`. Subsequent acceptance attempts reuse that purchase and must not sign another payment.

| Field | Recorded value |
| --- | --- |
| Network | Base mainnet, chain ID 8453 |
| Product | Standalone Trading Terminal, 24 hours |
| Amount | 1.50 USDC, 1,500,000 atomic units |
| Transaction | `0xc53667c601dd8806eade5c883a2ac7cb53b35012abb1ef852d3a6ccf913314ac` |
| Block | 53,490,211 |
| Activation | 2026-11-04 05:22:46.446 UTC |
| Expiry | 2026-11-05 05:22:46.446 UTC |

The transaction can be inspected on [BaseScan](https://basescan.org/tx/0xc53667c601dd8806eade5c883a2ac7cb53b35012abb1ef852d3a6ccf913314ac). The local acceptance runner binds the receipt and grant to the original owner, request ID, duration and amount. No exchange orders were placed. Journal entries used for QA are user-reported records, not executed trades.

## Completed implementation and safeguards

- `FEATURE_TRADING_TERMINAL` is documented in the environment examples and enabled as `1` in the local test configuration. Its product gate is distinct from the older `FEATURE_TERMINAL_TRADING` execution flag.
- `PRICE_TERMINAL_PASS_24H`, `PRICE_TERMINAL_PASS_7D` and `PRICE_TERMINAL_PASS_30D` configure the agreed 1.50, 10.50 and 45.00 defaults. Prices support exact settlement precision through six decimals. The server catalog supplies displayed prices; checkout rejects a changed reviewed amount before signing.
- EOA ownership authentication uses a single-use, origin-bound login challenge. Private workspace requests require an owner session. Production entitlement and monitoring state require durable Redis/KV storage.
- The purchase journal records authorization, settlement and grant progress. A lost response or interrupted grant write can recover the original accepted purchase without a second charge or a renewed expiry. An uncertain authorization is not blindly resubmitted. Chain recovery checks the matching token transfer and original authorization nonce.
- Native market tools expose anchored value, executed profiles/footprints, separate Spot and perpetual flow, open interest/funding and current resting depth with source clocks, units and actual coverage. Missing observations remain unavailable. A recent trade sample is not advertised as a complete weekly/monthly profile; a current book is not advertised as a historical heatmap.
- Terminal profile rows use stable decimal display bins. The final live run exposed a fractional-bin rounding failure with ordinary BTC prices; a deterministic reproduction verified the correction and conserved quantities. Invalid optional profiles or captures now disclose their own unavailable state without removing independent price, derivative or depth evidence. The shared Global validation schema remains strict.
- Market Radar uses the verified registered Tapeout component from X Layer in its causal event evaluation. Repeated polls cannot supply a later event. Replay uses the original detector/component and retained observations, with a 512-observation bound; a missing prefix prevents replay.
- Follow setup preserves the selected strategy's existing policy, bound prices and deadlines. It is distinct from Radar and from a recorded position. A chart touch never creates an exchange fill or realized PnL.
- The position journal handles actual user-entered quantities, additions, partial closes and protection updates idempotently. Reference marks retain their instrument type and timestamp; perpetual marks are not silently replaced by Spot quotes.
- Contextual AI receives bounded, valid JSON containing the selected private record, exact deterministic setup/policy, current eligibility and source limitations. Large source histories cannot truncate the selected record or risk prices out of the prompt. AI explanations do not modify the deterministic setup.
- AI qualification is projected through the same domain rules as the UI, separately from scenario progress. Selected/saved and current evidence have separate qualification, blockers, deadlines and payoff summaries. A completed price-event confirmation cannot override `qualified=false` or `WAIT`.
- Telegram monitoring requires the owner's verified chat link and explicit preferences. Delivery rechecks consent, pass status and subject pause state; uncertain sends are not blindly retried. Access expiry stops monitoring/paid AI without closing positions or changing exchange protection.

## Chronology and historical snapshot corrections

The audit compared the existing five BTC captures from approximately 05:23 UTC with captures from approximately 05:40 UTC on 4 November. It found a publication defect: repeated preparation of the same opportunity reset its clock and expiry; the daily candidate also removed a reached first target and promoted a farther objective despite no observed entry.

The corrected Terminal uses an owner-scoped canonical opportunity ledger. The first publication binds the priced revision, targets, start time and expiry. Raw market caches remain shared and unmodified; owner-specific binding occurs on a clone. Existing followed source reports seed their original history rather than acquiring a new birth time.

Finer completed bars contribute only entry-area, stop and target price observations. They cannot manufacture a higher-frame location test, confirmation, failed retest or invalidation rule. Bars that straddle publication are excluded from these supplementary price observations. Source/instrument/quote identity and completed-candle cutoff checks are enforced. Same-bar entry/stop/target ordering remains ambiguous where OHLC cannot establish the sequence. Observed entry event prices lie within the actual candle/entry-zone intersection.

Supplementary price observations and canonical strategy events advance atomically in time order. A delayed fine-bar backfill can also reconcile an earlier risk touch before an already retained later confirmation, using the original definition and retained events. This replay is Terminal-only; existing paid Global callers do not opt in. Ended opportunities remain absorbing. If 256 retained events mean the prefix may have been pruned, reconciliation fails closed as Data needed without replacing the ledger or renewing clocks.

The immutable captured-data replay verified:

- The 1H, 4H, 1D and 1W captures retained their same-source original definition, priced revision, start time and expiry. The 15m capture had a genuinely different source premise.
- The daily setup retained its original TP1 lower boundary at 77,619.7. A post-publication five-minute bar reached that target at 05:40 UTC while all covered post-publication lows remained above its 76,265.2–76,492 entry region. The opportunity became `invalidated`, reason `target_before_entry`, rather than promoting a new target.
- The daily original 04:00 UTC confirmation was retained, and no entry observation was invented.
- The weekly passive entry-area observation used an actually observed price of 77,465 within the finer bar and entry zone. It did not establish a venue fill.
- All five bound reports remained schema-valid.

This is a causal software validation of captured reports, not a performance backtest. Poor payoff or opposing context is disclosed rather than repaired by forcing a direction, narrowing an unsupported stop or extending targets. Previously unindexed, unfollowed views cannot be reconstructed retroactively.

## Immutable watch source capacity

Source report bodies are stored separately under owner-scoped, content-addressed references. Workspace and compare-and-set requests carry the reference and lifecycle state, not repeated report bodies. Missing, tampered or mismatched source objects preserve watch progress and produce Data needed.

The deterministic capacity fixture uses twenty watches referring to a representative report with a 510,000-character narrative:

| Verified assertion | Bound |
| --- | ---: |
| Former inline twenty-watch payload | More than 10,000,000 bytes |
| Referenced owner compare-and-set command | Less than 100,000 bytes |
| Each immutable source write | Less than 1,000,000 bytes |
| Workspace watch count retained | 20 |
| Inline `report` bodies exposed in workspace watches | 0 |

The fixture deliberately permits content deduplication; these bounds do not claim twenty different live reports were purchased. Reference tests also verify exact source bytes, owner isolation, retention through expiry and legacy inline migration.

## Completed checks

| Check | Recorded result |
| --- | --- |
| API TypeScript build | Passed |
| Full API suite with Terminal enabled and all network mock test prerequisites | 438 tests: 437 passed, 0 failed, 1 skipped |
| Skipped API check | Optional local Redis-compatible TCP/Lua integration; its dedicated endpoint was not configured in the hermetic suite |
| Web suite | 231 passed |
| Web production build | Passed |
| Independent lifecycle review | Passed the scoped source, chronology, delayed-backfill, absorbing-state and incomplete-history checks |
| Immutable actual five-frame snapshot replay | Passed |
| Native Terminal and shared order-flow checks after the profile fix | 15 passed; analysis build passed |
| Terminal API regressions after the profile fix | 25 passed; API build passed |
| Final AI qualification/prompt regressions | 14 focused checks passed; API build passed |
| Final actual API plus connected browser run after the profile fix | 26 checks passed, including 14 browser checks; 18 screenshots; zero browser runtime errors |
| Independent delivered/refreshed BTC audit | All 10 captures passed across 15m, 1H, 4H, 1D UTC and 1W UTC |
| Live AI qualification recheck after the final correction | Passed using the original grant; zero payment requests |

The API regression coverage includes owner/session isolation, exact/env-configured prices, payment recovery, manual accounting, notification consent/deduplication, source interruptions, immutable source capacity, first-publication binding, target-before-entry, coarse/fine event ordering, delayed backfill, ambiguous bars and bounded AI context. Earlier full-suite attempts exposed missing Prediction/network feature flags in the hermetic test configuration; the final fully enabled mock run passed without changing those product routes.

The final connected run used the existing Base grant with no `--spend`. Receipt recovery retained the original expiry, accepted the same duration idempotently and rejected a conflicting duration. All five frames returned current evidence and then a genuinely newer source generation. The same 4H, daily and weekly opportunities retained their original definitions and clocks. The 15m and 1H source premises changed across a completed-candle boundary and received different opportunity IDs.

Actual API checks covered ownership/nonce replay, authenticated access, receipt recovery, current market tools, Follow eligibility, real X Layer Tapeout Radar creation, retained-history inspection, pause, idempotent journal fills/partial closes and source-backed AI. The browser used one real ownership signature and the previously paid pass. It did not request a payment signature or exchange transaction. It verified the unchanged header, Terminal as the second tab, the shared chart, zoom through a real evidence refresh, separate Spot/perpetual tools, three catalog prices and review/cancel, journal protection/close, Radar history/pause, contextual AI, dark/Clarity layouts at desktop and 390-pixel width, Portfolio, the actual anchored app guide and landing CTAs. Screenshot inspection confirmed darker readable Clarity text and the shared chart rendering.

## Current setup audit and practical limit

The independent audit used captures from 13:14:52–13:15:43 UTC. It checked schema validity, completed primary candles, quote age, source clocks, stop placement beyond every entry, bound Entry/SL/TP values, canonical entry deadlines and the absence of fabricated fills. Exchange quote timestamps led the host clock by 42–1,358 milliseconds, within the existing clock-skew allowance. Recent executed flow remained explicitly partial; unavailable perpetual samples were not replaced with Spot quantities.

| Primary frame | Conditional direction and evidence | First target, least favourable fill | Nearest obstacle |
| --- | --- | ---: | ---: |
| 15m | Short resistance retest; awaiting location | 2.25R | 0.28R |
| 1H | Long after a completed 15m reclaim; bounded entry still required | 0.33R | 0.11R |
| 4H | Short after a completed 1H rejection; bounded entry still required | 2.60R | 0.91R |
| 1D UTC | Long after a completed 4H reclaim, against the still-bearish primary trend | 1.85R | 0.43R |
| 1W UTC | Long recovery hypothesis; awaiting location | 0.40R | 0.16R |

**All five nearest-obstacle rewards were below 1R.** Passing technical integrity does not qualify these plans as attractive entries. A larger distant target does not remove the nearer opposing level, and a completed reclaim/rejection does not establish an exchange fill. No strategy was retuned or direction forced to make this acceptance appear profitable. This audit is not a backtest or a win-rate result.

Human review of the earlier live AI answer found that its context contained lifecycle state without the full deterministic qualification. It called a confirmed retest “confirmed” eligibility despite the poor payoff. The correction supplies explicit canonical qualification, action, blockers, deadlines and least-favourable R for both selected and current setups. In the 13:59 UTC live recheck, the same 1H opportunity had progressed to `entry_observed`, while qualification remained false. The answer correctly stated **WAIT / not qualified**, 0.33R to TP1 and 0.11R to the nearest obstacle, preserved the 14:15 UTC entry deadline and hard stop, and identified the touch as observation without a fill. The check called no payment endpoint and reused the unchanged Base grant.

## Evidence and remaining limits

Local QA evidence is under `.tmp/terminal-base-acceptance/`: `validation.json`, `browser/validation.json` and its screenshots record final connected acceptance; `final-independent-audit.json` and `FINAL_MARKET_AUDIT.md` record the independent audit. `ai-final-validation.json`, `ai-final-context.json` and `ai-final-answer.json` retain the final qualification explanation check. Build/suite logs, `publication-binding-proof.json`, immutable initial/unbound-refresh captures, final `snapshots`/`refreshed-snapshots` and payment metadata retain provenance. Earlier failure/AI artifacts are historical attempts, not the final result. Private keys, authentication tokens and payment signatures are not included in this document. Local artifacts are not a substitute for deploying and checking the intended production configuration.

- Desktop browser automation and mobile viewport checks do not certify physical iOS/Android wallet or download behavior. Real-device acceptance remains separate.
- Telegram transport was not exercised by sending live messages during this funded acceptance. Consent, outbox, deduplication and expiry paths have deterministic coverage.
- Public HTTPS discovery, production CORS/origin settings, actual worker scheduling and deployment routing require deployed-environment validation. A local browser/API run does not prove them.
- Wallet login support tested here is EOA `personal_sign`; smart-contract-wallet signature support is not claimed.
- Exchange history, trade samples, footprints, retained Radar observations and depth have explicit coverage bounds. Neither the pass nor the 180-day workspace retention creates missing historical market data.
- Terminal settlement is limited to its catalog-supported X Layer, Base and Arbitrum routes. Arc/Robinhood Terminal purchases are not enabled by this work.
- Tapeout integration evidence does not guarantee hackathon organizer acceptance. No trading win-rate, profitability, filled exit or verified exchange protection is certified by these checks.
- No deployment, push, exchange order or recurring payment was performed by this acceptance work.
