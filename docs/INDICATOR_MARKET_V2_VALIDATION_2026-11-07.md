# Indicator Market second-release implementation and acceptance — 7 November 2026

This record extends the [first-release acceptance](INDICATOR_MARKET_VALIDATION_2026-11-07.md). That earlier record covers the original catalog/local kernels and funded Terminal pass; it does not prove the later creator formula, commerce, on-chain registration or reorganized workspace paths. Local implementation and acceptance do not establish that the public deployed app already includes the latest changes.

## Requested deliverables 1–8

| # | Requested behavior | Implemented surface and acceptance boundary |
|---:|---|---|
| 1 | Actual X Layer registration | Three numerical Tapeout circuits deployed under a new PULSE processor; deployed netlist/ports and six numeric vectors per circuit verified through independent RPC sources. Transactions and blocks below. A creator formula needs its own matching registration. |
| 2 | Meaningful creator formulas | `pulse-flow-expr-v1` compiles supported arithmetic and `abs/min/max/clamp` over executed `buy/sell` quantities to TAP-02 NAND gates. Per-bucket/cumulative output, unit dimensions, zero division, integer range and circuit bounds are checked. This remains an executed-flow expression language, not arbitrary JavaScript or an unrestricted chart scripting language. |
| 3 | Paid indicator service | Explicit immutable-version quote, direct creator payment, wallet entitlement/sales record, idempotent retry, interrupted-payment recovery and restoration after delisting. Enabled supported routes are X Layer USDT0, Base USDC and Arbitrum One USDC. Only Base has the funded creator-purchase evidence recorded here. |
| 4 | Creator-to-buyer validation | The real Base buyer used an already paid Terminal pass and bought a custom formula service for 0.001 USDC. The creator's Terminal access was an explicit synthetic local QA grant. Duplicate retry and delisted-version restoration passed. No exchange orders or Telegram messages were sent. |
| 5 | Visible product information | Dedicated public landing section and direct app links; Terminal introduction; separate handbook entries `docs-indicator-market` and `docs-create-indicator`; README and technical contract. A successful local build does not prove a deployed domain was updated. |
| 6 | Apply indicators to the chart | Installed numerical results feed independent panes on the price chart's shared time axis. They keep their own units/scales. Hover/tap readings and Inspect execution window on chart expose actual retained input timestamps. A daily/weekly chart cannot create missing historical executions. |
| 7 | Structured Terminal navigation | Seven workspace sections: Trading Terminal, Market tools, Market Radar, Create indicator, Indicators Market, My opened positions, Alerts & Activity. Deep links retain the destination; one market/timeframe carries between sections. Desktop sidebar/narrow-screen picker preserve the existing PULSE header and top tabs. |
| 8 | Updated examples and docs | Illustrated installation and creator workflows, worked CVD calculation, supported-formula/unit examples, registration attachment, paid-service/recovery explanation and revised complete Terminal guide. Landing, app handbook, README and repository contracts describe the same boundaries. |

## Actual X Layer deployment

User-approved total limit: **0.020 OKB** on X Layer. Actual creation, parts, three registrations and gas: **0.012230791172616297 OKB**.

- Chain: X Layer mainnet, `196`.
- Factory: `0x1f09daefa827f02cbb40967cc91b259763760761`.
- PULSE processor: `0x9e2849c04a513fe64db07521cbe52d078d905c0e`.
- Processor creation: `0xc5a879702e6c3621ae66f785d739125875aa194d99eac16cf26cd8e3bc2e0b1f`.
- Numerical parts: `0x5a5fdb06fd613db80d77eee11d7712efda2313f311800d19de1996a22ca64d4e`.

| Package | Circuit | Verified at block | Registration transaction |
|---|---:|---:|---|
| `pulse.executed-cvd` | 1 | 75306038 | `0xb76e235f963aae58a87a986a05ce3235d1cb343477431c28ebe1109a5674b5b0` |
| `pulse.buy-participation` | 2 | 75306050 | `0x93ed43b65c7e35111da2d2ab291e907e74910405b36c8dd9ddb020a6c1b37287` |
| `pulse.weighted-flow` | 3 | 75306061 | `0x992e2490d42e45560e3205d640d2c41598fcf10dde5664910adde83beb1f3c8d` |

Versioned verified records are in `packages/market/src/indicatorDeployments.ts`. Detailed local receipts/cost checkpoints are in `.tmp/indicator-market-v2/registration-progress.json` and the three `*.registration.json` files. These identify calculations at recorded blocks, not the truth of exchange inputs, creator originality, profitability or hackathon acceptance. Chart updates execute locally without another fabrication transaction.

## Actual creator-service purchase

- Settlement: **Base native USDC**, amount **0.001** (`1000` atomic units).
- Transaction: `0x3971aac2543075b6fcb3f0a3bc399b5796cb501c095547492bf85fbbbb21d044`.
- Creator recipient: `0x41D4deF3019fF03d2A4dfcC7690e887E95250ec8`.
- Listing: `pmi_41fbfc1a1ac16681f9a997d249d93264`, custom expression `((buy*2)-sell)`.
- Existing buyer access: real paid Terminal pass, no new pass bought for this run.
- Creator access: explicit local QA grant; this is not evidence of a second real pass purchase.
- Creator payment, repeated-request receipt recovery, creator sales record and purchased-version restoration after delisting passed.

The 0.001 amount was deliberately small QA listing pricing. It is not a Terminal pass price, a mandatory price for every indicator, or an additional recurring debit. Exported formulas remain public; the purchased entitlement is the quoted managed Terminal service.

Artifacts: `.tmp/indicator-market-e2e/commerce-validation.json` and `funded-validation.json`. Payment proof remains encrypted; credentials and private authorization payloads are not included in public documentation.

## Payment support versus funded acceptance

| Network/token | Indicator-service implementation | Funded creator-purchase evidence in this record |
|---|---|---|
| X Layer / USDT0 | Enabled-network quote, authorization, settlement and recovery path | **Not performed**. The real OKB circuit-registration transactions are a different operation. |
| Base / native USDC | Enabled-network quote, authorization, settlement and recovery path | **Passed**, the 0.001 USDC transaction above |
| Arbitrum One / native USDC | Enabled-network quote, authorization, settlement and recovery path | **Not performed** |
| Arc / Robinhood | Indicator-service checkout unavailable | Not performed |

Payment quotes bind their original network, asset, amount and creator. A Base receipt cannot satisfy an X Layer quote. Unsupported/disabled routes must fail before signing; the app must never silently select Base for a different header network. No cross-chain bridge or automatic token conversion is part of this checkout.

## Final regression status

Final local acceptance completed at **2026-11-07 18:36 UTC** after the multi-network changes. The final run reused the existing Base pass and indicator receipt; **it made no new payment**.

| Check | Result | Local evidence |
|---|---|---|
| API suite | 519 passed, 1 optional local Redis TCP/Lua integration test skipped, 0 failures | `.tmp/indicator-v2-api-final-tests.log` |
| Web suite | 299 passed, 0 failures | `.tmp/indicator-v2-web-final-tests.log` |
| Domain suite | 90 passed, 0 failures | `.tmp/indicator-v2-domain-final.log` |
| Market suite | 60 passed, 0 failures | `.tmp/indicator-v2-market-final.log` |
| Payments suite | 44 passed, 0 failures | `.tmp/indicator-v2-payments-final-tests.log` |
| API and web production builds | Passed; existing bundle-size warnings remain | `.tmp/indicator-v2-api-build-final.log`, `.tmp/indicator-v2-web-final-build.log` |
| Actual API, retained Base entitlement, registration attachment and Chrome workflow | 24 checks passed | `.tmp/indicator-v2-live-final.log`, `.tmp/indicator-market-e2e/funded-validation.json` |
| Chrome UI, actual wallet sign-in and live chart inputs | 15 browser checks, 7 screenshots, 0 browser exceptions | `.tmp/indicator-market-e2e/browser/indicator-browser-validation.json` |

The live unsigned checkout checks received actual 402 challenges for **X Layer / USDT0**, **Base / USDC** and **Arbitrum One / USDC**, each binding `1000` atomic units, the exact native token address, selected chain, creator recipient and resource path. These checks did not sign or settle another payment. The actual API also independently reverified the custom weighted-flow numerical circuit already deployed as circuit 3, without a new fabrication transaction.

Payment regression checks cover disabled-adapter rejection, CDP operation independently of OKX credentials, and explicit `X402_MOCK` as the simulation opt-in. The X Layer browser signing test runs the installed SDK against a restricted simulated provider: one reviewed challenge is signed once, recovery state is recorded before submission, and cancellation does not submit a payment. This is a protocol-path test, not funded USDT0 settlement evidence.

Chrome acceptance covers the unchanged header and Terminal's second tab, seven sidebar destinations, paid-pass countdown, registered catalog entries, two installed numerical studies, custom `buy*2-sell` preview `160`, the corresponding shared-chart pane, Ask PULSE context/model display, 1440px/390px layouts in two themes, both illustrated handbook entries, and the public landing section/direct Terminal link. The restricted browser wallet cannot sign payment typed data or send transactions.

Required checks include compiler dimensions/overflow/gaps; numerical registration mismatch; creator ownership and immutable versions; exact-network quote/asset/payee/amount binding; duplicate authorization/recovery; delisted entitlement restoration; independent custom-package execution; all seven workspace destinations; chart indicator panes and narrow-screen navigation; landing and handbook links; and API/web production builds.

Physical iOS/Android clients, unrelated third-party application adoption, profitable trading performance and full retained macro-session coverage are outside the evidence above. Missing executions remain unknown; porting an indicator cannot fill them.
