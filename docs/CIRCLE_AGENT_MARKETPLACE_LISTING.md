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

The Circle marketplace lists x402 HTTP resources. The MCP endpoint is a complementary JSON-RPC agent interface and is not counted as one of the four marketplace endpoints.

## Form answers

| Field | Value |
|---|---|
| Service Name | PULSE |
| Website | https://www.ai-pulse.tech |
| Primary Service Category | Financial analysis / market intelligence; if unavailable, choose Data & Analytics |
| Number of Endpoints | 4 |
| Pricing Model | Usage-based, pay per report through x402. Standard analysis costs $0.10 in Arc Testnet USDC; Premium analysis costs $0.20. Public discovery and metadata are free. |
| Contact Name | Enter the legal or operational contact responsible for PULSE. |
| Endpoints Documentation URL | https://github.com/mssystem1/ai-pulse/blob/main/docs/circle-marketplace-openapi.yaml |

### Description

PULSE is independent market intelligence for humans and AI agents. It combines live OKX spot-market evidence with one explicitly selected, read-only crypto Polymarket question and produces structured, recoverable reports. Reports disclose confidence, probabilities, market quality, invalidation conditions, limitations, source freshness, and provenance. For this listing, callers pay per report in test USDC through Circle Gateway on Arc Testnet. PULSE provides decision support only and never places trades or Polymarket orders.

### Anything else?

PULSE is submitted as an Arc Testnet service using test USDC through Circle Gateway. Arc is clearly identified as a test environment throughout the payment and report lifecycle. Paid analysis is delivered as a durable asynchronous job with authenticated recovery, so a caller can retrieve a settled report without paying twice. Prediction markets are explicitly selected by the caller and reloaded server-side; PULSE uses public read-only evidence and never submits orders. The project also exposes an MCP server for agent clients at `https://pulse-api-production-7aae.up.railway.app/mcp` and source code at `https://github.com/mssystem1/ai-pulse`.

## Published Arc service endpoints

- `POST https://pulse-api-production-7aae.up.railway.app/arc/v1/analysis/spot/standard` — $0.10
- `POST https://pulse-api-production-7aae.up.railway.app/arc/v1/analysis/spot/premium` — $0.20
- `POST https://pulse-api-production-7aae.up.railway.app/arc/v1/analysis/prediction/standard` — $0.10
- `POST https://pulse-api-production-7aae.up.railway.app/arc/v1/analysis/prediction/premium` — $0.20

All four declare Arc Testnet `eip155:5042002`, test USDC `0x3600000000000000000000000000000000000000`, the `exact` x402 scheme, and Circle Gateway in public metadata. Fused, divergence, and event-risk routes are intentionally excluded because they are disabled in the public product.

## MCP verification

`GET /mcp` publishes the server and available tool names. `POST /mcp` supports JSON-RPC 2.0 initialization and tool discovery, currently negotiating MCP protocol version `2024-11-05`. MCP tool pricing is generated from the same runtime configuration as REST pricing.

## Submission gate

- Confirm the website, health endpoint, metadata, MCP initialization, and MCP `tools/list` return HTTP 200.
- Confirm the four Arc resources and prices appear under `asp.networkServices` in `/v1/metadata`.
- Send a valid unpaid request to each Arc endpoint and confirm its HTTP 402 challenge declares the exact network, asset, amount, seller, and resource URL.
- Complete one controlled test-USDC payment for each distinct price/payment contract and recover the private report without repaying.
- Confirm the receipt identifies Circle Gateway batch settlement and does not fabricate an immediate on-chain transaction.
- Submit the endpoint URL, payout wallet, description, and published OpenAPI specification through Circle's official intake form.
- Save the submission identifier, approval result, and Discovery API record.

Do not include secrets, recovery tokens, private reports, mock-payment evidence, or an unverified payout address in the submission.
