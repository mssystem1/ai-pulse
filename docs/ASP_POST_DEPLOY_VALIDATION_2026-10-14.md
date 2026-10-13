# ASP post-deployment validation — 14 October 2026

Dates use Europe/Samara. The successful paid regression occurred at 00:07 on 14 October (20:07 UTC on 13 October).

## Deployed reports and charts

The production API health check returned 200/healthy. All five deployed guide PNGs match the files in commit `e5d77c4`. The direct ASP audit passed 301 checks, including 40 unpaid REST/MCP challenges across X Layer, Base, Arc and Arbitrum. All 20 previously paid reports reopened through both REST and MCP without payment, retaining their saved reports and full Markdown.

Deployed browser checks passed 14 desktop/mobile cases with zero runtime errors. A second 14-case review used the fresh paid X Layer Pro report. These cover real candles, primary/context timeframe labels, indicator toggles preserving the chart and viewport, historical pan, full-size guide images and simulated Telegram Mini App rendering. Browser report/library reads and Telegram host state were intercepted explicitly; all mutations were blocked. No Telegram chat send or Stars purchase is claimed.

Fresh Pro export and screenshot evidence is retained privately under `.tmp/asp-audit/postdeploy-2026-10-14` and `.tmp/asp-audit/browser-fresh-report-2026-10-14`. Public checks are under `.tmp/asp-audit/public`. Wallet authorizations and recovery capabilities are excluded from Git.

## Funded X Layer Pro MCP regression

The user funded `TEST_WALLET_ADDRESS`. Before signing a fresh request, the previous failed MCP authorization was verified expired and unused, with no payment receipt. The new test used an isolated journal, exactly one signed checkout, and a maximum of **0.30 USD₮0**.

- Job: `e6db69ca-4e4f-452e-91c3-b021459ff87e`, completed.
- Settlement: [X Layer transaction](https://www.oklink.com/xlayer/tx/0x4ad00b2961349ee72ec639e4cbf3709b8a4e614bef67f323596f1695c7a00ddf).
- Exact token transfer from TEST_WALLET_ADDRESS to the published merchant: verified.
- Grok 4.5, medium reasoning; 520 completed 1H candles and independent 4H context.
- Entire Markdown, TXT, PNG and Telegram text/caption formatting: checked; canonical setup prices agree.
- Free authenticated REST and MCP recovery: passed; unauthenticated recovery returns 403.

This closes the live X Layer MCP regression required by the previous audit. Including the preceding 20 completed service tests, 21 paid test deliveries succeeded, with 5.10 USDC-equivalent service fees in total. Gateway deposits and gas are separate.

The fresh report correctly leaves Fibonacci unavailable: its latest confirmed leg spans 734.70 price units, below twice ATR14 (892.58). SMA55 is the saved default. The earlier qualifying snapshot verifies all seven standard retracement ratios; a chart must not fabricate a measured leg just to enable a study. The fresh report retains Watching and Count unclear, with any actually observed retest/stop evidence shown without claiming a ready trade. The follow-up adds a bilingual explanation of the two-ATR rule to the illustrated app guide.

## External discovery and moderation

The latest Codespace lookup returns agent **8355 / PULSE / ASP / not listed / Listing under review**. The approved English review was already submitted; no duplicate activation or identity was created. Final approval and refreshed generated service schemas remain external checks.

The refreshed public CDP search contains Global Quick, Global Pro and Risk Guard on both Base and Arbitrum: six indexed resources. Prediction Quick/Pro remain absent. Some indexed rows still retain earlier generated metadata. Circle's complete 2,854-resource catalog contains no PULSE match; a working Arc endpoint/payment does not prove Circle marketplace publication.

[Coinbase's official validator](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/validate-x402-endpoint) reports Global and Risk Guard ready on both networks (6/10), but rejects both Prediction tiers because its initial input-free POST receives 400. Direct paid requests with a verified market succeed; that does not satisfy the crawler's discovery probe.

The local correction lets an **unsigned, empty** Prediction POST on Base/Arbitrum reach the existing x402 challenge and advertise its inputs. It selects no market and creates no job. Supplied inputs and both signed header forms still pass normal schema/evidence validation before payment. X Layer, Arc and MCP input validation retain their existing behavior. The new regression tests exercise these boundaries; the focused API and delivery suites pass 67 tests (51 + 16), with no skips. API and web builds pass.

`node scripts/validate-bazaar-discovery.mjs` reproduces all ten read-only platform checks and distinguishes readiness from actual indexing. [Coinbase's seller guide](https://docs.cdp.coinbase.com/x402/seller/get-discovered) documents discovery after a successful settled CDP call; the validator itself does not pay or index resources.

## Required next checks

1. Deploy the follow-up Prediction discovery correction and verify that all ten CDP validator results are ready.
2. Verify Prediction indexing after valid CDP-settled calls, and confirm the indexed descriptions/examples/required fields match the deployed challenge. Validation success alone is insufficient.
3. Verify OKX review approval and generated schemas when its review completes.
4. Obtain and use Circle's official marketplace publication route if publication is desired; the prepared OpenAPI/listing copy is not publication evidence.
