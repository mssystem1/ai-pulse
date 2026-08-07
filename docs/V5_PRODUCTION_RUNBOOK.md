# PULSE V5 production runbook

## Release order

Ship additively and keep every new payment route disabled until its gate passes.

Before an X Layer canary, run the non-secret facilitator routing diagnostic from the repository root:

```powershell
node scripts/okx/probe-facilitator-routing.mjs
```

It prints only origin, path, HTTP status, OKX business code/message, and whether a data envelope exists. It never prints credentials, signed headers, or provider data. A successful `/api/v6/pay/x402/supported` response is required before attempting a paid canary.

Before enabling Polymarket analysis, build the market package and run the live public-provider readiness probe:

```powershell
npm.cmd run build -w @pulse/market
node scripts/v5-polymarket-live-readiness.mjs
```

The gate requires a stable Gamma condition/outcome-token mapping plus successful CLOB order-book and history reads. Data API open interest is reported separately because it is optional enrichment and may legitimately be unavailable for a market.

1. Merge registry, schemas, Polymarket read clients, fixtures, and metadata with X Layer compatibility tests green.
2. Deploy the API with `ENABLED_NETWORKS=xlayer`, all new payment flags off, `ARC_AI_MODE=fixture`, and durable Upstash/Vercel Blob persistence configured.
3. Deploy the web app with `VITE_ENABLED_NETWORKS=xlayer`; run the legacy REST, MCP, wallet, and paid-replay canary.
4. Enable Polymarket discovery and V5 services on X Layer. Verify explicit selection, `202` delivery, refresh recovery, normalized receipt, private report, and both automatic regeneration attempts.
5. Enable Base only. Verify CDP challenge fields, native-USDC balance, in-app ETH→USDC quote/simulation, one controlled settlement, Bazaar extension response, and catalog appearance.
6. Enable Arbitrum only after repeating the Base gates with Arbitrum native USDC.
7. Enable Arc Testnet with `ARC_AI_MODE=fixture`. Verify wallet USDC, Gateway available/pending balances, approval, deposit finality, Circle batch payment, and fixture delivery. Change to `live` only after xAI prices and cost alerts are configured.

## Alert installation

Load `ops/pulse-alerts.yml` into the Prometheus-compatible ruler used by the deployment and route `severity=critical` to the release on-call owner. Before rollout, validate the exact file with `promtool check rules ops/pulse-alerts.yml`. The rules cover API availability, HTTP/provider error ratios, provider/network settlement failures, settled-job backlog, terminal/manual reconciliation, and 24-hour estimated AI cost. Replace the `$4/$5` warning/critical thresholds if `ARC_LIVE_DAILY_COST_LIMIT_USD` is changed; the application-side Arc limit remains the fail-closed enforcement boundary.

An alert configuration file in Git does not configure an external notification destination. The release owner must prove one test notification reaches the selected pager/chat channel before enabling a second payment network.

Run `npm run readiness:upstash` against each deployment's server-side environment. It uses a random isolated namespace, proves atomic receipt enqueue, worker claim, lease heartbeat, atomic completion linkage, acknowledgement, and an empty final queue, then deletes only the exact temporary keys it created.

Run `npm run readiness:blob` to prove a private Blob write, authenticated read, and checksum match. The probe deletes only its random temporary object in a `readiness/` prefix.
8. Enable `BAZAAR_DISCOVERABLE=1` only for a deployment that uses CDP verify and settle. Indexing occurs after successful settlement, not after verify.

## Required gates per network

- Correct CAIP-2 chain, payment contract, decimals, payee, price, resource URL, and enabled feature flags.
- Wallet switch and return tested with OKX Wallet, MetaMask, Rabby, WalletConnect mobile, and Base Account where supported.
- Insufficient-payment-asset and insufficient-gas paths tested without signing.
- Quote transaction target/data/value validated and simulated; native USDC output contract confirmed.
- One operator-approved minimum-value settlement with receipt and report recovery evidence.
- `/healthz`, `/metrics`, `/v1/metadata`, `/mcp`, paid GET discovery, free Polymarket endpoints, and job polling return expected status.
- Error rate, p95 latency, job age, failed settlement, partial context, regeneration, and estimated AI cost dashboards are healthy.

## Alerts

- Page: payment settled without completed/partial report for 10 minutes.
- Page: settlement failure rate over 2% for 10 minutes or receipt/job mismatch at any time.
- Warn: provider 5xx/429 over 5%, p95 paid acceptance over 3 seconds, or report completion p95 over 120 seconds.
- Warn: partial Polymarket context over 10%, any manual reconciliation, or AI daily estimated cost above the operator budget.
- Warn: Upstash/Blob configuration unhealthy, report checksum failure, or enabled network missing a payment adapter.

## Rollback

Disable only the affected network flag and remove it from `VITE_ENABLED_NETWORKS`; do not alter legacy prices or routes. Preserve Upstash jobs, receipts, idempotency keys, and Blob reports. Keep recovery reads online until the retention window expires. Roll back the web deployment first if signing UX is unsafe; roll back the API only after confirming no settled jobs remain unfinished.

## Post-deploy commands

```powershell
npm.cmd test
npm.cmd run build
curl.exe -fsS https://API_ORIGIN/healthz
curl.exe -fsS https://API_ORIGIN/metrics
curl.exe -fsS https://API_ORIGIN/v1/metadata
curl.exe -i -X POST https://API_ORIGIN/base/v1/analysis/prediction/standard -H "Content-Type: application/json" -d '{"primaryMarketId":"pm:REPLACE","additionalMarketIds":[],"lang":"en"}'
```

Record wallet/provider versions, timestamps, transaction hashes, receipt IDs, job IDs, report checksums, and Bazaar `EXTENSION-RESPONSES` status in the private release evidence. Never record a private key or payment signature.
