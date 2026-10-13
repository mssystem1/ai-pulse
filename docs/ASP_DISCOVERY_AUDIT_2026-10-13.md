# ASP discovery and paid-delivery audit — 2026-10-13

Production API: `https://pulse-api-production-7aae.up.railway.app`.
Test buyer: `TEST_WALLET_ADDRESS`, `0xa7d827622c4f9c884ca8f751b2060dd767f18683`.
The authenticated Codespace owner wallet was used only for the approved agent identity update, never for report purchases.

## Paid services

| Network | Global Quick | Global Pro | Prediction Quick | Prediction Pro | Risk Guard |
| --- | --- | --- | --- | --- | --- |
| X Layer | Passed, REST | Passed, REST | Passed, REST | Passed, REST | Passed, REST |
| Base | Passed, MCP | Passed, REST | Passed, REST | Passed, REST | Passed, REST |
| Arc | Passed, REST | Passed, MCP | Passed, REST | Passed, REST | Passed, REST |
| Arbitrum | Passed, REST | Passed, MCP | Passed, REST | Passed, REST | Passed, REST |

All 20 deliverables completed. Service fees total $4.80 equivalent: $1.20 on each network, using USD₮0 on X Layer and USDC elsewhere. Each report passed complete Markdown delivery, free authenticated REST reopening, free MCP recovery and rejection without the recovery capability. Non-Arc settlement token transfers were verified onchain with exact payer, merchant and amount. Arc receipts contain Gateway transfer UUIDs, not transaction hashes; Gateway debits were verified separately.

The Global sample is BTC-USDT, primary 1H, with independently observed 4H context for Pro. Each sample contains 520 closed real OHLCV candles. This matrix does not claim paid coverage of every asset/timeframe combination. Prediction samples retain the verified selected Bitcoin question, `pm:0x8717c39520cadcb8ad6f88af148c30acf7d044c92a9cf48416b9b9a5ed65d6d8`. Risk Guard samples use the network's actual settlement token. No swaps, Spot orders, Autopilot activations or Telegram messages were sent.

The original signed X Layer Pro MCP request failed with `No paid route configuration`, before settlement. Its authorization was verified unused and expired before the separately authorized REST checkout. This is a real production MCP routing defect, outside the 20 successful deliverables. It is fixed locally: the common payment gate now defers unconfigured/free routes, allowing MCP validation and canonical REST forwarding before settlement. The regression uses the actual non-mock OKX adapter with a local test facilitator; it verifies invalid-input rejection before settlement and exactly one verify/settle pair for valid input. Deployment and a live signed MCP regression remain required.

## Arc funding

The approved 0.50 USDC deposit funded the two Global tests. A separately approved 0.70 USDC deposit funded Prediction Quick/Pro and Risk Guard. Each approval was exact, not unlimited. Each deposit's combined approval/deposit gas was about 0.003021 USDC, below its 0.01 USDC cap.

- Additional approval: `0xde3a446ea71861e8a3ef97c808f1cc9b56fabe481884e26aaff504bf198331a8`.
- Additional deposit: `0x6cf73427aaabcbbfeb3907d4b293e644694d7dfe0b2d3ffdd187acae4d08218c`.
- Gateway balance after additional deposit: 0.706500 USDC; after the three tests: 0.006500 USDC.

Private payment authorizations, raw transactions and recovery tokens remain in ignored local audit files. The public ledger `.tmp/asp-audit/paid-ledger.json` records the 20 job IDs, settlement references and report hashes without those secrets.

## Discovery

The live public audit passed 301 checks and 40 unpaid x402 v2 challenges across the five research/risk services, REST/MCP and all four networks. It checked chain, token, amount, recipient, canonical resource, signing domain, invalid-input rejection and free recovery tool discovery. MCP initialize/tools/list succeeded. Paid Autopilot start probes were excluded because no vault activation or trade was requested.

Actual external catalog indexing is different from endpoint discoverability. The final official CDP filtered search returned no Base resources and three Arbitrum resources: Global Quick, Global Pro and Risk Guard. Prediction services were absent from that Arbitrum result. The complete Circle discovery catalog inspected earlier contained no PULSE entry. Search evidence is in `.tmp/asp-audit/public`; an advertised discovery extension alone is not proof of indexing.

Local Bazaar corrections add the required timeframe/language fields, valid network-specific Risk Guard examples and accurate synchronous/asynchronous delivery examples. The Circle OpenAPI contract now identifies Arc mainnet 5042, the correct prices, complete required inputs and free private report retrieval. Its seven paths and 26 internal references validate. These local changes require deployment; no Circle/CDP listing submission was made.

## OKX.AI agent 8355

The Codespace private moderation feedback explicitly identifies **Prediction Quick and Prediction Pro** as not delivering after payment. It does not identify the Global report redesign as the cause. Successful current direct tests cannot establish what happened during those earlier buyer calls.

The fetched catalog had stale generated schemas and examples: Global required only `instId` and gave `12:00` as a timeframe example; Prediction IDs used `test`; Risk Guard exposed a fake `langInlineJSON` field and an integer chainId. Instructions did not adequately cover full Markdown delivery, partial completion or repeating all parameters during CLI payment replay.

The user approved the exact five-description correction in [the metadata review](./OKX_8355_METADATA_REVIEW_2026-10-13.md). Official listing QA passed once with no findings. The first update attempt was explicitly not executed because the Codespace daemon was stopped; the installed communication repair reported ready before the approved update was retried.

The update succeeded: [X Layer transaction](https://www.oklink.com/xlayer/tx/0xd33afa208882bc52e660fde6bfcf8aba5b1386c07f2fb8909838c62d0f74836b). All five descriptions were re-read and matched the approved payload; names, fees, endpoints and profile were preserved.

**Unresolved at the post-update read:** service-list still returned the old generated input schemas and request examples, with status 2 / approvalStatus 6. A successful metadata transaction did not refresh those fields or relist the agent. The official CLI exposes service descriptions and endpoints, not a documented direct inputSchema/reqExample update. Do not create duplicate identities or delete/recreate the five services to work around this cache.

The user then explicitly approved a separate English (`en-US`) listing-review submission. The request returned `submitApproval[0].success: true` and `approvalStatus: 2`: the new submission was accepted for review. The `activate` portion still reported the previous rejected state/reasons; it did not confirm publication. A single subsequent service-list read returned status 2 / approvalStatus 3, retained the old feedback and still exposed the stale generated schemas/examples. This result does not establish publication. Final approval and schema refresh remain unverified. The first connection attempt failed before SSH/any OKX command; the later submission executed once.

## Chart and Telegram validation

The chart correction is based on [Vilarso's public documentation and TradingView's product/drawing guides](./GLOBAL_CHART_RESEARCH_2026-10-13.md). It preserves saved report data and aligned Spot levels, uses cleaner study presets, retains zoom on indicator changes and displays standard Fibonacci retracements from the original confirmed swing.

Domain, analysis, config, payments and web tests pass: 19 + 42 + 12 + 38 + 183. The focused API/report/Telegram suite passes 62 tests; total 356 distinct tests, zero skips. Backend and web builds pass. Existing handoff tests retain Market/Limit review, TP/SL prefill and protection against URL price overrides.

Browser review uses existing paid production snapshots inside the rebuilt app. Shared report/library reads and Telegram host state are mocked explicitly; all mutations are blocked. All 14 desktop/mobile report, indicator/zoom/pan, guide and Mini App cases passed without runtime errors and are recorded in `.tmp/asp-audit/browser-after-fixes`. Screenshots revealed a separate Telegram CSS defect that collapsed report SVGs to 24 pixels; overview and interactive overlay sizing were corrected and their dimensions are asserted. Guide screenshots also exposed the article occupying the docs grid's 42-pixel number column; the guide now spans the section. Its five full-resolution historical chart images use the production bundled fonts, bilingual captions and saved-snapshot provenance; all five load with correct geometry on desktop and mobile. These checks do not claim a live Telegram Stars purchase or chat send.

## Required remaining checks

1. Deploy the local API/payment metadata and chart corrections; verify production health and displayed chart/guide.
2. Perform a live signed X Layer MCP regression after deployment. A new paid test needs a funded, approved test matrix; existing recoveries remain free.
3. Verify the outcome of the submitted OKX review, including generated examples/required fields and final listing state. Review submission is not proof of publication or schema refresh.
4. Complete authorized Circle/CDP indexing work and verify actual search results. Endpoint health does not substitute for marketplace listing evidence.
