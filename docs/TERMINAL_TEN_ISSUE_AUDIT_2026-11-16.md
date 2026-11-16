# Trading Terminal: ten issues

The agreed scope is **10 issues**. Changes are local until deployed. Local code cannot restore a suspended Railway subscription.

| # | Issue | Change |
| --- | --- | --- |
| 1 | Missing candles/data | Primary-clock overview; explicit original-time execution inspection; no invented OHLC; exclude unconfirmed inputs. |
| 2 | BTC/XO reports and entries | Supplied report audit, prominent NO ENTRY, geometry-aware core/event selection, explicit passive limits. |
| 3 | Tapeout value and creation references | Exact-core recommendations during creation; portable financial graphs and actual TAP-02 numerical execution. |
| 4 | Pass expiry | Pause monitoring and Telegram, cancel queued alerts, recheck before send; explicit resume after renewal. |
| 5 | Redis/Railway usage | Due-time owner queue, bounded batches, no overlapping polls, failure backoff and emergency background pause. |
| 6 | Creation/server errors | Typed recoverable source failures, accepted language query, offline drafts and client errors for invalid formulas. Original deployed 500's precise cause remains unconfirmed. |
| 7 | Indicator chart problems | Price overlays, compatible shared panes, publisher headers, fewer repeated markers and primary/micro clock switch. |
| 8 | Publisher names | Required in both builders; visible in catalog, library, chart, purchase review and receipts. |
| 9 | Professional builder | Visual dataflow, bounded scripts, EMA/SMA/RSI/ATR/bands, ordered conditions, six templates and multiple outputs. |
| 10 | Purchases/My indicators | Exact payment review; created/published/installed/purchased tools in My indicators; original-version restore after delisting. |

## Resource controls

```dotenv
FEATURE_TRADING_TERMINAL=1
TERMINAL_BACKGROUND_PAUSED=0
TERMINAL_MONITOR_BATCH_SIZE=25
TERMINAL_MONITOR_INTERVAL_MS=60000
TERMINAL_HISTORY_POLL_MS=60000
TERMINAL_HISTORY_BOOK_SAMPLE_MS=60000
```

Set `TERMINAL_BACKGROUND_PAUSED=1` in deployment environment to stop automatic Terminal monitoring/history collection during the service limit. Manual requests remain available if the API is running. This neither changes billing nor erases records. After restoring service on/after November 20, set it back to 0. Genuine source gaps remain unknown until collected.

Browser workspace reads run every 60 seconds, visible ticker/forming candle every 15 seconds, and assessments every 120 seconds. Sequential polling backs off on failure up to 15 minutes. Workspace reads do not force repeated monitoring evaluations. Idle and handled-expired owners leave the recurring queue. Book collection respects its configured sampling cadence.

## What Tapeout supplies

A circuit ID identifies a numerical circuit within a specific processor on X Layer (196). The indicator also needs its publisher/version, input units, graph/script and plot definitions. Creation recommends an existing reference only if netlist bytes and bit ports match. The API verifies the reference against chain data before marking the listing verified. Registration is optional for local chart use.

The ecosystem contribution is a portable financial-tool format, authoring UI and compatible standalone host. Another Tapeout application can import the calculation and provide its own real market data without copying a PULSE report. `tap_delta` executes the bundled NAND circuit. Rolling calculations and state transitions are explicitly host operations; pure price graphs cannot borrow an unrelated flow registration. Paid installation receipts and circuit registration are separate.

[OKX's TapeOut Accelerate requirements](https://web3.okx.com/xlayer/build-x-series) call for Tapeout circuits/contracts/onchain data on X Layer or X Layer DeWEB. Existing verified cores, actual TAP-02 execution and the portable-host demonstration provide concrete integration evidence. They cannot guarantee a prize. This is a bounded financial studio, not full PineScript or MMT parity.

## Validation

Validated locally before commit with FEATURE_TRADING_TERMINAL=1:

- API: 543 passed, one intentionally skipped (544 total).
- Domain: 131 passed; web: 334 passed; analysis: 398 passed.
- Total: **1,406 passed, one skipped** across those suites.
- Chrome: **18 desktop/mobile workflow checks**, zero runtime exceptions. Includes initial-source failure, draft saving without source data, retry, script dirty guard, six templates, real chart outputs, publisher labels, creation-time core recommendations, exact Base USDC purchase review/cancellation, My indicators, illustrated docs and landing copy. Hidden Market Tools made zero session/collection requests in these unrelated views.
- Final follow-up: 149 Terminal/scenario checks rerun after legacy-expiry migration, explicit-resume scheduling and current-quote stop-breach changes; all passed.
- API and production web builds passed. Portable host parity and stateflow-gap tests passed. Third-party bundle-size/comment warnings remain informational.

Reproduce the offline workflow from repository root:

```powershell
npx.cmd tsx --tsconfig tsconfig.base.json scripts/audit-terminal-workspace-offline.ts
```

The committed fixture contains public market inputs only; report text, wallet identity, access capabilities and journals are excluded. The script derives a historical analysis locally, never a fresh paid report. It signs only a local owner-login message. Run it with the configured TEST_WALLET_ADDRESS/key; never print that key. Evidence is written under `.tmp/terminal-offline-audit/`.

Remaining acceptance limits: Railway availability/billing and a new live funded checkout have not been verified in this revision. Existing X Layer circuit registrations and earlier real Base receipts are retained historical evidence. The exact original deployed 500 exception did not reproduce; recoverable source failures and the actual UI/API language-query mismatch are covered. The BTC audit diagnoses geometry and execution, not a verified replacement-strategy win rate. The offline browser audit uses TEST_WALLET_ADDRESS identity, genuine captured BTC input and an explicitly simulated Base 24h/1.50 USDC pass. It does not call Railway/Redis, generate paid reports, send Telegram or trade. Earlier funded receipts are historical evidence, not a new funded checkout for this revision.


Resource detail: hidden Market Tools no longer launch 15-second session reads or automatic 30-second collection batches. Visible retained views read every 60 seconds with backoff; explicit collection is a user action. With `TERMINAL_HISTORY_BOOK_DEMAND_ONLY=1` (default), the independent book worker samples only markets requested in the last fifteen minutes. Set it to 0 only for deliberately budgeted continuous collection across configured markets. Missing periods remain unknown; neither mode fabricates history.
