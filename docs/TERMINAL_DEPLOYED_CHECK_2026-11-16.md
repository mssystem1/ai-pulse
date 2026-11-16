# Terminal deployment check — November 16, 2026

The deployed web app contains the updated eight-section Terminal, six-template Visual & Script Studio, My indicators, public Indicator Market information and illustrated guides. This check continues the [ten-issue audit](TERMINAL_TEN_ISSUE_AUDIT_2026-11-16.md); it does not establish trading profitability or complete live funded acceptance.

## Live findings

- `app.ai-pulse.tech` serves the new Studio and My indicators. A draft was created locally with its publisher, reopened, edited as a script and compiled. Uncompiled edits disabled saving. Applying without an active workspace remained disabled.
- The app's indicator creation guide and its three example images loaded at 390px width. The Studio and library had no page overflow at 390px or 1440px.
- `www.ai-pulse.tech` explains Indicator Market and links to discovery and creation in the app.
- The deployed catalog reports `grok-4.7`, X Layer USDT0, Base USDC and Arbitrum USDC, with the 60-second Terminal monitor interval. A listed payment route is not proof of a new settlement on that route.
- Public Railway HTTP routes respond, but the TEST wallet's `POST /v1/terminal/auth/challenge` returned **503 / KV_TEMPORARILY_UNAVAILABLE**. Passive `/healthz` status subsequently confirmed the native Redis connection was **degraded**. Billing was not established as the cause of the connection failure.
- Signed workspace reads, current live chart execution and new funded purchases could not be completed through this deployment. No payment, trade, Telegram message or private customer report was requested. The live browser was closed after the checks.

## Follow-up fixes

These changes require another API/web deployment:

1. A storage failure while consuming a challenge or saving a session remains a recoverable service failure. It no longer becomes a misleading 401 “invalid or expired signature.” Genuine invalid signatures still return 401.
2. The public Terminal catalog uses the store's existing connection circuit to disable checkout during a known outage. This status check issues **zero** Redis commands. Opening/syncing the workspace remains the recovery path; successful sync refreshes checkout availability.
3. Client errors explain that private storage is unavailable while local drafts remain usable. Existing credentials and pending payment recovery identifiers are retained.
4. Polling respects the server's retry delay, including foreground-tab events, and resumes its normal cadence after success.
5. App health checks change from every eight seconds to every sixty seconds while visible, serialize requests, time out after fifteen seconds and back off during outages. Hidden tabs make no recurring health requests. The header shows **API limited** when HTTP is reachable but saved workspace storage is degraded; independent public tools remain available.

## Validation and continuation

Local Terminal/API resilience checks: **134 passed**. Focused web request/polling checks: **18 passed**. The final explicit-store/circuit checks: **3 passed**, including one additional passive connection test. API and production web builds passed. The isolated **18-check Chrome workflow** was rerun with real app/API code, captured public BTC inputs and a simulated pass; it uses no Railway, Redis, paid report or payment signatures. Its header check injects a degraded-health response to verify “API limited”; market inputs and calculations remain the real captured fixture.

Recheck the deployed storage before attempting wallet access:

```powershell
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.base.json scripts/audit-terminal-deployed.ts --live
```

This bounded script reads the public catalog and passive health status first. If Redis is degraded/recovering, it stops before authentication or payment. Once storage is available, it validates the exact production-origin challenge and TEST wallet identity, signs only the owner-login message, and reads that wallet's access/catalog/receipts. It never pays. Sanitized evidence is written to `.tmp/terminal-deployed-audit/validation.json`.

Restore the deployed Redis service/connection, then rerun signed workspace and funded purchase acceptance using the original request/receipt if any prior payment is unresolved. Source coverage, expiry suspension and real current chart data require a working durable service; local code cannot restore an unavailable hosting dependency.
