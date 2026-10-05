# Trading catalog coverage and route ordering

## Arc mainnet update — 2026-10-05

Global Market uses the live OKX research catalog, preserving the existing Base and Arbitrum logic. Arc Spot and Autopilot currently map BTC-USDT to the published cirBTC/USDC deployment and ETH-USDT to WETH/USDC. Search cirBTC to find the BTC mapping. Execution selection checks live OKX ticker/history, chain-5042 contract metadata and both indicative Arc swap directions. Autopilot additionally requires 50 fresh consecutive completed OKX candles for the selected market/timeframe. Actual order amounts are requoted before signing.

The broader [RadarDex index via Arcodex](https://www.arcodex.fun/tokens) is only for Token Risk Guard discovery. Its 2,000 indexed contracts plus reviewed USDC, WETH, cirBTC and EURC returned 2,004 Risk Guard entries; this is bounded provider coverage rather than the entire chain. Name/symbol/full-address search and manual address entry remain available. Quote success does not promote a token into Global, Spot or Autopilot. Legacy native market IDs are rejected before checkout or AI usage.

Earlier catalog evidence describing 2,005 execution entries, 3,146 Global instruments or native memecoin candle support documents a superseded experiment. It is not the current execution catalog. Production trading remains paused pending final acceptance and manual release.

## Earlier multichain review

Reviewed September 28, 2026. This follows the screenshot with unavailable XBSP/XBE entries above routable CRV/COMP.

## Findings and changes

The previous sort only distinguished a token mapping from no mapping. Every execution-picker entry was already mapped, and its automatic route result lived inside the row, so the list never changed order after a failed quote. Completed route checks now publish to the shared cache, and Global, Spot, Autopilot and discovery cards use the same ordering: verified available routes, mapped assets awaiting checks, failed checks, confirmed unavailable routes, then unmapped research assets. Equal-ranked entries retain their original order. Checks remain bounded to two concurrent requests and refresh while visible.

Spot and Autopilot now have the same Crypto, Tokenized stock, Tokenized ETF and RWA filters as Global, with category counts. Classification comes from the live instrument's metadata, rather than guessing from ticker prefixes. Robinhood uses its contract registry and the same stock/ETF classifier. Additional ETF symbols such as TQQQ, SOXL, EWY and SGOV are classified consistently.

Global previously requested only 80 instruments and filtered those locally. Categories could therefore appear empty even when matching instruments existed beyond that slice. It now requests the full supported instrument catalog (bounded at 5,000), and execution pickers request up to the API's 1,000-pair limit rather than 160.

The trading-token source now supplements OKX's discovery list with reviewed, chain-specific deployment metadata. Both catalog construction and route resolution use these additions, so new entries can actually resolve; they are not display-only rows. Each added contract records its source in `apps/api/src/curatedExecutionTokens.ts`:

- [Uniswap Base token list](https://github.com/Uniswap/default-token-list/blob/main/src/tokens/base.json)
- [Uniswap Arbitrum token list](https://github.com/Uniswap/default-token-list/blob/main/src/tokens/arbitrum.json)
- [Arbitrum bridge token list](https://bridge.arbitrum.io/token-list-42161.json)
- [Aave Arbitrum address book](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Arbitrum.sol)

The live-catalog comparison found 21 additional non-settlement Base symbols with live OKX USDT instruments, including UNI, VIRTUAL, KAITO, COMP, ZRX, AIXBT and ZORA, plus AAVE, RSR and DEGEN on Arbitrum. Read-only production quote requests for one USDC succeeded for AAVE/RSR on Arbitrum and UNI/VIRTUAL/KAITO on Base. No trade or wallet transaction was performed.

Provider rate-limit, timeout and authentication errors now return an unavailable check instead of falsely declaring that no route exists.

## Boundaries

The three pair pickers default to the separate **Route available** filter, which combines with asset categories and search. Opening the picker scans the loaded mapped catalog, including offscreen rows, with two concurrent checks and progress reporting. Choose **All assets** to see the broader catalog. Only successful checks for the selected network and custody mode qualify; switching networks cannot reuse another network's results. Closing the picker stops scheduling further checks. These are provider API requests, not AI screening calls.

Route status currently refers to **OKX**. Read-only Arbitrum checks returned OKX code `82000` (insufficient liquidity) for AAPLx, SPYx, BSPx and BEx; AAPLx and SPYx also failed a ten-USDC probe. This does not establish absence of liquidity at other providers. PAXG and XAUT were not mapped in the tested catalog.

Coinbase CDP is already integrated in `apps/api/src/cdpSwap.ts`, but only for native ETH-to-USDC funding on Base and Arbitrum. General pair resolution, trading preparation and Autopilot currently call OKX. [Coinbase's ERC-20 swap API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/evm-swaps/create-swap-quote) includes a Permit2 signing payload. The present swap adapter only approves a spender and calls an allowlisted router; Coinbase execution therefore requires explicit signing and adapter compatibility work. A Coinbase quote alone must not qualify an asset for automated execution. General Coinbase routing is not implemented by this filter update.

Deployment metadata is not a liquidity guarantee. Added candidates still need a fresh route; actual order amounts are quoted again before signing. Global-linked execution still requires a live matching analysis instrument. Unsupported DEX-only assets are not relabeled as exchange-listed assets, and staking derivatives are not substituted for their underlying coin. This update does not fabricate additional X Layer contracts or guarantee liquidity for every tokenized stock.

## Validation

- API catalog integration test covers added UNI/KAITO/AAVE deployments, stock/ETF/RWA metadata, actual route resolution and rate-limit handling.
- Route-cache tests cover asynchronous ordering, expiration, chain/custody isolation, sharing and concurrency limits.
- Browser fixtures reproduce unavailable stocks preceding CRV/COMP, verify the corrected ordering in all three pickers, exercise every category, and find assets after the previous 80-row cutoff at 390px and 1440px.
- Read-only quote evidence is recorded above; synthetic browser tests never access wallets or production endpoints.

Deploy the market package, API and web together. No additional AI screening or subscription cost is introduced.

## Arc mainnet correction — 5 October 2026

Global uses the live OKX exchange research catalog, as on Base and Arbitrum. Arc execution currently exposes BTC-USDT → cirBTC/USDC and ETH-USDT → WETH/USDC, using exact reviewed deployments. Search cirBTC to find BTC. Selection requires fresh OKX market data and both Arc swap directions; Autopilot also requires 50 recent consecutive closed OKX candles.

The wider RadarDex/Arcodex index remains searchable only in Token Risk Guard. Quote success cannot promote an indexed memecoin into research or automated trading. API, MCP and Telegram reject legacy native research IDs before checkout; the workers reject unsupported Arc bindings before consuming an AI confirmation or preparing a transaction. Existing Base and Arbitrum catalog and routing rules are unchanged.

The [current policy audit](ARC_MAINNET_OKX_MARKET_POLICY_AUDIT_2026-10-05.json) records live ticker/history, two-way quotes and 0.11 USDC guarded Autopilot preflight for both mappings. Browser checks cover Global pair/timeframe changes, Spot, Autopilot, exact-address Risk Guard discovery and live free contract inspection. All paid checkout and worker execution checks in this correction use isolated fixtures; no additional funds were spent.
