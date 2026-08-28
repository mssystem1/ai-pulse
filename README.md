<p align="center">
  <img src="assets/logo.svg" alt="PULSE logo" width="132" />
</p>

<h1 align="center">PULSE</h1>

<p align="center"><strong>Analyze first, then Spot trade or run a guarded Autopilot on your selected network.</strong></p>

PULSE combines live OKX Global Market evidence—including crypto, xStocks, and RWA instruments—with explicitly selected Polymarket data. A valid report can prefill an owner-signed Market or Limit Spot ticket, including optional TP/SL, or become the signal policy for a guarded Autopilot. Reports are private, recoverable across devices through wallet proof, and paid per request through network-aware x402 settlement on X Layer, Base, Arbitrum One, and Arc Testnet.

PULSE is an independent intelligence product. Polymarket is a public read-only evidence source; PULSE does not place Polymarket orders or bypass Polymarket trading restrictions.

## Contents

- [Product and experience](#the-product)
- [Networks, services and payments](#networks-and-payments)
- [System architecture](#system-architecture)
- [End-to-end workflows](#end-to-end-workflows)
- [Data architecture: KV and Blob only](#data-architecture-kv-and-blob-only)
- [On-chain execution architecture](#on-chain-execution-architecture)
- [Repository and module architecture](#repository-and-module-architecture)
- [Local development and configuration](#quick-start)
- [Persistence and deployment](#persistence-and-operations)
- [Security, release discipline and status](#security-and-limitations)

## The product

Markets move continuously, but most analysis products still require an account, subscription, or separate checkout. Agents need something stricter: structured intelligence they can discover, pay for, recover after a refresh, and consume without a human checkout.

**PULSE turns market intelligence into a multichain onchain service while preserving the original X Layer product.**

- Preview live OKX spot instruments, xStocks/RWA instruments, tickers, and candles without payment.
- Use the Opportunity Radar to shortlist markets worth analyzing without treating a score as a trade signal.
- Discover active crypto-focused Polymarket questions in an in-page picker and explicitly select the single market used by a report.
- Buy a visibly marked Base or Premium Global report, or a separate Base or Premium Prediction report. Agent discovery names the same tiers Quick and Pro so the next action is explicit.
- Read deterministic Fibonacci, pivot, and Elliott-wave structure; Pro reports add an annotated chart and executable Buy-or-Wait plan.
- Move a valid Global plan into connected-wallet Market or Limit Spot execution with route, balance, slippage, entry, TP, and SL carried forward.
- Run a policy-bounded Autopilot that can Buy, Hold, partially Sell, fully Sell, and later Buy again only inside owner-signed limits.
- Run network-scoped Risk Guard evidence and pre-trade checks on X Layer, Base, Arbitrum, and Arc Testnet.
- Settle through USD₮0 on X Layer, native USDC on Base and Arbitrum, or test USDC on Arc Testnet.
- Recover an idempotent paid job without paying twice and reopen wallet-owned report history on another device.
- Use the same product through the responsive web console, REST, MCP, or TypeScript SDK.

The browser keeps funding in context: connect once, inspect the selected chain’s native and payment-asset balances, and use the chain-specific in-app funding path. The last selected network is restored after reload. PULSE remains decision support, not financial advice. Contract evidence reports observable RPC facts; heuristic safety scores are not audits or guaranteed simulations.

## Why it stands out

| Typical market tool | PULSE V6 |
| --- | --- |
| Account and recurring subscription | Pay only for the requested report |
| Human-only dashboard | Responsive web + REST + MCP + typed SDK |
| Opaque AI prose | Strict structured output, evidence quality, limitations, and invalidation |
| One generic workflow | Separate Global Market and user-selected Prediction Market analysis |
| Payment failure after work begins | Input and required primary evidence are validated before the payment challenge |
| Lost result after refresh | Receipt-bound durable job and private report recovery |
| Separate wallet and funding journey | Network-aware balances and funding inside PULSE |
| Hidden network assumptions | Explicit chain, token, provider, amount, payee, and receipt metadata |
| Analysis disconnected from execution | One guided Analyze → Spot or Autopilot journey |
| Ticker assumed to equal a chain token | Identity-safe representations such as BTC → cbBTC/WBTC and ETH → WETH, followed by a live-route check |

## Experience

### Global Market

Choose a live OKX instrument instead of typing an arbitrary pair. Select a timeframe and PULSE fetches public ticker/OHLCV data, renders the chart locally, and sends bounded structured context—not a screenshot—to Grok. Base and Premium reports have distinct marks. Premium adds an annotated, click-to-enlarge chart with Fibonacci levels, pivots, the current Elliott candidate, its invalidation, and wave-consistent next paths. The recommendation is deliberately **Buy or Wait**; PULSE never turns a bearish report into a new short. Changing pair, timeframe, network, or request tier supersedes the earlier request so a late response cannot replace the current context.

### Prediction Market

Prediction discovery is free and lives inside the main application rather than on a separate page. The user opens the market picker, chooses one active crypto price/direction question, reviews its probabilities, order books, liquidity, volume, open interest, restriction status, and resolution rules, then purchases Base or Premium prediction analysis. PULSE validates condition/outcome identity, order-book availability, freshness, liquidity, spread, depth, history, and horizon. Restricted markets remain usable as public read-only evidence when active and orderbook-enabled, but the restriction is always disclosed and PULSE never places an order.

Prediction reports use the same readable presentation standard as Global Market reports: confidence and tier, headline and summary, outcome probability cards, bid/ask and evidence-quality labels, market metrics, invalidation conditions, risks, evidence provenance, and disclaimer. Large provider payloads are kept behind a collapsed technical-details control. The optional focus note lets the user request emphasis such as the bull/up case, counter-case, catalysts, liquidity quality, resolution risk, or invalidation; it does not create a market or place an order.

### Connected-wallet Spot execution

Spot Trading works with or without a loaded report. The network-specific pair picker lists supported execution candidates directly; loading a Global report additionally prefills its pair, timeframe, entry, take-profit, and stop-loss. PULSE resolves the analysis ticker to an identity-safe chain token, checks the selected settlement asset and connected-wallet balance, and verifies a fresh OKX Onchain OS route before enabling either order button.

- Market orders expose Auto or Manual maximum slippage and can attach TP/SL after the confirmed fill.
- Limit orders carry the trigger, minimum received amount, and optional OTOCO protection in one ticket.
- Factory state is read from chain before account creation is offered; tab changes cannot erase an existing owner account.
- The shared dashboard separates Pending, Active, Executed, Cancelled, and Activity, displays mark/trigger/P&L when provable, and supports selected or all-position closure.
- If the pair is unavailable on the selected network, PULSE recommends a verified supported network; if none exists, it explains that the pair remains analysis-only and links to OKX Spot.

### Guarded Autopilot

Autopilot is independent from manual Spot Trading. The trader chooses a market, timeframe, strategy preset, capital, and risk profile; technical contract addresses and atomic values remain under an optional proof section. Capital is the selected vault’s real USDC or USDT0 balance, not a browser estimate. The executor may act only through allowlisted assets/routes and owner-signed exposure, slippage, turnover, cooldown, daily-loss, confidence, and expiry limits. The fast risk monitor handles TP/SL and completes bounded exits without waiting for another AI cycle. Pause, resume, add funds, and withdrawal remain owner actions.

### Private report recovery

Paid reports are stored as private Blob objects and indexed by the paying wallet in KV. If a hosting configuration requires public Blob transport, PULSE encrypts the report body with authenticated AES-256-GCM before upload and refuses an unencrypted public configuration. A wallet signature creates a short-lived report-access session that may open reports or retry an already-settled failure; it cannot create a payment, trade, or authorize Autopilot. This makes report history available on desktop, iOS, Android, Mac, or another browser while retaining a same-device recovery fallback.

### Risk Guard

- **X Layer token discovery · free:** OKX Onchain OS catalog with X Layer-only enrichment and manual-address fallback.
- **Contract evidence · free:** chain/block/code/balance/nonce reads, bytecode fingerprint, and common proxy detection.
- **Token risk:** deterministic component scores and explicit limitations.
- **Composite preflight:** PASS/WARN/FAIL report, grade, checklist, recommendations, and report identity.
- **Transaction simulation:** network-scoped evidence that never broadcasts a transaction.

Catalog presence, price, liquidity, and market probability are evidence—not endorsement, fact, or a safety guarantee.

### Wallet and funding

- One wallet drawer supports OKX Wallet, EIP-6963 injected wallets, WalletConnect, Base-compatible AppKit connectors, and Circle User-Controlled EOA wallets authenticated by email OTP. With the configured Circle Testnet application, Circle email sessions are Arc Testnet-only; PULSE hides X Layer, Base, and Arbitrum until the Circle wallet is disconnected.
- The selected PULSE network, connected provider, wallet chain, address, native balance, and exact payment-asset balance remain distinct.
- X Layer prepares OKB → USD₮0 through OKX Exchange OS.
- Base and Arbitrum prepare native ETH → native USDC inside PULSE; Arbitrum explicitly rejects USDC.e as the payment asset.
- Arc Testnet exposes faucet guidance, test-USDC balance, Circle Gateway balance, and Gateway deposit.
- Arc displays wallet USDC and Circle Gateway USDC in separate tabs so onchain funds are not confused with spendable Gateway funds.
- Before browser signing, PULSE switches to the selected chain and refreshes the exact payment-asset balance.

## Product surfaces

- **Global Market:** live OKX crypto, xStocks/RWA instruments, candles, Opportunity Radar, and Base/Premium reports with Elliott-aware execution plans.
- **Prediction Markets:** active crypto price/direction markets only, explicit single-market selection, order books, probability history, liquidity and evidence quality, followed by base or premium prediction analysis.
- **Risk Guard:** network-scoped contract evidence and transaction simulation on every supported network; legacy heuristic scores remain clearly identified.
- **Spot Trading:** connected-wallet Market, Limit, integrated TP/SL, route/balance checks, account discovery, and reconciled lifecycle dashboard.
- **Autopilot:** separate owner-controlled vault capital, strategy presets, enforceable policy limits, autonomous Buy/Hold/Sell lifecycle, and shared dashboard semantics.
- **Human web app:** one responsive Global Market / Prediction Market / Risk Guard / Spot Trading / Autopilot / Telegram / Docs workspace; persistent network selection; X Layer, Base, Arbitrum and Arc-specific themes; direct OKX Wallet preference plus EIP-6963/WalletConnect compatibility; balances, funding, payment progress, private report history, and readable reports.
- **Agent interfaces:** REST, MCP, TypeScript SDK, machine-readable metadata, OKX.AI compatibility, CDP Bazaar metadata, and Circle Marketplace listing material.

### Link previews and search metadata

The web entry point publishes canonical, Open Graph, X card, robots, sitemap, web-manifest, and Schema.org `WebApplication` metadata. Search engines, Telegram, X, Slack, and other link unfurlers use the versioned 1200×630 PULSE V6 social card at `apps/web/public/og-image-v6.png`. Updating these local files does not refresh any remote crawler cache; deployment and external cache invalidation remain explicit operator actions.

## Networks and payments

| Network | Public prefix | Payment asset | Provider | Funding inside PULSE |
| --- | --- | --- | --- | --- |
| X Layer (`eip155:196`) | `/xlayer` | USD₮0 | OKX x402 | Native OKB to USD₮0 through OKX Exchange OS |
| Base (`eip155:8453`) | `/base` | Native USDC | CDP x402 | Native ETH to native USDC swap |
| Arbitrum One (`eip155:42161`) | `/arbitrum` | Native USDC | CDP x402 | Native ETH to native USDC swap; USDC.e is not accepted |
| Arc Testnet (`eip155:5042002`) | `/arc` | Test USDC | Circle Gateway | Faucet guidance and in-app Gateway deposit |

The shared unprefixed routes retain X Layer compatibility. Network aliases isolate chain IDs, assets, receipts, discovery metadata, and idempotency records while reusing the same business handlers.

Arc is always labeled **Testnet**. Its USDC has no production-value implication.

## Services and prices

The web UI uses the familiar **Base** and **Premium** tier labels. Public agent metadata uses the action-oriented **Quick** and **Pro** service names below; each pair maps to the same endpoints and prices.

| Service | Price |
| --- | ---: |
| Free OKX and Polymarket discovery | Free |
| Global Market Quick Plan | $0.10 |
| Global Market Pro Strategy | $0.20 |
| Prediction Market Quick View | $0.10 |
| Prediction Market Pro Analysis | $0.20 |
| Onchain Pre-Trade Risk Guard | $0.05 |

Prices are configured by environment variables and published through `/v1/metadata`. A paid request is rejected before the payment challenge when its schema is invalid or its required Polymarket market/order-book evidence is unavailable.

The earlier fused, divergence, and event-risk routes remain in the codebase only for API compatibility and are disabled by default. They are not presented as consumer products in the web app or public product metadata.

## Paid report lifecycle

1. Validate the request and required provider evidence before payment.
2. Return a network-specific x402 challenge.
3. Verify and settle the signed authorization.
4. Persist an idempotent job and normalized payment receipt.
5. Fetch fresh provider context and calculate deterministic features.
6. Generate and validate the structured report.
7. Store the report privately and expose recovery through the job API.

Real backend stages are returned by `GET /v1/jobs/:jobId`. A recovery token lets the payer retrieve the completed report after refresh without paying again. A settled job may regenerate its deliverable within policy without creating a second payment.

## Polymarket data policy

PULSE uses public Gamma, CLOB and Data API reads. No Polymarket API key is required for discovery, order books, prices, history, or public open interest.

- Web users explicitly select one primary crypto market. The API retains bounded additional-market fields only for backward compatibility and never adds markets silently.
- PULSE never silently substitutes another market.
- Condition IDs and outcome-token mappings are validated.
- Active restricted markets may be analyzed read-only; `restricted` remains visible as a trading-compliance signal.
- Closed, archived, inactive, malformed, or orderbook-disabled markets are rejected.
- Required primary-market order books are checked before payment and revalidated by the worker after settlement.
- Optional-source failures produce explicit partial-data fields rather than invented values.

## Wallet and funding UX

One restored wallet session supports all enabled networks. The UI distinguishes the selected PULSE network, connected provider, connected address, and wallet chain. Before signing, PULSE switches to the selected chain and verifies the exact payment-asset balance.

The selected network is stored locally and restored on reload or the next start. `DEFAULT_NETWORK` is used only when no valid saved selection exists. Each non-X-Layer network has its own visual theme; the original X Layer appearance remains unchanged.

- **X Layer:** OKB and USD₮0 balances; in-app OKB → USD₮0 swap.
- **Base:** ETH and native USDC balances; in-app ETH → USDC swap.
- **Arbitrum:** ETH and native USDC balances; in-app ETH → USDC swap with explicit USDC.e warning.
- **Arc Testnet:** separate Wallet USDC and Gateway USDC tabs, faucet entry, and Gateway deposit. `ARC_AI_MODE=live` is required for real Base/Premium reports; `fixture` is only a deterministic payment/job plumbing check and makes no market inference.

Supported connection paths include OKX Wallet, EIP-6963 injected wallets such as MetaMask and Rabby, WalletConnect mobile sessions, Base-compatible connectors exposed through AppKit, and Circle User-Controlled EOA wallets via email OTP. The connected address in the funding drawer is copyable. Circle wallet keys remain controlled by the user through Circle's MPC signing UI; `CIRCLE_API_KEY` is server-only.

## System architecture

PULSE separates presentation, payment, analysis, operational state, immutable artifacts, wallet authority, and on-chain enforcement. The browser never receives provider secrets or an automation private key. The API never treats its database projection as stronger evidence than a confirmed chain receipt, contract read, token balance, or provider order state.

```mermaid
flowchart TB
  subgraph Clients[Client and agent surfaces]
    WEB[React web console]
    TG[Telegram Bot and Mini App]
    AGENT[REST, MCP and TypeScript SDK clients]
    WALLET[Connected user wallet]
  end

  subgraph Control[PULSE API and control plane]
    API[Express API<br/>schemas · auth · x402 · quotes · tx preparation]
    JOB[Durable report worker]
    CRON[Secret automation tick<br/>plus distributed KV lease]
    SPOTW[Deterministic Spot worker]
    AUTOW[Policy-bounded Autopilot worker]
    TGW[Telegram delivery worker]
  end

  subgraph Evidence[Evidence, analysis and payment providers]
    OKX[OKX public market, Onchain OS DEX and DeFi]
    POLY[Polymarket public Gamma, CLOB and Data APIs]
    XAI[xAI structured analysis]
    PAY[OKX, CDP or Circle x402 settlement]
    RPC[Chain RPC primary and fallback pools]
  end

  subgraph Data[KV and object persistence, no SQL]
    KV[Upstash KV<br/>jobs · receipts · indexes · sessions · leases · activity · strategies]
    BLOB[Vercel Blob<br/>private reports · Autopilot evidence]
  end

  subgraph Chains[Supported execution chains]
    REG[Pulse Registry]
    ORACLE[Oracle Router]
    ADAPTER[Allowlisted OKX execution adapter]
    SPOT[Owner-controlled Spot accounts]
    VAULT[Owner-controlled Autopilot vaults]
  end

  WEB --> API
  TG --> API
  AGENT --> API
  WEB <--> WALLET
  API --> OKX
  API --> POLY
  API --> PAY
  API <--> KV
  API <--> BLOB
  JOB <--> KV
  JOB --> OKX
  JOB --> POLY
  JOB --> XAI
  JOB --> BLOB
  CRON --> SPOTW
  CRON --> AUTOW
  CRON --> TGW
  SPOTW <--> KV
  AUTOW <--> KV
  AUTOW --> BLOB
  TGW <--> KV
  SPOTW --> OKX
  AUTOW --> OKX
  API --> RPC
  SPOTW --> RPC
  AUTOW --> RPC
  WALLET --> SPOT
  WALLET --> VAULT
  SPOTW --> SPOT
  AUTOW --> VAULT
  SPOT --> REG
  SPOT --> ORACLE
  SPOT --> ADAPTER
  VAULT --> REG
  VAULT --> ORACLE
  VAULT --> ADAPTER
```

### Runtime boundaries

| Component | Owns | Does not own |
| --- | --- | --- |
| Web console | product state, responsive UI, wallet selection, signatures, local opaque recovery capability | provider secrets, server wallets, autonomous scheduling, final settlement truth |
| API | request schemas, network capability checks, x402 middleware, wallet-history challenges, route/quote validation, unsigned transaction preparation, dashboards | permission to sign a user’s trade or loosen an Autopilot policy |
| Durable report worker | leased paid jobs, provider context, deterministic features, xAI calls, schema validation, report persistence | trading authorization |
| Spot worker | deterministic owner-created limit/bracket/OCO trigger evaluation and confirmed-receipt reconciliation | AI strategy decisions, arbitrary assets, arbitrary recipients |
| Autopilot worker | strategy evaluation, evidence persistence, simulation, bounded executor calls, fast TP/SL monitoring | owner withdrawals, policy expansion, manual Spot orders |
| Telegram worker | webhook deduplication, retry queue, report-link delivery | wallet custody, analysis generation, payment signing |
| KV | current operational projections, indexes, queues, leases, idempotency, short-lived sessions and resilient outbox state | private keys, large report bodies, sole financial truth |
| Blob | private report bodies and Autopilot decision evidence | mutable live order state, wallet balances, signing authority |
| Contracts | allocated-asset custody and enforcement of owner-approved execution limits | off-chain inference, market discovery, arbitrary router calls |

### Runtime modes

The same modules support three process layouts; changing the layout does not change financial authority.

| Mode | Behavior |
| --- | --- |
| Local `npm run dev` | Starts the API and web console. The API starts the durable report worker plus enabled Spot, Autopilot, and Telegram timers. The launcher reuses healthy local services, refuses a stale occupied port, and kills only child process trees it started. |
| Long-lived Node host | Runs the same API and in-process timers continuously. KV leases plus contract state/nonces prevent overlapping or repeated financial execution across instances. |
| Optional serverless API | Handles HTTP requests; `/v1/internal/automation/tick` is called with `CRON_SECRET`. A shared KV lease prevents overlapping Spot/Autopilot/Telegram cycles. The checked-in production default instead runs one long-lived Railway API/worker. |

A split web/API/worker deployment is supported operationally, but it is not required by the source tree. Autonomous execution never happens inside the browser and is never authorized by an ordinary report request.

### Market-data and analysis pipeline

Analysis coverage and on-chain executability are intentionally separate. Every valid OKX Global Market instrument may be analyzed, including crypto, xStocks, and RWA products. Spot or Autopilot is enabled only after a second pipeline resolves an identity-safe token representation and verifies a live route on the selected execution network.

```mermaid
flowchart LR
  PICK[Selected pair and timeframe] --> OKXDATA[OKX instrument, ticker and OHLCV]
  OKXDATA --> NORMALIZE[Normalized bounded market context]
  NORMALIZE --> TECH[Deterministic pivots, Fibonacci and Elliott candidate]
  NORMALIZE --> MODEL[xAI structured analysis]
  TECH --> MODEL
  MODEL --> VALIDATE[Strict versioned schema validation]
  VALIDATE --> PLAN[Base or Premium Buy-or-Wait report]
  PLAN --> MAP[Selected-chain identity mapping]
  MAP --> TOKEN[Exact token contract and settlement asset]
  TOKEN --> ROUTE[Fresh OKX Onchain OS route]
  TOKEN --> DEFI[Exact-contract OKX DeFi opportunities]
  ROUTE --> ACTION[Market, Limit or Autopilot action]

  PM[Explicitly selected Polymarket question] --> GAMMA[Gamma identity and rules]
  PM --> CLOB[CLOB books, prices and history]
  PM --> DATA[Data API open interest]
  GAMMA --> PCONTEXT[Normalized prediction context]
  CLOB --> PCONTEXT
  DATA --> PCONTEXT
  PCONTEXT --> PMODEL[xAI Prediction analysis]
  PMODEL --> PVALIDATE[Strict report validation]
  PVALIDATE --> PREPORT[Base or Premium Prediction report]
  OKX4H[Independent mapped 4H OKX context] --> PREPORT
```

Key rules:

- Provider payloads are normalized and bounded before model input; Grok receives structured evidence, not screenshots, wallet secrets, or arbitrary raw pages.
- Pivot, Fibonacci, alternating swing points, Elliott candidate/invalidation, and chart paths are calculated deterministically. The report explanation must remain consistent with those values.
- Pro Global reports expose an execution intent only when the result is a valid Buy setup. Bearish or insufficient evidence becomes Wait, never a new short recommendation.
- DeFi discovery first resolves the selected chain representation—for example `BTC → cbBTC` on Base or `BTC → WBTC` on Arbitrum—then accepts only products containing that exact contract.
- Prediction Market uses one explicitly selected condition/outcome mapping. It never silently substitutes a trending market. Pro may add an independently sourced 4H underlying-asset chart, clearly separated from the prediction probability evidence.
- The Opportunity Radar is a free technical shortlist. Its score selects what to investigate; it is not transaction authorization.
- Shared Zod schemas reject missing, extra, malformed, or mixed-type model output. Compatibility repair is limited to the known obsolete pre-Elliott shape so a paid report is not lost merely because a provider returned the previous schema.

### Report data model

| Layer | Representative data |
| --- | --- |
| Request identity | network, service/tier, pair or selected market ID, timeframe, language, optional focus, request hash |
| Source evidence | observed times, ticker/candles, order books/history/open interest, source availability, stale/partial flags |
| Deterministic structure | pivot, supports/resistances, Fibonacci levels, Elliott candidate, wave points, invalidation and candidate next paths |
| Model interpretation | tier mark, headline, summary, bias, confidence, catalyst/counter-case, limitations and disclaimer |
| Execution intent | Buy-or-Wait, entry trigger, take-profit, stop-loss, rationale and timeframe; never a wallet authorization |
| Selected-chain extension | identity-safe execution token, settlement asset, live-route result, alternative networks and exact-token DeFi products |
| Delivery proof | normalized settlement receipt, durable stage events, report checksum, Blob record and opaque recovery capability |

The chart is rendered locally from report candles and deterministic annotations. It is not an AI-generated picture and does not require a horizontal overflow area; the same SVG opens in an accessible zoom dialog.

## End-to-end workflows

### Paid report and recovery

```mermaid
sequenceDiagram
  participant User
  participant Web as PULSE Web
  participant Wallet
  participant API as PULSE API
  participant Pay as Network x402 provider
  participant KV
  participant Worker as Durable report worker
  participant Sources as OKX, Polymarket and xAI
  participant Blob

  User->>Web: Select network, market, timeframe and tier
  Web->>API: Validate input and required primary evidence
  API-->>Web: HTTP 402 bound to route, body, payee, asset and amount
  Web->>Wallet: Switch chain and verify exact payment balance
  Wallet-->>Web: Signed payment authorization
  Web->>API: Replay the identical request
  API->>Pay: Verify and settle
  API->>KV: Atomically bind receipt and enqueue idempotent job
  API-->>Web: 202 job plus opaque recovery capability
  Worker->>KV: Claim job with expiring lease
  Worker->>Sources: Fetch, calculate, generate and validate
  Worker->>Blob: Store private report with checksum
  Worker->>KV: Attach report record and complete job
  Web->>API: Poll with recovery capability
  API->>Blob: Read privately and verify checksum
  API-->>Web: Report, stage history and normalized receipt
```

The payment authorization is bound to network, asset, amount, payee, resource URL, and request hash. Replaying one authorization resolves to one idempotent job. A settled job whose deliverable failed can be retried within policy without a second payment. A five-minute wallet challenge creates a separate 15-minute report-history session for cross-device retrieval and receipt-bound recovery; that signature cannot create a payment or trade.

### Manual Spot and automatic protection

```mermaid
sequenceDiagram
  participant User
  participant Web
  participant API
  participant OKX as OKX Onchain OS
  participant Wallet
  participant Chain
  participant Worker as Spot worker
  participant KV

  User->>Web: Choose pair directly or load a report plan
  Web->>API: Resolve analysis ticker to chain token and settlement asset
  API->>OKX: Verify live route and quote
  Web->>Wallet: Read exact balances and request final signature
  Wallet->>Chain: Submit market swap or create/fund owner order account
  Web->>API: Announce transaction hash as pending only
  API->>KV: Store pending activity without claiming confirmation
  API->>Chain: Reconcile receipt and factory/account state
  API->>KV: Record confirmed or failed activity
  Worker->>Chain: Execute only an owner-created trigger proven by oracle policy
  Worker->>KV: Reconcile Pending, Active, Executed or Cancelled projection
```

For a direct Market swap, PULSE validates the prepared sender, input/output token contracts, router, native value, approval target, amount, deadline, and slippage before the wallet sees it. For Limit or protected Spot, only the allocated amount enters the owner’s account contract. The keeper can execute an existing condition; it cannot create a market, enlarge an amount, change TP/SL, or redirect proceeds.

### Guarded Autopilot

```mermaid
sequenceDiagram
  participant Owner
  participant Web
  participant Wallet
  participant API
  participant KV
  participant Worker as Autopilot worker
  participant Evidence as OKX, Premium analysis and oracle
  participant Blob
  participant Vault

  Owner->>Web: Select pair, timeframe, strategy, capital and risk profile
  Web->>Wallet: Create or reuse vault, configure limits, fund and authorize strategy
  Wallet->>Vault: Persist owner policy and isolated capital
  Web->>API: Store expiring signed strategy authorization
  API->>KV: Save policy hash and current strategy projection
  Worker->>KV: Acquire per-strategy analysis/execution lease
  Worker->>Evidence: Evaluate entry, Hold and exit rules
  Worker->>Blob: Persist decision evidence before execution
  Worker->>Vault: Submit bounded action and adapter payload
  Vault->>Vault: Enforce policy version, nonce, assets, exposure, loss, turnover, cooldown, oracle, min-out and recipient
  Worker->>KV: Store evaluation, receipt and reconciled P&L state
  Owner->>Vault: Pause, resume, withdraw or change policy at any time
```

Autopilot capital is the vault’s actual settlement-token balance. It is separate from the connected wallet’s Spot capital and from every other Autopilot vault. A Hold does not disable a strategy: later evaluations may Buy; a held position may Hold, partially Sell, fully Sell, and later Buy again if the unchanged owner policy permits it. The one-minute deterministic risk path does not wait for xAI before enforcing an already configured TP/SL.

### Telegram paid delivery

```mermaid
sequenceDiagram
  participant User
  participant Telegram
  participant API
  participant KV
  participant MiniApp as PULSE Mini App
  participant Wallet
  participant Worker as Report worker

  User->>Telegram: Choose Global, Prediction or My reports
  Telegram->>API: Webhook update plus secret header
  API->>KV: Deduplicate update ID for seven days
  API-->>Telegram: Expiring chat-bound Mini App capability
  User->>MiniApp: Select service and review exact x402 price
  MiniApp->>Wallet: Connect and sign payment in wallet UI
  MiniApp->>API: Paid request plus delivery capability
  API->>KV: Bind payment, job and delivery capability
  Worker->>KV: Complete the normal durable report job
  alt Telegram accepts delivery
    Worker->>Telegram: Send summary and opaque full-report link
  else Telegram is unavailable
    Worker->>KV: Queue failed delivery with exponential retry
  end
```

The Telegram bot is a navigation and delivery adapter, not a wallet, model host, or separate analysis service. Its seven-day HMAC capability identifies only the destination chat and cannot pay, trade, retrieve arbitrary wallet history, or authorize Autopilot. Wallet connection and x402 signing remain in the Mini App. A full-report message uses a revocable opaque report share and therefore requires explicit `REPORT_SHARE_LINK_ENABLED=1`; the bot never receives a direct Blob URL. Duplicate updates are ignored, and failed messages are retried from KV under a per-delivery lock without rerunning or recharging the report.

## Data architecture: KV and Blob only

PULSE does not use PostgreSQL or another relational database. Production persistence has two internal stores plus external financial truth.

| Data class | Authority | Storage and rule |
| --- | --- | --- |
| Chain transactions, contract state, token balances | blockchain RPC and finalized receipts/logs | strongest execution truth; reconciliation repairs cached projections |
| OKX native route/order state and market observations | OKX provider responses | provider truth for its own route/order IDs; never accepted as permission to spend |
| Current jobs, receipts, activity, automation and dashboard projections | Upstash KV | operational read model; updated idempotently and allowed to degrade without inventing confirmation |
| Private reports and large decision evidence | Vercel Blob | immutable artifact body; KV stores its small manifest/index/checksum |
| Selected network and opaque recovery handles | browser storage | convenience only; no report body, private key, executor key, or authoritative order state |

### Implemented KV model

`PERSISTENCE_NAMESPACE` isolates paid-job, report, history-session, budget, and cron keys. The V6 trading keys retain the stable `pulse:v6:*` prefix so existing mainnet activity and vaults remain discoverable; separate environments must therefore use separate KV databases. Wallet addresses are normalized before keys are built, and payer indexes use a SHA-256-derived suffix. Important implemented key families are:

```text
<ns>:job:<jobId>                         paid job projection and stage history
<ns>:idem:<paymentIdempotencyKey>        payment/request deduplication
<ns>:jobs:ready                          report queue sorted by availability
<ns>:jobs:leased                         active leases sorted by expiry
<ns>:job-lease:<jobId>                   current report-worker lease owner
<ns>:payer-jobs:<payerDigest>            wallet report-history index

<ns>:report:<reportId>                   Blob path, owner, checksum and creation time
<ns>:report-body-fallback:<reportId>     bounded private paid-report fallback when Blob write fails
<ns>:report-share:<tokenDigest>          revocable expiring share mapping
<ns>:report-history-challenge:<digest>   one-use five-minute wallet challenge
<ns>:report-history-session:<digest>     15-minute report-access/recovery session

pulse:v6:activity-map:<network>:<wallet> per-transaction Spot/Autopilot activity hash
pulse:v6:activity:<network>:<wallet>     read-only legacy activity list used during migration
pulse:v6:automation:orders               current deterministic Spot automation projections
pulse:v6:autopilot:strategy-map          one hash field per signed Autopilot strategy
pulse:v6:autopilot:lease:<scope>:<id>    separate analysis and execution leases
pulse:v6:autopilot:evidence:<...>        private evidence fallback when private Blob is unavailable
pulse:v6:autopilot:potential-gainers:<tf> five-minute opportunity-radar cache

pulse:v6:telegram:delivery:<id>          retryable Telegram delivery task
pulse:v6:telegram:due                    due-delivery sorted set
pulse:v6:telegram:lock:<id>              delivery lock
pulse:v6:telegram:update:<updateId>       seven-day webhook deduplication marker
<ns>:automation:cron-lease               cross-instance scheduler lease
```

Report receipt binding and queue insertion are one Redis script. Job claims, acknowledgements, lease extensions, requeues, expired-lease recovery, and report attachment are also ownership/version checked. Trading activity uses one hash field per transaction so two workers cannot overwrite the whole ledger. Autopilot configuration and runtime telemetry are merged separately: a stale worker cannot roll back a newer owner-signed policy, and concurrent evaluation histories are unioned by evaluation ID.

Memory stores exist only for local/unit use. A production capability response labels persistence as `upstash_kv`; Spot/Autopilot execution that requires durable coordination fails closed when KV is unavailable. The resilience circuit bounds request time, opens after failure, retries a recovery probe, and lets read-only UI use last-known data without marking it confirmed.

### Implemented Blob model

- Paid report bodies are written under a unique `reports/<namespace>/<reportId>.json` path with overwrite disabled.
- The KV report record contains the paying wallet, Blob path, SHA-256 checksum, private visibility, and creation time.
- Private Blob reads bypass caches and verify the body checksum before JSON parsing.
- If a deployment must use public Blob access, the body is encrypted with authenticated AES-256-GCM before upload; unencrypted public reports are rejected by configuration.
- A bounded private-KV report-body fallback protects already-paid delivery when Blob rejects a write or is temporarily unavailable. It uses the report retention TTL and the same SHA-256 verification; Blob remains the primary artifact store.
- Autopilot stores the canonical decision payload before execution and binds its hash to the vault action. Private Blob is preferred; configured private KV is the fail-closed evidence fallback.
- Blob never stores the only current copy of a balance, active order, vault policy, position status, or P&L projection.

### Consistency and crash recovery

```text
wallet or worker broadcasts transaction
  -> UI records only a pending hash
  -> receipt reconciliation reads the selected chain through primary/fallback RPC
  -> confirmed sender + successful receipt advances activity
  -> contract/account reads determine Pending, Active, Executed or Cancelled
  -> immutable execution activity heals stale worker runtime
```

If a report worker crashes after settlement, its lease expires and a replacement claims the same job. If it crashes after Blob upload but before job completion, the receipt-bound retry policy regenerates or reconciles the deliverable without charging again. If an automation worker crashes after broadcast, the next cycle uses the transaction hash, receipt, existing activity ledger, and contract nonce/state rather than blindly broadcasting again. KV is the fast operational projection; chain/provider evidence wins disagreements.

### Operational state and dashboard projections

PULSE does not infer trading state from an unrelated account-creation receipt. It derives each lifecycle from its own contract/provider evidence:

| UI state | Meaning |
| --- | --- |
| Pending | a submitted transaction awaits a receipt, or a funded entry condition has not filled |
| Active | acquired assets remain under TP/SL, or an Autopilot vault currently holds a governed position |
| Executed | a Market/Limit buy or sell completed without active protection, or a protected lifecycle closed fully |
| Cancelled | the owner cancelled the order or the contract reports a terminal cancellation |
| Activity | append-only view of wallet/contract transactions; it is not another order status |

A partial exit remains Active while protected target balance remains. A completed exit becomes Executed only when contract state and balance agree. Trigger and mark come from contract/provider evidence; P&L is shown only when a confirmed fill basis exists. Legacy records without provable basis say that the basis is unavailable instead of displaying a fabricated zero.

The browser also maintains a latest-request epoch. Starting Premium supersedes a still-running Quick request; changing pair, timeframe, network, or selected Prediction question invalidates the previous context. A late response can be recovered in history, but it cannot overwrite the currently selected report.

### Sensitive-data boundary

- User wallet private keys and seed phrases never enter the API, KV, Blob, logs, or report payloads.
- `TEST_WALLET_PRIVATE_KEY` and the restricted automation executor key are server/worker environment values only and are never exposed through `VITE_*`.
- Provider keys, xAI credentials, Blob tokens, KV tokens, Telegram secrets, `CRON_SECRET`, and report encryption keys stay server-side.
- Wallet-history nonces and sessions are hashed in keys and expire; they can read reports and retry only an already-settled report job, never pay or trade.
- Browser-announced activity can only be `pending`; confirmation is derived from a receipt whose sender matches the wallet.
- Logs and metrics contain correlation IDs, stages, timings and outcome counts—not private report bodies or signing secrets.

## On-chain execution architecture

One separately configured contract suite exists on each supported execution mainnet. The UI reads factory state before suggesting account creation. Arc Testnet exposes analysis/payment and Risk Guard only; Spot and Autopilot remain hidden.

```mermaid
flowchart LR
  OWNER[Connected wallet owner] --> LIMIT[Limit account]
  OWNER --> BRACKET[Bracket / OTOCO account]
  OWNER --> PROTECT[Protected OCO account]
  OWNER --> VAULT[Isolated Autopilot vault]
  KEEPER[Restricted Spot keeper] --> LIMIT
  KEEPER --> BRACKET
  KEEPER --> PROTECT
  EXECUTOR[Restricted Autopilot executor] --> VAULT
  LIMIT --> REG[PulseRegistryV1]
  BRACKET --> REG
  PROTECT --> REG
  VAULT --> REG
  LIMIT --> ORACLE[OracleRouterV1]
  BRACKET --> ORACLE
  PROTECT --> ORACLE
  VAULT --> ORACLE
  LIMIT --> ADAPTER[OkxSwapAdapter V1/V2]
  BRACKET --> ADAPTER
  PROTECT --> ADAPTER
  VAULT --> ADAPTER
  ADAPTER --> ROUTER[Allowlisted OKX router and approval spender]
```

| Contract family | Responsibility and enforced boundary |
| --- | --- |
| `PulseRegistryV1` | approved adapters, separate Spot keeper and Autopilot executor roles, and guardian automation pause; owner withdrawal is not delegated to automation |
| `OracleRouterV1` | normalized price plus freshness/validity; automatic execution rejects missing, stale or invalid observations |
| `OkxSwapAdapterV1/V2` | exact token/amount/recipient/deadline payload, separate router and approval-spender policy, balance-delta output and minimum received |
| `SpotOrderAccountV2` + factory | connected-wallet Buy-below/Sell-above limit order; owner cancellation and exact funded amount |
| `SpotBracketAccountV1` + factory | OTOCO entry followed by contract-held TP/SL protection; one exit closes the sibling branch |
| `SpotOrderAccountV1` + factory | owner-controlled protected OCO position and immediate owner close/recovery |
| `AutopilotVaultV2` + factory | isolated settlement capital, allowlisted target asset, policy version/hash, nonce, trade/exposure/turnover/loss/slippage/cooldown/expiry limits, executor-only bounded action |

Contracts are not proxy-upgraded in place. New behavior uses a new implementation/factory version and explicit configuration. Provider calldata is untrusted: the adapter validates the approved router path, tokens, recipient, amount, deadline, approval target and output before success. Global pause and per-integration allowlists can stop automation, while the owner retains pause, cancellation, close and withdrawal controls.

Spot Trading and Autopilot are independent systems. A Spot report action never allocates capital to Autopilot; creating a Spot order never authorizes strategy decisions; an Autopilot vault never controls ordinary connected-wallet holdings.

## Repository and module architecture

```text
.
├── apps/
│   ├── web/                         React 19 + Vite V6 console
│   │   └── src/
│   │       ├── App.tsx              network, wallet, analysis and top-level routing
│   │       ├── V6Workspaces.tsx     Spot, Autopilot, Telegram, Docs and shared dashboards
│   │       ├── Pickers.tsx          themed market, execution-pair and timeframe pickers
│   │       ├── Report.tsx           readable reports and zoomable Elliott charts
│   │       ├── ReportHistory.tsx    wallet-owned cross-device recovery
│   │       └── wallet.ts            provider selection, x402 signing and chain checks
│   └── api/
│       └── src/
│           ├── app.ts               REST/MCP/x402 routes and durable report execution
│           ├── jobs.ts              KV jobs, leases, receipts and Blob report store
│           ├── v6Routes.ts          pair resolution, quotes, balances and activity APIs
│           ├── onchainDiscovery.ts  factory multicall, RPC fallback and account snapshots
│           ├── tradeAutomation.ts   deterministic Spot reconciliation/trigger worker
│           ├── autopilotPolicy.ts   explicit entry, Hold and exit rule engine
│           ├── autopilotAutomation.ts strategy/evidence/simulation/execution loop
│           ├── reportHistoryAuth.ts wallet challenge and scoped report recovery sessions
│           ├── resilientKv.ts       bounded retry and recovering KV circuit
│           ├── automationTick.ts    secret serverless scheduler entry and lease
│           └── telegram.ts          webhook, checkout handoff and durable delivery
├── packages/
│   ├── contracts/                   Solidity, artifacts, deployments, config and tests
│   ├── analysis/                    structured Global/Prediction analysis and Elliott logic
│   ├── market/                      OKX and public Polymarket evidence clients
│   ├── payments/                    OKX, CDP, Circle and mock x402 adapters
│   ├── buyer/                       controlled x402 buyer utilities
│   ├── domain/                      Risk Guard and deterministic preflight logic
│   ├── schemas/                     versioned Zod API/report contracts
│   ├── config/                      networks, feature gates, prices and metadata
│   └── sdk/                         typed PULSE client and job polling
├── api/                             Vercel serverless entrypoint
├── metadata/                        local machine-readable marketplace package
├── assets/                          source brand assets
├── scripts/                         dev orchestration, readiness and E2E diagnostics
├── ops/                             alerting and operational configuration
└── docs/                            architecture, testing, deployment and user guides
```

The architecture detail in this README reflects implemented modules. The deeper contract authority, strategy rules, deployment variables, acceptance evidence, and operator procedures live in [V6 technical proposal](docs/V6_TECHNICAL_PROPOSAL.md), [Autopilot trading report](docs/AUTOPILOT_TRADING_REPORT.md), [environment reference](docs/ENVIRONMENT.md), and [product testing guide](docs/PRODUCT_TESTING_GUIDE.md).

## Quick start

### Requirements

- Node.js 22.x
- npm 10+
- xAI key for live generated reports
- Provider credentials for real settlement and funding
- A funded test wallet only when intentionally running real-payment tests

```bash
git clone https://github.com/mssystem1/ai-pulse.git
cd ai-pulse
copy .env.local.example .env
npm install
npm run build
npm test
npm run dev
```

`npm run dev` starts both applications. Use `npm run dev:api` and `npm run dev:web` only when separate terminals are preferable.

## Local development

Requirements: Node.js 22.x and npm 10+.

```bash
copy .env.local.example .env
npm install
npm run build
npm test
npm run dev
```

`npm run dev` starts the web app at `http://localhost:5173` and the API at `http://localhost:4000`. Individual processes are available as `npm run dev:web` and `npm run dev:api`.

Useful local endpoints:

- Web: `http://localhost:5173`
- API health: `http://localhost:4000/healthz`
- Product metadata: `http://localhost:4000/v1/metadata`
- MCP: `http://localhost:4000/mcp`
- Polymarket discovery: `http://localhost:4000/v1/polymarket/markets`

### Real local payment testing

Use `X402_MOCK=0`. Real testing spends the configured wallet's assets and must use a fresh challenge and signature for every payment. `X402_MOCK=1` is reserved only for automated shape/unit tests and must never be enabled in production.

Do not expose server credentials or private keys through `VITE_*` variables. Test-wallet secrets belong only in ignored local environment files.

## Configuration

Start with [`.env.local.example`](.env.local.example) for local integration and [`.env.production.example`](.env.production.example) for rollout. The complete categorized guide is [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

Key controls:

```dotenv
ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet
VITE_ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet

FEATURE_PREDICTION_ANALYSIS=1
FEATURE_FUSED_ANALYSIS=0
FEATURE_DIVERGENCE_ANALYSIS=0
FEATURE_EVENT_RISK_ANALYSIS=0
FEATURE_BASE_PAYMENTS=1
FEATURE_ARBITRUM_PAYMENTS=1
FEATURE_ARC_PAYMENTS=1
CIRCLE_GATEWAY_ENABLED=1

X402_MOCK=0
ARC_AI_MODE=live
GROK_MAX_INPUT_FUSED_STANDARD=13000
```

`ENABLED_NETWORKS` controls server routes and payment adapters. `VITE_ENABLED_NETWORKS` controls which networks the built web application exposes. Keep them aligned for local testing. Production can begin with only `xlayer` and expand through feature flags after each network's release gates pass.

`ARC_AI_MODE=live` uses real xAI analysis after Circle Gateway settlement and requires positive xAI input/output cost variables. `fixture` intentionally returns a labelled non-analytical test report. Fused, divergence, and event-risk flags remain disabled because they are not part of the current web product.

## API examples

```bash
curl "http://localhost:4000/v1/market/ticker?instId=BTC-USDT"
curl "http://localhost:4000/v1/polymarket/trending?limit=20"

curl -i -X POST "http://localhost:4000/base/v1/analysis/prediction/standard" \
  -H "content-type: application/json" \
  -d '{"primaryMarketId":"pm:0x...","additionalMarketIds":[],"lang":"en"}'
```

The unpaid request returns a 402 response only after input and primary-market evidence validation succeeds.

## Persistence and operations

- Upstash KV/Redis is the durable operational read model for payment idempotency, report queues and leases, receipt references, wallet-history authorization, Spot activity, automation projections, Autopilot strategies, worker leases, and Telegram delivery retries.
- Vercel Blob holds immutable private report bodies and large Autopilot evidence. KV holds the small owner/index/checksum manifest; private Blob reads bypass caches and verify SHA-256 integrity. Public Blob mode is allowed only with authenticated report encryption.
- Confirmed chain receipts, contract state, wallet balances, and provider-owned order state remain stronger evidence than KV. Reconciliation heals stale projections and never upgrades browser-announced activity beyond Pending without receipt evidence.
- `PERSISTENCE_NAMESPACE` scopes report/job/history/budget/cron data. Stable `pulse:v6:*` trading keys preserve existing mainnet accounts and activity, so development, staging, and production must use separate KV databases.
- Correlation IDs connect payment, job, provider, xAI, report, automation, and delivery events. `/metrics` publishes payment, provider, queue, completion, recovery, token, and estimated AI-cost metrics without report bodies or secrets.
- Long-lived Node hosts run report and enabled automation timers in process. Serverless installations call the secret `/v1/internal/automation/tick` route; `CRON_SECRET` authenticates the request and a KV lease prevents overlapping cycles.
- Alert rules and production checks live under `ops/` and `scripts/`. The complete source-of-truth and crash-recovery model is documented above in [Data architecture: KV and Blob only](#data-architecture-kv-and-blob-only).

Deployment and rollback instructions are in [docs/V5_PRODUCTION_RUNBOOK.md](docs/V5_PRODUCTION_RUNBOOK.md) and [docs/DEPLOY.md](docs/DEPLOY.md). Marketplace drafts are documentation until an operator explicitly publishes them.

## Deployment

### Current topology and supported layouts

PULSE supports a split Vercel-web/Railway-API layout and an optional one-origin serverless layout. The checked-in production default is the split layout: `BASE_URL` is the final public Railway API origin and `VITE_API_URL` is compiled into the Vercel web build. The single long-lived Railway service runs report, Spot, Autopilot and Telegram cycles directly. An alternative serverless deployment must schedule the authenticated automation tick and must not run alongside Railway automation. Neither layout moves user wallet signing into the server. See [`docs/DEPLOY.md`](docs/DEPLOY.md).

Production deployment is an operator action. Local readiness never authorizes a commit, push, redeploy, marketplace submission, or agent update. Use [docs/DEPLOY.md](docs/DEPLOY.md) and [docs/V5_PRODUCTION_RUNBOOK.md](docs/V5_PRODUCTION_RUNBOOK.md), deploy a canary network set first, verify live receipts and recovery, then expand feature flags.

### Marketplace discovery contract

- OKX.AI A2MCP endpoints must either return a free result or a standard paid challenge followed by a successful paid replay.
- X Layer challenges declare USD₮0 address, six decimals, symbol, EIP-712 name/version, amount, payee, and `eip155:196`.
- Base and Arbitrum publish CDP Bazaar discovery extensions only after their deployed paid routes are enabled and verified.
- Arc Testnet listing material must remain explicitly testnet and must not imply production-value USDC or Arc-native AI inference.
- The Base dashboard verification tag is emitted by `apps/web/index.html` as `base:app_id=6a71cfab2c28265d676172e4`.

Detailed operator steps are in [docs/MARKETPLACE_LISTING_GUIDE.md](docs/MARKETPLACE_LISTING_GUIDE.md).

## Test commands

```bash
npm test
npm run build
npm run readiness:okx
npm run readiness:upstash
npm run readiness:blob
npm run validate:alerts
```

`readiness:*` commands are release diagnostics, not requirements for ordinary `npm run dev` usage. Live settlement certification is separate from mocked automated tests and must be reported by exact network, service, transaction, receipt, and terminal job state.

## Security and limitations

- Browser keys remain in the wallet; server credentials remain server-side.
- Signed payments are bound to network, asset, amount, payee, resource URL, and request body.
- Idempotency prevents one authorization from starting duplicate analysis jobs.
- PULSE provides decision support, not financial advice.
- Polymarket probabilities are market prices, not objective truth.
- Restricted-market analysis does not authorize or facilitate trading.
- Prototype heuristic safety outputs are never presented as audits or guaranteed transaction outcomes.
- Arc production-quality analysis requires `ARC_AI_MODE=live`; fixture reports are labelled non-analytical plumbing checks and cannot be confused with live Grok output.

## Current release discipline

All network and feature additions are additive and feature-flagged. Existing X Layer routes remain compatible. No cloud deployment, marketplace publication, agent update, commit, or push should occur until the local test matrix is complete and the operator explicitly approves release actions.

## Status

The exact Autopilot strategies, entry/exit rules, risk profiles, contract authority and point 12.d acceptance standard are documented in [`docs/AUTOPILOT_TRADING_REPORT.md`](docs/AUTOPILOT_TRADING_REPORT.md).

| Area | Local implementation state |
| --- | --- |
| Original X Layer web, REST, MCP, safety, wallet and funding | Preserved and extended |
| Base / Arbitrum native-USDC payment and in-app funding | Implemented; production certification remains an operator gate |
| Arc Testnet Circle payment and funding | Implemented; explicitly testnet |
| Polymarket discovery and read-only analysis | Implemented |
| Prediction Market Quick and Pro services | Implemented |
| Receipt-bound durable jobs and private recovery | Implemented |
| Desktop/mobile V6 layouts and mobile service switcher | Locally reviewed |
| Automated tests | 168/168 passing locally on 2026-08-27 |
| Production build | Passing locally |
| Base dashboard verification tag | Implemented locally |
| Marketplace publication and agent #8355 mutation | Not executed; requires explicit operator approval |

---

<p align="center"><strong>PULSE</strong> · Signal when you need it. Proof when it matters.</p>
