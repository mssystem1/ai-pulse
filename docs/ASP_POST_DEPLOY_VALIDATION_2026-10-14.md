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

## Completion after deployment of a04a263

The user deployed the Prediction discovery correction. All ten official CDP validator checks are ready. Four funded Prediction calls (Quick/Pro on Base/Arbitrum) completed, delivered the full requested research, reopened free through REST/MCP and matched their exact onchain transfers. The five older Global/Risk catalog entries were then refreshed with one paid request each.

| Refresh | Job | Exact settlement transaction |
| --- | --- | --- |
| Base Global Quick | `ea47cf09-38f1-40dc-8bd9-faa733d3cc09` | `0x9a203324116f414dd4b1315cfd17128366960ce3e8be7c6284f1b488c993c914` |
| Base Risk Guard | `6b2fbe85-d146-4adf-b890-4172db510732` | `0x43c0b97729f8e6a41c73a8131eeea3ea6f424e725bc74c5f03398e39a162f371` |
| Arbitrum Risk Guard | `006e48f5-459d-4b6b-853a-3b44dea67873` | `0x64a72efbd81fcd9a4a2fa5cb612be29dd2edcceefc7e4d92d41d77b8a649271b` |
| Arbitrum Global Quick | `ff854a40-82de-4c44-a92d-19e4416cca23` | `0x8df0067a41339feb43ea18f4714aa7211339d868845cb3fcee484de6a6e21798` |
| Arbitrum Global Pro | `6e2fd70a-0f28-4081-8eb4-fa17424745bf` | `0xfba9bbf1c347e3142b6f3b76883f75e8b906bc94890bbbf0aa0c98150247d855` |

All refreshes passed full delivery, unauthenticated-access rejection, free REST/MCP recovery and exact transfer checks. Already accepted jobs were resumed without another payment. Older documents were validated against the sections their deployed report version contains; they do not claim the staged directional-plan feature.

The public Coinbase search at **2026-10-13 22:45:11 UTC** returns **10 indexed / 10 matching / 0 stale**, comparing required inputs, schema and delivery examples against the official deployed validator responses. The first two required checks above are complete.

Across the original matrix and these deployment regressions, **30 paid service deliveries succeeded**, costing **7.20 USDC-equivalent** in service fees. Gateway deposits and gas are separate. The user's own BTC timeframe purchases are excluded from this count. Journals and private deliverables remain ignored local artifacts; no access tokens or payment signatures are committed.

Agent **8355 remains in the user's requested OKX review process**. No additional resubmission or profile mutation was performed. Approval and refreshed OKX-generated schemas remain external results. Circle marketplace publication also remains separate from the verified Arc metadata/payment endpoint and the completed service-delivery tests.

The subsequently reported BTC setup/chart issue is addressed in [the setup audit](GLOBAL_REPORT_SETUP_AUDIT_2026-10-14.md), including four approved live Grok replays and desktop/mobile/Telegram rendering validation. That implementation is prepared locally and requires deployment of its new commit.
