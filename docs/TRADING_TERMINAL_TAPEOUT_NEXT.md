# Trading Rules: a useful next Tapeout function for PULSE

Status: design proposal for review; no new feature implementation or on-chain write is authorized by this document. Research reviewed against the official sources below on 6 November 2026 (client date, Europe/Samara).

## Product decision

Add **Trading Rules** inside the existing Trading Terminal. A trader combines the conditions they actually care about, sees which ones currently pass, follows the resulting rule and receives a useful review or position warning. A rule can combine value-area location, executed buying/selling, a completed price response and the trader's own risk limits. The trader can save it privately or deliberately publish a reusable circuit on X Layer.

The central benefit is control: “Follow my conditions, tell me what changed, and show why.” Traders can use several rule templates on one market or different rules for different assets and horizons. This complements the existing strategies; it does not replace their setup logic or promise a win rate.

Tapeout becomes the executable engine for a composed trading rule, including its comparisons and state transitions. Publishing makes that executable rule portable and available for reuse. Checking a report hash or adding an explorer badge would not satisfy this proposal.

Keep the current PULSE header and navigation. Trading Terminal stays after Portfolio. Add Trading Rules as a Terminal section, beside Market, My positions and Alerts & activity; do not add another global product picker or a second market picker.

## What changes for the trader

| Existing capability | New Trading Rules capability |
| --- | --- |
| Radar follows a reviewed three-stage event at one boundary | A trader composes a rule from several measured conditions and optional ordered stages |
| A report supplies its own saved setup | A rule can start from a setup, a chart level, a journal position or a blank template |
| Market tools show separate measurements | A rule explains how the selected measurements combine, including missing evidence and veto conditions |
| A recorded position has individual stop/target observations | A position rule can watch a user-selected change in market conditions as well as price thresholds |
| The current evaluator imports an existing NAND component | A composed program is compiled to a specific Tapeout circuit version and its complete behavior is inspectable and reproducible |

This is a proposed PULSE capability. No claim is made that another terminal offers the same circuit workflow.

## Three concrete uses

### 1. Follow a possible entry without chasing it

The trader selects a saved setup or a chart area, then chooses **Build a trading rule → Entry review**. The initial rule reads:

1. Price returns to my chosen Entry area.
2. A new completed execution candle tests the area and a later candle confirms the required response.
3. The specified Spot or Futures execution window satisfies my participation condition.
4. My least favorable allowed fill, fixed hard stop and nearest opposing price area satisfy my chosen minimum payoff.

The rule shows “2 of 4 conditions met” with actual values, timestamps and the next required close. A positive result means **Review entry conditions**. It does not treat a confirmation close as a fill, place an order or move the allowed Entry range to catch price.

The trader can mix the rule with another report strategy. Any changed side, Entry, hard stop, targets or horizon is a newly reviewed rule instance; an existing instance retains its original terms.

### 2. Monitor an actual position

The trader opens an existing record in My positions and chooses **Add a position rule**. The form is a short sentence rather than a circuit editor:

> Notify me if BTC loses my selected support on a completed 15-minute candle while net executed selling increases. Always notify me separately if my recorded hard-stop price is crossed.

Price-only protection is a priority condition. It must not depend on a favorable funding reading, a second indicator or a positive participation gate. A quote/source interruption produces a separate data warning; it must never become “position safe.”

The card shows the rule state, current distance to the recorded stop, source times and the most recent changed condition. A Telegram message links back to that exact position and rule version. A manual journal record remains a manual record; observing a price does not establish an exchange fill or an executed protective order.

### 3. Reuse a trading method across assets

The trader opens **Trading Rules → Templates**, chooses a public rule such as Value-area reclaim, and sees its conditions and required sources before saving it. They select asset, execution cadence and their own levels, preview the current readings and then start a private instance.

An advanced author can publish a reusable circuit, retain author attribution and allow others to fork it. A recipient can inspect the actual executable program rather than rely on a screenshot or a prose claim. Existing followers stay on the version they reviewed. Changing a published method creates a new version; it cannot silently alter another trader's active rule.

## UI and workflow

Start from useful actions in the current interface:

- A value-area/POC/VWAP level offers **Build a rule at this level**.
- A reviewed setup offers **Use these conditions**.
- A recorded position offers **Add a position rule**.
- Trading Rules offers **Choose a template** and a restrained advanced **Start with your own conditions** action.

The editor has three short steps:

1. **What should I watch?** Entry review, position warning or a level response; inherited market and position/setup context stay visible.
2. **Which conditions matter?** Plain-language cards with source, window, threshold and cadence. Start with a small template, then add or remove conditions. AND/OR and “then on a later candle” have different visible controls.
3. **Review and start.** Show the complete readable rule, exact fixed prices, missing sources, next eligible close, expiry and alert settings. Nothing starts while required inputs are missing or without the trader's review.

An active card contains:

- Outcome: Waiting, Conditions met, Risk warning, Data needed, Paused or Expired.
- Each condition's actual measured value, required value and source time.
- What changed and the next required event.
- Link to its market, exact setup version or actual journal position.
- **Inspect observations**, **Pause** and **Telegram settings**.
- Advanced details: circuit identity, program version and source adapter versions.

“Publish on X Layer” is optional and separate from saving or monitoring privately. Its review states which program details become public, exact network, current protocol/transistor cost and gas estimate. Only generic program logic and an explicitly approved parameter schema are public by default. Wallet addresses, balances, fills, stop amounts and private parameter values are excluded from the publication manifest.

On phones, conditions form one vertical list with a persistent Review/Start action. An expanded condition reveals details inline; no wide node canvas or mandatory programming terms appear in the basic workflow. Advanced authors can inspect the graph and export the program.

## What Tapeout actually supplies

The public draft TAP-02 describes NAND, LATCH and referenced circuits, with caller-supplied state for read-only `step` evaluation. This offers a technical basis for compiling a composed rule and reproducing its results. Its published general deployment verification applies to BNB Smart Chain, while its X Layer deployments are explicitly not covered by that verification. PULSE must verify the selected X Layer contracts and supported operations independently before using them. [TAP-02 specification and deployment limitations](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md)

The current PULSE Radar verifies a particular registered X Layer NAND component. That verification is useful existing integration evidence, but it does not establish that an arbitrary new sequential circuit or publisher is supported. The November 5 public read retained at `.tmp/docs-illustrations-20261105/tapeout.json` pins circuit 2 at block 75,134,025; it is evidence for that component only.

For Trading Rules, the selected program must determine the combined result. The adapter provides numeric measurements and validity bits; it must not secretly calculate a completed outcome and merely pass that bit through an on-chain NAND. A before/after demonstration must show a changed circuit condition causing a different result for the same source observations.

## Technical requirements

### Program and data contracts

Persist a versioned program definition containing:

- Program ID, author, title, explicit license and version.
- Node graph and readable rule generated from that graph.
- Input descriptors: source, market type, instrument, units, value encoding, requested window and freshness requirement.
- Parameters with types, limits and defaults; private instance values stored separately.
- Output descriptors: review event, risk warning, reset and data-needed outcomes.
- Cadence, ordered-stage semantics, expiry and deduplication policy.
- Compiler version, supported Tapeout format version and bounded resource limits.
- For published programs: chain ID, factory/processor/circuit ID, netlist hash, pinned implementation and reference closure.

Each evaluation retains the source observations, source-known times, parameter version, input/state vectors, resulting outputs, circuit identity and generated explanation. An observation's market time and the later time PULSE retrieved it are separate fields. An earlier full-day profile cannot be introduced into a morning replay as though it was already known.

### Numeric and unknown values

Use explicit bounded integer encodings for price ticks, quantity and delta. Reject overflow, wrong tick size and incompatible units before evaluation. Decimal display formatting must not change comparisons. Spot coin amounts and Futures contract counts remain separate inputs.

Represent every measurement with a value and a validity/freshness bit. A missing source is not zero or an automatically false comparison. Logical composition must preserve an unknown result when it could change the decision. Every required input must be valid before an Entry-review output can become positive.

A recorded hard-stop crossing has an independent high-priority output. Other conditions cannot suppress it. Quote-only changes may produce the explicitly selected price warning; completed-candle stages only advance on new eligible completed candles.

### Circuit compilation and execution

Compile bounded comparisons and composition into an executable netlist. For temporal programs, a step represents one eligible ordered observation; saved state is scoped to one private rule instance. At most one stage advances per observation ID. Repeated polls cannot create extra beats, and an actual source gap follows the program's explicit reset or suspend policy.

Before supporting sequential programs on X Layer:

1. Verify chain, factory registration, implementation, circuit metadata and exact netlist at one pinned block using independent RPC agreement.
2. Compare local evaluator results with the selected X Layer processor's read-only `eval`/`step` for bounded combinational and stateful vectors, including invalid data and resets.
3. Bound gate count, total state and referenced-circuit depth; reject unknown opcodes, cycles or resource excess.
4. Retain the verified dependency closure and stop new evaluations if the implementation or referenced behavior changes.

Draft semantics and BNB addresses/fees must not be treated as confirmed X Layer deployment facts. Any protocol publishing costs and required transistor balances must be read and simulated against the selected X Layer deployment before a later publish review.

Private monitoring evaluates the verified program locally and retains caller state offchain. Public RPC parity tests use public vectors, not a user's private stops or position values. A public read request need not be an on-chain transaction, but its RPC operator can still observe submitted inputs. Do not label this monitoring state or the market feed “on-chain verified.”

### Native market inputs

MVP inputs should reuse genuine retained session VWAP/profile, price/volume/delta buckets, completed candles, historical book observations and explicitly sourced current derivatives readings. Each input declares minimum history and coverage. A short recent sample cannot pass a “complete daily session” requirement. A single OI reading cannot pass an “OI increased” test without comparable retained observations.

Public terminal examples establish demand for configurable reference levels, execution-driven indicators, linked views and alert workflows. These are product concepts for independent PULSE implementations using its own supported data. No private indicator code, data subscription, proprietary visuals or paid source is included by this proposal. The UI remains PULSE-branded. [Public indicator catalog](https://mmt.gg/indicators/), [public scripting overview](https://mmt.gg/scripting/), [public workflow overview](https://mmt.gg/features/platform-workflow/)

### Service and alert integration

Retain private programs, instances and evaluation traces under the signed-in wallet. Proposed API boundaries are program draft/validate/preview, instance start/pause, retained evaluations, public template lookup and explicit publication preparation. Preview is bounded and read-only; it must not activate a recurring watcher.

Reuse the existing wallet-to-bot ownership link and both global and per-subject Telegram switches. Deduplicate by rule version, subject, observation and changed outcome. Link every delivery to its retained evaluation. An alert can ask for a review or report a known risk condition; it cannot claim execution.

TAP-11 and TAP-13 describe draft service manifests, delegated signers and responses bound to a request and service. A later portable feed could let another compatible client resolve a rule service and verify who supplied an evaluation. This is an optional interoperability phase, dependent on independently verified X Layer deployment support, not a prerequisite or a claim that signed observations prove exchange truth. [TAP-11](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-11.md), [TAP-13](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-13.md)

## Access and revenue

Use the existing independent Trading Terminal passes and countdown. The current commercial settings remain 24h 1.50, 7d 10.50 and 30d 45 USDT/USDC, adjustable through the existing environment-backed catalog. Do not restore the removed report/terminal bundle or invent an additional rule subscription.

Users pay for retained data, continuous condition evaluation, private workspace, position monitoring and useful notifications. Public rule inspection and publication cost treatment need a separate reviewed product decision; this proposal does not charge an author fee or promise creator revenue. Pass expiry stops paid monitoring while retaining the user's records and original rule versions. A published public circuit remains independently inspectable.

## Delivery plan and review gates

1. **Approve this workflow and initial templates.** Produce an interactive, clearly labeled prototype using actual terminal components and the real retained historical examples. No new production navigation or payment activation is needed for that review.
2. **Verify protocol support.** Build the bounded compiler/evaluator spike and perform independent read-only X Layer parity checks. Present supported features and measured limits; do not bypass an unsupported operation with a decorative circuit read.
3. **Deliver one complete private rule.** Entry review and a position risk warning, source-aware preview, retained evaluation, pause/expiry and wallet-linked Telegram integration. Begin with the minimum supported circuit feature set.
4. **Publish one reviewed reusable program.** After an explicit publication review, deploy/register the real program, verify it back from X Layer and demonstrate its behavior. Private parameter values and journal records stay private.
5. **Add reusable templates and portability.** Fork/review/version workflow, then a signed external feed only if its additional value and X Layer support are established.

This is design work. Product implementation and public publishing start only after approval of the selected scope; no transaction or spending is requested here.

## Acceptance and useful demo

Core acceptance:

- A beginner can create a rule from a real chart level or position without writing code or choosing another global market.
- Same version, parameters and observations give the same result in browser/server replay. Supported public vectors match actual X Layer read-only evaluation.
- A changed rule condition demonstrably changes the circuit outcome for the same observations.
- A source gap, stale quote, incomplete session, missing OI history, duplicate candle or reordered observation cannot produce a positive unsupported result.
- A later candle remains necessary for an ordered-stage requirement; refreshing a screen cannot substitute for it.
- A hard-stop warning cannot be vetoed by an unrelated indicator. A missing price source is visible as unknown.
- Forking or publishing version 2 cannot change an active version-1 instance.
- Telegram links to the correct wallet, exact subject and evaluation; global/per-rule pause and expiry stop delivery as described.
- Desktop and mobile work in all five actual themes. Every important event has a clear explanation, time and next action.

Three-minute demonstration:

| Time | Show |
| --- | --- |
| 0:00–0:25 | A real trader's problem: several conditions and a position to monitor, not another static chart |
| 0:25–0:55 | Build a readable rule from an actual value-area level or journal position |
| 0:55–1:25 | Genuine retained historical observations: conditions differ, missing evidence is visible, and later candles change the state |
| 1:25–1:55 | Inspect the actual published X Layer circuit and compare a public evaluation with the retained local result |
| 1:55–2:20 | Change one condition in a new version; same source inputs produce a different explained outcome |
| 2:20–2:45 | Follow the reviewed version; show a controlled, labeled alert workflow and position review link |
| 2:45–3:00 | Target users, existing pass prices, why monitoring is useful, and the exact Tapeout contribution |

Historical replay must remain labeled throughout. Report only what was actually executed and observed. A future live demonstration requires genuine current data and explicit handling of message delivery, not simulated activity presented as real.

## Official event fit, checked 6 November

The official page requires relevant Tapeout/X Layer integration, an accessible product and a clear user/revenue explanation. It permits existing processors; existing projects must identify substantial new work. Its listed submission deadline is **7 December 2026, 23:59 UTC**, explicitly provisional. The proposed builder, executable rule program and versioned following workflow are the new-development scope; they remain proposed until built and demonstrated. Eligibility and judging remain with the organizers, and no award or profitable trading result is guaranteed. [Official Build X Series requirements and FAQ](https://web3.okx.com/xlayer/build-x-series)
