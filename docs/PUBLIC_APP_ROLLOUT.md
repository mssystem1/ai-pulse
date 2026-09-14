# Public website and application rollout

This guide is for the owner’s manual deployment. Local implementation does not configure DNS, change Telegram, push GitHub commits, deploy Vercel/Railway, or move funds.

## Addresses and preview

| Address | Purpose |
| --- | --- |
| `https://www.ai-pulse.tech/` | Public product landing, when enabled |
| `https://app.ai-pulse.tech/portfolio` | Canonical application home |
| `/overview` | Compatible old Portfolio route; normalized to `/portfolio` |
| `/landing` | Explicit landing preview, including localhost |
| `/portfolio?legacyRecovery=1#reports` on the old host | Original-browser recovery handles |
| `/shared-report#share=…` | Read-only shared report, retained on its original host |

Both domains may serve the same frontend build. The `app.ai-pulse.tech` root always opens the application. Existing product paths on the old host keep working in place so browser-local report handles and Telegram delivery contexts are not stranded by a forced cross-origin redirect. Canonical metadata points to the new app routes. Recovery tokens are never copied into a cross-origin URL.

Local preview uses the existing Vite port, for example `http://127.0.0.1:5178/landing` and `/portfolio`. Launch-app links stay local on localhost and Vercel preview hosts. The landing and application offer Pulse, Clarity, Midnight and Horizon appearances. Only an allowlisted `pulseTheme` preference crosses the Launch-app link; wallet state, report tokens and arbitrary query parameters do not.

## Manual deployment order

1. Deploy the API changes to the existing Railway API. Keep its service URLs, payment endpoints and agent identity unchanged. Check `GET /healthz` and `GET /v1/public/activity` without a wallet or payment header.
2. Add `app.ai-pulse.tech` to the frontend deployment and configure the DNS records shown by the hosting provider. Do not infer DNS targets from this document. Wait for valid HTTPS.
3. Configure these **frontend build variables**, then rebuild:

   ```dotenv
   VITE_APP_ORIGIN=https://app.ai-pulse.tech
   VITE_PUBLIC_LANDING_ENABLED=0
   VITE_API_URL=https://pulse-api-production-7aae.up.railway.app
   ```

   Use the actual API origin if it differs. The repository’s catch-all SPA rewrite is not an API proxy: a production frontend must not point API requests at its own HTML fallback. Never put Redis, Blob, Grok, Telegram secrets or private wallet keys in `VITE_` variables.

4. Verify `/portfolio`, `/overview`, `/global`, `/prediction`, `/safety`, `/spot`, `/autopilot`, `/telegram`, `/docs`, and an existing shared report on the new and legacy hosts. AppKit metadata uses the current origin. If the wallet provider enforces an origin allowlist, add the new app origin in that provider’s dashboard before wallet testing.
5. Reconnect the original report-paying wallet on the new origin. In Portfolio, expand **Recover wallet-owned reports**, choose Global or Prediction, and use **Sync with wallet**. This is a report-access signature, not another purchase. Device-only handles remain available through the original-site recovery link. Never delete old browser storage as part of migration.
6. Check Telegram’s configured Mini App URL and BotFather web-app/menu destinations. Change them manually to the app origin only after app/recovery checks pass. Existing report share links and Railway endpoints remain valid. Test a real Telegram launch/delivery link rather than stripping its query or fragment.
7. Enable `VITE_PUBLIC_LANDING_ENABLED=1` and rebuild after accepting the preview. The public root now shows the landing; `/portfolio` and legacy product links remain operational. Check all four appearances, mobile navigation and Launch app again.

Rollback: set `VITE_PUBLIC_LANDING_ENABLED=0` and rebuild. This restores the public root’s application entry without deleting application state or changing the API/payment domains.

## Public statistics: evidence and storage

`GET /v1/public/activity` returns platform-wide aggregates. It ignores wallet/network filters, requires no wallet session/payment, caches aggregate reads for 60 seconds and may serve an explicitly stale snapshot for at most one hour during storage failure. No wallet addresses, report bodies or recovery capabilities are exposed. It does not scan chains, invoke AI or enumerate jobs for each landing visitor.

- Global, Prediction and Risk Guard are separate research totals. X Layer, Base, Arbitrum and Arc Testnet analyses contribute, with a mainnet/testnet chain breakdown. Genuine developer testing is included; this is not evidence of independent customer adoption.
- A delivered report counts once under its original chain/payment identity. Retries, recovery reads, renamed/migrated report files, mock settlement and synthetic fixture reports do not add deliveries. Partial deliverables count once and are identified.
- Risk Guard delivery tracking begins with this version. Older inline Risk Guard reports had no durable job-delivery index; do not invent a historical count from a cache or browser history.
- Spot and Autopilot execution totals are separate. Server-reconciled fills are projected in bounded background batches from account activity reads. Account-based executions require matching PULSE factory discovery. Confirmed transactions are deduplicated across journals. Historical totals can grow as older fills are reconciled; missing evidence is not zero lifetime volume.
- Volume uses exact settlement-token quantities and is displayed in human units by chain/asset. No dollar conversion or combined return is implied. Report payments, vault funding, withdrawals, approvals, failed executions and Arc Testnet analyses are not trading volume.
- An active-Autopilot headline is intentionally not published without a fresh platform-wide runtime inventory. Created/funded vaults are not automatically running strategies.

Aggregate records live in the existing namespace under `public-activity:*:v1` in Railway Redis. Identity hashes and aggregate fields are retained independently of expiring job records. Existing encrypted report bodies remain in Blob. No additional database subscription is introduced. Memory-mode results are development-only and the public UI does not advertise them as production activity.

### Historical research backfill

After deploying, an operator can inspect surviving, checksum-verified live Global/Prediction reports. The command is **read-only by default** and prints aggregate counts only:

```powershell
npx tsx apps/api/src/publicActivityBackfill.ts
```

Inspect `scanCompleted`, excluded and unverifiable counts. Records with missing reports or fixture/unknown analysis profiles remain excluded. To publish the verified projection into the configured durable PULSE namespace:

```powershell
npx tsx apps/api/src/publicActivityBackfill.ts --write
```

This writes aggregate facts, never overwrites jobs, never moves funds and is idempotent with the live delivery path. Confirm the resolved Redis destination and PULSE namespace in the environment before `--write`; do not paste credentials into chat or command output. The scan is bounded to 500 pages / 50,000 examined records and never claims complete lifetime coverage. It cannot reconstruct already deleted history or old inline Risk Guard deliveries. Do not run it as a request-time landing-page operation.

For migrated PULSE history spread across namespaces, explicitly name each source and the live destination. Preview first, then repeat with `--write` after checking the counts:

```powershell
npx.cmd tsx apps/api/src/publicActivityBackfill.ts --source-namespace pulse:local --source-namespace pulse:production --target-namespace pulse:production
```

Use the actual deployment namespace, not a new name. Source jobs and report bodies stay in their original namespaces. Only receipt-verified public aggregates are published in the target. Original payment identities deduplicate across namespaces, including genuine live developer tests; fixtures and unsettled receipts remain excluded. Cross-namespace writes require an explicit `--target-namespace`.

Spot history includes legacy direct-wallet fills, protected market buys and confirmed protected limit entries. The activity source label alone is not trade evidence: server reconciliation must verify the successful receipt, approved router or owner-matched PULSE account, net token transfers and block time. Funding, approvals, withdrawals and failed/cancelled orders never become trading volume.

### Arc mainnet readiness

The statistics model records chain identity and environment separately. Do not rename the existing Arc Testnet bucket into mainnet on a calendar date. Verify official network configuration, payment contracts and PULSE service deployment before adding Arc Mainnet. New mainnet activity joins the aggregates as a separate bucket; old testnet analyses remain visible and labeled. Mainnet availability alone does not enable Spot/Autopilot routes.

## Verification commands

Run the test suite with an isolated environment (`PULSE_SKIP_DOTENV=1`, `NODE_ENV=test`, `QUEUE_PROVIDER=memory`, empty Redis/KV URLs and tokens). Then run:

```powershell
npm test -w @pulse/web
npm test -w @pulse/api
npm run build -w @pulse/web
npm run build -w @pulse/api
node scripts/landing-ui-check.mjs
node scripts/product-ui-check.mjs
node scripts/autopilot-ui-check.mjs
node scripts/product-state-ui-check.mjs
node scripts/app-shell-ui-check.mjs
```

Browser scripts use localhost port 5178 and `PLAYWRIGHT_MODULE` if Playwright is installed outside the repo. They intercept external calls with deterministic fixtures and do not use real funds. Screenshots are local review artifacts, not public evidence of trading performance. Post-deployment wallet/payment/on-chain acceptance remains a separate owner-authorized check.

For a production-bundle check, run `npm run preview -w @pulse/web -- --host 127.0.0.1 --port 5190 --strictPort` after building, then `node scripts/landing-build-check.mjs`. It measures the local landing response sizes and verifies that no application, wallet or report bundle/private endpoint is loaded. It is not a Lighthouse or mobile-network benchmark.

The optional `apps/api/src/publicActivityRedis.test.ts` runs only when `PUBLIC_ACTIVITY_REDIS_TEST_URL` names an unauthenticated loopback Redis test server. It creates a random test namespace and deletes only its own five keys. Never point this test at production. The local Redis-compatible/Lua run checks command semantics and a new reader, not disk persistence or Railway availability.

## Local acceptance record — September 13, 2026

- Web unit suite: 74 passing. Coverage includes canonical routes, safe theme preferences, report isolation, pass checkout sequencing, incomplete PnL, partial fills, recovery and payment validation.
- API suite: 194 passing, one optional loopback test skipped in the normal isolated run. The loopback Redis-compatible/Lua test was then run separately and passed concurrent deduplication, exact volume arithmetic and cold-reader checks. No Railway database was used.
- Full app shell: eight routes × four appearances × four widths (360/390/768/1440), with additional focused checks after layout edits. No document overflow or uncaught render exception. Keyboard sheet navigation, Docs topic isolation and appearance/network independence checked.
- Landing: all 16 appearance/width combinations, original graphics, reduced motion, keyboard skip/focus, scoped CTA, blocked preference storage, malformed statistics and unavailable-state checks passed. Missing activity is not rendered as zero.
- Product browser regression: 18 desktop/mobile cases covering guides, Telegram online/offline states, Portfolio, candle charts/history/zoom and shared/revoked reports. Expected provider-error fixtures do not crash the page.
- Account workflow browser regression: eight desktop/mobile cases, including returning Autopilot accounts, existing versus new setup, restoring account controls when leaving setup, local shortlist expansion, and report-to-Spot pair/level handoff followed by direct pair selection.
- Portfolio recovery/context: both widths passed exact selected-report retrieval with a header-only capability and no payment request, focus restoration, actual human-unit allocation, and rejection of delayed old-wallet/network data.

Both production builds pass. Existing third-party wallet bundle/annotation warnings and an unused Tempo-action export warning remain; Tempo is not a supported PULSE network. Wallet and application chunks are isolated from the public landing. The local cold-browser landing check observed roughly 132–184 KB of encoded JavaScript response bodies across preview runs (compression varied), with no wallet/private-account requests. This is a scoped engineering measurement, not a claim about public network performance.

Not performed: deployment, DNS/provider configuration, production statistics backfill, real wallet signing, real payments or trades. Preview the design, then follow the manual rollout and recovery checks above.
