# Arc Autopilot setup and WETH/USDC audit — October 8, 2026

Arc Autopilot stopped before vault creation because its API preflight omitted `signalMarket`, although its history check reported a usable OKX signal. The UI interpreted that missing field as a changed source. The correction returns the validated signal for both **BTC-USDT → cirBTC/USDC** and **ETH-USDT → WETH/USDC**. [Sanitized evidence](ARC_MAINNET_AUTOPILOT_SETUP_FIX_2026-10-08.json) distinguishes the old hosted behavior, corrected local API, and isolated browser checks.

No payment, withdrawal, signed request, transaction broadcast, hosting deployment or push was performed. This audit did not change registry pause state, payment recipients or email-wallet activation.

## Reported failure

The supplied HAR contains 58 entries, including two HTTP-200 preflight requests for the test owner's BTC-USDT, 15-minute strategy and two successful history requests. Response bodies are absent. There is no strategy/activity/pass write in that capture; separate wallet behavior cannot be established from the HAR alone. Authorization headers and signatures were neither replayed nor copied into the audit.

A fresh unsigned hosted request reproduced `ready: true` without `signalMarket`, while the matching history check returned `signalMarket: BTC-USDT`. Source inspection confirmed that Arc's handler validated live OKX data but assigned the response field only for Robinhood. The frontend then stopped at its source-comparison guard, before the vault-creation code.

The API now returns the exact market from its validated OKX context. It retains the token-contract binding, fresh ticker, consecutive completed-history, entry quote and cap-compliant exit quote requirements. The UI requires the same selected pair and reviewed source and identifies missing metadata separately from an actual source change. It does not infer a signal to bypass an old API.

Failure messages now distinguish checks from wallet setup. A check failure does not advise pausing an invented existing strategy. If vault creation is interrupted, the user is told to refresh transactions and accounts and reuse any created account. Nested OKX wallet objects produce readable errors instead of `[object Object]`; confirmed pass purchases and resume outcomes retain their existing recovery guidance.

## Funding correction

The setup form previously checked capital plus the AI pass against wallet USDC on Arc. Arc's pass is paid from Circle Gateway. Setup now verifies wallet capital and Gateway pass funds separately and shows the Gateway balance beside the pass selection. It refreshes Gateway evidence after preflight and before requesting vault creation or policy mutation, and before a new pass payment. Existing exact-request payment recovery still skips a new-payment balance check. Funded vaults and active passes retain reuse behavior.

A fixture with **1.1 wallet USDC**, **1.5 Gateway USDC**, **1 USDC capital** and a **1.5-USDC pass** reaches the explicit creation review. A high wallet balance cannot replace insufficient Gateway funds. Missing Gateway evidence or a balance decrease during preflight stops setup before the wallet prompt. Base/Arbitrum retain their combined wallet capital/pass checks and existing market mappings.

## WETH/USDC

Public hosted checks at approximately **10:30 UTC** confirmed the official WETH contract `0x128cc466b61f542da60c70e3aa11c10e19b84edb` with 18 decimals, canonical USDC with 6 decimals, and an available two-way route. The execution catalog contained only the reviewed cirBTC and WETH mappings. Indexed memecoins remain Risk Guard discoveries.

OKX returned a current ETH-USDT ticker, 120 fifteen-minute candles and ready completed history. A **1-USDC unsigned quote** returned **0.000391044359352776 WETH**; an unsigned exit quote for that amount returned **0.998314 USDC**. These are dated route observations, not trades or guaranteed later execution prices. Hosted WETH Autopilot preflight reproduced the same missing `signalMarket` field.

The rebuilt local API was then checked against real OKX data, public RPC metadata and unsigned quotes. Both cirBTC and WETH preflights returned HTTP 200, `ready: true`, and the correct signal matching their history source. No executor worker was started.

## Validation and release

- **172 frontend tests passed.** All **342 API tests passed**, with one external Redis fixture skipped. The API suite excluded production dotenv settings so fixtures did not inherit live feature flags or provider credentials.
- API TypeScript, frontend TypeScript and the production frontend build passed. The browser artifact scan checked 236 files against 28 server-secret values and found zero leaks.
- **Nine isolated Autopilot browser scenarios passed** at 390 and 1440 pixels: cirBTC/WETH creation review, missing/changed source rejection, insufficient/unavailable Gateway funding, and a Gateway balance decrease after preflight. Wallet review validates factory calldata and then deliberately rejects; it never signs or broadcasts.
- **Two WETH Spot browser scenarios passed**, at mobile and desktop widths. The entered 0.1-USDC amount is quoted first; only the separate review action performs fresh preparation and requests a fixture wallet review. Both wallet/Gateway header rows remain visible. All eleven browser scenarios had no render errors or horizontal overflow.

README and English/Chinese app Docs describe the separate funding checks. **The user must manually release both API and frontend.** The old hosted API still lacks the field at the recorded snapshots, so a frontend-only release cannot make that response valid. Physical OKX/mobile acceptance and any new funded Autopilot creation remain pending. The wider acceptance requirements in the [migration record](ARC_MAINNET_MIGRATION.md) still apply.
