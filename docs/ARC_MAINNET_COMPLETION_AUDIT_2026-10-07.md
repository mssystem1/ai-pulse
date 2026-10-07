# Arc mainnet completion audit — October 7, 2026

The migration is implemented across contracts, configuration, APIs, SDKs, workers, landing page and app. Full production acceptance is **not yet proven**. This continuation used public read-only providers and isolated worker fixtures, sent **no transactions**, spent **0 USDC**, and performed no hosting deployment or push.

[Current public evidence](ARC_MAINNET_COMPLETION_AUDIT_2026-10-07.json) was collected at 18:33–18:35 UTC. [Infrastructure readiness](ARC_MAINNET_READINESS_2026-10-07.json) independently checked Arc RPC, Gateway support, deployed runtime hashes and an unsigned executable OKX route. The operational registry is unpaused; the full release gate remains false because production acceptance is incomplete. Source verification and operational activation are separate facts.

## Requirement-by-requirement evidence

| Requirement | Evidence and current result | Completion limit |
| --- | --- | --- |
| Deploy and publicly verify all necessary contracts | Fresh Sourcify API checks returned exact creation and runtime matches for all seven core contracts and all four qualification instances. All eleven addresses have current chain-5042 bytecode; all seven core runtime hashes match the manifest. | Does not certify every production wallet workflow. |
| Fill all nine requested environment bindings | `.env`, `.env.example`, `.env.local.example` and `.env.production.example` each contain exactly one matching value for every requested binding. The two OKX addresses belong to existing third-party routing contracts. | Environment exports still require the user's manual hosting release. Private environment files are excluded from Git. |
| Retire Arc testnet execution and payments | New network selection, payment domains and execution use chain 5042. Tests reject retired chain 5042002 requests. Legacy report/history identity and the saved Horizon appearance ID remain preserved. | Historical testnet activity must retain its original identity. |
| Wire Global Market to live OKX data | Hosted catalog returned 1,143 OKX instruments. Fresh BTC-USDT and ETH-USDT tickers and Autopilot history gates passed. A native indexed memecoin market returned 422. | Paid report delivery is covered by prior confirmed qualification journals and the October 7 HAR audit, not a new purchase here. |
| Map Spot and Autopilot to real Arc assets | Hosted routes resolve BTC-USDT to official eight-decimal cirBTC and ETH-USDT to eighteen-decimal WETH, both against canonical USDC. The execution catalog contains exactly these two reviewed pairs. | Each signed trade still requires a fresh amount-specific quote; broad indexed tokens cannot become execution mappings. |
| Populate Risk Guard with Arc tokens and memecoins | Hosted discovery returned 2,004 address-scoped tokens and included official cirBTC. | Discovery is not an endorsement or proof that every token has complete source, liquidity or market evidence. |
| Enable automated Spot and Autopilot | Public registry read confirmed `automationPaused=false`. Hosted Market, Limit, bracket, TP/SL and Autopilot capabilities are enabled with Redis persistence. | One initial public capabilities request failed; a repeat returned HTTP 200 in 2,395 ms. Both observations are preserved. Individual owner pause and policy controls still apply. |
| Keep cirBTC amounts correct throughout automation | Ten Arc worker tests passed, including new actual-control-flow cirBTC scenarios: 0.10 USDC at the fixture price buys 120 atomic cirBTC units; a 119-unit signed limit minimum reaches the adapter; limit, bracket and TP/SL fills, Autopilot receipt recovery, bounded partial/final exits and owner pause all pass with eight decimals. | Chain, provider and storage clients are isolated fixtures. This is not a funded live cirBTC transaction or a live deterministic risk-worker sell qualification. |
| Wire Gateway deposit, withdrawal and Max | Prior live deposit/withdrawal receipts, current fee-aware unsigned Max evidence, frontend regressions and 390px browser checks are recorded in the [Gateway audit](ARC_MAINNET_GATEWAY_AUDIT_2026-10-07.md). | A signed physical mobile withdrawal with a gas-funded wallet still needs acceptance after manual release. |
| Preserve the existing x402 recipient and account for funds | `PAY_TO_ADDRESS` / `VITE_PAY_TO_ADDRESS` are canonical. The [public receipts and balances](ARC_MAINNET_USDC_RECEIPTS_2026-10-07.json) reconcile the buyer's USDC and seller's Gateway proceeds. | The 3.9-USDC seller balance is the dated audit snapshot; it is not a promise of a later balance. No seller funds were moved. |
| Wire APIs, SDKs and UI/UX | Existing complete API, frontend, payments, SDK, cloud-env and browser evidence is indexed by the [migration record](ARC_MAINNET_MIGRATION.md). Current hosted metadata, routes and market gates agree on Arc mainnet. README and English/Chinese app Docs describe wallet trading capital, Gateway payments, withdrawal and reviewed markets. | Latest Gateway UI and worker fixes are local commits; production extension/mobile acceptance and the manual release remain outstanding. |
| Support Circle email wallets | Mainnet implementation is wired; the hosted status correctly reports ARC with email wallets disabled, as explicitly requested. | Production App ID/subscription/SMTP and real login/signing remain pending. Disabled-wallet readiness checks now skip private Circle user-list authentication. |

## Verification tool correction

`verify-arc.mjs` previously assigned `deployed_verified_paused` after every source-verification run, even if the suite had already been explicitly activated. It now preserves an existing verified operational status and its activation evidence. Instance verification uses the state-neutral `instances_source_verified` status. The command neither changes nor claims to inspect the live pause state, and its success message no longer says active trading is disabled.

The existing deployer's initially paused status can still become `deployed_verified_paused` during its first verification. The October 7 activation record remains `deployed_verified_automation_unpaused`; source verification does not alter `tradingEnabled`, `productionReady`, roles or the chain.

The corrected verifier was run with `--existing-only`, which forbids source submission. All seven core matches passed again and the activation status, trading flag, incomplete production-acceptance flag and public resume evidence were preserved. The root npm command forwards the flag through the contract workspace: `npm run verify:arc -- --existing-only`.

## Remaining acceptance

1. Manually release the committed frontend/API changes and recheck the hosted flows. Hosting deployment is deliberately left to the user.
2. Complete Circle production subscription, matching App ID and email setup before enabling email wallets; prove real login and signing.
3. Qualify production extension and physical mobile signed Spot, Autopilot and Gateway workflows. A seller withdrawal requires native Arc USDC gas in the same wallet.
4. Complete dedicated production executor role/funding acceptance and a live deterministic risk-worker sell. Public capability readiness is not equivalent to qualifying a newly provisioned production signer.
5. Complete a bounded funded cirBTC acceptance transaction with a fresh receipt-complete spending reconciliation. No new funded tests were run in this continuation.

The migration goal remains active. Neither green unit tests nor source matches establish these outstanding production outcomes.

Primary references: [Arc deployed asset and Gateway addresses](https://docs.arc.io/arc/references/contract-addresses), [Sourcify registry verification](https://sourcify.dev/server/v2/contract/5042/0x67e14b9545b069afbd78e195ec37914466e1807f). All eleven verification URLs and sanitized observations are included in the JSON evidence.
