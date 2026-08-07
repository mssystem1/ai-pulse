# PULSE · OKX.AI listing pack

Use this document as the single copy source when registering the A2MCP service. Replace every `<PLACEHOLDER>` and verify the live endpoint before submission.

## Canonical identity

| Field | Value |
| --- | --- |
| Name | **PULSE** |
| Type | **A2MCP** |
| Category | **Trading** |
| Tagline | **OKX spot intelligence. Pay per signal on X Layer.** |
| One-liner | Live OKX market context, Grok-powered trading scenarios, and pre-trade safety—available to humans and agents through x402. |
| Network | X Layer · `eip155:196` |
| Settlement | USDT0 / USD₮0 · `0x779ded0c9e1022225f8e0630b35a9b54be713736` |
| Payment | x402 exact scheme · official OKX seller middleware |
| Languages | English, Simplified Chinese |
| MCP endpoint | `https://<DOMAIN>/mcp` |
| Metadata | `https://<DOMAIN>/v1/metadata` |
| Logo | `https://<DOMAIN>/brand/logo.png` |

Do not reuse the legacy product name. **Pre-trade Safety Check** is one PULSE service; it is not the brand.
For the current rejected listing, `<DOMAIN>` must not be a `*.vercel.app` hostname. Update existing agent **#8355** rather than creating another identity.

The canonical marketplace avatar is `assets/logo.png`: a real 512×512 PNG,
under 1 MB, with an opaque square canvas and no rounded outer mask. It is rendered
from the matching PULSE waveform in `assets/logo.svg`; do not upload the retired
radar artwork or a rounded-corner export.

## Short description

PULSE is pay-per-signal OKX spot intelligence for traders and AI agents. Search live OKX spot instruments, discover X Layer tokens, and preview tickers/candles for free; then buy structured Grok analysis or pre-trade safety with USDT0 on X Layer through x402.

## Full description

PULSE turns market intelligence into an agent-native onchain service. It reads live OKX spot instruments, tickers, and OHLCV; provides a source-labeled X Layer token catalog and free market previews; and delivers structured Grok-powered base and premium reports with bias, confidence, levels, scenarios, invalidation, risk notes, and limitations. Free chart refreshes preserve the current report. PULSE also exposes explainable token-risk and composite pre-trade checks. Humans use the bilingual web console; AI agents use MCP, REST, or the TypeScript SDK. Paid calls settle per request in USDT0 on X Layer through x402 and the official OKX payment stack—no account or recurring subscription required.

## Services submitted to the marketplace

| Tool | Price | Input | Output |
| --- | ---: | --- | --- |
| `spot_search` | Free | query | Live OKX spot instruments |
| `spot_ticker` | Free | `instId` | Live ticker and 24h context |
| `analysis_base` | $0.03 | pair, timeframe, language, optional focus | Structured Grok market signal |
| `analysis_premium` | $0.06 | pair, timeframe, language, optional focus | Multi-scenario report and execution checklist |
| `token_scan` | $0.01 | X Layer token address | Explainable deterministic risk heuristic |
| `preflight` | $0.05 | intent and trade/counterparty context | Composite PASS/WARN/FAIL safety report |
| `resolve` | Free | token query | Known token metadata |

The REST API also exposes wallet, lightweight market-pulse, and heuristic swap-quality endpoints. They are useful advanced/demo capabilities but should not be presented as live indexer or executable quote data.

The web and REST API also expose `GET /v1/xlayer/tokens` for chain-196 discovery. It uses OKX Onchain OS as the primary catalog and DexScreener only as best-effort X Layer enrichment. Catalog presence is not a safety verdict, and manual address entry remains available.

## Product proof points

- Live market input comes from official OKX public endpoints.
- Market pairs are selected from the live OKX instrument list rather than accepted as arbitrary text.
- X Layer token discovery labels OKX/DexScreener sources, rejects non-X-Layer enrichment, and is explicitly separated from safety claims.
- Free ticker/candle refreshes do not clear an existing report.
- Paid AI reports use a server-side xAI/Grok key.
- Browser payments use the connected wallet; keys never enter the API.
- A single header connection powers balances, x402 signing, and the native Exchange OS swap flow; disconnect remains effective across reloads.
- Safety is scoped to X Layer chain 196: free contract evidence is live RPC data, while paid scores are explicitly labeled deterministic heuristics.
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
5. Confirm `GET /v1/token/scan` reports `input_required`, then complete one `$0.01` paid POST replay and retain `replayBody`, `PAYMENT-RESPONSE`, and the saved deliverable path.
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
