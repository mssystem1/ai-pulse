# PULSE V5 engineering report

Date: 2026-08-05

## Outcome

The additive multichain + Polymarket implementation is ready for operator localhost end-to-end acceptance and preserves the legacy X Layer surface. Production certification still requires the physical-wallet/browser matrix, final deployed-origin settlement checks, and external marketplace visibility checks; this report does not mislabel those operator gates as completed publication.

## Delivered

- Immutable X Layer, Base, Arbitrum One, and Arc Testnet registry; server and browser allowlists; provider-specific aliases and feature flags.
- Existing X Layer REST, MCP, SDK, pricing, payment challenges, and inline paid replay retained.
- Polymarket Gamma/CLOB/Data public clients, canonical condition IDs, strict outcome-token mapping, explicit selection/revalidation, parallel fused context, retries, short cache, and partial/stale evidence.
- Prediction-market web workflow with trending/search, primary URL selection, additional selections, executable bid/ask/spread, freshness, open interest, source warnings, chain-specific visual state, and explicit fused/prediction/divergence/event-risk product selection. Fused Intelligence is the default flagship workflow.
- Spot, prediction, fused, divergence, and event-risk service schemas and prices. Grok receives prepared context only, enforces conservative input and hard output limits, supplies strict JSON Schema to xAI, independently rejects incomplete or extra output locally, records actual usage and estimated cost, and supports deterministic Arc fixtures. The Arc provider review keeps direct xAI as the explicit live path and BlockRun as a gated future candidate, not an implicit fallback.
- Reown/Wagmi/Viem wallet layer across approved chains; network-aware x402 clients; wallet/native/payment/Gateway balances.
- In-app wallet-signed OKB→USD₮0 on X Layer and ETH→native-USDC on Base/Arbitrum. CDP credentials stay server-side; quote and transaction fields are validated before wallet submission.
- Arc faucet guidance, live Gateway balance, persisted pending deposit, explicit ERC-20 approval + official Gateway deposit, finality polling, and Circle batch payment client.
- Immediate `202` paid-job delivery, persisted real stages, opaque recovery tokens, authenticated polling/report retrieval, private Blob reports, Upstash idempotency, normalized receipts with settlement mode and finality scope, checksums, share/revoke flow, and two receipt-bound automatic model regenerations without another charge.
- CDP Bazaar v2 resource-server extension with POST examples and JSON schemas, provider/network metadata, and updated PULSE product copy.
- Generic EVM live RPC contract/proxy and ERC-20 interface evidence plus exact non-broadcast transaction simulation and configurable primary/fallback RPC failover; missing evidence remains `unknown`. Paid heuristic scoring remains X Layer-only and is not represented as a multichain audit.
- Correlation-aware JSON events plus Prometheus HTTP, provider latency/error/retry/cache, payment challenge/verify-settle/amount, job/unfinished-queue, report outcome/recovery, and input/cached/reasoning/output-token/cost metrics, with staged alerts and rollback guidance.

## Verification completed

- Full monorepo production build: PASS.
- Full automated workspace suite: PASS across config, domain, market, analysis, payments, jobs, REST, MCP, Arc budget enforcement, provider/cache/payment observability, browser challenge/provider behavior, durable recovery, OKX Exchange OS authentication, RPC failover, strict local model-output validation, cached-token cost accounting, live-evidence semantics, and compatibility. Deterministic Arc prediction and canonical-spot `202 → recovery → private report` E2Es pass without xAI; signed OKX/CDP requests settle before protected work, and fresh unavailable/insufficient balances fail before wallet signing.
- `git diff --check`: PASS.
- Production dependency audit: 0 vulnerabilities.
- Configured test private key derives the configured test wallet: PASS; secrets were not printed or added to Git.
- Live RPC chain ID, native balance, payment-token balance, and token-bytecode checks: PASS on all four networks.
- Circle Gateway Testnet balance API: PASS; available balance observed.
- Live CDP Trade API native ETH→native USDC quote, validation, simulation, broadcast, and receipt: PASS on Base (`0xfb09e92480f8bd4ad8e3e61420930f84f3d1425c7b4b2becfbc2b22d06efe102`) and Arbitrum (`0xc9ee7e93c1fc55a2c8a1805063cc8f6f519749f5dee030a5e94924e614c70b23`).
- Arc Testnet ERC-20 approval and Circle Gateway deposit: PASS for 0.01 test USDC; deposit receipt `0xcd5a26dddfa9f0a907f66d300216ec76e443ed05c2c36209d52f995edf2dae02`.
- Live payment-token evidence: PASS for X Layer USD₮0 and native USDC on Base, Arbitrum, and Arc, including deployed bytecode, symbol, decimals, chain, and observed block.
- Bounded live Grok 4.3 canaries: PASS. Spot accepted `reasoning_effort=none` plus strict JSON Schema and returned all 15 required fields (1,376 input, 243 output, 128 cached, 0 reasoning tokens). Prediction V5 returned all six strict fields (525 input, 169 output, 128 cached, 0 reasoning tokens). No wallet transaction was involved.
- Existing Railway discovery/free/402/MCP compliance: 70 checks passed.

## Remaining production certification gates

1. Run the physical OKX Wallet, MetaMask, Rabby, WalletConnect mobile, and Base Account matrix in the localhost guide. Automated EIP-1193/AppKit coverage cannot certify real extension and mobile clients.
2. After explicit release approval, run one bounded settlement-to-report certification per enabled service family from the final public origin. Local success does not prove deployed routing, secrets, queues, or storage.
3. Verify CDP Bazaar/Base visibility, the applicable Arbitrum discovery surface, Circle/Arc publication, and the reviewed OKX.AI #8355 metadata after publication. Draft metadata is not proof of listing.
4. Before live Arc AI activation, recheck the current model rates and configured daily ceiling. `ARC_AI_MODE=fixture` remains the safe default until that release gate passes.

## Secret hygiene

The `.env` file remains ignored and has no Git diff. Repository scanning did not find the supplied secret fragments outside `.env`. Credentials pasted into chat should nevertheless be treated as exposed: rotate the CDP secret, Vercel Blob token, Upstash tokens/URLs/password, and any other pasted credential before production.

## Release decision

The code is ready for the user's localhost end-to-end acceptance. No commit, push, cloud deployment, marketplace publication, or agent #8355 update is authorized by that readiness. After localhost acceptance, follow `V5_PRODUCTION_RUNBOOK.md` and require explicit approval before every external mutation.
