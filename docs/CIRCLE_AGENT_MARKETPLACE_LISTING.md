# PULSE ? Circle Agent Marketplace mainnet listing

PULSE provides Global Market, selected Prediction Market and Onchain Pre-Trade Risk Guard reports. Arc payments use mainnet 5042, USDC's six-decimal ERC-20 interface and production Circle Gateway. Testnet is retired from the active catalog.

| Service | Arc resource | Default price |
| --- | --- | --- |
| Global Quick | /arc/v1/analysis/spot/standard | $0.20 USDC |
| Global Pro | /arc/v1/analysis/spot/premium | $0.30 USDC |
| Prediction Quick | /arc/v1/analysis/prediction/standard | $0.20 USDC |
| Prediction Pro | /arc/v1/analysis/prediction/premium | $0.30 USDC |
| Risk Guard | /arc/v1/preflight | $0.20 USDC |

Deployed /v1/metadata is authoritative for enabled services and prices. Durable asynchronous jobs provide authenticated recovery without another payment. Prediction analysis uses public evidence and does not submit Polymarket orders.

Payment identity: eip155:5042; USDC 0x3600000000000000000000000000000000000000; x402 v2 exact; GatewayWalletBatched version 1; GatewayWallet 0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE.

Arc Spot and Autopilot paths are implemented; deployment and qualification remain pending. Publish the three Autopilot pass resources only after verified execution is activated with FEATURE_ARC_TRADING=1. Claims of live execution require confirmed mainnet receipts.

API: https://pulse-api-production-7aae.up.railway.app; MCP: /mcp; source: [PULSE](https://github.com/mssystem1/ai-pulse). This draft prepares migration; external registration and hosted deployment have not been performed by these code changes.

See [migration audit](ARC_MAINNET_MIGRATION.md) and [OpenAPI resources](circle-marketplace-openapi.yaml).
