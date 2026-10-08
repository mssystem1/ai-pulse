# Arc Autopilot #2 dependency recovery — October 8, 2026

Autopilot #2 encountered unavailable Arc execution evidence, then retained that error through later healthy scheduler checks. The correction reduces RPC request bursts, restores the default backup provider, records safe failure details, and clears an obsolete Arc outage after verified recovery. [Sanitized observations and validation](ARC_MAINNET_AUTOPILOT_DEPENDENCY_FIX_2026-10-08.json) distinguish the hosted incident from the corrected local build.

## Observed incident

Public API reads at **17:01 UTC** identified the test owner's second factory account as `0xEE9F3626e81c2cA019bE87C4E5536106Dac7AdC8`. Its BTC-USDT, one-hour strategy was running, individually unpaused, with **1 USDC in settlement funds, zero cirBTC**, and a pass expiring at **16:24:07 UTC on October 9**. Redis was online and its journal was synced. Current public capabilities enabled Arc Spot and Autopilot. The older, empty qualification vault remained individually paused.

The failed journal rows were recorded at 16:39, 16:45, 16:46 and 16:53 UTC. `lastRiskCheckAt` subsequently advanced to 17:00:47 UTC while `lastDecision` and `lastError` still described unavailable Arc evidence. Source inspection and the scheduler regression reproduced the stale warning: an empty target balance and a previously evaluated candle could both return without clearing the prior dependency error.

The old readiness handler discarded the failed endpoint, check stage and transport status. Its original RPC failure cannot be attributed to a particular HTTP status from the retained incident data. Four fresh checks of the original gate succeeded. The audit therefore does **not** claim to have reproduced a historical 429 or an ongoing contract fault.

## Correction

- A complete healthy gate still performs 13 RPC methods, including fresh bytecode, factory references, permissions, global pause and executor-gas evidence. JSON-RPC batching reduces them from **13 HTTP requests to four**. The fifteen binding/permission reads still use one deployless read-only multicall.
- Blank fallback configuration now selects the official mainnet Quicknode backup, consistent with the normal execution clients. An unavailable provider causes a complete recheck on the backup. Explicit wrong-chain, missing-code, wrong-binding, denied-role, paused-registry and insufficient-gas evidence remains blocking.
- The scheduler checks readiness when analysis or risk work is due. Pending signed-transaction recovery still requires fresh readiness even when normal work is not due. Completed permission and pause results are never cached; only simultaneous in-flight checks share reads.
- Provider outages identify the failed stage and safe timeout, HTTP status or RPC-code class. RPC URLs, credentials, response bodies and raw error text are not included in these diagnostics.
- After fresh readiness and vault-state checks succeed, the worker clears only the obsolete Arc evidence error and adds one held recovery event. Existing failure rows remain. Recovery does not consume an AI confirmation, create a trade, change the policy or purchase a pass. Unrelated AI/provider errors are preserved.
- Dashboard notices and latest-journal summaries distinguish an Arc RPC HTTP 403 from an AI provider billing failure. The Arc notice explains that the scheduler will retry and directs the user to the journal. Its Chinese translation is included.

## Validation

All **343 API tests**, **173 frontend tests** and **11 Arc worker tests** passed. The API suite skipped one optional external Redis fixture. The focused readiness suite passed 23 tests covering batching, default fallback, outages, malformed evidence, concurrent callers and explicit negative evidence. API TypeScript and the production frontend build passed.

Six fresh read-only checks of the corrected gate passed: four against the primary Arc RPC and two against the official backup. Each used four HTTP requests. No worker was started against the live vault. Four isolated production-build browser scenarios covered unavailable and recovered states at **390 and 1440 pixels**. They confirmed the Arc-specific notice, preserved failure history, visible recovery event, no render errors or horizontal overflow, and zero signing requests or financial writes. The browser artifact scan checked 236 artifacts against 28 server-secret values and found no leaks.

## Release and limits

**The user must manually release both API and frontend.** This continuation did not deploy, push, submit a transaction, move funds, modify registry pause state or alter the hosted strategy. After release, the next successful due scheduler check can clear the old Arc warning automatically; the existing vault and active pass do not need to be recreated for this correction. A genuine new dependency failure continues to hold execution and appears in the journal with the new diagnostic.

These checks validate dependency recovery, not a new funded Autopilot entry or live risk-worker exit. The remaining signed/mobile acceptance and Circle email-wallet setup requirements in the [migration record](ARC_MAINNET_MIGRATION.md) remain applicable.
