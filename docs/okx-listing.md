# PULSE · OKX.AI listing pack

Use this document as the single copy source when registering the A2MCP service. Replace every `<PLACEHOLDER>` and verify the live endpoint before submission.

## Canonical identity

| Field | Value |
| --- | --- |
| Name | **PULSE** |
| Type | **A2MCP** |
| Category | **Trading** |
| Tagline | **Analyze first. Spot trade or run a guarded Autopilot.** |
| One-liner | Global and Prediction Market intelligence connected to owner-signed Spot execution, guarded Autopilot, and Onchain Pre-Trade Risk Guard. |
| Networks | X Layer · Base · Arbitrum One · Arc Testnet payments; Spot and Autopilot are hidden on Arc Testnet |
| Settlement | USDT0 on X Layer · native USDC on Base/Arbitrum · test USDC on Arc Testnet |
| Payment | Network-specific x402 settlement |
| Languages | English, Simplified Chinese |
| MCP endpoint | `https://<DOMAIN>/mcp` |
| Metadata | `https://<DOMAIN>/v1/metadata` |
| Logo | `https://<DOMAIN>/brand/logo.png` |

Do not reuse the legacy product name. **Pre-trade Safety Check** is one PULSE service; it is not the brand.
For the current rejected listing, `<DOMAIN>` must not be a `*.vercel.app` hostname. Update existing agent **#8355** rather than creating another identity.
Public record: https://www.okx.ai/agents/8355

The canonical marketplace avatar is `assets/logo.png`: a real 512×512 PNG,
under 1 MB, with an opaque square canvas and no rounded outer mask. It is rendered
from the matching PULSE waveform in `assets/logo.svg`; do not upload the retired
radar artwork or a rounded-corner export.

## Short description

PULSE is an Analyze -> Spot or Autopilot workflow for traders and AI agents. Preview live OKX markets for free, buy a focused Global report and use its plan for an Agentic-Wallet-signed Spot Market or Limit order, or start a separately guarded Autopilot without a report. Payments use USDT0 on X Layer or USDC on Base and Arbitrum through x402; Arc Testnet supports analysis payment testing.

## Full description

PULSE turns live OKX Global Market and explicitly selected Polymarket evidence into recoverable Quick or Pro reports. Global coverage includes crypto, xStocks, and RWA instruments. Pro reports add Fibonacci, pivots, global Elliott-wave paths, selected-network DeFi opportunities, and a Buy-or-Wait execution plan. A valid Global plan can prefill an Agentic-Wallet-signed Market or Limit Spot order with optional TP/SL. Autopilot starts independently through its own six-step pair, strategy, capital/risk, vault and runtime workflow; it does not require a report. Every onchain action independently verifies the selected network’s identity-safe token representation, settlement asset, live route, and wallet balance. Onchain Pre-Trade Risk Guard exposes PASS/WARN/FAIL evidence with explicit unknowns. Humans use the bilingual web console; agents use REST, MCP, or the TypeScript SDK. Eight public paid services are available on X Layer, Base and Arbitrum; Arc Testnet exposes the five analysis/risk services only.

## Services submitted to the marketplace

| Public service | Price | Input | Output / next action |
| --- | ---: | --- | --- |
| Global Quick → Spot Market or Limit | $0.20 | pair, timeframe, language, optional focus | Concise Buy-or-Wait analysis, then a prefilled Agentic-Wallet-signed Spot Market or Limit order |
| Global Pro → Spot Market or Limit | $0.30 | pair, timeframe, language, optional focus | Chart, Elliott paths and DeFi context, then a prefilled Agentic-Wallet-signed Spot Market or Limit order |
| Prediction Quick | $0.20 | one selected Polymarket market | Probability evidence, decision, risks and invalidation |
| Prediction Pro | $0.30 | one selected Polymarket market | Deeper evidence weighting plus a mapped 4H underlying chart |
| Onchain Pre-Trade Risk Guard | $0.15 | network, intent, token/transaction context | PASS/WARN/FAIL with live RPC evidence and explicit unknowns |
| Start Autopilot · 24h | $1.50 | owner, vault and six-step strategy setup | Agentic Wallet creates/configures/funds/registers the vault; x402 activates 24 active-runtime hours |
| Start Autopilot · 7d | $10.50 | owner, vault and six-step strategy setup | Same owner-controlled start workflow with seven active-runtime days |
| Start Autopilot · 30d | $45.00 | owner, vault and six-step strategy setup | Same owner-controlled start workflow with 30 active-runtime days |

Spot Market and Limit are execution choices inside the two Global services, not separate marketplace rows. The three Autopilot rows are complete guided start/extension services. Their `/autopilot/pass/...` HTTP call is specifically the final x402 activation step after Agentic Wallet has created or selected, configured, funded and registered the owner vault; it must not be described as creating the vault by itself.

The web and REST API also expose `GET /v1/xlayer/tokens` for chain-196 discovery. It uses OKX Onchain OS as the primary catalog and DexScreener only as best-effort X Layer enrichment. Catalog presence is not a safety verdict, and manual address entry remains available.

## Product proof points

- Live market input comes from official OKX public endpoints.
- Market pairs are selected from the live OKX instrument list rather than accepted as arbitrary text.
- X Layer token discovery labels OKX/DexScreener sources, rejects non-X-Layer enrichment, and is explicitly separated from safety claims.
- Free ticker/candle refreshes do not clear an existing report.
- Paid AI reports use a server-side xAI/Grok key.
- Browser payments use the connected wallet; keys never enter the API.
- A single header connection powers balances, x402 signing, and the native Exchange OS swap flow; disconnect remains effective across reloads.
- Risk Guard contract evidence and non-broadcast simulation are network-scoped on X Layer, Base, Arbitrum One, and Arc Testnet; legacy heuristic scores remain explicitly labeled and never become audits.
- The web app checks USDT0 before requesting a signature.
- The funding drawer shows OKB + USDT0 and uses the official OKX Exchange OS DEX API for live routes and unsigned transaction preparation.
- MCP returns both text content and structured JSON.
- Paid REST and MCP routes emit standards-shaped x402 challenges.
- Paid REST routes publish a machine-readable POST-body contract. Token scan returns the full risk JSON inline on paid replay, which the Onchain OS task client saves as its deliverable.
- Live mode uses the OKX facilitator; mock mode is clearly disclosed by `/healthz`.

## Registration sequence

1. Deploy the final commit to a stable public HTTPS hostname that is not `*.vercel.app`.
2. Confirm `/healthz` reports `paymentMode: "okx"`, `hasOkxCredentials: true`, and `hasXaiKey: true`.
3. Confirm `/v1/metadata` uses **PULSE**, the final HTTPS URLs, and the intended non-zero `payTo` address.
4. Call a paid route without payment and inspect the HTTP 402 challenge.
5. Confirm each advertised GET probe reports `input_required`, then complete one advertised paid POST replay (for example Risk Guard at $0.15) and retain `replayBody`, `PAYMENT-RESPONSE`, and the saved deliverable path.
6. Verify `tools/list` and one free plus one paid `tools/call` through `/mcp`.
7. Test the market picker, X Layer token catalog/manual input, report-preserving chart refresh, wallet drawer, balance guard, native OKB → USDT0 flow, and free contract inspector on desktop and mobile.
8. Update the service URL on existing OKX Agent Identity #8355.
9. Re-activate #8355 to resubmit the final marketplace URL—not localhost, `*.vercel.app`, or a preview deployment.

Suggested Onchain OS prompts:

```text
Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS.
Help me list my PULSE ASP on OKX.AI using its MCP endpoint and live metadata.
```

## Copy quality gate

- Use **PULSE** everywhere.
- Write **USDT0** in plain text; use **USD₮0** only where the official asset styling is helpful.
- Say “live OKX ticker/OHLCV,” not “live safety score.”
- Say “Grok-powered scenarios,” not “guaranteed predictions.”
- Say “live X Layer RPC evidence” only for contract inspection, and “deterministic heuristic” for scored safety endpoints.
- Do not claim the product is listed, deployed, profitable, audited by a third party, or production-settled until proof exists.
- Keep NFA/DYOR language visible in the web console and listing media.

## Source of truth

- Dynamic listing payload: `GET /v1/metadata`
- Metadata builder: `packages/config/src/index.ts`
- MCP catalog: `apps/api/src/mcp.ts`
- Pricing: `.env.example` and `packages/config/src/index.ts`
- Brand assets: `assets/logo.svg`, `assets/logo.png`
- Release audit: [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md)
