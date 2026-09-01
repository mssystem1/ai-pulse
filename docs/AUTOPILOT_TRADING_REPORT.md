# PULSE Autopilot Trading Report

Updated: 2026-09-01

This document is the functional and acceptance report for Autopilot. It distinguishes strategy evaluation from vault administration. Creating, funding, pausing, resuming or withdrawing a vault proves owner control, but does **not** prove automated trading. A complete trading acceptance run must also prove a fresh compact signal when an entry candidate exists, a deterministic decision, guarded execution, position reconciliation and an exit.

## 2026-08-29 cost-control amendment

The earlier acceptance runs used a full Premium report for every analysis cycle. That behavior is retired: it consumed roughly `$6–$9/day` in one observed active-vault run and was neither necessary nor commercially sustainable. Current code uses a deterministic new-candle gate with a hard 15-minute scheduler floor, a strict 4,000-input/320-output-token classifier only for a surviving entry candidate, a four-hour pair/timeframe cache, atomic per-vault/global call and USD budgets, and a manually prepaid vault-bound AI Entry Pass. The attempt timestamp is persisted before calling xAI; a rejected request therefore cannot bypass the cooldown, and billing/auth/quota failures open a six-hour circuit breaker. Historical transaction evidence below remains valid, but historical references to a full Premium cycle describe the tested release at that time, not the current scheduler.

Paid time is active-runtime time. Pausing the on-chain vault freezes the pass deadline and Telegram warning clock; resuming extends expiry by the paused duration. The unified Autopilot dashboard owns Pause/Resume, top-up, per-asset withdrawal/Max, close-and-withdraw-all and 24h/7d/30d x402 renewal. Strategy decisions explain why PULSE waited, bought or sold; reconciled on-chain activity separately records wallet confirmations and fills. The export format is CSV for spreadsheet/audit use rather than the former JSON download.

Strategy registration and effective runtime are different facts. A durable strategy can remain registered while the on-chain vault is paused or its Entry Pass has expired. The API therefore derives one effective state from the pause flag, invested balance and pass: `running`, `paused`, `protecting_position`, `entry_pass_expired`, `entry_signals_exhausted`, `telemetry_unavailable`, `failed`, or `inactive`. New CSV exports begin with a `runtime_snapshot` row and include pass expiry/usage columns before the historical decision and confirmed on-chain activity rows.

## 2026-09-01 owner-closure audit

The two legacy strategies supplied for review belong to different networks, not two Base vaults. BTC-USDT `0xa24A…7fda` is on Arbitrum; DOGE-USDT `0x2DD4…bBEE` is on Base. Read-only durable and activity-log reconciliation confirmed an owner pause followed by an owner withdrawal for both vaults on 2026-09-01. Neither supplied CSV contains a filled Buy or Sell. The BTC log's 44 retained failures are the historical xAI 403 credit-exhaustion incident from 2026-08-29; its current failure streak is zero. The DOGE CSV contains three retained transient request failures (the live durable record contains four), with no fill. These facts are historical audit evidence and do not imply that either vault is still running.

## Trading workflow

1. The user selects an analysis pair, timeframe (`15m`, `1H`, `4H` or `1D`), strategy, capital and risk profile.
2. PULSE maps the analysis asset to an identity-safe token on the selected network and proves an amount-sized OKX Onchain OS route.
3. The connected owner creates or reuses a guarded vault, signs its policy, allowlists one target asset, configures risk limits, funds it and activates it. Activation does not require a current Buy signal.
4. Every due cycle loads 120 current candles and ignores a candle already evaluated by that vault.
5. When no position is open, a free deterministic strategy prefilter decides whether an entry candidate exists. Only a candidate with an active AI pass may consume a compact AI signal. Full charts, Elliott narratives, DeFi sections and report prose are excluded.
6. A deterministic strategy engine evaluates every documented entry or exit rule. An AI classification cannot override a failed rule.
7. `Hold` is a normal running state: it stores the complete rule evaluation and evidence without sending an entry transaction. The strategy remains active for later cycles.
8. `Buy` or `Sell` obtains a fresh amount-specific OKX quote. The worker verifies the configured router, zero native value, quote minimum and contract policy, then simulates before broadcasting.
9. The vault independently enforces executor, adapter, asset, nonce, policy version, expiry, cooldown, per-trade value, daily turnover, exposure, slippage and daily-loss bounds.
10. The runtime reads the actual settlement and target balances from the vault. A sell uses the actual target balance received, not a setup-time estimate. If its oracle value exceeds the signed per-trade cap, PULSE sells a bounded chunk and retains the exit state for later cooldown-qualified chunks.
11. A separate one-minute deterministic risk monitor checks the live OKX mark against the active TP/SL and completes latched partial exits. It does not wait for an AI signal. A touched exit is latched while the on-chain cooldown runs, then uses the same guarded oracle, quote, router allowlist, simulation, policy version and nonce path as every other execution.
12. The UI displays decision statistics, each passed/waiting rule, compact-signal source/confidence, token/cost budget, pass expiry, TP/SL, evidence hash, transactions, cash-flow-adjusted P&L and a downloadable CSV audit log.

## Strategy rules

### Trend following

Purpose: join a confirmed directional trend and exit when the trend structure fails.

Entry requires **all** of the following:

- Compact AI bias is bullish.
- Compact AI confidence meets the owner-signed threshold.
- Compact AI regime is `trend_up`.
- Latest close is above SMA20.
- SMA20 is above SMA50.

Exit requires **any** of the following while the vault owns the target asset:

- Take-profit is reached.
- Stop-loss is reached.
- A fresh compact signal turns bearish at or above the confidence threshold.
- Latest close falls below SMA20.

### Breakout

Purpose: enter only when both price and participation confirm a range break.

Entry requires **all** of the following:

- Compact AI bias is bullish.
- Compact AI confidence meets the owner-signed threshold.
- Latest close exceeds the highest high of the preceding 20 candles.
- Latest volume is at least 1.15 times the preceding 20-candle average.
- Compact AI regime is `trend_up` or `transition`.

Exit requires **any** of the following: TP, SL, a threshold-qualified bearish compact signal, or a close below SMA20.

### Mean reversion

Purpose: buy a confirmed pullback, not a falling trend, and exit when price reverts or invalidates.

Entry requires **all** of the following:

- Compact AI bias is bullish.
- Compact AI confidence meets the owner-signed threshold.
- Price is within 1% of compact-signal support, or RSI14 is 42 or lower.
- Compact AI regime is `range` or `transition`.

Exit requires **any** of the following: TP, SL, a threshold-qualified bearish compact signal, or price reaching SMA20.

## Risk profiles

| Profile | Max/trade | Daily loss | Target exposure | Daily turnover | Max slippage | Cooldown | Min confidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Conservative | 25% | 2% | 25% | 60% | 0.5% | 15 min | 80% |
| Balanced | 50% | 3% | 50% | 100% | 1.0% | 5 min | 70% |
| Active | 100% | 5% | 100% | 200% | 1.5% | 2 min | 60% |

Percentages are converted to settlement-token atomic units by the UI and committed to the vault. Active may use all deposited spot capital in one Buy; this creates no leverage and borrows nothing. The contract caps slippage at 10% and daily loss at 30% even if a malformed client attempts a larger value.

## Contract functions and authority

| Function | Caller | Function in the product |
| --- | --- | --- |
| `createVault(settlementAsset, policyHash)` | Connected owner | Creates an isolated strategy account only when factory discovery finds none suitable. |
| `updatePolicy(nextHash)` | Connected owner | Commits a changed strategy and pauses before reconfiguration. |
| `configureAsset(asset, allowed, cap)` | Connected owner | Restricts trading to the selected mapped asset and its exposure cap. |
| `configureLimits(...)` | Connected owner | Commits trade, turnover, slippage, loss, cooldown and expiry bounds. |
| `setPaused(bool)` | Connected owner | Activates or immediately stops automated execution. |
| `withdraw(token, amount)` | Connected owner | Returns vault funds to the owner. The executor cannot call it. |
| `execute(...)` | Registry-approved executor | Executes exactly one evidence-bound, nonce-bound trade through an approved adapter. |
| `portfolioValue()` | Anyone/read-only | Values allowlisted vault balances using the configured oracle. |

Registry administration controls approved executors, adapters, keepers and the global emergency pause. The OKX adapter resets approvals around each swap and only permits approved routers.

## Evidence and reporting

Each cycle updates lifetime evaluation/Buy/Sell/Hold/failure counters and appends its detailed decision to a private per-vault KV journal. The latest 100 rows also remain embedded in the strategy snapshot as an outage fallback, but they are not the source of lifetime fill statistics. Confirmed on-chain activity repairs missing or stale Buy/Sell counters on legacy strategies. The UI and CSV expose every available journal/activity row and label any unrecoverable pre-journal detail gap explicitly. An execution evidence payload is stored before a trade and its hash is committed in the vault transaction. The report contains:

- exact strategy and market/timeframe;
- action (`Buy`, `Sell` or `Hold`) and reason;
- observed value and required value for every rule;
- compact signal, deterministic technical structure, source, token usage and cost budget status;
- OKX quote and signed policy hash for executions;
- evidence hash and transaction hash;
- current settlement/target balances, mark-to-market value and cash-flow-adjusted P&L.

The Autopilot runtime UI exposes this as a **Strategy journal** with a plain-language current state, PASS/WAIT rule evidence and a separate on-chain activity ledger. Contract addresses remain under **Technical proof** so a trader does not need to enter them.

## Verification status

Automated verification covers all three entry strategies, low-confidence fail-closed behavior, TP, SL, bearish and structural exits, the Buy → protected Hold → Sell lifecycle, owner-only controls, asset/exposure/risk limits, approved executor/adapter checks and nonce replay rejection.

The earlier Base mainnet run verified vault creation, configuration, funding, one authentic `Hold` evaluation, pause and withdrawal. It proves that a strategy may activate and keep monitoring without an entry transaction. At that stage, the separate full trade-path acceptance remained open until a real strategy produced a qualifying `Buy`, guarded execution, position reconciliation and a rule-qualified exit. The later X Layer lifecycle below completed that gate. A missing `Buy` never blocks activation.

### Live qualification on 2026-08-25

The read-only audit used current OKX candles and fresh Premium reports. It did not use the test private key or broadcast transactions.

| Pair / timeframe | Premium state | Result |
| --- | --- | --- |
| ETH-USDT 4H | neutral, 55%, transition | All strategies Hold |
| ETH-USDT 1H | neutral, 50%, range | All strategies Hold; Mean Reversion technical pullback passed but signal did not |
| ETH-USDT 15m | neutral, 55%, range | All strategies Hold |
| BTC-USDT 4H / 1D / 15m | neutral, 55–60% | All strategies Hold |
| DOGE-USDT 4H / 15m | neutral or bearish | All strategies Hold |
| SOL-USDT 4H / 15m | bearish, 55% | All strategies Hold |
| WIF-USDT 4H / 15m | neutral, 55% | All strategies Hold despite technical shortlist rank |
| SHIB-USDT 4H | neutral, 55%, range | All strategies Hold |

The opportunity prefilter scanned 16 OKX pairs across 15m and 1H and additionally ranked the 4H universe. It found technical candidates, but a shortlist score is deliberately insufficient for execution. Forcing a mainnet Buy by relabelling a neutral report or lowering rules after evaluation would invalidate the test.

### Qualified candidate found on 2026-08-25

The expanded scan tested high-volume gainers and changed timeframes as requested. `HYPE-USDT 4H` produced a valid Trend Following Buy, but PULSE correctly rejected it for execution because no identity-safe HYPE representation plus settlement route exists on X Layer, Base or Arbitrum. The analysis remains useful; the unsupported asset is not silently substituted.

`SOL-USDT 1D` then produced a fresh Premium bullish report with 60% confidence and a `trend_up` regime. X Layer independently resolved the live execution pair as `SOL/USDT0`. The test-wallet preflight found `2.630502 USDT0`, `0.002823311971309224 OKB`, no existing X Layer Autopilot vault and a live SOL/USDT0 route.

| Trend Following entry rule | Observed | Required | Result |
| --- | --- | --- | --- |
| Premium bias | bullish | bullish | PASS |
| Confidence | 60% | at least 60% | PASS |
| Regime | trend_up | trend_up | PASS |
| Close vs SMA20 | 98.39 vs 82.61 | close above SMA20 | PASS |
| SMA alignment | 82.61 vs 78.401 | SMA20 above SMA50 | PASS |

The same snapshot correctly kept the other strategies in Hold: Breakout failed because `98.39` was below the previous 20-candle high `103.16` and volume was `0.16x` rather than at least `1.15x`; Mean Reversion failed because RSI14 was `99.0`, price was not within 1% of `95.48` support, and the regime was not range/transition. Report levels were TP `110` and SL `93.26` at a `98.41` mark.

The prepared bounded mainnet acceptance action is: X Layer, SOL-USDT 1D, Trend Following, `1 USDT0` capital under the documented Active profile: maximum `0.1 USDT0` per trade, 2 USDT0 daily turnover, 0.75 USDT0 target exposure, 1.5% route-slippage cap, 5% daily loss stop, 120-second cooldown and 60% Premium threshold. The authorized monitoring run creates/configures the owner vault, begins in Buy, Hold or Sell monitoring state according to fresh evidence, records decisions/receipts/balances/P&L and remains active until the owner pauses or withdraws it.

### Confirmed mainnet gate result at 2026-08-25T19:46:20Z

The owner explicitly authorized the bounded X Layer run. Immediately before the first state change, PULSE reran the complete read-only Premium and deterministic policy gate. Market state had changed, so the authorized execution correctly became a no-trade decision:

| Evidence | Fresh observed value | Signed requirement | Result |
| --- | ---: | ---: | --- |
| Premium bias | neutral | bullish | BLOCKED |
| Premium confidence | 55% | at least 60% | BLOCKED |
| Premium regime | transition | trend_up | BLOCKED |
| Close vs SMA20 | 97.63 vs 82.572 | close above SMA20 | PASS |
| SMA alignment | 82.572 vs 78.3858 | SMA20 above SMA50 | PASS |

The fresh mark was `97.64`. Breakout also remained Hold because price `97.63` was below the prior high `103.16` and volume was only `0.18x`, below the required `1.15x`. Mean Reversion remained Hold because the price was not within 1% of support `94.78` and RSI14 was `95.9`.

Fail-closed trade outcome: no SOL entry transaction was allowed. This is authentic evidence that the automation refuses a stale recommendation after owner confirmation. Product behavior has since been clarified: this Hold must not block creating, funding and activating Autopilot. A running strategy begins in Watching/Hold when necessary and continues evaluating future Buy, Hold and Sell cycles.

### Active X Layer mainnet monitoring run — 2026-08-26

The owner authorized leaving `1 USDT0` active under the documented limits. Fresh factory discovery found no prior X Layer Autopilot vault, so PULSE created exactly one owner-controlled vault and did not touch the independent Spot accounts.

| Item | Confirmed value |
| --- | --- |
| Owner | `0xa7d827622c4f9c884ca8f751b2060dd767f18683` |
| Vault | `0x64b4C9fc379EE1F4820fEC6597124f7f835374A1` |
| Network / route | X Layer mainnet (`196`) · SOL/USDT0 |
| Strategy | Trend Following · SOL-USDT · 1D |
| Status | Active, unpaused |
| Vault balances after reconciliation | `1,000,000` USDT0 atomic = `1 USDT0`; `0` SOL atomic |
| Portfolio value / P&L | `1,000,000` settlement atomic · `0%` at activation |
| First completed decision | `hold_trend_following` |
| Evidence hash | `0xe8db978f11239eb199bfcbf2a959a462ef4d112ec4a70f3d06f32fa031c5d64f` |

Confirmed state-changing transactions:

| Action | Transaction |
| --- | --- |
| Create vault | `0x50d58bfabc9458b7ddd0eb06179edc0fe0ff2c53b3a5514feb8ade60b8e8b4c3` |
| Allowlist SOL and set exposure cap | `0x3c8ee7c5d5bd2f3d7d2d40abd7032fcde31fa46a5d4be763a8a898f4fe382b2f` |
| Commit risk limits | `0xf871efd3d62c64b87b03f9562d0431976a694bcd331363688ce3a6cbfb69d59a` |
| Fund exactly 1 USDT0 | `0x7fdbecb8ab44479d555c0c30ab89bead9ddcabd00e788a5232c9278f070eebb9` |
| Activate monitoring | `0x0b075661edea36b1473d669398fcb8599cf56b7b3a70f6ac27744c9c37236ff3` |

The first analysis attempt failed closed before trading because the private KV store's cold request exceeded the former 3-second client deadline. Direct latency evidence showed a successful first `PING` at 3.628 seconds followed by 0.908–1.201 second responses. PULSE's bounded KV deadline was corrected to 6 seconds, the service restarted, and the same active strategy recovered without recreating or refunding the vault. The recovered cycle persisted this complete rule evaluation:

| Trend Following rule | Observed | Required | Result |
| --- | ---: | ---: | --- |
| Premium bias | neutral | bullish | WAIT |
| Confidence | 55% | at least 60% | WAIT |
| Regime | transition | trend_up | WAIT |
| Close vs SMA20 | 96.06 vs 82.4935 | close above SMA20 | PASS |
| SMA alignment | 82.4935 vs 78.3544 | SMA20 above SMA50 | PASS |

Additional evidence: prior 20-candle high `103.16`, volume ratio `0.6732x`, RSI14 `89.9921`, nearest support `95.27`, take-profit candidate `103.16`, stop-loss candidate `93.26`. No swap transaction exists for this cycle because three signed entry rules did not pass. This is the correct active `Hold` state: monitoring continues at the configured interval and may later Buy, Hold, Sell, and Buy again without recreating the strategy. The UI Activity ledger and fresh factory-contract multicall both reconcile the vault as active and funded; Etherscan or another paid indexer is not required.

### Restart and persistence recovery proof — 2026-08-26

Continued monitoring exposed a separate concurrency defect in the former single-key JSON strategy index. A worker that began with an empty snapshot could finish after an owner activated a strategy and overwrite the newer registration with `[]`. The vault and its capital remained safe on-chain, but the dashboard and scheduler could temporarily lose the strategy metadata.

PULSE now stores one atomic KV hash field per vault. Worker cycles merge only runtime telemetry into the latest owner-signed configuration; an empty or stale cycle cannot delete another record or roll back pair, timeframe, assets, strategy, or risk policy. The API also retains a last-known read view during short KV interruptions, while execution still fails closed because its distributed lease requires live KV.

The existing vault was recovered from its original signed policy without sending a contract transaction or moving tokens. The ordinary one-minute scheduler—not the diagnostic command—then produced a fresh evaluation at `2026-08-26T10:57:19.054Z`:

| Item | Recovered value |
| --- | --- |
| Status | Active, unpaused |
| Settlement / target balance | `1 USDT0` / `0 SOL` |
| Decision | `hold_trend_following` |
| Evidence hash | `0x53a145f73b857dda01039ea344155b6b01f1240c60f69418d3efa94de8fba76f` |
| Mark used for dashboard reconciliation | `97.52` |
| Premium bias / confidence / regime | neutral / 55% / transition |
| Passing technical rules | close above SMA20; SMA20 above SMA50 |
| Waiting rules | bullish bias; 60% confidence; trend-up regime |

This proves process-level recovery, persistent strategy discovery, scheduled analysis, evidence storage, factory reconciliation and fail-closed execution with the authorized capital left active.

After a complete `npm run dev` process restart, PULSE loaded the same record and waited for the signed 15-minute interval rather than calling xAI on every one-minute worker scan. The next ordinary scheduled evaluation completed at `2026-08-26T11:13:33.362Z` with evidence hash `0x59e343bf27d33e552e6a45f5b52478790d1fc017a900b0a5c4a34329d01188b5`. It again returned Hold at a `97.47` analyzed close (`97.44` reconciled mark), preserved `1 USDT0`, held `0 SOL`, left the vault unpaused and reported `0%` P&L. This is the final restart-plus-next-interval persistence proof.

### First autonomous entry — 2026-08-26

Continued live monitoring later produced a fresh Premium report that passed every owner-authorized Trend Following entry rule. This was an ordinary scheduled decision, not a forced diagnostic, and required no additional owner signature.

| Entry rule | Observed | Required | Result |
| --- | ---: | ---: | --- |
| Premium bias | bullish | bullish | PASS |
| Confidence | 60% | at least 60% | PASS |
| Regime | trend_up | trend_up | PASS |
| Close vs SMA20 | 96.78 vs 82.5295 | close above SMA20 | PASS |
| SMA alignment | 82.5295 vs 78.3688 | SMA20 above SMA50 | PASS |

The guarded entry spent exactly `100,000` settlement atomic (`0.1 USDT0`) and received `1,035,205` target atomic (`0.001035205 SOL`). The vault retained `0.9 USDT0`. The active exit policy was recorded at take profit `103.16` and stop loss `93.26`; later cycles may Hold, Sell on an exit rule, and Buy again when all entry rules pass.

| Evidence | Confirmed value |
| --- | --- |
| Oracle update | `0x38b8b0f00c2eec98f140433eaeef35f229e604b89ccc6bbb0a27638c6b91591a` |
| Guarded autonomous Buy | `0x75b6fc1ba40ed87c2e95d8f7768165601897e888a3b75aae1717088a977c52a1` |
| Decision evidence hash | `0x1f6b93e6c2704e38884eada92c204320a8e918defc8239c5f2651f612d19f88f` |
| First reconciled portfolio snapshot | `1,000,259` settlement atomic; `+259` atomic / `+0.0259%` |

At this point in the dated run, the position remained active under the owner's existing authorization; PULSE did not force a sell merely to complete a test. The dashboard classified this protected entry as **Active**, not also Executed. Activity is stored as one atomic KV hash field per transaction, so concurrent API workers cannot move an order backward between Pending and Active or overwrite newer receipt/account metadata. The later section records the natural exit that subsequently fired.

The next scheduled cycle at `2026-08-26T14:20:53.841Z` proved the post-entry Hold path. At a `96.72` analyzed close, TP `103.16` and SL `93.26` were both untouched; the report was neutral at 55%, not bearish at the 60% threshold; and close remained above SMA20 `82.5265`. No second Buy and no premature Sell was broadcast. Evidence `0x301699e46ebaf5c4162d356795ea5999c15290db3ed3cb6490c9db557a1023f9` reconciled the same `0.9 USDT0` and `0.001035205 SOL` balances. This demonstrates the live `Buy → protected Hold` portion of the lifecycle; the natural Sell was still pending at that timestamp and is completed below.

## Multi-agent strategy matrix — 2026-08-26

Three additional owner-controlled agents were created with `0.5` settlement token each so the live acceptance run covers every strategy preset, three mainnet RPCs, multiple assets and three time horizons. They use the same Active risk profile scaled to their capital: maximum `0.05` settlement token per trade, `1.0` daily turnover, `0.375` target exposure, 1.5% slippage cap, 5% daily loss stop, 120-second cooldown and 60% Premium confidence threshold. The original SOL agent remains independent with its previously signed `1 USDT0` limits.

This is intentional diversification, not three copies of SOL: ETH tests a wrapped native asset, DOGE tests Base's identity-safe `cbDOGE` mapping, and BTC tests Arbitrum `WBTC`. New acceptance agents use `0.5 USDC` or `0.5 USDT0`; the already-authorized SOL position is not resized or silently reconfigured.

| Network | Analysis / execution asset | Timeframe | Strategy | Capital | First live result | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| X Layer | ETH-USDT / WETH-USDT0 | 15m | Mean Reversion | 0.5 USDT0 | Hold | `0x7afd2c6edf3d0b81cc81a07dce0689c1cbb79e683fd2c955f80f1c818c82fcd3` |
| Base | DOGE-USDT / cbDOGE-USDC | 15m | Breakout | 0.5 USDC | Hold | `0xb54ac8da9c35ad6f5d16a6d4ed055afd2ff84447781e0dc644319e4dc79c05cd` |
| Arbitrum | BTC-USDT / WBTC-USDC | 1H | Mean Reversion | 0.5 USDC | Hold | `0x5947cc3f7e3a603399e5fa31d45e77f47a1dce625b9a90876050be3fda3c00d0` |
| X Layer | SOL-USDT / SOL-USDT0 | 1D | Trend Following | 1 USDT0 | Buy → Hold | `0xdb40243afeaf9a70db94c699812f8ced40930c4363057fbf00c1549de3823e96` |

### X Layer ETH 15m — Mean Reversion

Vault `0x545e68d4FB792812062d7D19Ad6fFbF093eCbb5C` is active, unpaused and reconciles exactly `0.5 USDT0` with no WETH position. Its first live cycle used a `2449.7` close, RSI14 `36.75`, verified support `2446.81` and a `range` regime.

| Entry rule | Observed | Required | Result |
| --- | --- | --- | --- |
| Premium bias | neutral | bullish | WAIT |
| Confidence | 55% | at least 60% | WAIT |
| Pullback | support 2446.81; RSI 36.8 | within 1% of support or RSI ≤ 42 | PASS |
| Mean-reversion regime | range | range or transition | PASS |

| On-chain action | Transaction |
| --- | --- |
| Create vault | `0x13fdc516e5f3e14b37fb0bce5b0d34d353e45c79cc7d6be3e17b70f454ed5d1c` |
| Allowlist WETH and set exposure | `0xa0fb5edbce26d501d8c8adff7bf6ced72c01d373da0115f6f8720f616fae5f8e` |
| Commit risk limits | `0x87188cfa20e2d1b8d5c6b09a985c55d29e9e612dfe0710f6ce4a2e11550e576f` |
| Fund 0.5 USDT0 | `0x1ae9b9f586ed843862804df99b346274c92c05df12f1801ca0139148e3a57154` |
| Activate | `0x9ae899ee10827904d49a12b2281339127002efd9b64a0d61e5ea01c1f1ff45a3` |

### Base DOGE 15m — Breakout

Vault `0x2DD49A1035FCF7A951dda16609f5d33158d91bEE` is active, unpaused and reconciles exactly `0.5 USDC` with no cbDOGE position. The live cycle was a useful partial setup: 65% confidence and `1.79x` volume passed, while the required bullish direction, range break and continuation regime correctly blocked entry.

| Entry rule | Observed | Required | Result |
| --- | --- | --- | --- |
| Premium bias | bearish | bullish | WAIT |
| Confidence | 65% | at least 60% | PASS |
| Prior range broken | 0.08504 | above 0.08709 | WAIT |
| Breakout volume | 1.79x | at least 1.15x | PASS |
| Continuation regime | trend_down | trend_up or transition | WAIT |

| On-chain action | Transaction |
| --- | --- |
| Create vault | `0xff357032627a161d76e9629545bb8fb162f4fe262836b45b64616028454b95db` |
| Allowlist cbDOGE and set exposure | `0xbf4a1cf2eaabc9195ff909f11e7e2fe30c66693a74a5aef66bbe5efdb13c8e6e` |
| Commit risk limits | `0xd100f358c59662723e8834ca438ef3a522d399efa3f9d29683cf14f3b388e17f` |
| Fund 0.5 USDC | `0x30729a8e89ebcc5844458d47132885904cf51200f28516d0517a94a46c1a9cc4` |
| Activate | `0xa9ced41c48af5cdaa370c721b5a10be99041cd8c517fcfc86aaf43ce86d99c0b` |

### Arbitrum BTC 1H — Mean Reversion

Vault `0xa24AEb32A1B4da667EB69c809aAcb4eFd90e7fda` is active, unpaused and reconciles exactly `0.5 USDC` with no WBTC position. Price was near support and RSI was below 42 in a range, but the Premium report remained neutral at 55%, so the two mandatory report gates prevented entry.

| Entry rule | Observed | Required | Result |
| --- | --- | --- | --- |
| Premium bias | neutral | bullish | WAIT |
| Confidence | 55% | at least 60% | WAIT |
| Pullback | support 78174.5; RSI 39.1 | within 1% of support or RSI ≤ 42 | PASS |
| Mean-reversion regime | range | range or transition | PASS |

| On-chain action | Transaction |
| --- | --- |
| Create vault | `0x347d5c91fae0ab7d780462093a7a459b003032d97cd594e3d207f1875b42d158` |
| Allowlist WBTC and set exposure | `0xa88c637a2d60ccba2ba1ca6337523a00b59be45fbeb2340946b085dcd1d4ae49` |
| Commit risk limits | `0x0cbd291f1cec33a00aa11e57ea4d205b9f30abeaa8e865aa21bda39f0bed1c03` |
| Fund 0.5 USDC | `0xdf67a5b48dfa42f0b49707afbcb6e4528b25a0a502094dd898307eca3e0bb855` |
| Activate | `0x8f8f8db009a26381e7cf5602b0afb3389bec40dd0ff2e68ccdad5b9ebbae06ca` |

### Reconciliation result

Every new transaction is confirmed in the chain-derived Activity ledger: X Layer has 12 confirmed Autopilot records across its two agents, Base has 13 confirmed records including the earlier acceptance vault, and Arbitrum has 5 confirmed records for the new BTC agent. There are zero pending and zero failed Autopilot receipts on all three networks. Each new strategy appears once in persistent strategy storage and once in its factory-derived vault list; none required Etherscan or a paid indexer.

The matrix proves that activation is independent of a Buy signal and that each preset evaluates its own complete rules rather than sharing a generic LLM decision. The agents remain active so subsequent cycles can demonstrate transitions when real evidence changes. Only the SOL Trend Following agent currently owns a target asset; the other agents retain settlement capital and cannot report fabricated P&L or an active position.

### Second scheduled cycle and recovery proof

The ordinary API scheduler—not the acceptance script—then evaluated all four agents again. This proves that the newly created agents continue operating after setup and that strategy state is not tied to the browser tab.

| Network / strategy | Scheduled result | Important observed rules | Evidence |
| --- | --- | --- | --- |
| X Layer SOL 1D Trend Following | Protected Hold | mark 95.70; TP 103.16 not reached; SL 93.26 not reached; bearish confidence 55% below the 60% signed exit threshold; close remained above SMA20 | `0xea6c103d7d93c19efa15f581618e2b23ec9bc2654796004f9058506d6d372eee` |
| X Layer ETH 15m Mean Reversion | Hold | bearish 55%; support/RSI pullback passed at support 2440.41 and RSI 34.2; trend-down regime blocked entry | `0x550caa33b892791dfc9e126053c94711eaf5e9099cecbc1c761aab0870b0e542` |
| Base DOGE 15m Breakout | Hold | bearish 68%; 5.21x volume passed; price 0.08445 did not break the prior high; trend-down regime blocked entry | `0x07e241c721bf55e0bd6157f3ccd058ad3c4d40bdd2e420d6d2bf6e8abf261e0c` |
| Arbitrum BTC 1H Mean Reversion | Hold | neutral 55%; support/RSI pullback passed at support 78320.3 and RSI 32.9; transition regime passed; Premium direction and confidence blocked entry | `0xff69612c250d7dca29dc4903fa3c19ceb4990792b0085dd63e4ee0095e10b170` |

During this cycle the X Layer ETH analysis provider timed out once. The vault failed closed, moved no assets, retained its signed strategy, and the scheduler retried without owner or browser action. The next attempt completed with the evidence hash above. The runtime now labels transient failures `hold_dependency_retry` and explicitly tells the trader that no assets moved and automatic retry remains active; a previous successful decision is no longer presented as if it were the failed cycle's result.

The Autopilot runtime summary also now aggregates portfolio value and cash-flow-adjusted P&L across every strategy on the selected network. The selected-vault card still shows the capital belonging to that one strategy account. This avoids presenting one selected vault's `0.5` balance as the total for a multi-agent portfolio.

### Durable cloud scheduling

These mainnet acceptance runs used the local Node in-process worker. `AUTOMATION_EXECUTOR_PRIVATE_KEY` was unset, so the runtime intentionally used the funded `TEST_WALLET_PRIVATE_KEY` acceptance fallback; the public sender of the recorded guarded Buy matches `TEST_WALLET_ADDRESS`. This proved the same keeper/executor/oracle transaction path without creating a second funded test identity. It is not the production secret model. The checked-in production topology now runs one long-lived Railway API/worker and a static Vercel web app: Railway alone receives a dedicated Registry- and OracleRouter-approved `AUTOMATION_EXECUTOR_PRIVATE_KEY`, while neither host receives `TEST_WALLET_PRIVATE_KEY`. The optional serverless cron route remains available only for an alternative all-in-one deployment and must not run beside Railway automation. Upstash leases, per-vault leases and the on-chain action nonce remain independent replay barriers.

Local acceptance generated a 48-byte `CRON_SECRET` directly into the gitignored `.env` without logging it. The endpoint returned `401` without the Bearer capability and `200 completed` with it; Spot, Autopilot and Telegram workers all fulfilled. After the subsequent clean process restart, the ordinary worker independently evaluated the protected SOL strategy at `2026-08-26T19:43:23.373Z`. It persisted evidence `0xa716ed97fdc7a3d7aa6dcd51f4d5ae002783c4974caa5a7dc9b7daa79228f637`, held at `96.58`, and reconciled `900,000` USDT0 atomic plus `1,035,205` SOL atomic. TP `103.16`, SL `93.26`, bearish Premium `neutral 55%` and structure exit `96.58 < SMA20 83.6215` were all false, so no transaction was broadcast.

### Exit-completion guard

The live SOL position is worth slightly more than its signed `0.1 USDT0` per-trade cap when mark price is above its entry. A naive maximum-size exit would sell almost all SOL and leave only unquotable token dust. PULSE now calculates the number of cap-compliant exit transactions first and divides the position into balanced chunks. At a `96.64` oracle price, the current `1,035,205` SOL atomic balance would exit as `517,603` and `517,602` atomic rather than one near-cap transaction plus dust. Both chunks remain below the unchanged on-chain limit; no guardrail is widened.

A direct contract read confirmed `maxTradeValue = 100,000`, `dailyTurnoverCap = 2,000,000`, `cooldown = 120`, `actionNonce = 1`, `policyVersion = 3`, `paused = false`, expiry `2026-09-25T09:47:56Z`, and exact balances `1,035,205 SOL atomic` plus `900,000 USDT0 atomic`. A read-only OKX Onchain OS quote then accepted the first `517,603`-atomic SOL chunk on chain 196 and returned `49,939` USDT0 atomic with `-0.03%` quoted price impact through Uniswap V3 and ElfomoFi. This confirms the balanced chunks are economically quotable before an exit condition is allowed to broadcast them.

The pre-exit baseline was independently reconfirmed at X Layer block `69,004,994`: `actionNonce = 1`, `policyVersion = 3`, `paused = false`, `maxTradeValue = 100,000`, `dailyTurnoverCap = 2,000,000`, `900,000` USDT0 atomic and `1,035,205` SOL atomic. The read-only `portfolioValue()` call returned `STALE` between trades because the guarded oracle is intentionally not refreshed with a gas-spending transaction on every Hold. The dashboard values current balances with the live OKX mark; before any execution, the worker updates the guarded oracle, simulates the exact transaction and only then broadcasts. A stale idle oracle therefore fails closed and cannot authorize a trade.

After the first chunk, the remaining target balance and TP/SL policy keep the position **Active**. The dashboard does not relabel its original Buy as Executed merely because `lastTxHash` now points to a partial Sell. Only a complete exit clears protection and moves the closed lifecycle into Executed history. The exact split and partial-state classification are covered by automated tests before the live exit rule fires.

### Natural take-profit, bounded exit and autonomous re-entry — 2026-08-27

The live run completed the previously open acceptance gate without an owner-forced close. At `2026-08-27T08:11:40.989Z`, the independent risk monitor observed SOL at `103.54`, above the active `103.16` take-profit. That latched a Sell even though the later mark moved back below TP. The first two exact simulations reverted with contract reason `SLIPPAGE`; both failed closed and moved no vault assets. Investigation found that the worker used only the OKX quote tolerance while the vault also enforces an oracle-valued minimum.

PULSE now calculates both values with the same decimal arithmetic as `AutopilotVaultV2`, requires the live quote to satisfy the oracle minimum, and submits `max(quote minimum, oracle minimum)`. Quote validation also runs before the gas-spending oracle update. The latched exit then completed in the two precomputed cap-compliant chunks:

| Phase | Policy evidence | Sold | Received | On-chain evidence |
| --- | --- | ---: | ---: | --- |
| TP latch | mark `103.54 >= 103.16`; cooldown ready | — | — | evidence `0x5793391dba2c330d58536591363678aa3f4305eeb30f7f44ef4810a86f691667`; simulation failed closed |
| Partial exit | completion latch active; mark `102.99` | `517,603` SOL atomic | `53,237` USDT0 atomic | tx `0x6e2a14e29048022f883bc7fa4f070383b8f5d19a789a6e17e7acd6be84678d02`; block `69,049,500`; evidence `0xac5eee30c01d9e2787a87cee6c98921d194c41b57020bce0eb75fd3ad62aceb7` |
| Cooldown | target remained; 120-second contract cooldown active | — | — | `hold_exit_cooldown`; no transaction |
| Final exit | completion latch active; mark `102.84`; cooldown ready | `517,602` SOL atomic | `53,221` USDT0 atomic | tx `0x7d2a2dc3b4bb67f49d17e0175753754adc461c2279912c5586645de1e9a2bdff`; block `69,049,741`; evidence `0xe6deb6fadf8a7f67ee29843e8520e83a1a11a8020f86775c12295c81b40e1908` |

The final contract read showed `actionNonce = 3`, `target balance = 0`, `settlement balance = 1,006,458` atomic, no active TP/SL and cash-flow-adjusted realized P&L of `+6,458` atomic (`+0.6458%`) against the original `1 USDT0` capital. The Activity ledger independently contains both confirmed Sell receipts. Durable activity now reconciles runtime labels, and concurrent runtime saves union evaluation IDs so a slower risk or analysis cycle cannot erase a newer fill from the detailed report.

Because the owner authorized leaving the strategy active—not a one-shot trade—the next ordinary Premium cycle was allowed to evaluate a new entry. At `2026-08-27T08:31:24.463Z`, all five Trend Following rules passed: bullish bias, `72% >= 60%` confidence, `trend_up`, close `104.62 > SMA20 84.0235`, and SMA20 `84.0235 > SMA50 78.9092`. The guarded vault then spent `100,000` USDT0 atomic and received `960,412` SOL atomic:

- Buy tx: `0x2fd6a65422424a0746a5a77521f4dae63377c7a1c5c8685f56b021e7d29d565b`, block `69,050,475`.
- Evidence: `0x3f2b4121ed68bc44f5619d20987f39cdb16fd58a854da8937285e950e3459dfe`.
- Fresh protection: TP `112`, SL `95.48`.
- Quote: `960,412` SOL atomic; enforced minimum `946,005`; reported impact `0.48%` through the live OKX route.
- Reconciled state after entry: `906,458` USDT0 atomic plus `960,412` SOL atomic; active and unpaused.

This proves the requested continuing state machine rather than a Buy-only bot: `Buy -> protected Hold -> TP latch -> partial Sell -> cooldown Hold -> final Sell -> flat Hold -> new qualified Buy`. Every transition remained inside the original owner-signed capital, asset, exposure, slippage, turnover, cooldown, loss and executor/adapter boundaries.
