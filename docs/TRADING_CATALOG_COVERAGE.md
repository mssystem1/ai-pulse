# Trading catalog coverage and route ordering

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

Deployment metadata is not a liquidity guarantee. Added candidates still need a fresh route; actual order amounts are quoted again before signing. Global-linked execution still requires a live matching analysis instrument. Unsupported DEX-only assets are not relabeled as exchange-listed assets, and staking derivatives are not substituted for their underlying coin. This update does not fabricate additional X Layer contracts or guarantee liquidity for every tokenized stock.

## Validation

- API catalog integration test covers added UNI/KAITO/AAVE deployments, stock/ETF/RWA metadata, actual route resolution and rate-limit handling.
- Route-cache tests cover asynchronous ordering, expiration, chain/custody isolation, sharing and concurrency limits.
- Browser fixtures reproduce unavailable stocks preceding CRV/COMP, verify the corrected ordering in all three pickers, exercise every category, and find assets after the previous 80-row cutoff at 390px and 1440px.
- Read-only quote evidence is recorded above; synthetic browser tests never access wallets or production endpoints.

Deploy the market package, API and web together. No additional AI screening or subscription cost is introduced.
