# Arc mainnet migration audit — updated 2026-10-05

PULSE's active Arc network is now **`arc`, chain 5042, `eip155:5042`, wallet ID `0x13b2`**. Testnet is retired from routing, discovery, wallet connections and execution workers. Seven PULSE core contracts and four factory-created qualification accounts/vaults are deployed and source-verified with exact creation/runtime matches on Sourcify. Router/spender and execution/oracle roles are configured. Live acceptance remains in progress.

## Goal and completion criteria

Deliver fully wired PULSE on Arc mainnet: deploy and source-verify every required smart contract; configure their roles and routes; connect all APIs, SDKs, payments, wallet integrations and UI/UX flows; and verify existing PULSE functions end to end on mainnet. Retire testnet from active operation while preserving historical records. The goal remains active until deployment, configuration and live acceptance are complete. Production Circle email wallets remain in scope while the user's subscription/App ID setup is pending.

The user's expanded UI/UX completion requirements are part of this same goal:

- Show Arc mainnet on the landing page, network coverage and research chart. Keep retired testnet deliveries in explicitly historical coverage; never relabel them as mainnet or invent mainnet counts.
- Make Arc mainnet selectable in the app's network/RPC selector and actual Reown wallet kit, with chain **5042**, RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io` and **18-decimal native USDC**. The research/trading ERC-20 USDC interface remains six decimals.
- Keep app selection, wallet-kit selection, connected wallet chain and saved preference consistent. Verify add/switch, rejected or ineffective switching and reload behavior.
- Audit the rendered landing page, wallet/funding controls, network selector and existing research/Spot/Autopilot/history/docs flows on desktop and mobile, including Chinese copy, accessible controls and unavailable-feature states.
- Record direct browser evidence and distinguish local UI wiring from remaining production Circle and hosted acceptance. Deployment and pushing remain reserved for the user's manual execution.

## Verified network identity

| Setting | Mainnet value |
| --- | --- |
| RPC / explorer | `https://rpc.mainnet.arc.io` / `https://explorer.arc.io` |
| Native gas asset | USDC, **18 decimals** |
| ERC-20 payment/trading interface | `0x3600000000000000000000000000000000000000`, **6 decimals** |
| Gateway API / domain | `https://gateway-api.circle.com` / **26** |
| GatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` |
| Nanopayment signing domain | `GatewayWalletBatched`, version `1` |
| Circle wallet blockchain | `ARC` |

Native and ERC-20 USDC represent the same wallet balance and must not be summed. Gateway balance is separate. Testnet funds, contracts and sessions do not become mainnet assets.

Arc receipts can also contain native USDC `Transfer` events from the system ledger `0xfffffffffffffffffffffffffffffffffffffffe`, alongside the ERC-20 USDC transfer for the same payout. PULSE's execution-fill indexer now excludes that system ledger on Arc so one payout is counted once. A real vault exit exposed the duplicate; regression tests cover buys, sells and genuinely ambiguous third-token receipts. See [Arc event indexing](https://docs.arc.io/integrate/infrastructure/indexing-events), [EIP-7708's system event address](https://eips.ethereum.org/EIPS/eip-7708) and the [live exit evidence](../packages/contracts/deployments/5042-autopilot-exit-qualification.json).

Sources: [Arc connection reference](https://docs.arc.io/arc/references/connect-to-arc), [Arc contracts](https://docs.arc.io/arc/references/contract-addresses), [Gateway supported chains](https://developers.circle.com/gateway/references/supported-blockchains), [Circle wallet support](https://developers.circle.com/wallets/supported-blockchains).

Live read-only probes verified the chain, USDC decimals, Gateway/WETH/cirBTC bytecode, production Gateway nanopayments and a prepared OKX USDC/WETH route with decoded intent/minimum-output validation. [Refreshed network evidence](ARC_MAINNET_READINESS_2026-10-05.json) and [API evidence](ARC_MAINNET_API_READINESS.json) record results. Read-only preparation alone does not prove funded execution or every asset/amount route; funded acceptance is recorded below. Router/spender addresses match the [current OKX contract reference](https://web3.okx.com/onchainos/dev-docs/trade/dex-smart-contract).

## Function coverage

| Function | Mainnet evidence | Outstanding release acceptance |
| --- | --- | --- |
| Global Quick/Pro | Both paid live reports delivered; authenticated SDK recovery and same-payment replay passed | Signed browser and hosted rollout checks |
| Prediction Quick/Pro | Both paid live reports delivered against a usable CLOB selection; recovery/replay passed | Signed browser and hosted rollout checks |
| Risk Guard | Paid live scan; actual buyer/MCP purchase; browser purchase, reload recovery and signed history passed | Hosted and production wallet acceptance; source/liquidity evidence remains explicitly unknown where unavailable |
| Gateway funding | Production domain 26 credited; 3.10 USDC total paid services; actual browser funded 0.20 USDC | Hosted and production wallet acceptance |
| Browser wallets | Mainnet switching/domain tests; mobile/desktop routes; actual browser funding/payment/recovery/history through a bounded local signing harness | Production Circle/extension qualification and remaining signed UI flows |
| Email wallets | ARC EOAs, mainnet signatures and session/authentication code wired | Production Circle App ID, subscription, SMTP/OTP and live login/signing |
| Agents / SDK / MCP | Actual buyer → MCP → Circle → live report; durable lost-response recovery and free MCP/SDK retrieval passed | Hosted metadata and production deployment acceptance |
| Spot Market | Confirmed 0.10 USDC/WETH round trip, only acquired tokens sold | Actual signed UI workflow and hosted acceptance |
| Limit / TP-SL / bracket | Source-verified instances; limit fill; real scoped keeper/API; bracket and V1 protection exits; pause/update; cancellation returned escrow | Actual signed UI workflows and hosted acceptance |
| Autopilot | Paid 24h pass/replay; real live AI worker buy; paused timer, withdrawal and pass return; bounded vault exit and capital recovery | Remaining signed UI flows and production acceptance; live AI/risk-worker sell has not been separately qualified |
| Activity/history | Real vault sell enriched correctly; signed browser report history reopened its paid report; legacy identity retained | Continuity after hosted rollout |

Legacy reports and Telegram history retain their original testnet identity. Stored reports remain recoverable; testnet receipts cannot authorize mainnet regeneration. Queued legacy jobs require reconciliation. Appearance ID `arc-testnet` remains only for the saved Horizon theme.

## Environment

```dotenv
ENABLED_NETWORKS=xlayer,base,arbitrum,arc,robinhood
VITE_ENABLED_NETWORKS=xlayer,base,arbitrum,arc,robinhood
FEATURE_ARC_MAINNET=1
FEATURE_ARC_PAYMENTS=1
CIRCLE_GATEWAY_ENABLED=1
ARC_AI_MODE=live
ARC_RPC_URL=https://rpc.mainnet.arc.io
CIRCLE_GATEWAY_MAINNET_URL=https://gateway-api.circle.com
CIRCLE_GATEWAY_ACCEPTED_NETWORKS=eip155:5042
CIRCLE_GATEWAY_SELLER_ADDRESS=<seller EVM address>
CIRCLE_API_KEY_MAINNET=<production server secret>
VITE_CIRCLE_APP_ID=<public App ID from the same production Circle project>
FEATURE_CIRCLE_MAINNET_WALLETS=0
FEATURE_ARC_TRADING=0
```

`CIRCLE_API_KEY_MAINNET` takes precedence over legacy `CIRCLE_API_KEY`. Test keys are rejected for mainnet email wallets. A production key and UUID App ID are present locally, but the user confirmed that production setup is still pending and explicitly requested that email wallets stay disabled. Keep `FEATURE_CIRCLE_MAINNET_WALLETS=0` until the matching production app, subscription and email setup are ready. Obtain or check the App ID from Circle Console → Mainnet → Wallets → User Controlled → Configurator and configure Email/SMTP there. Once setup is complete, enable the flag, restart the API and rebuild the frontend. Set the server key on Railway and the public App ID on Vercel before deployment; secrets never belong in `VITE_*`.

These mainnet bindings are now filled in `.env`, `.env.example`, `.env.local.example` and `.env.production.example`:

```dotenv
ARC_PULSE_REGISTRY_ADDRESS=0x67e14b9545b069afbd78e195ec37914466e1807f
ARC_ORACLE_ROUTER_ADDRESS=0x8cf94c9fabb4a740cf50ebd438b4896101d665a5
ARC_EXECUTION_ADAPTER_ADDRESS=0xa61bea98e42a943874dc80d958b157173b9f5a6e
ARC_SPOT_ORDER_FACTORY_ADDRESS=0xa4546529b1174765d4d8e256c951365359c853fa
ARC_SPOT_LIMIT_FACTORY_ADDRESS=0x3189d82c8abeb35e8ca80d079781fc5096eca289
ARC_SPOT_BRACKET_FACTORY_ADDRESS=0xc2cf8dd0ba67142c539053c51fc1da9cc52e1af3
ARC_AUTOPILOT_VAULT_FACTORY_ADDRESS=0xe54dc99228463dad2c4f2762c9e1baf2d6f2ee07
ARC_OKX_ROUTER_ADDRESS=0x4E3bcCE28cAf98A143Fd8BD9e4875ccAb3E7bBE0
ARC_OKX_APPROVAL_ADDRESS=0x2B9899bC46Bf0eE094225995f4bD496d42f261Af
```

Arc has no fallback to another chain's PULSE contracts. Automation readiness checks the chain, bytecode, factory wiring and on-chain pause state before paid activation or keeper work. Keep `FEATURE_ARC_TRADING=0` until release acceptance is complete. The seven PULSE core addresses are our deployed, Sourcify-verified contracts; the two OKX addresses are existing third-party contracts checked against official routing configuration and live bytecode, not PULSE deployments or PULSE source-verification claims.

## Deployment preparation

`npm run plan:arc` is read-only. [Initial deployment plan](ARC_MAINNET_DEPLOYMENT_PLAN_2026-10-04.json) records the pre-funding seven-contract plan, roles and predicted addresses. The deployer/guardian/oracle updater is `0xA7d827622c4F9c884cA8F751b2060DD767F18683`. Deployment is complete; use the manifest and confirmed receipts rather than treating the initial estimate or zero starting balance as current state.

`packages/contracts/scripts/deploy-arc.mjs` defaults to read-only. Broadcasting requires `--broadcast --max-spend-usdc=<approved cap>`. It checks signer/chain/nonces/balance, journals hashes before broadcast, refuses an existing manifest and verifies receipts/code/roles. It deploys the registry, oracle, V2 adapter, V2 limit factory, V2 Autopilot factory, bracket factory and V1 protection factory, leaving automation **paused**, `productionReady=false`, `tradingEnabled=false`.

Verified router/spender and keeper/executor/oracle roles are configured. Complete bounded live acceptance. Only then unpause, enable `FEATURE_ARC_TRADING=1` and record qualification in `packages/contracts/deployments/5042.json`. Deployment alone does not qualify execution.

Deployment is now complete: [mainnet manifest](../packages/contracts/deployments/5042.json) records seven deployments plus pause/adapter configuration receipts, exact Sourcify matches and **0.16482280241136 USDC** in actual gas. The user approved a **5 USDC total spending limit** and explicitly approved public Sourcify source submission. [Acceptance budget](ARC_MAINNET_ACCEPTANCE_BUDGET_2026-10-04.json) records phase caps. Public contract bindings are published in the API registry; `npm run wire:arc -- --write-env` independently checks route bytecode and updates only public Arc settings. `npm run configure:arc -- --broadcast --max-gas-usdc=0.10` configures approved routes/roles and preserves the on-chain pause.

## Validation

Regression tests run with `NODE_ENV=test` and `PULSE_SKIP_DOTENV=1`, excluding real credentials/workers. Checks cover retired-network rejection, mainnet configuration, Circle signing, agent payment domains, SDK recovery, Gateway balance evidence, mirrored USDC events and interrupted-payment recovery. The initial migration's full suite passed **546 tests**, with **one optional Redis test skipped** and no failures, and its full production build compiled contracts, packages/SDKs, API and Vite UI. `npm run check:arc-qualification` also passed, including the capital audit script. The subsequent UI/wallet review passed **149 frontend tests** and **44 API application tests**, with successful frontend and API type checks/builds. The final web build uses the nine public settings exported for the selected production API; Vite's runner loader avoids the workspace sandbox's parent-directory restriction. The Vite proxy forwards `/arc` in same-origin mode. The refreshed [browser artifact scan](ARC_MAINNET_BROWSER_ARTIFACT_AUDIT_2026-10-05.json) checked 28 server configuration values across **235 generated artifacts**, finding no leaks. These focused results supplement the initial full-suite baseline rather than claiming a new full-repository run.

`npm run readiness:arc -- --output .tmp/arc-readiness.json` repeats live read-only checks without signing or spending; `--strict` fails while prerequisites remain incomplete. Secrets and fetched Circle user records are never printed.

## Funded acceptance progress

Access was restored and the previously interrupted checks completed without repeating settled purchases or completed trades. The user-funded deployer completed a 0.10 USDC/WETH round trip, returning 0.0994 USDC. Four factory instances are [source-verified](../packages/contracts/deployments/5042-instance-verification.json). [Protection qualification](../packages/contracts/deployments/5042-protection-qualification.json) records both bracket and V1 TP/SL exits, pause/resume/update and exact 0.01 USDC cancellation recovery. [Keeper qualification](../packages/contracts/deployments/5042-keeper-qualification.json) records SDK/API registration and a real, isolated worker fill; only qualification output was subsequently sold.

Risk Guard, Global Quick/Pro and Prediction Quick/Pro delivered five live reports with authenticated free SDK retrieval, unauthorized-read rejection and same-authorization replay. The adapter publishes canonical Arc resource URLs and persists request-bound settlement receipts before report work. Replays reuse the stored receipt; changed requests are rejected. Uncertain claimed payments require reconciliation and never silently create a second charge.

The [24-hour Autopilot pass](../packages/contracts/deployments/5042-autopilot-pass-qualification.json) cost 1.50 USDC; replay neither extended its duration nor charged again. The [live Autopilot cycle](../packages/contracts/deployments/5042-autopilot-cycle-qualification.json) used real AI and executed a bounded WETH buy, then checked paused timers, a withdrawal and pass return. The [exit qualification](../packages/contracts/deployments/5042-autopilot-exit-qualification.json) closed that acquired position through the approved adapter and recovered 0.199294 USDC of vault cash. The exit was an explicit qualification close with a real price, not evidence of a live AI/risk-worker sell decision. Registry and vault pauses were restored.

The [actual agent workflow](../packages/contracts/deployments/5042-agent-paid-qualification.json) used `@pulse/buyer`, MCP and production Circle to buy a live 0.20 USDC Risk report. Deliberately losing its settled response and constructing a new buyer client with the same encrypted Redis recovery store recovered the same job. Free MCP/SDK retrieval and replay left Gateway at zero. Production agents should supply a **private durable `paymentRecoveryStore`**, with cross-process serialization through `exclusive`; the default store is process-local and cannot recover across a process restart. Pin `expectedPayTo` and set a maximum payment budget.

The [actual browser workflow](../packages/contracts/deployments/5042-browser-paid-qualification.json) connected a bounded local wallet provider, funded Gateway with 0.20 USDC through the UI and purchased a live Risk report. A deliberately lost settled response was recovered after a real page reload using its saved authorization; **zero additional payment signatures** were requested. Signed wallet history sync and opening the stored report passed, as did free authorized report access and rejection without authorization. The signing key remained on the local server. This qualifies the tested browser flow through a narrow acceptance harness; production Circle/extension wallets and other signed UI flows still need acceptance.

Browser recovery uncovered and fixed two defects: the pre-payment balance guard blocked recovery after the first authorization consumed Gateway funds, and an unbound native `fetch` call failed after reload. Exact saved-request matching now permits recovery without requiring a new balance/payment; genuinely new requests retain the balance guard. Native fetch receives its proper global receiver. Regression tests and the rebuilt production UI passed.

The [balance audit](ARC_MAINNET_BALANCE_AUDIT_2026-10-05.json) reconciles all **92 transactions**, with no missing nonces: gas **0.431935778921677042 USDC**, paid services **3.10 USDC**, and conservative total spend **3.534676818912683849 USDC**, including realized trade losses. **1.465323181087316151 USDC** remains under the approved 5 USDC cap. Wallet balance is 1.831394181087316151 USDC; Gateway and vault balances are zero. The [capital audit](ARC_MAINNET_CAPITAL_AUDIT_2026-10-05.json) confirms all four qualification accounts hold zero USDC/WETH, all checked qualification allowances are zero, and registry/vault remain paused. Qualification journals preserve receipts and refuse duplicate actions.

The user confirmed that production email-wallet setup remains pending and requested that email wallets stay disabled. Trading and email-wallet activation remain disabled. Hosted deployment and the remaining signed UI acceptance are still outstanding; the goal remains active and this audit does not certify a fully released PULSE mainnet deployment.

The wallet review fixed an incomplete Circle login state: OTP alone previously committed a session and could restrict the network picker after wallet creation failed. A login now commits its SDK and session together only after an Arc mainnet EOA is available. Failure preserves any prior working session; testnet, SCA and unspecified-account-type wallets are excluded from mainnet selection and restoration. Five offline regression cases cover cancellation, pending initialization, replacement failure, returning testnet-user migration and incompatible cached accounts. These mocked SDK/API regressions do not qualify live production Circle login. A LIVE key and UUID App ID are now present locally, but the user confirmed that production setup is still pending; the local email feature flag and hosted email status remain disabled.

The same review corrected stale testnet/analysis-only claims in the docs UI and Chinese translations. Arc mainnet uses USDC through Circle Gateway, and Spot/Autopilot availability depends on verified contracts, routes and activation. Historical testnet activity retains its original labels.

The expanded [UI/UX audit](ARC_MAINNET_UI_UX_AUDIT_2026-10-05.json) covers seven workspaces at desktop and 390-pixel mobile widths, the actual Reown network modal, keyboard selection, saved preferences and non-signing wallet-switch fixtures. Arc is selectable as chain 5042 in both selectors, and disconnected selections synchronize in both directions. Restoration reads the connected wallet's current chain; legacy testnet sessions are rejected. Rejected or ineffective switches preserve selection and show an accessible alert on every workspace. Chinese Arc funding instructions and unavailable Gateway balances are corrected. The landing page shows five mainnet integrations, mainnet-only charts/totals and separate expandable retired-testnet history. Older API snapshots cannot hide Arc or convert its missing coverage to zero. The final local release build also loaded real hosted activity directly and selected Arc with Reown on chain 5042; no financial actions were performed in this UI continuation.

Cloud export now separates private Railway settings from public Vercel settings and includes modified existing settings, rather than just variables added after an old commit. The ignored review files can be prepared for the selected service with `npm run env:cloud:export -- --production --api-origin=https://pulse-api-production-7aae.up.railway.app`. These options set production runtime mode and align server, browser and Telegram API origins while preserving local development settings. Seven focused checks cover secret/test-wallet exclusion, credential-looking browser variables, qualification signer exclusion, public report-key fixture exclusion, dotenv round trips and explicit origin validation/alignment. No host configuration or deployment was changed. Before production activation, configure and authorize a dedicated executor rather than reuse the qualification owner.

The final commit scan found the local `REPORT_ENCRYPTION_KEY` matches an existing public repeated-character test fixture. The Railway export omits it. Preserve the secure key already protecting production reports; for a new isolated store, provision a securely generated key. Replacing a key for existing encrypted reports requires a separate re-encryption migration. The local qualification key and data were preserved so its stored reports remain recoverable.

The earlier [hosted probes](ARC_MAINNET_HOSTED_AUDIT_2026-10-05.json) found older metadata and did not qualify those hosts. Refreshed public reads in the [UI/UX audit](ARC_MAINNET_UI_UX_AUDIT_2026-10-05.json) now confirm that the user-selected **`pulse-api-production-7aae`**, at **`https://pulse-api-production-7aae.up.railway.app`**, returns chain 5042 for both selected and Arc-prefixed metadata. Its seven PULSE contract bindings match the verified deployments; it advertises two Arc pairs and online Redis. Public activity distinguishes mainnet Arc from retired testnet history. Spot/Autopilot remain disabled with an execution-evidence-unavailable reason, and Circle email login remains disabled pending production setup. The hosted metadata still reports the global OKX `paymentMode` beside Circle Gateway; the local API fix now reports the selected provider and passes HTTP regressions for Arc, Base and X Layer while preserving mock-mode disclosure. Releasing that fix, the frontend, and remaining signed acceptance/activation stays manual. No deployment or push was performed.

The [production dependency audit](ARC_MAINNET_DEPENDENCY_AUDIT_2026-10-05.json) initially reported seven high and 35 moderate affected packages. Reviewed compatible fixes now pin Axios 1.20.0, Undici 6.29.0, gRPC 1.13.6, fast-uri 3.1.8, qs 6.16.0, morgan 1.12.1 and ws 8.22.0 on its 8.x branch. The repaired lockfile passes a clean-install dry run. The refreshed production audit has **zero high/critical** findings; two moderate advisories still propagate through 22 older wallet dependency entries and remain tracked for wallet release review. The URI decoder's patched ESM API cannot be blindly substituted into its CommonJS caller. UUID's advisory affects buffered v3/v5/v6 calls; inspected Circle and MetaMask utility callers use v4. See [the decoder's upstream release](https://github.com/SamVerschueren/decode-uri-component/releases) and [UUID's advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq). This audit does not claim every dependency is vulnerability-free.

The full audit, including build dependencies, exposed two additional high findings in adm-zip and tmp. Those were patched to **0.6.1** and **0.2.7** without changing compiler 0.8.26 or Solidity sources. The final full dependency audit now has **zero high/critical**, 22 moderate and six low affected entries. The contract suite passed **14/14** after these patches, including a new assertion reproducing the exact deployment creation-data hashes of **all seven** source-verified core contracts. The final clean-install dry run passed. The cloud export suite subsequently passed **7/7**, including the selected service's explicit production origins and report fixture exclusion. These focused checks cover the final build-tool and export changes after the 546-test full-suite run.
