# Robinhood Chain integration

Status: seven contracts deployed and source-verified on mainnet; automation paused pending final release review.
All five research tiers have passed real USDG payment-to-report qualification through localhost, including receipt replay. Funding, wallet Spot, contract Limit execution and Autopilot registration/pass/pause/withdrawal have mainnet evidence. The scoped Autopilot worker held without calling AI or buying; this is not proof of an AI-approved autonomous trade. Full Spot/Autopilot release qualification remains in progress, not advertised as supported.

## Latest Risk Guard source check — September 24

The free mainnet evidence check covered canonical USDG, an official stock token and canonical WETH. Blockscout token, verified-contract and holder responses, RPC evidence, Sourcify and official registry context were observed for all three. GeckoTerminal token/pool/profile responses were observed for USDG and the stock token, but unavailable for WETH during this check. Missing WETH coverage remains unknown, not a contract vulnerability. The current catalog supplied no ordinary non-stock sample; negative classification cases are covered by regression tests, not claimed as a live ordinary-token test. Public source-status evidence is recorded in `packages/contracts/deployments/4663-risk-evidence-qualification.json`.

## Receipt recovery regression — September 25

Autopilot records a pending execution hash before waiting for its receipt. Subsequent cycles reconcile unresolved trades before evaluating another entry. Reconciliation accepts executor-signed fills only when the receipt targets a factory-owned vault and includes that vault's execution event; it no longer incorrectly requires the executor to be the owner. Missing receipts or unavailable ownership evidence stay pending. Confirmed, reverted and pre-submission failures have different journal explanations; a confirmation timeout never claims that no assets moved.

The actual activity-store regression uses isolated RPC fixtures for confirmed/reverted/missing receipts, ownership outages, a foreign vault and a missing execution event. It also checks recovery into the original records and coalesced ownership queries. The API suite passed 247 tests with one external-service skip, and the web suite passed all 97 tests. These tests do not establish crash-safe persistence between broadcast and hash storage, or a deployed scheduler's behavior. The on-chain qualification accounts remain paused; no hosting deployment was performed.

September 27 follow-up: successful worker receipt handling now confirms the original pending activity instead of inserting a second confirmed row. Regression coverage checks buy, partial sell and full sell, stable activity IDs/timestamps, replay without duplicates and rejection of changed transaction/vault identities. All 247 API tests passed with one external-service skip, and the API build passed. This prevents new duplicate worker rows; no historical records were deleted or rewritten.

## Manual release order

**September 27 wallet-modal correction:** commit `66537c6` removes AppKit's independent four-chain allowlist. Its Wagmi adapter and Reown modal now derive their networks from the same configuration as the PULSE selector. All 100 web tests and the web TypeScript check passed. A local Chrome DevTools inspection of the actual AppKit instance returned all five chains; clicking Robinhood in its rendered network modal selected `eip155:4663`. The repeatable `scripts/robinhood-appkit-ui-check.mjs` passed at 390px and 1440px against the real SDK/modal, not a replacement picker. These checks used disconnected browsers and did not sign or spend. Existing remote WalletConnect sessions may need reconnection after the frontend update; a production connected-wallet check remains separate.

**Network-selector deployment requirement:** both `ENABLED_NETWORKS` (API/worker) and `VITE_ENABLED_NETWORKS` (web build) must include `robinhood`. The corrected template is `xlayer,base,arbitrum,arc-testnet,robinhood`. Existing hosting variables are not changed by committing this template; the web must be rebuilt after its variable changes. The network selector is separate from payment/trading feature gates. Do not claim the deployed selector is fixed until the new build and hosting values are checked.

The appearance label is now **Dawn**, retaining the `robinhood` storage ID so existing preferences survive. The network remains named **Robinhood Chain**. A dedicated network logo replaces the previous accidental Arc fallback. Wallet selection is published only after a successful chain switch, including an explicit switch after adding an unknown chain and a verified `eth_chainId` response. Browser fixture checks cover actual selector clicks, USDG/header labels, persistent selection across eight routes and independent appearance changes at 390/1440px in light and lime themes; they do not prove a deployed wallet connection.

The follow-up surface audit corrected the landing page's three-mainnet assumption, included Robinhood in the network list/FAQ, and updated Risk Guard's visible/API methodology to describe Robinhood RPC and stock-registry evidence. Landing fixtures now include a fifth research-statistics row and correctly summed totals; light/Dawn checks passed at 390/1440px with unavailable-data recovery still covered. The GET-only `scripts/robinhood-free-workflow-check.ts` also passed against the actual local application and live providers: 138 catalog assets, exact WETH/USDG and AAPL/USDG roundtrip mappings, positive USD chart prices and 100 candles for each. It uses no wallet signing, paid endpoints or background workers.

Local verification on September 24: the complete workspace test/build run passed; after the final quote-identity guard, the API suite passed 243 tests with one external-service skip and both API/web builds passed. The app-shell fixture sweep covered eight routes across five appearances and four widths (160 route checks). Reported-flow checks passed at 390/768/1440/1920px, funding fixtures at 390/1440px across five themes, and Robinhood asset/chart fixtures at 390/1440px. Browser fixtures do not sign transactions. Known build warnings remain for large wallet/application bundles and third-party annotations/unused Tempo exports. Configured-secret-value scanning and whitespace checks passed before commit.

Follow-up contract qualification closed an adapter-version coverage gap: older account behavior tests used adapter V1. Seven local EVM behavior tests now pass, including the exact Robinhood combinations of market-protection V1, bracket V1 and Autopilot V2 with adapter V2 and a distinct approval spender. The new tests use 6-decimal settlement and 18-decimal target assets, non-parity prices, triggered protection, bracket custody/owner payout, Autopilot buy/sell and withdrawal, duplicate-action rejection and zero residual adapter allowance/balance. These use isolated mock assets/router and do not establish mainnet AI or scheduler execution.

1. Deploy the same reviewed revision to API, workers and web. Do not resume Robinhood registrations against the older worker: it cannot process this network. Keep the qualification strategy paused; its remaining paid time and 0.20 USDG deposit are preserved.
2. Set the public contract addresses from `.env.example` and `4663.json`. The market-protection V1 factory and limit-order V2 factory are different contracts. Configure the network/trading/payment flags only with the required provider credentials and a dedicated facilitator gas signer. Never deploy the local shared-signer testing exception.
3. Check live API capabilities, facilitator readiness, RPC chain ID, deployed bytecode and configured executor/oracle permissions. Complete the protected-order and autonomous-entry release checks; the current Hold is not evidence of an AI-approved buy. Do not weaken signal conditions to obtain a trade.
4. Only after those checks, the existing registry admin may clear the on-chain automation pause. Hosting deployment alone does not clear it. Confirm capabilities reflect the change before inviting users to fund automated accounts. Resume only an explicitly selected, configured and funded vault with a valid pass.
5. Verify the new worker writes fresh journal decisions with the correct contract-specific USDG market. Observe confirmations, timer behavior and delivery through the deployed application. Preserve failed attempts and distinguish holds, provider failures and confirmed fills.

The public catalog currently exposes 138 exact token identities. This is mapping coverage, not a claim that all 138 assets have executable liquidity or sufficient candle history at every moment; those checks remain per selection and per execution.

## Confirmed product choices

- Mainnet only: chain 4663. No Robinhood testnet deployments.
- Preserve the existing PULSE deployer, admin, oracle signer and executor arrangement; verify each role against existing manifests/config before signing.
- USDG is the payment and settlement asset. ETH remains necessary for gas.
- Wallet funding: explicit user-approved ETH-to-USDG quote/swap with a gas reserve; never automatically swap all ETH.
- Optional fifth appearance named Dawn, lime/ink-black, across landing and app. Its persisted ID remains `robinhood`. Preserve saved appearances, default and network selection; retain PULSE branding.

## Evidence and readiness gates

Official [network configuration](https://docs.robinhood.com/chain/connecting/) lists mainnet 4663, ETH gas, the public RPC and Blockscout. Public RPCs are rate limited; production needs a suitable provider/fallback.

[Robinhood token contracts](https://docs.robinhood.com/chain/contracts/) and [Paxos USDG deployments](https://docs.paxos.com/guides/stablecoin/usdg/mainnet) identify USDG and WETH. Before configuration, verify RPC chain ID, bytecode, token decimals, proxy implementation and signing domain on-chain. Do not copy USDC assumptions or addresses from another chain.

The [OKX network matrix](https://web3.okx.com/onchainos/dev-docs/home/supported-chain) lists Robinhood wallet/trade/market support but not payments. CDP's live capability response also omits Robinhood, and Circle Gateway does not offer USDG settlement. The [payment investigation](ROBINHOOD_PAYMENTS_RESEARCH.md) records alternative facilitators with live Robinhood advertisements, fee/access caveats and release gates. On September 20 the owner selected a [self-hosted SDK facilitator](ROBINHOOD_SELF_HOSTED_FACILITATOR.md) as the preferred route, avoiding a private third-party dependency. All five research services passed mainnet settlement and recoverable live report delivery through localhost by September 21. This does not enable Autopilot pass checkout or qualify production hosting. Do not point Robinhood requests at Base/Arbitrum settlement. No new payment challenge until input validation and readiness pass.

Verify live ETH/USDG and asset/USDG routes, spender/router identities, oracle availability, slippage and token transfer behavior before enabling funding, Spot or Autopilot. Token mapping alone is not execution readiness.

## Token Risk Guard: required design

### 1. Scope and identity

- Support arbitrary Robinhood ERC-20 contracts, not only listed pairs.
- Resolve identity by chain plus contract; reject wrong-chain addresses and lookalike symbols. Distinguish ordinary tokens, wrapped assets, USDG and canonical stock/ETF tokens.
- Show contract, asset class, source timestamps and coverage before offering a paid report. Research payment asset and analyzed token are separate concepts.

### 2. Evidence providers

- Blockscout: verification, proxy and implementation, token metadata, indexed holders. Probe v2 and documented legacy routes; do not label a 503 as unverified or safe. Cached bounded retries; honor quota failures.
- RPC: bytecode, metadata, supply, proxy slots and supported admin/pause/transfer-control reads. Unknown ABI or failed call remains unknown; no generic claim that a token is sellable.
- GeckoTerminal: discover its actual Robinhood network identifier before enabling token, pool, profile and candle requests. Validate chain/contract in responses. If absent, report unsupported indexing and use verified OKX/pool evidence without inventing Gecko data.
- Liquidity: selected-pool identity, USDG/WETH quote asset, reserves, depth/slippage, volume, pair age and price divergence. Avoid double-counting duplicated pools; distinguish market cap from FDV and both from liquidity.
- Project links: canonical issuer/registry or verified profiles first; SSRF protections, size/time limits and untrusted-content handling remain mandatory. Website presence is evidence, not endorsement.

### 3. Asset-specific risks

- USDG: issuer and redemption dependencies, freezing/pausing, proxy/admin control, supply-control/OFT contracts, bridge exposure, depeg and liquidity. Never grant a perfect score solely for issuer identity.
- Stock/ETF tokens: confirm exact deployment against the [official assets API](https://docs.robinhood.com/chain/stock-token-apis/); explain token rights without presenting them as direct share ownership.
- Track active status, transfer restrictions where evidenced, session-dependent trading capabilities, stale underlying quotes and corporate actions.
- Use the documented corporate-action multiplier consistently: REST underlying prices and multiplier-adjusted on-chain oracle prices are different units. Preserve raw contract quantities internally; display human units and distinguish underlying exposure from token price. Avoid multiplying twice.
- Read [stock-token mechanics](https://docs.robinhood.com/chain/stock-tokens/) before implementation. Separate tokenization/minting windows from secondary-market swap availability.
- Ordinary tokens: mint/admin powers, concentrated ownership, transfer taxes/restrictions, pool concentration and simulation limits. No fabricated honeypot result.

### 4. Report UX and scoring

- Order: identity and verdict; key risks/strengths; market/liquidity evidence; contract/admin controls; holders; issuer/asset-class risks; unknowns and source coverage; recommendations.
- Separate risk assessment from evidence confidence and market momentum. A rising chart or large market cap must not force a high safety score.
- Preserve existing reports and schema compatibility. Introduce asset-specific sections without presenting irrelevant promotion/social evidence as a required stablecoin or stock-token quality signal.
- Unknown data is unavailable, never zero. Use explicit observed/unavailable/not-applicable labels and explain coverage limits.
- Reports remain scoped to Risk Guard, recoverable from the same paid receipt and included in Robinhood cross-chain public statistics only after confirmed delivery.

### 5. Risk Guard acceptance tests

- Canonical USDG, WETH, one verified stock token and an ordinary token with actual evidence; mocked impostor, malformed address and no-code address.
- Provider 404/429/503/timeouts, missing holders/profile, wrong-chain pool identity, unknown market cap and duplicated liquidity.
- Proxy implementation, paused/restricted transfer evidence, stale oracle, corporate-action multiplier and differing raw/display decimals.
- Invalid input rejected before charging; paid failure recovery without double charge; reload, wallet history and report-tab isolation.
- Desktop/mobile, all five themes, accessible status contrast and no atomic balances in UI.

## Product and contract rollout sequence

1. Independent fifth theme and preference tests.
2. Read-only mainnet preflight and capability matrix: RPC, tokens, market providers, facilitator, explorers, oracle feeds, deployer gas.
3. Network registry, wallet/funding, payment asset and capabilities; gate incomplete services rather than claiming full support.
4. Risk Guard evidence adapters and asset-aware reporting; Global/Prediction research payment and history isolation.
5. Spot/Autopilot mappings, settlement, charts, portfolio/PnL, journals, scheduler, Telegram, docs and cross-chain aggregates.
6. Compile and simulate necessary registry, oracle, execution adapters, current Spot/Autopilot factories and protection contracts. Estimate total gas; deploy only required versions, verify source/constructor args and runtime code, then validate roles/allowlists/feeds.
7. Bounded mainnet end-to-end tests with the authorized test wallet, then close test positions/withdraw deposits and pause new test vaults. Mainnet-only does not eliminate local unit/fork/simulation tests.
8. Publish deployment manifest and verification links, tests and limitations; commit when ready. Hosting deployment remains with the owner.

## Current progress

The entries below are a chronological implementation log; later qualification results supersede earlier pending statuses.

### September 23 integration checkpoint (not release qualification)

- The live OKX catalog returned 138 ERC-20 asset candidates. Contract-scoped market IDs cover stocks and ordinary tokens without requiring a centralized-exchange listing. Catalog inclusion does not establish executable liquidity or sufficient history for Autopilot.
- The read-only `scripts/robinhood-trading-readiness.ts --run --catalog-only` check returned 100 hourly WETH candles and synchronized WETH/USDG and AAPL/USDG settlement marks. No signing or broadcasting occurs in catalog-only mode. These checks sample market data; they do not qualify every route.
- Analysis and chart feed prices are explicitly USD. Position valuation and order monitoring divide synchronized asset/USD marks by USDG/USD. Autopilot entry analysis uses completed contract-specific candles; saved protection levels are converted to USDG. Stale or asynchronous conversion data is rejected rather than assuming parity.
- Spot order registration and Autopilot preflight/registration validate exact target-contract identity and canonical USDG for contract-scoped markets. Picker labels show asset names and abbreviated addresses rather than internal market IDs.
- Execution configuration receipts are in `packages/contracts/deployments/4663-execution-configuration.json`. Router/spender and keeper/executor configuration succeeded; automation remains paused pending bounded end-to-end qualification.
- The combined commit must preserve the corrections from thread `01a0b8ce-4c71-7193-962a-5daa6f1f00dd`, documented in `SERVICE_RELIABILITY_AUDIT.md`: Risk Guard history/scoring, report layout/focus, free technical Explore with an optional recent bullish-report filter, manual Spot access, full report delivery and Telegram reliability. No automatic paid AI discovery screening was agreed.
- Still required before release: full browser/API workflow regression, funding transaction and contract-account Spot/Autopilot qualification, final documentation consistency review and reviewed commit. No hosting deployment is authorized in this task.
- Subsequent local checks: API suite 235 passed / one external-service test skipped; web suite 93 passed. The referenced thread's reported-flow browser suite passed at 390, 768, 1440 and 1920 pixels. Robinhood contract-picker/chart fixtures passed at 390 and 1440 pixels, including USD chart labels, USDG settlement disclosure, exact market selection and no horizontal overflow. These browser fixtures do not establish mainnet execution.
- Added selected-timeframe Autopilot preflight and runtime checks for at least 50 completed, contiguous, recent candles, plus available synchronized USDG pricing. The setup sends its timeframe before wallet transactions, so inadequate market data is reported before funding rather than discovered only after purchasing a pass.
- Mainnet funding qualification completed: 0.00004 ETH received 0.107274 USDG, spending 0.00001210126976 ETH in gas. The successful receipt and exact transaction hash are recorded in `packages/contracts/deployments/4663-funding-qualification.json`. The minimum received was independently checked from USDG transfer logs. Rerunning the script reconciled the same transaction without another swap. This supersedes the earlier pending funding-transaction status, not the remaining contract-account Spot/Autopilot qualification.
- Funding UI now polls confirmation on the Robinhood RPC, refreshes balances after a confirmed receipt, distinguishes reverted and unavailable receipts, and disables another swap while confirmation remains unknown. Receipt-status fixture coverage supplements, rather than replaces, the real funding receipt.
- Mainnet wallet Spot round trip completed using the product's OKX preparation and calldata-validation functions: 0.10 USDG bought WETH; selling only the WETH received by that transaction returned 0.09991 USDG before gas. Both input debits and output minimums were verified from token transfer receipts. Exact approvals were consumed; final allowance checks found no residual test allowance. The four transaction hashes and gas costs are in `packages/contracts/deployments/4663-spot-qualification.json`. This qualifies the wallet execution route, not yet browser activity persistence, protected/limit contract accounts, or autonomous vault execution.
- Spot retry qualification reconciled all four original receipts and exited without sending another transaction. Read-only factory estimates then returned approximately 0.00013504 ETH for an Autopilot vault and 0.00009950 ETH for a Spot limit account, including 25% gas buffers. The observed 0.00028227 ETH balance leaves insufficient comfortable headroom for both workflows' configuration, execution and cleanup; an additional 0.0004 ETH was requested. No account-creation transaction was sent by that estimate.

### September 24 local checkpoint — funded account qualification

- The requested top-up was verified: 0.000648079951282079 ETH before account creation. The gas-funding dependency above is resolved.
- The full provider catalog still returned 138 ERC-20 candidates. WETH history and WETH/USDG and AAPL/USDG settlement prices were available. This is catalog and sampled data verification, not a claim that every candidate has liquidity.
- Robinhood Autopilot preflight/registration and Spot order registration now reject ticker-only research identifiers. Both workers also reject persisted ticker-only Robinhood entries before evaluation or execution. Other networks retain their existing identifiers.
- Automated readiness checks now read the mainnet registry pause state and fail closed on wrong-chain or unavailable RPC. A paused registry disables advertised limit/Autopilot readiness and blocks Autopilot setup preflight before funding; ordinary owner-signed wallet swaps remain separate.
- `scripts/robinhood-account-qualification.ts` simulated and created one Autopilot vault and one Spot limit account, validating receipts, factory membership and ownership. Both receipt hashes and addresses are in `packages/contracts/deployments/4663-account-qualification.json`. Total actual gas was 0.000152972876354 ETH. The script moves no trading capital and does not resume automation. Re-running reconciled the original receipts without another creation transaction.
- API regression before the new readiness helper: 239 passed, one external-service test skipped. The subsequent targeted identity/readiness suite passed all 10 tests and the API TypeScript build passed.
- Remaining release work includes account configuration, funded limit/Autopilot execution and pass workflow qualification, browser regression, documentation review and commit. Factory creation alone does not qualify autonomous trading. No hosting deployment has been performed.

### September 24 funded workflow results

- The limit account executed a 0.10 USDG buy through the deployed adapter/router and paid 0.000037150034786247 WETH to its owner. Only that test output was sold afterward. The eight successful transactions and restored registry pause are recorded in `4663-limit-qualification.json`. Re-running reconciled receipts without creating another order. This test covers the deployed limit contract and swap adapter; it does not establish browser or scheduler coverage by itself.
- The paused Autopilot vault was configured with canonical WETH/USDG, a 0.11 USDG on-chain per-trade maximum, a 0.40 USDG daily turnover cap, and 0.20 USDG funding. Owner-signed registration through the real API succeeded; `4663-autopilot-setup-qualification.json` records the configuration and deposit.
- A real 1.50 USDG Entry Pass purchase returned HTTP 201, with 24 paused hours and three confirmations persisted in Redis. Replaying the same authorization used the same settlement receipt and neither charged again nor extended time/confirmations. See `4663-autopilot-pass-qualification.json`.
- The scoped live Autopilot cycle resumed its pass timer, evaluated real contract-specific candles and returned a valid trend-following Hold (close below SMA20 and SMA20 below SMA50). No Grok call or buy was appropriate under those conditions. Pause froze the timer; a 0.01 USDG owner withdrawal was verified and returned to the vault. Both vault and registry were left paused. See `4663-autopilot-cycle-qualification.json`. This is not evidence of a live AI-approved Buy/Sell cycle.
- The shared Redis journal exposed an older independently running worker that does not recognize Robinhood (`Cannot read properties of undefined (reading 'oracle')`). Its failed evaluations were preserved, not erased. The qualification registration was separately paused using a compare-and-swap update; the 0.20 USDG capital and remaining paid time stay owner-controlled. The current workers also skip unrecognized network records. The unrelated local Mantle MCP process was not modified or stopped. Deploying this release is still manual and is required before a hosting worker can process Robinhood.
- Market-buy TP/SL required one additional deployed contract: the separate `SpotOrderAccountFactoryV1`, recorded as `spotProtectionFactory` in the manifest. All seven contracts have exact Sourcify creation/runtime matches. Local `.env`, `.env.example`, published API addresses and regression tests now distinguish that V1 protection factory from the existing V2 limit factory. No hosting deployment was performed.

- Added optional appearance and decoupled appearance typing from supported networks.
- Added preference regressions and Robinhood network metadata/API aliases. The new network is not enabled by default; live settlement and funding swaps remain gated.
- On September 19, read-only probes confirmed mainnet identity, USDG/WETH bytecode and metadata, and USDG's signing domain. Staged USDG price/capability helpers and negative-input tests added; not enabled as a payment adapter.
- GeckoTerminal lists `robinhood`; Blockscout contract evidence returned HTTP 403 here. Explorer fallback and coverage handling remain required.
- After owner funding, deployed the current six-contract suite directly on September 19 and verified exact creation/runtime matches using Sourcify. Public addresses, transaction hashes, constructor arguments, source snapshot and verification results are in `packages/contracts/deployments/4663.json`.
- Deployment/configuration receipt gas totals are approximately 0.00047 ETH; recorded remaining balance was 0.00049752 ETH. No USDG spent. Registry automation is paused; routers, spenders, keepers and executors are not enabled for trading.
- All eight contract tests and fourteen payment-package tests passed. The staged seller integration creates explicit USDG requirements through the installed SDK; a real paid request has not yet passed.
- No production jobs or hosting configuration were changed. Do not enable the chain merely because contracts exist: routing, oracle updates, payment recovery and full-product integration remain required.
- All six verified addresses are recorded in local `.env` and the public `.env.example`, with a manifest consistency regression test. The V2 Spot factory uses `ROBINHOOD_SPOT_LIMIT_FACTORY_ADDRESS`; it is not a legacy V1 order factory. These entries do not enable execution.
- Risk Guard now has chain-scoped USDG/WETH identity context, RPC evidence and independently scoped Sourcify source verification alongside the GeckoTerminal adapter. Explorer outages remain unavailable evidence, not a safety verdict. Stock-registry enrichment and full paid workflow checks are still outstanding.
- Focused network, payment and Risk Guard regressions passed (23 tests), followed by two payment-gate regressions and one deployment-template test. Real Robinhood paid routes currently return an explicit unavailable response without issuing a foreign-chain challenge, including trailing-slash URLs.
- Added the embedded self-hosted SDK facilitator, merchant-restricted gas signer, persistent Redis authorization journal, distributed signer lock/pre-broadcast nonce reservation, receipt checks and HTTP middleware. Official buyer SDK interoperability and localhost lost-response/retry fixtures pass.
- September 20 update: gate/client recovery are wired. A real 0.20 USDG Risk Guard payment delivered a live report through localhost; restart/replay and authenticated full-report retrieval passed without another charge. Transaction and exact gas cost are recorded in the facilitator guide. The owner explicitly approved the shared admin/buyer signer for this test only; production requires its replacement. Global/Prediction paid qualification, funding swap, Spot and Autopilot remain outstanding.
- September 21: Global Quick/Pro and Prediction Quick/Pro delivered real live Grok reports with independent on-chain receipt checks. Every saved authorization replay returned the original job and a usable private recovery capability, without another charge. Global Quick also recovered after a process restart. See the facilitator guide for all transaction IDs and gas costs.
- Fixed the Robinhood funding drawer's inactive USDC/CDP button. It now prepares ETH → USDG through the live OKX Robinhood router, validates the verified deployed DAG ABI, enforces a 0.5% minimum-received bound and 1% price-impact ceiling, expires quotes, checks the active wallet/chain and gas reserve, and simulates before wallet submission. Live RPC simulation passed; no funding swap has yet been broadcast. Funding does not use the payment facilitator or require ERC-20 approval.
- Live quote/calldata discovery succeeded for ETH → USDG, USDG → WETH and WETH → USDG. This is not yet contract-account execution qualification; registry automation remains paused, with router/spender/oracle/role configuration and Spot/Autopilot E2E outstanding.
