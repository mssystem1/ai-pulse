# PULSE · Circle Agent Marketplace listing

This file is the canonical, copy-ready submission package for Circle's Agent Marketplace intake form.

## Public links

| Field | Value |
|---|---|
| Website | https://www.ai-pulse.tech |
| Repository | https://github.com/mssystem1/ai-pulse |
| API origin | https://pulse-api-production-7aae.up.railway.app |
| MCP endpoint | https://pulse-api-production-7aae.up.railway.app/mcp |
| Machine-readable metadata | https://pulse-api-production-7aae.up.railway.app/v1/metadata |
| OpenAPI specification | https://raw.githubusercontent.com/mssystem1/ai-pulse/main/docs/circle-marketplace-openapi.yaml |
| Logo | https://pulse-api-production-7aae.up.railway.app/brand/logo.png |

The Circle marketplace lists x402 HTTP resources. The MCP endpoint is a complementary JSON-RPC agent interface and is not counted as one of the five marketplace services. The per-vault Autopilot AI Pass is an in-product mainnet execution entitlement, not a Circle marketplace analysis endpoint.

## Form answers

| Field | Value |
|---|---|
| Service Name | PULSE |
| Website | https://www.ai-pulse.tech |
| Primary Service Category | Financial analysis / market intelligence; if unavailable, choose Data & Analytics |
| Number of Endpoints | 5 |
| Pricing Model | Usage-based through x402: Onchain Pre-Trade Risk Guard $0.15, Quick reports $0.20, Pro reports $0.30 in Arc Testnet USDC. Public metadata and paid-job recovery are free. |
| Contact Name | Enter the legal or operational contact responsible for PULSE. |
| Endpoints Documentation URL | https://github.com/mssystem1/ai-pulse/blob/main/docs/circle-marketplace-openapi.yaml |

### Description

PULSE is a focused Analyze → Act intelligence workflow for humans and AI agents. Global Market turns live OKX evidence into Quick or Pro Buy-or-Wait plans; Pro adds Fibonacci, pivots, global Elliott wave paths, DeFi extraction and report-linked Spot/Autopilot actions on supported mainnets. Prediction Market analyzes one explicitly selected Polymarket question read-only. Onchain Pre-Trade Risk Guard adds a separate PASS/WARN/FAIL review. Reports are durable and recoverable. Arc Testnet remains analysis/payment only, so this Circle listing never executes trades.

### Anything else?

PULSE is submitted as an Arc Testnet service using test USDC through Circle Gateway. Arc is clearly identified as a test environment throughout the payment and report lifecycle. Paid analysis is delivered as a durable asynchronous job with authenticated recovery, so a caller can retrieve a settled report without paying twice. Prediction markets are explicitly selected by the caller and reloaded server-side; PULSE uses public read-only evidence and never submits orders. The project also exposes an MCP server for agent clients at `https://pulse-api-production-7aae.up.railway.app/mcp` and source code at `https://github.com/mssystem1/ai-pulse`.

## Published Arc service endpoints

- `POST https://pulse-api-production-7aae.up.railway.app/arc/v1/analysis/spot/standard` — $0.20
- `POST https://pulse-api-production-7aae.up.railway.app/arc/v1/analysis/spot/premium` — $0.30
- `POST https://pulse-api-production-7aae.up.railway.app/arc/v1/analysis/prediction/standard` — $0.20
- `POST https://pulse-api-production-7aae.up.railway.app/arc/v1/analysis/prediction/premium` — $0.30
- `POST https://pulse-api-production-7aae.up.railway.app/arc/v1/preflight` — $0.15

All five declare Arc Testnet `eip155:5042002`, test USDC `0x3600000000000000000000000000000000000000`, the `exact` x402 scheme, and Circle Gateway in public metadata. Fused, divergence, event-risk and execution internals are intentionally excluded from the public service catalog.

The Circle listing must not add Spot execution, Autopilot execution or Autopilot pass purchase as a sixth service. Arc Testnet remains analysis and Risk Guard only; a report may explain supported-mainnet next actions without claiming those actions execute on Arc.

## MCP verification

`GET /mcp` publishes the server and available tool names. `POST /mcp` supports JSON-RPC 2.0 initialization and tool discovery, currently negotiating MCP protocol version `2024-11-05`. MCP tool pricing is generated from the same runtime configuration as REST pricing.

## Submission gate

- Confirm the website, health endpoint, metadata, MCP initialization, and MCP `tools/list` return HTTP 200.
- Confirm the five Arc resources and prices appear under `asp.networkServices` in `/v1/metadata`.
- Send a valid unpaid request to each Arc endpoint and confirm its HTTP 402 challenge declares the exact network, asset, amount, seller, and resource URL.
- Complete one controlled test-USDC payment for each distinct price/payment contract and recover the private report without repaying.
- Confirm the receipt identifies Circle Gateway batch settlement and does not fabricate an immediate on-chain transaction.
- Submit the endpoint URL, payout wallet, description, and published OpenAPI specification through Circle's official intake form.
- Save the submission identifier, approval result, and Discovery API record.

Do not include secrets, recovery tokens, private reports, mock-payment evidence, or an unverified payout address in the submission.
