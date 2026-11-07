# PULSE Execution Lab — Size check proposal

**Status: PROPOSED; design review required. Not approved for implementation.** Reviewed 6 November 2026. This document authorizes no product changes, purchases, circuit publication or transactions. The rejected Trading Rules concept is outside this proposal.

## 1. One user problem and one launch feature

“Before I enter or reduce this position, how much of my amount fits inside the actual captured order book, at what estimated price, and how much cannot be assessed?”

The MVP is **Size check**: choose Buy or Sell and a base-asset amount, inspect one genuine same-venue Spot order-book capture, then compare estimated filled quantity, total cost/proceeds, average price, worst included price and unassessed remainder. It helps size an order; it does not generate direction, change a report setup, place an order or guarantee execution.

PULSE Execution Lab is the proposed capability name. Size check opens inside the existing Terminal workspace or an eligible existing position/Spot flow. Keep the current header, navigation and Trading Terminal placement. No separate Lab tab, subscription, rules builder or new asset/timeframe picker.

## 2. Retail workflow and entry points

1. In Terminal, open **Size check** beside the current book. Market and venue come from that exact source; enter an amount such as BTC quantity. Show approximate quote value as a helper, not a budget guarantee.
2. From **My positions**, prefill the remaining recorded base quantity and the reducing side. The trader reviews the amount; the journal remains unchanged.
3. In Spot, expose the action only for a supported execution instrument with a matching venue/book. An on-chain AMM swap must continue through the existing DEX quote workflow; OKX exchange BTC-USDT depth cannot estimate a Base DEX swap. If no supported match exists, explain it and omit the book estimate.
4. Capture a fresh book and freeze its source time. Show its age, depth and ladder beside the estimate. Editing size recomputes against that same capture, allowing an honest comparison.
5. **Refresh book** explicitly obtains a new capture and recomputes; highlight changed results. A source/market change clears the previous estimate immediately; late responses cannot replace a newer selection.
6. **Use amount** may return the reviewed amount to an existing eligible order ticket. The ticket must obtain its own fresh executable quote and existing confirmation. Size check never submits or marks a fill.

Proposed narrow drawer, using the existing theme and mobile sheet:

```text
Existing PULSE header and navigation — unchanged
Trading Terminal / existing chart and Market tools
┌ Size check                                      Close ┐
│ BTC-USDT · OKX Spot · Book captured [UTC + age]        │
│ Buy / Sell      Amount [          ] BTC               │
│                         Approximate value: [source]   │
│ [Check size]                    [Refresh book]         │
│ Estimated fill […] BTC    Unassessed remainder […] BTC │
│ Cost / proceeds […]       Average […]  Worst […]       │
│ Captured depth used […] / […] levels                   │
│ [ladder: price, available quantity, modelled take]     │
│ Snapshot estimate · orders can change before execution │
│ Details: source, units, rounding, circuit, limitations │
└ [Use amount — eligible ticket only]                   ┘
```

No-data, expired capture, unsupported venue/units and arithmetic refusal are distinct states. Keep inputs readable and retry available; never replace missing liquidity with zeros or distant profile levels. Screen-reader results announce when a new estimate replaces the old one. Mobile shows amount and summary before expandable ladder details.

## 3. Why TapeOut performs essential work

Publish a reusable **integer ladder-fill kernel**. Each beat receives one level and the previous accounting state. The circuit computes `take = min(remaining, available)`, subtracts the remainder, adds filled quantity, accumulates `take × priceTicks`, and updates worst included price only when `take > 0`. A final output contains filled quantity, accumulated cost, worst price, remainder and explicit error flags. The adapter must not precompute these outputs and pass them through a decorative circuit.

PULSE validates and encodes the raw ladder, supplies source metadata and renders results. TapeOut executes the numerical model. Average price is the documented rational `cost / filled` converted with instrument scales; display rounding is separate from integer accounting. A zero fill has no average or worst price. Show notional before venue fees and state that boundary; this MVP is not a net-PnL model.

**Proposed arithmetic envelope, to be proved:** unsigned 64-bit price ticks and quantity lots; 128-bit product/cost accumulator with overflow refusal; explicit reset/start/end; no floating point, saturation, implicit truncation or wraparound. Price and quantity must be exact tick/lot multiples from instrument metadata. The adapter refuses unsupported precision or values. Host validation of ladder ordering is repeated in circuit state checks; invalid order, negative/zero-invalid inputs and inconsistent side produce a refusal.

Buy consumes asks from lowest to highest; Sell consumes bids from highest to lowest. Input state advances once per supplied level. Full input and output bit layout, reset semantics, rounding, bounds and error flags form a versioned public ABI. A deterministic integer reference implementation and public test vectors accompany the kernel.

The contribution to TapeOut is a useful numerical component plus real-data adapters, reproducible examples and an independent consumer. Another builder can call it without buying a PULSE report or adopting PULSE's UI. This is a proposed ecosystem contribution, not proof that users already demand it.

## 4. Interfaces, source truth and privacy

| Proposed interface | Required content / behavior |
| --- | --- |
| `BookCapture` | Venue, exact instrument, market type, base/quote units, tick/lot scales, exchange timestamp, received timestamp, supplied level count, bids/asks, capture ID and sequence-verification status. |
| `SizeCheckInput` | Capture ID, side, amount in integer base lots, kernel version. Never infer an execution venue from the wallet payment network. |
| `SizeCheckResult` | Source/capture binding; filled lots, cost units, worst price ticks or null, remainder, consumed levels, flags, program identity, evaluation mode and observation time. |
| TapeAPI method `pulse.execution.sizeCheck.v1` | Proposed server method for builders: bounded typed inputs, fixed version, same integer outputs and source provenance. Existing TapeAPI transport may expose it; availability and authentication remain design decisions, not deployed claims. |
| Public verification bundle | Network/chain ID, processor address, circuit ID, pinned block, bytecode/netlist digest, ABI, reference outputs and public raw example ladder. |

The authoritative binding includes venue/instrument, capture ID, timestamps, scales, side, amount and kernel version. The same ladder cannot be relabelled as another venue, time or asset. Redistributing source depth requires a source-terms review; public API access alone does not establish commercial redistribution rights.

Default private evaluation loads a pinned verified program and runs locally; keep user position size and journal identifiers off chain. A read-only RPC call can expose its inputs to the RPC operator, and a TapeAPI service can see inputs sent to it: neither path is confidential by default. Public parity demos use explicitly public vectors. No private wallet/report/position records enter shared fixtures, circuit state or public logs.

The model uses only the capture available when the user runs it. It never imports later books, fills missing depth, interpolates between captures or treats a last trade as executable depth. A small remaining amount beyond returned levels is **unassessed**, not a claim that the entire exchange has no liquidity. Book changes, hidden orders, latency and the user's market impact can change actual results. Passive queue fills, Futures leverage/liquidation, historical SL/TP ordering and strategy win rates are outside this MVP.

## 5. Verified facts and open technical gates

**Verified source facts as of 6 November 2026:**

- [TAP-02](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md) is a draft specifying NAND/LATCH/REF netlists and evaluation. Its documented general verification was against BNB Smart Chain, not X Layer. PULSE's current NAND/Radar integration does not prove support or performance for this arithmetic kernel on X Layer.
- [TapeAPI 3.0.0](https://github.com/BruceLanLan/tapeapi/releases/tag/v3.0.0) was released today. Its passport/policy/interop packages are experimental; its release describes paid escrow as unaudited and undeployed. They are not prerequisites for this numerical MVP. Signed responses establish what the signer asserted, not exchange-data truth.
- Existing products already address related needs: [OKX DEX quotes](https://web3.okx.com/onchainos/dev-docs/trade/dex-get-quote) return route estimates, [Tenderly](https://docs.tenderly.co/simulations/overview) simulates transactions, [HftBacktest](https://hftbacktest.readthedocs.io/en/py-v2.1.0/order_fill.html) models replayed fills, and [Switchboard](https://github.com/switchboard-xyz/on-demand) supplies configurable oracle data. No “first”, universal execution advantage or novel oracle claim is supported.

**Design inference:** the useful distinction would be an inspectable, reusable TapeOut-native ladder arithmetic kernel with PULSE source-aware retail distribution. Whether that is valuable enough is a user and builder validation question.

**Mandatory gates before product implementation or launch claims:**

1. Verify the exact X Layer processor ABI, limits, ownership/publication permissions, REF/LATCH behavior and arithmetic bit order at pinned blocks through independent RPCs. Record addresses and network explicitly.
2. Build the smallest nontrivial multiply/add/min/reset example in an isolated benchmark. Compare actual X Layer read-only evaluation with the local evaluator and independent BigInt reference. Publication, if required, needs separate authorization.
3. Benchmark supported precision and 1/10/50-level cases: netlist size, beat count, RPC call size, latency p50/p95, browser memory and errors. Candidate UX target: cached local calculation within 250 ms for 50 levels; this is a proposed acceptance target, not a measured fact. Record on-chain read limits independently.
4. Reject overflow and prove quantity conservation, exact accumulated notional and correct worst-price selection across both sides. If the supported processor cannot run useful bounded arithmetic, stop and revise the proposal; JavaScript substitution must not be advertised as TapeOut computation.
5. Verify source availability/terms and interview retail users and TapeOut builders. Confirm the proposed matching-venue entry points before adding UI.

## 6. MVP acceptance and demonstration

- Deterministic vectors cover zero/one/many levels, partial final level, size beyond depth, both sides, exact decimals, large inputs, reset, stale/out-of-order responses, wrong venue, duplicate/out-of-order levels and overflow. Compare all intermediate states against an independent integer implementation.
- Capture real public depth from the supported venue and publish one permissible example with exact clocks. Increasing the amount must change circuit-computed take/cost/remainder. Never fabricate a live example or use a stale capture as current.
- In the existing Terminal, demonstrate amount entry → bounded estimate → larger-size remainder → explicit book refresh. From a matching journal record demonstrate reducing-side prefill without changing recorded positions. An unavailable matching venue must remain an honest refusal.
- Show the actual X Layer address/circuit, a public vector evaluated against it, and a second independent builder calling the same version through the proposed TapeAPI adapter. A mocked gateway or local NAND wrapper alone does not satisfy this demonstration.
- Test desktop/mobile and all current themes, wallet/pass expiry, owner changes, source outages, quote age, cancellation and keyboard/screen-reader access. No purchase, trade, alert or circuit publication occurs merely by opening Size check.

The [official OKX event page](https://web3.okx.com/xlayer/build-x-series) requires relevant TapeOut/X Layer use and addresses, permits existing processors, and requires substantial new work for existing projects. It asks for user value, commercial model and an accessible product/demo. Its listed 7 December 2026, 23:59 UTC deadline is explicitly provisional. A working numerical kernel and retail journey could support an entry; eligibility, ranking and awards remain the organizers' decision.

## 7. Commercial hypothesis, boundaries and decision

Hypothesis: existing Terminal users repeatedly check amount versus available depth before opening/reducing positions; builders reuse the numerical component. Measure completed checks, repeat usage, refusal/source-failure rates, amount revisions and independent builder reproductions. Do not equate usage with profitable trades or report a win-rate improvement.

Existing Terminal passes remain unchanged: **24h 1.50, 7d 10.50, 30d 45.00 USDT/USDC**, configurable through `PRICE_TERMINAL_PASS_24H`, `PRICE_TERMINAL_PASS_7D` and `PRICE_TERMINAL_PASS_30D`. This proposal adds no fee, bundle or separate paid plan. Builder-service pricing, if needed, requires a later decision; no undeployed TapeAPI escrow is assumed.

Historical execution replay is a later, separately reviewed capability requiring ordered source events and an explicit fill model. It is not launch scope and does not reopen broad strategy backtesting. Review the narrow Size check workflow and benchmark gates first; implementation starts only after approval.
