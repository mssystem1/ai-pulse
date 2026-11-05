# Trading Terminal workflow follow-up — 5 November 2026

This follow-up covers the additional workflow review and requested pass countdown. Dates in captured market evidence are UTC; 20:00 UTC on 4 November is 5 November in Europe/Samara. The original [funded acceptance](TRADING_TERMINAL_ACCEPTANCE_2026-11-04.md) remains the receipt and initial implementation record.

## Corrected workflow defects

- Follow review retains the exact reviewed owner, market, timeframe, report and setup version. A background poll cannot switch the confirmation to another plan. Changing owner or market context closes the review; the server still rechecks the original opportunity before saving.
- Market → My positions/Alerts & activity → Market retains the chart instance and zoom. Hidden zero-width observations do not reset the range. Owner changes still clear the private workspace.
- An observed entry-area touch keeps the priced plan visible but no longer invites a new entry on that opportunity. It is an observation, not a verified fill; actual fills belong in the journal.
- Conflicting opening fills under one journal request ID return `409` before any write. An identical retry remains idempotent after later partial closes or protection changes. Capacity errors also return `409`.
- Renewal during an asynchronous expiry check cannot publish a false expiry or cancel valid queued monitoring events. Already queued expiry messages are suppressed after renewal.
- A mark preceding the latest effective journal event cannot trigger newly recorded protection. Late recording of a backdated fill uses its actual execution time, not the later recording time.
- An expired or superseded worker lease cannot replace a newer mark, advance state, publish events or claim notifications.
- Spot and perpetual position marks retain a source quote cursor independently of the currently displayed mark. A source outage can clear an unavailable current mark without erasing the last accepted timestamp and price. A later worker cannot rewind that timestamp or accept a conflicting price at the same source instant to trigger protection. Reading the identical quote again does not repeat its target alert; a genuinely newer quote can advance monitoring.
- Price-policy confirmation alerts identify the completed event separately from entry qualification, blockers and payoff. The UI preserves the event key for history compatibility while displaying “Price policy confirmed.”
- Pass cards retain the catalog's exact precision through six decimals. A configured price of `0.000001` cannot display as zero.
- All three price settings reject amounts below `0.000001`, including tiny positive values that would otherwise round to zero payment units. The configuration regression checks every pass duration and accepts exactly one payment unit.
- The Terminal footer opens `/docs#docs-trading-terminal` directly. The landing page explains the visible access countdown and explicit renewal; English and Chinese guide text describe each tool's own source window and current order-book coverage.

## Questions about a selected tool

Tool questions retain the selected Spot/perpetual stream and exact completed footprint bucket. Each displayed tool capture has an owner-scoped `evidenceSnapshotId` independent of the priced setup version: one setup version can legitimately have several newer tool captures.

The server retains the tools-only capture for one hour, verifies its content hash, and checks owner, market, timeframe and optional setup version before using it. A missing capture or selected bucket returns `409` before consuming an AI question. A newer current snapshot does not replace the selected source. Current qualification and selected historical evidence stay separate in the explanation.

Selected footprint context includes its own totals and up to 32 highest-volume price rows, with explicit row coverage. Omitted cells remain unknown. The current overview's two latest footprint buckets are not substituted for an older selected candle.

## Access countdown

The requested countdown uses the recorded access expiry for the purchased 24h, 7d or 30d pass. Price environment variables configure purchase amounts; changing a price cannot restart an already purchased period.

The private workspace/access responses supply `serverNow` sampled at the same instant as access status. The browser anchors that clock to monotonic elapsed time, displays days/hours/minutes/seconds and uses the same time for its paid-control gate. Renewals preserve the continuous access expiry rather than starting a fresh display-only period. The server remains authoritative for access enforcement.

The header and Portfolio card identify the currently running grant and display continuous remaining access, including already purchased renewals. Reopening the workspace retains its original expiry. The timer updates once per second, resynchronizes on return to the tab and uses `role="timer"` with `aria-live="off"`. Expiry disables paid actions, including submission of journal/Radar forms opened earlier; the Follow review closes or disables its submission. Readable journal records do not become exchange orders.

The connected browser run observed the original grant counting down from 29,526 to 29,525 seconds. Reauthentication after reload showed 29,496 to 29,492 seconds at the same `2026-11-05T05:22:46.446Z` expiry; there was no new purchase or display-only restart.

## Mobile layout correction

Screenshot review of the connected run exposed intrinsic grid sizing that allowed Terminal children to extend beyond a 390px device even though the outer workspace fit. The heading description extended to approximately 483px, the third view tab to 615px and the market button to 607px. The earlier document-overflow check did not establish that each control was visible.

The Terminal now constrains its grid column to `minmax(0, 1fr)`, bounds the retained market pane and heading text, and lets the three local view tabs and input/button row shrink within their available width. The existing PULSE header and navigation are preserved.

The updated Chrome regression checks each element's actual bounding rectangle against the fixed 390px device width, rather than relying on `innerWidth` or document scroll width alone. In both Clarity and dark themes, the description ends at 382px, the three tab edges at approximately 131px, 254px and 376px, the input at 258px and View market at 368px. The description wraps, and all three tabs and both market controls remain visible.

## Verification record

- Final enabled API suite: 474 tests total, 473 passed and one optional Redis TCP/Lua test skipped; API build passed.
- Final web suite after countdown and expiry guards: 243 passed. The production web build passed again after the mobile CSS correction.
- Release configuration suite: 13 passed after the payment-unit floor correction; configuration build passed. Market suite: 42 passed. Payments suite: 39 passed. The final web production build also passed after the guide-link and bilingual content updates.
- Shared domain suite after the observed-entry wording fix: 70 passed.
- Selected-tool HTTP regressions: eight passed, covering polling, old bucket/stream selection, owner isolation, content hash, expiry and rejection before AI quota.
- Monitoring regressions: 12 passed, including controlled asynchronous renewal, protection, source quote cursor and lease races.
- API access-clock regressions: six passed, covering server time, exact expiry and recorded renewals without changing stored workspace revisions for clock metadata.
- Final deterministic Chrome DevTools workflow checks: 14 passed, nine screenshots, zero runtime errors. These used clearly synthetic localhost owner/pass/market/AI fixtures, with external browser requests blocked before I/O. They include strict 390px element bounds in both themes, chart zoom, pinned Follow/tool evidence, exact catalog prices, real-time countdown, browser wall-clock skew, reload, foreground server resynchronization, stacked grants and pre-opened form expiry.
- Connected current-source acceptance completed at 21:11 UTC on 4 November: 29 checks passed, including 17 browser checks. The previously purchased Base pass was reused; no new purchase was requested. Chart zoom through source refresh and both Terminal tab transitions passed against the actual local API. The real countdown, reload at the same grant expiry and Portfolio countdown also passed. This functional run preceded the final mobile CSS correction described above.
- Independent technical audit across BTC 15m, 1H, 4H, 1D and 1W passed. Same-source definitions, risk prices and clocks remained bound; an already `entry_observed` opportunity was not offered as a new fill.
- Final connected read-only Chrome layout probe passed after the mobile CSS correction: seven checks, four screenshots and zero runtime errors. The real API and original Base pass were used at 1440px and 390px in both themes. Fixed-width bounds confirmed the countdown, description, all three local tabs and both market controls were visible. The original grant counted down from 28,216 to 28,215 seconds. The private runner needed an absolute Chrome profile path; its initial startup failure was corrected before this successful check.
- Final public Chrome guide-navigation check: three checks passed, two screenshots and zero runtime errors. Clicking the Terminal footer opened its own guide article with the current `1.50 / 10.50 / 45.00` catalog prices and countdown/renewal instructions, at desktop and mobile widths. This later check ran after the original pass expired; it used no wallet signature or payment. The earlier paid-access checks remain the dated evidence for active-pass behavior.

The latest captured plans still offered less than 1R to their nearest obstacle. This technical validation does not establish attractive entry conditions, a win rate or profitability. No strategy was changed to manufacture a successful result.

## Evidence and scope

Local evidence is under `.tmp/terminal-base-acceptance/`, `.tmp/terminal-workflow-regressions/` and `.tmp/terminal-monitor-review/`. The earlier 13:18 UTC snapshots/browser evidence are preserved separately under `.tmp/terminal-acceptance-1318/`.

Final API output is in `api-countdown-final.log`. Connected functional checks are in `validation.json` and `browser/validation.json`; the later strict layout check is in `browser/layout-validation.json`, with `layout-*-countdown.png` screenshots. The independent five-timeframe audit is in `final-independent-audit.json` and `FINAL_MARKET_AUDIT.md`. The deterministic browser record is `.tmp/terminal-workflow-regressions/validation.json`.

Release follow-up evidence is in `config-price-floor-final.log`, `supporting-release-tests.log`, `web-release-final-build.log` and `browser/guide-release-validation.json`.

Only one real 1.50 USDC Base Terminal purchase was made: transaction `0xc53667c601dd8806eade5c883a2ac7cb53b35012abb1ef852d3a6ccf913314ac`, block `53490211`, activated `2026-11-04T05:22:46.446Z`, expiring `2026-11-05T05:22:46.446Z`. The receipt remains documented in the first acceptance record. This follow-up reused that grant and made no new purchase.

Journal fixtures are QA records, not exchange orders. No live Telegram messages, deployment, push or recurring payment was performed. Physical iOS/Android, production HTTPS routing and deployed worker operation remain separate validation boundaries.
