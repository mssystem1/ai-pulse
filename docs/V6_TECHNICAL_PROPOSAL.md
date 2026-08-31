# PULSE Technical Specification

Status: implementation specification  
Date: 2026-08-20  
Scope: Global Market, Prediction Market, multichain payments, spot execution, Autopilot, Telegram, and product documentation

> **Operational amendment · 2026-08-29:** routine Autopilot cycles no longer buy or generate full Premium reports. A free deterministic new-candle gate runs first; only a surviving entry candidate may use a compact, schema-bound AI market-state confirmation. Each vault requires a manually prepaid pass ($1.50/24h, $10.50/7d, or $45/30d), with up to three compact confirmations per covered day plus stricter global/per-vault call and USD ceilings. Renewal extends the active expiry. On expiry, new entries Hold while deterministic TP/SL, structural exits and owner controls continue. Any later sections describing a full Premium report per scheduler cycle document the earlier design and are superseded by this amendment.

## 1. Purpose

This proposal defines the architecture and delivery contract for the nine requested PULSE updates. It is grounded in the existing monorepo and preserves its current strengths: live OKX and Polymarket evidence, network-aware x402 settlement, durable paid jobs, private report storage, connected browser wallets, and server-side provider credentials.

The two money-moving products are intentionally independent:

- **Spot Trading** is deterministic and user-directed. Every order is created or changed by an explicit wallet authorization.
- **Autopilot** is autonomous. It uses separately allocated funds and a restricted executor operating inside on-chain guardrails.

They may share presentation components and low-level market/transaction adapters, but they must not share custody, order state, strategy state, or authorization.

## 2. Confirmed product decisions

1. **Global Market** includes all live OKX spot instruments, including crypto, xStocks, tokenized ETFs, and other RWA instruments exposed by the OKX spot catalog.
2. Manual spot execution uses the existing connected wallet. No second wallet is required.
3. Spot TP/SL automation belongs to a dedicated deterministic Spot Order Manager, not Autopilot.
4. Autopilot must be fully operable on X Layer, Base, and Arbitrum mainnet.
5. `TEST_WALLET_ADDRESS` and `TEST_WALLET_PRIVATE_KEY` may be used for mainnet integration tests. The private key remains server-only and must never be logged, serialized, returned, or bundled.
6. When Arc Testnet is selected, all new trading and Autopilot functionality is hidden. Analysis and supported payment functionality remain available.
7. Arc mainnet remains disabled behind explicit capability flags after its announced September 16, 2026 launch until its execution stack is certified.
8. All nine points are one product scope. The phases below are an internal dependency order, not a reduction in deliverables.

## 3. Existing architecture and required change

### 3.1 Existing components to retain

- `apps/web`: React 19 and Vite UI, wallet connection, payment network selection, report rendering, job recovery.
- `apps/api`: Express API, paid-route middleware, provider adapters, durable job orchestration, report persistence.
- `packages/market`: OKX public spot data and Polymarket clients.
- `packages/analysis`: structured Grok analysis.
- `packages/payments`: OKX, CDP, Circle, and mock x402 adapters.
- `packages/schemas`: shared runtime validation.
- `packages/config`: network, feature, model, pricing, and provider configuration.

### 3.2 Current gaps

- The application shell is concentrated in `App.tsx` and has no route-level product modules.
- Reports do not contain deterministic Fibonacci, pivot, or Elliott-wave candidate data.
- Report tier identity is visually weak.
- Prediction Premium does not attach the underlying asset's 4H spot context.
- DeFi opportunities are not included in reports.
- The funding drawer is named `SwapPanel`, but it is not a trading terminal.
- There is no spot execution domain, order ledger, position ledger, P&L engine, contract, or indexer.
- There is no Autopilot domain, policy contract, executor, scheduler, or receipt system.
- There is no Telegram adapter or in-app documentation area.
- New feature flags currently have no implementation behind them.

### 3.3 Target module boundaries

```text
apps/web
  shell/                 navigation, theme, network capability context
  global-market/         discovery, analysis, report actions
  prediction-market/     market selection, analysis, report actions
  spot-trading/          order ticket and independent dashboard
  autopilot/             strategy builder and independent dashboard
  telegram/              setup and account-linking guide
  docs/                  product documentation application
  safety/                existing safety experience
  wallet/                connection and payment funding drawer

apps/api
  routes/analysis/       spot and prediction analysis orchestration
  routes/defi/           read-only DeFi opportunities
  routes/trading/        connected-wallet spot execution
  routes/autopilot/      strategy and vault lifecycle
  routes/telegram/       linking, commands, checkout callbacks
  providers/okx/         spot, DEX, intent/limit, DeFi adapters
  providers/oracles/     normalized price observations
  workers/               reports, order reconciliation, triggers, Telegram

packages
  technical-analysis/    deterministic indicators and wave candidates
  execution/             quote/order/transaction domain logic
  portfolio/             lots, fills, balances, and P&L
  autopilot/             policy evaluation and decision receipts
  schemas/               versioned public/internal contracts
  contracts/             Solidity contracts, deployment, tests
```

The physical layout may be introduced incrementally, but these dependency directions are mandatory. UI code must not call provider APIs directly, and AI output must not become executable transaction data without deterministic validation.

## 4. Point 1: Crypto Market to Global Market

### 4.1 Naming

Replace user-facing `Crypto Market` and `Crypto market intelligence` with `Global Market` and `Global market intelligence` in:

- navigation and page titles;
- English and Chinese copy;
- API metadata and service descriptions;
- MCP descriptions;
- README and in-app Docs;
- accessibility labels, empty states, and report headings.

Historical API paths remain stable for compatibility. New aliases may be added, but existing clients must not break.

### 4.2 Instrument classification

Extend the normalized instrument model:

```ts
type GlobalInstrumentClass = "crypto" | "tokenized_stock" | "tokenized_etf" | "rwa" | "unknown";

type GlobalInstrument = SpotInstrument & {
  assetClass: GlobalInstrumentClass;
  displayName?: string;
  underlyingSymbol?: string;
  executionNetworks: Array<"xlayer" | "base" | "arbitrum">;
  regionalRestrictionNotice?: string;
};
```

Classification must use provider metadata when available and a tested fallback classifier for known OKX unified tokenized-stock symbols. Unknown instruments remain visible and are not mislabelled as crypto.

### 4.3 Picker UX

- Add category chips: `All`, `Crypto`, `Stocks`, `ETFs`, `RWA`.
- Preserve free-text search across symbol, instrument ID, and display name.
- Add an asset-class badge and execution-network badges.
- Keep analysis availability separate from on-chain execution availability.
- Show the tokenized-asset disclosure before the first RWA report or trade.

## 5. Points 2 and 3: Report system redesign

### 5.1 Principles

- Numerical levels are calculated in code from the captured OHLCV snapshot.
- The model explains calculated evidence; it does not invent indicator values.
- Every report is bound to instrument/market, timeframe, tier, payment network, methodology version, evidence time, and job ID.
- Elliott analysis is explicitly a heuristic candidate count, never a deterministic fact.
- Base and Premium use separate schemas so Premium depth is structurally enforceable.

### 5.2 Deterministic technical-analysis package

Create `packages/technical-analysis` with pure, unit-tested functions:

- swing detection using configurable fractal/zigzag thresholds;
- Fibonacci retracement and extension levels from the selected validated swing;
- classic pivot point, S1-S3, and R1-R3 from the relevant prior completed period;
- ATR, RSI, EMA set, volume trend, and volatility regime;
- support/resistance clustering;
- Elliott candidate waves using pivot sequences, relationship constraints, confidence, invalidation, and alternate counts;
- scenario path construction for bull/base/bear outcomes;
- serializable chart annotations.

All functions accept chronological candles and return their source candle timestamps and calculation parameters.

### 5.3 Base Global Market report

Required fields:

- `BASE` tier mark;
- instrument and asset-class identity;
- regime, bias, confidence, and concise summary;
- current price and evidence freshness;
- support/resistance and primary pivot;
- primary target and invalidation;
- short risk/action checklist;
- network-specific DeFi opportunities;
- limitations and disclaimer.

Base may render a compact price chart, but advanced annotation is Premium-only.

### 5.4 Premium Global Market report

Premium adds:

- `PREMIUM` seal and distinct visual surface;
- interactive candlestick chart for the selected pair and timeframe;
- Fibonacci retracement/extensions with anchor explanation;
- pivot, S/R levels, and calculation period;
- primary and alternate Elliott candidate counts;
- wave labels, confidence, invalidation, and possible next moves;
- bull/base/bear paths;
- entry zone, targets, stop/invalidation, and estimated risk/reward;
- liquidity/volatility warnings;
- actionable but editable trade-plan payload;
- expanded DeFi opportunity comparison.

Use a maintained financial chart library loaded as a route-level chunk. The chart consumes report snapshot data so later market movement does not silently rewrite a paid report.

### 5.5 Prediction Base report

- `BASE` tier mark distinct from Global Market Base.
- Market-implied probability and executable bid/ask.
- Evidence-based fair range.
- Decision, evidence, counter-case, invalidations, liquidity, spread, resolution risk, freshness, and limitations.
- No unrelated asset chart.

### 5.6 Prediction Premium report

Add an underlying-asset resolver for supported questions:

```ts
type PredictionUnderlying = {
  symbol: string;
  okxInstId: string;
  confidence: number;
  matchedText: string;
};
```

For Premium only:

1. Resolve the question's underlying asset.
2. Fetch 4H OKX candles regardless of the Global Market selector.
3. Calculate the same deterministic Premium technical evidence.
4. Render a 4H asset chart with Fibonacci, pivot, and wave candidates.
5. Explain how the spot structure may affect the prediction scenario.
6. Keep spot direction and prediction-market probability conceptually separate.

If the asset cannot be resolved confidently, omit the chart and report the limitation rather than selecting a guessed pair.

### 5.7 DeFi opportunities in Global Market reports

Add an authenticated server-side Onchain OS DeFi provider using the selected network's chain index and the selected base asset.

Pipeline:

1. Resolve the verified token identity on the selected network.
2. Search `SINGLE_EARN`, `LENDING`, and applicable `DEX_POOL` products.
3. Fetch details for ranked candidates.
4. Normalize APY, TVL, protocol, product type, accepted token, investability, withdrawal support, and observation time.
5. Rank using a transparent score that favors relevant token match, meaningful TVL, supported exit, and data completeness. Do not rank on APY alone.
6. Return up to three opportunities and explicit risk flags.

No opportunity is better than a same-symbol product on the wrong chain. Empty coverage is a valid result.

### 5.8 Report schema version

Use the current PULSE response schemas while retaining parsers for stored legacy reports. Report rendering dispatches by schema/methodology identifier.

## 6. Point 4: Base-to-Premium report replacement bug

### 6.1 Root cause

The current paid action retains the previous `result`. Progress UI is rendered only when `result` is empty, so a Premium request can run behind a visible Base report. Terminal worker failures also do not reliably replace the stale report with an error state.

### 6.2 State model

Replace loose state with a reducer/state machine:

```ts
type ReportRequestKey = {
  product: "global" | "prediction";
  selectionId: string;
  timeframe: string;
  tier: "base" | "premium";
  network: WebNetworkKey;
};

type ReportState =
  | { status: "idle" }
  | { status: "paying"; key: ReportRequestKey }
  | { status: "queued" | "generating"; key: ReportRequestKey; jobId: string }
  | { status: "ready"; key: ReportRequestKey; report: unknown }
  | { status: "failed"; key: ReportRequestKey; message: string; recoverable: boolean };
```

Rules:

- A new purchase immediately supersedes the prior visible report with a progress surface.
- A response is accepted only if its key matches the active request.
- Terminal job stages map to explicit errors.
- Recovery tokens are stored per product/network/request, not one mutable slot.
- Double-click and concurrent purchase protection is enforced.
- A completed Base report cannot satisfy a Premium request.

Add reducer, recovery, and component tests for the exact reported regression.

## 7. Point 5: Network and payment UX

### 7.1 Language

Replace the ambiguous hidden select with a visible `Network & payment` control. The UI describes networks; raw RPC URLs remain implementation details.

### 7.2 Custom popover

Each row includes:

- network identity and environment;
- payment asset and spendable balance;
- payment provider;
- wallet network status;
- analysis capability;
- spot, Autopilot, DeFi, and safety capability badges;
- funding action when insufficient.

Native `<option>` styling is replaced with an accessible custom listbox/dialog supporting keyboard navigation, focus return, escape, and mobile layout.

### 7.3 Capability matrix

The server publishes a capability document and the web app renders from it:

```ts
type NetworkCapabilities = {
  payments: boolean;
  globalAnalysis: boolean;
  predictionAnalysis: boolean;
  defiDiscovery: boolean;
  spotMarket: boolean;
  spotLimit: boolean;
  spotProtection: boolean;
  autopilot: boolean;
};
```

The browser must not infer execution support solely from a chain name or feature flag.

### 7.4 Themes

Retain semantic design tokens and strengthen distinct themes:

- X Layer: dark ink, mint/cyan energy.
- Base: bright cobalt and white.
- Arbitrum: deep navy and layered blue.
- Arc: graphite, silver, and restrained cyan.

Dialogs, charts, tooltips, loading states, tables, focus rings, and empty states must all consume the same token set.

## 8. Point 6: Independent Spot Trading

### 8.1 Product boundary

Spot Trading is available as a standalone Global Market sub-workspace and report action. It does not require Autopilot and does not permit AI to alter active orders.

### 8.2 Execution coverage

- Analysis catalog: all live OKX spot instruments.
- On-chain execution catalog: intersection of selected instrument, verified chain token, supported settlement asset, supported OKX route, and adequate liquidity.
- X Layer: primary venue for supported crypto and xStocks.
- Base and Arbitrum: supported tokens and liquidity only.
- Arc Testnet: hidden.
- CDP may remain a funding/route fallback where useful; it does not solve missing on-chain assets.

Every instrument exposes an execution status and reason. Never substitute a same-symbol token from another chain.

### 8.3 Server APIs

Proposed endpoints:

```text
GET  /v1/trading/capabilities?instId=&network=
GET  /v1/trading/tokens?network=&q=
POST /v1/trading/quote
POST /v1/trading/prepare-approval
POST /v1/trading/prepare-swap
POST /v1/trading/simulate
POST /v1/trading/limit/sign-data
POST /v1/trading/limit/submit
POST /v1/trading/limit/cancel-sign-data
POST /v1/trading/limit/cancel
GET  /v1/trading/orders?address=&network=&status=
GET  /v1/trading/portfolio?address=&network=
GET  /v1/trading/history?address=&network=
POST /v1/trading/positions/:id/close-quote
```

Provider credentials stay server-side. All prepared transactions are simulated and validated again in the browser before wallet submission.

### 8.4 Manual market execution

1. User selects buy/sell, amount, and slippage.
2. Server resolves exact token contracts and returns a short-lived quote.
3. Server performs token/security checks and prepares approval/swap transactions.
4. Browser checks chain, wallet, recipient, value, tokens, amounts, deadline, and quote hash.
5. Connected wallet signs and broadcasts.
6. API/indexer records the confirmed fill and updates the lot ledger.

### 8.5 Native limit orders

Use OKX DEX limit/intent APIs with connected-wallet EIP-712 signatures where the selected chain supports them. The user owns the order; the API stores provider IDs and normalized status only.

Changing an order is an explicit replace operation:

1. cancel existing order;
2. wait for accepted cancellation state;
3. create and sign the replacement;
4. preserve the relationship in order history.

### 8.6 Automatic TP/SL: Spot Order Manager

Create a dedicated deterministic contract suite for protected spot positions:

```text
SpotOrderManager
  createPosition
  createBracketPosition
  updateProtection
  addProtectedAmount
  reduceProtectedAmount
  pausePosition
  resumePosition
  executeEntry
  executeExit
  closeNow
  cancelAndWithdraw
```

Required protection types:

- fixed take profit;
- fixed stop loss;
- OCO TP/SL;
- optional trailing stop;
- optional expiry;
- optional tiered partial take profit after the base contract is proven.

Contract invariants:

- only the owner changes rules or withdraws;
- the executor cannot choose an arbitrary token, amount, receiver, or router;
- entry and exit calldata target allowlisted adapters;
- oracle trigger, quote deadline, min output, slippage, and deviation are verified;
- state changes precede external calls;
- reentrancy is blocked;
- only one terminal OCO path succeeds;
- users can always cancel and withdraw when not in an in-flight atomic execution;
- emergency pause blocks new automated execution but not user withdrawal.

The Spot Order Manager contains no model calls and no authority to rewrite user parameters.

### 8.7 Oracle policy

Use an asset-aware provider registry:

- validated on-chain oracle when available;
- DEX TWAP as independent secondary evidence when viable;
- bounded signed observations only when an asset lacks an on-chain feed;
- no automatic protection when a defensible price policy cannot be constructed.

Every trigger records the observations used. xStocks require explicit issuer/market-hours and stale-reference handling even though token markets may trade continuously.

### 8.8 Trading dashboard

Sections:

- overview: balances, portfolio value, realized/unrealized P&L;
- holdings/trade lots;
- active limit orders;
- protected positions;
- pending approvals/transactions;
- completed, cancelled, expired, and failed history.

Actions:

- edit/cancel order;
- edit/pause/resume TP/SL;
- close selected;
- close all with a chain-grouped execution plan;
- refresh/reconcile;
- open provider/explorer evidence.

`Close all` is not falsely represented as one cross-chain atomic operation. Same-chain contract positions may batch; connected-wallet holdings may require sequential signatures.

### 8.9 P&L

Store confirmed fills and fees. Use a documented cost-basis method (initially weighted average per chain/token/wallet), current normalized prices, and explicit unknown states.

```text
unrealized P&L = current value - remaining cost basis
realized P&L   = exit proceeds - allocated cost basis - recorded fees
```

Never calculate final P&L from quoted amounts when confirmed fills are available.

## 9. Point 7: Independent Autopilot

### 9.1 Product boundary

Autopilot has its own tab, contracts, API namespace, persistence, balances, strategies, decision records, executor, monitoring, and dashboard. Spot positions never become Autopilot positions implicitly.

Autopilot does not purchase or reuse a Global Market report. It starts from its own pair, timeframe, strategy, capital/risk policy and duration service. A free deterministic candidate gate runs first; only a surviving candidate may request the compact AI confirmation covered by its active runtime. Opportunity Radar may prefill pair/timeframe as navigation context, but no report recommendation, entry, TP or SL becomes an Autopilot signal or authorization.

### 9.2 Autopilot Vault

Use a per-user vault or factory-created isolated account owned by the connected wallet. The initial design should avoid pooled strategy custody.

Policy fields:

```ts
type AutopilotPolicy = {
  network: "xlayer" | "base" | "arbitrum";
  allowedAssets: string[];
  settlementAsset: string;
  allowedStrategies: string[];
  maxPositionUsd: number;
  maxTotalExposureUsd: number;
  maxTradeUsd: number;
  maxDailyTurnoverUsd: number;
  maxDailyLossUsd: number;
  maxDrawdownPct: number;
  maxSlippageBps: number;
  maxOracleDeviationBps: number;
  minTradeIntervalSeconds: number;
  expiresAt: number;
  premiumAnalysisRules?: {
    enabled: boolean;
    pair: string;
    timeframe: string;
    cadenceSeconds: number;
    maxServiceSpendPerDayUsd: number;
  };
};
```

The owner can tighten or loosen their policy. The agent can only operate inside it and may only tighten a proposed action.

### 9.3 Agent loop

```text
Sense -> Validate evidence -> Request analysis if policy permits
      -> Propose action -> Deterministic risk engine
      -> Adversarial/critic check -> Simulate
      -> Contract preflight -> Execute or hold
      -> Confirm -> Record decision receipt -> Reconcile P&L
```

The deterministic risk engine has final authority. Model failure, ambiguity, stale data, missing route, excessive spread, failed simulation, or policy uncertainty results in `HOLD`.

### 9.4 Contract guardrails

- allowlisted assets, adapters, routers, selectors, and receivers;
- per-trade, per-position, total exposure, turnover, and loss caps;
- cooldown and strategy expiry;
- oracle and quote bounds;
- nonce/idempotency and replay protection;
- restricted executor role with immediate owner revocation;
- pause and unconditional owner withdrawal;
- two-step administration for global registries;
- no arbitrary calls or external withdrawal path;
- policy hash emitted with each execution receipt.

### 9.5 Mainnet operations

- Deploy to X Layer, Base, and Arbitrum with verified source.
- Use chain-specific router/oracle registries.
- Start with conservative caps in the test-wallet policy.
- Use `AUTOPILOT_KILL_SWITCH` as an off-chain global stop in addition to on-chain pause controls.
- Separate deployer, admin, and executor roles for production even if the configured test wallet exercises them during initial certification.
- Add alerts for failed simulations, policy rejects, oracle disagreement, stuck transactions, unexpected balance change, daily-loss proximity, and executor inactivity.

### 9.6 Autopilot dashboard

- allocated capital and available balance;
- active/paused/expired strategies;
- policy limits and remaining daily budgets;
- open autonomous positions;
- queued, rejected, executed, and failed decisions;
- realized/unrealized P&L and drawdown;
- analysis-service spend;
- pause, resume, edit policy, close selected/all, and withdraw.

UI components may be visually shared with Spot Trading, but all queries and actions use Autopilot identifiers and APIs.

## 10. Point 8: Telegram bot

### 10.1 Architecture

Telegram is a delivery adapter over existing PULSE services:

```text
Telegram Bot/Webhook
  -> Telegram command adapter
  -> PULSE service facade
  -> x402 checkout session
  -> existing durable analysis job
  -> formatted Telegram report + secure full-report link
```

MCP remains an external agent interface and is not required for internal bot-to-API calls.

### 10.2 Account linking

1. Bot issues a short-lived one-time nonce.
2. User opens the PULSE Telegram Mini App.
3. User connects the same supported wallet and signs a human-readable link message.
4. Server verifies address, nonce, Telegram user ID, expiry, and replay protection.
5. Store only the wallet address and link metadata, never wallet secrets.
6. User can unlink from Telegram or the web application.

### 10.3 Payment flow

1. User selects Global or Prediction analysis, tier, selection, timeframe where relevant, language, and payment network.
2. Bot creates a checkout session with exact price and expiry.
3. Mini App performs the existing wallet-based x402 payment.
4. The paid request creates the durable report job.
5. Bot receives the job completion event and sends a concise result plus the private report link.

No custodial Telegram wallet is introduced. Arc uses its existing supported payment flow; trading remains hidden there.

### 10.4 Commands

Initial commands:

```text
/start
/link
/global
/prediction
/reports
/status
/prices
/network
/unlink
/help
```

Inline keyboards and Mini App forms should replace complex command syntax.

### 10.5 Bot reliability and security

- webhook secret validation;
- Telegram update idempotency;
- rate limiting and abuse controls;
- no secrets in messages;
- report ownership checks;
- checkout expiry and replay protection;
- durable delivery retries;
- message-size-aware report formatting;
- deletion/unlink flow and audit events.

## 11. Point 9: Docs tab

### 11.1 Information architecture

Add a first-class Docs tab/route:

- Getting started
- Wallet and network selection
- Paying per service
- Global Market and RWA instruments
- Base versus Premium reports
- Prediction Market analysis
- Spot Trading
- Limit, TP, SL, OCO, and trailing stops
- Spot dashboard and P&L
- Autopilot and guardrails
- Telegram setup and usage
- DeFi opportunities
- REST, MCP, and agent integrations
- Security model
- Risks, limitations, and troubleshooting

### 11.2 Content implementation

- Versioned local Markdown/MDX-like content compiled with the web build.
- Searchable table of contents and deep links.
- Code-native SVG/HTML architecture diagrams and graphs.
- Annotated screenshots captured from the implemented product.
- Realistic redacted report examples.
- Responsive callouts for chain support and regional/RWA disclosures.
- English first; Chinese strings/content follow the existing language system.

Generated decorative imagery is not required. Actual UI screenshots and deterministic diagrams are more accurate for a financial product.

## 12. Shared persistence and event model: KV and Blob only

PULSE will not introduce PostgreSQL or another relational database. The production persistence model uses:

- **Blockchain and OKX** as external financial sources of truth;
- **Upstash KV/Redis** as the durable operational ledger, indexes, queues, leases, locks, idempotency store, sessions, and cache;
- **Vercel Blob** as encrypted immutable storage for large reports, evidence packages, periodic ledger snapshots, and archived event segments.

KV is authoritative for the application's current projection, but never overrides confirmed chain or provider evidence. Reconciliation repairs KV when it disagrees with a chain receipt, contract event, balance, or OKX order status.

### 12.1 KV keyspace

All financial records use a versioned namespace and normalized lowercase EVM addresses.

```text
pulse:v6:order:<orderId>                         JSON current order projection
pulse:v6:order:event:<eventId>                   immutable normalized event
pulse:v6:order:provider:<network>:<providerId>   provider-id -> orderId
pulse:v6:owner:<network>:<wallet>:orders         ZSET score=createdAtMs
pulse:v6:owner:<network>:<wallet>:orders:<state> ZSET score=updatedAtMs

pulse:v6:fill:<fillId>                           immutable confirmed fill
pulse:v6:tx:<network>:<txHash>                   current transaction projection
pulse:v6:chain:event:<chainId>:<txHash>:<logIdx> idempotency marker + normalized event
pulse:v6:chain:cursor:<chainId>:<contract>        last finalized/reconciled block

pulse:v6:lot:<network>:<wallet>:<token>:<lotId>  trade-lot projection
pulse:v6:owner:<network>:<wallet>:lots            ZSET score=openedAtMs
pulse:v6:pnl:<network>:<wallet>:<token>            current P&L projection
pulse:v6:portfolio:<network>:<wallet>              latest portfolio projection

pulse:v6:protected:<positionId>                    Spot Order Manager projection
pulse:v6:owner:<network>:<wallet>:protected         ZSET score=createdAtMs
pulse:v6:autopilot:vault:<vaultAddress>             vault projection
pulse:v6:autopilot:policy:<vaultAddress>:<version>  immutable policy version
pulse:v6:autopilot:decision:<decisionId>             decision projection
pulse:v6:owner:<network>:<wallet>:autopilot          ZSET score=createdAtMs

pulse:v6:telegram:<telegramUserId>                  encrypted/minimized link metadata
pulse:v6:wallet:<wallet>:telegram                   reverse-link set
pulse:v6:checkout:<checkoutId>                      expiring checkout capability

pulse:v6:queue:<name>:ready                         ZSET score=availableAtMs
pulse:v6:queue:<name>:leased                        ZSET score=leaseExpiresAtMs
pulse:v6:lease:<name>:<itemId>                      worker/lease token
pulse:v6:lock:<scope>                               short-lived fencing lock
pulse:v6:idempotency:<scope>:<key>                  deduplication result
pulse:v6:nonce:<purpose>:<wallet>                   expiring signing nonce
pulse:v6:cache:<provider>:<key>                     expiring provider cache

pulse:v6:artifact:<artifactId>                      Blob metadata/checksum record
pulse:v6:snapshot:<scope>:latest                    latest verified snapshot manifest
```

Records for orders, positions, policies, transactions, and decisions do not expire. TTLs are used only for caches, quotes, sessions, nonces, leases, locks, and temporary signing material.

### 12.2 Atomic transitions

All multi-key financial mutations execute through reviewed Redis Lua scripts, following the pattern already used by the durable paid-job store. A transition script performs one atomic operation:

1. load the current projection;
2. verify expected version and allowed state transition;
3. reject a duplicate event ID;
4. write the immutable event;
5. update the current projection and increment its version;
6. update owner/status/time indexes;
7. enqueue any required follow-up task;
8. return the committed projection.

Examples include `applyOrderEvent`, `applyConfirmedFill`, `applyProtectedPositionEvent`, `applyAutopilotDecision`, and `bindChainEvent`. A worker lease improves coordination, but correctness relies on event idempotency and version checks rather than the lock alone.

Canonical event IDs are deterministic:

```text
on-chain event:  <chainId>:<txHash>:<logIndex>
transaction:     <chainId>:<txHash>
OKX order event: okx:<chainId>:<providerOrderId>:<providerUpdateVersion>
user command:    <wallet>:<signedNonce>:<requestHash>
```

### 12.3 Query indexes

Because KV has no relational query planner, every supported dashboard query has an explicit sorted-set index. API handlers page through index members, bulk-fetch projections, discard stale index entries, and return a stable cursor. No production endpoint performs key scans.

Required indexes cover owner, chain, product, status, creation/update time, pending reconciliation, and failed/retryable state. Secondary indexes are updated in the same Lua transaction as their projection.

### 12.4 Blob usage

Blob stores encrypted, immutable, content-addressed artifacts:

- full paid reports and their candle/chart snapshots;
- Autopilot evidence bundles and model/risk-engine receipts;
- exported trading history;
- periodic KV ledger snapshots;
- compact archived event segments;
- documentation screenshots and downloadable examples.

Blob does not hold the only current copy of an active order, position, policy, balance, or P&L projection. Each artifact has a KV manifest containing owner, type, Blob key, SHA-256, encryption/schema version, creation time, retention policy, and the event range it covers.

### 12.5 Snapshot, archive, and restore

A scheduled archival worker creates bounded per-owner/per-chain event segments, encrypts them, uploads them to Blob, verifies the returned checksum, and writes an immutable manifest to KV. It then creates a projection snapshot whose checksum is bound to the final event ID. Financial event keys are retained for the active retention window and are removed only after both snapshot and archive manifests are verified.

Disaster recovery proceeds in this order:

1. restore the latest verified Blob snapshot into a clean KV namespace;
2. replay later archived event segments;
3. query each configured contract from its stored finalized cursor to the current finalized block;
4. reconcile OKX native order IDs and statuses;
5. rebuild lots, P&L, owner/status indexes, and pending queues;
6. compare reconstructed balances with chain/provider truth;
7. switch the API namespace only after integrity checks pass.

### 12.6 Crash-safe trading example

```text
Worker leases execution task from KV
  -> broadcasts transaction
  -> transaction confirms on-chain
  -> worker crashes before updating projection
  -> lease expires
  -> replacement worker queries receipt/logs
  -> deterministic chain event ID is applied through Lua
  -> duplicate application is rejected atomically
  -> order, fill, lot, P&L, indexes, and next task commit together
```

### 12.7 Sensitive data

- Private keys never enter KV or Blob.
- `TEST_WALLET_PRIVATE_KEY` exists only in protected server/worker environment memory.
- Prepared transaction capabilities and signing nonces are short-lived.
- EIP-712 signatures are retained only when necessary for provider recovery, encrypted at the application layer, and deleted after the provider submission becomes independently recoverable by order ID/hash.
- Reports, decision evidence, and exported histories are encrypted before Blob upload.
- Telemetry contains identifiers and state transitions, not secrets or private report bodies.

## 13. API and authorization rules

- Read-only public market endpoints remain free where currently free.
- Paid report endpoints retain x402 and durable delivery.
- Wallet-owned trading reads require a signed session challenge or fresh wallet signature, not only an address query.
- Transaction preparation requires exact network, wallet, tokens, amounts, and an expiring nonce.
- State-changing provider submissions require user signatures or valid contract executor authority.
- Autopilot endpoints require vault ownership for policy changes and executor authentication for internal execution.
- Telegram callbacks use linked-wallet authorization and one-time checkout capabilities.
- All schemas are validated with Zod and versioned.

## 14. Security requirements

### 14.1 Secrets

- Never expose OKX/CDP/Circle/xAI/Telegram credentials or private keys.
- Redact authorization headers, signatures where unnecessary, and raw provider payloads.
- `TEST_WALLET_PRIVATE_KEY` is loaded only in server/worker processes and excluded from client environment prefixes.

### 14.2 Transaction safety

- exact chain validation;
- verified token-address resolution;
- quote expiry and idempotency;
- simulation before signing/broadcast;
- router, selector, receiver, value, and amount validation;
- allowance minimization and revocation UX;
- honeypot/tax/security warnings;
- MEV protection where supported and justified;
- confirmation-state reconciliation before P&L changes.

### 14.3 Contract assurance

- unit tests and fuzz tests;
- invariant tests for solvency, withdrawal, caps, OCO exclusivity, replay protection, and executor restrictions;
- mainnet-fork tests against exact approved routers and tokens;
- static analysis;
- verified deployment artifacts;
- emergency runbook;
- external audit strongly recommended before broad public capital, without blocking configured mainnet test-wallet certification.

## 15. Observability

Add metrics and structured events for:

- quote latency/failure and route coverage;
- simulation rejects;
- signing abandonment;
- transaction pending/confirmed/reverted;
- limit-order state drift;
- protected trigger observations and execution latency;
- oracle disagreement/staleness;
- Autopilot hold/reject/execute reasons;
- policy-budget usage and loss proximity;
- Telegram checkout and delivery status;
- report tier transitions and stale-result suppression.

Never include secrets, full authorization payloads, or private report content in telemetry.

## 16. Testing strategy

### 16.1 Unit

- technical indicators and golden candle fixtures;
- asset/question classification;
- DeFi ranking;
- report state reducer;
- execution capability resolver;
- cost basis and P&L;
- policy evaluation;
- Telegram command parsing and idempotency.

### 16.2 Contract

- lifecycle tests for Spot Order Manager and Autopilot Vault;
- owner/executor permission boundaries;
- OCO exclusivity;
- TP, SL, trailing, expiry, pause, update, close, and withdrawal;
- malicious router/calldata/receiver attempts;
- oracle staleness/deviation;
- reentrancy and replay;
- daily caps and loss accounting.

### 16.3 Integration

- mocked providers for deterministic CI;
- OKX sandbox/read-only coverage checks where available;
- mainnet-fork execution against configured contracts;
- x402 payment and durable report recovery;
- connected-wallet EIP-712 signing;
- Telegram webhook and checkout completion.

### 16.4 Mainnet certification

Using the configured test wallet and an explicitly approved spend budget:

- one minimal market buy and sell per supported chain;
- one limit create/cancel cycle;
- one protected TP and one protected SL lifecycle;
- one protection update and manual close;
- one minimal Autopilot entry/exit per chain;
- pause, revoke, and withdrawal recovery;
- P&L and explorer reconciliation.

Mainnet tests are never run from ordinary unit-test commands.

## 17. Delivery phases

### Phase A: foundation and reports

- modular application shell;
- Global Market/RWA naming and classification;
- network capability API and themed picker;
- deterministic technical-analysis package;
- Base/Premium schemas and UI;
- Prediction Premium 4H asset chart;
- DeFi opportunities;
- report-state regression fix.

### Phase B: independent Spot Trading

- provider adapters and execution resolver;
- market and limit order flows;
- Spot Order Manager contracts;
- order/fill/lot persistence and reconciliation;
- dashboard, P&L, edit, cancel, close selected/all;
- X Layer/Base/Arbitrum mainnet certification.

### Phase C: independent Autopilot

- vault/policy contracts;
- strategy builder;
- scheduler, risk engine, analysis purchasing, executor, critic, and receipts;
- independent dashboard and controls;
- mainnet deployment and certification.

### Phase D: Telegram and Docs

- Telegram bot, Mini App linking/payment, durable delivery;
- complete Docs tab with diagrams, screenshots, examples, and setup guides;
- final accessibility, responsive, security, and regression review.

## 18. Acceptance criteria by requested point

1. No user-facing Crypto Market label remains; live xStocks/RWA instruments remain searchable and classified.
2. Base and Premium Global reports are unmistakable and structurally different; Premium contains snapshot-bound Fibonacci, pivot, and explained wave candidates; both contain relevant chain-specific DeFi results or an honest empty state.
3. Prediction tiers are unmistakable; Premium resolves the question asset and renders an explained 4H technical chart when resolution is confident.
4. Starting Premium after Base immediately changes the report surface to Premium progress; completion replaces Base, and failures are visible/recoverable.
5. The network/payment popover is accessible, visually themed, capability-aware, and understandable without exposing RPC terminology.
6. Spot Trading works independently with the connected wallet on supported mainnets; market/limit/protected orders, editable automatic TP/SL, dashboard, P&L, history, and close actions are operational.
7. Autopilot works independently on X Layer/Base/Arbitrum mainnet with isolated funds, enforced policies, Premium-analysis rules, receipts, monitoring, and owner pause/withdrawal.
8. Telegram users can link a wallet, purchase either analysis product through the Mini App, monitor delivery, and receive a report without custodial keys.
9. The Docs tab covers every service with accurate diagrams, screenshots, examples, setup steps, chain coverage, and risk disclosures.

## 19. Deployable runtime architecture

### 19.1 Production topology

The existing monorepo remains the source tree, but long-running financial work is separated from request/response traffic.

```text
Vercel Web (React/Vite)
  -> Railway API (REST, MCP, x402, wallet sessions, transaction preparation)
       -> OKX public spot / DEX / limit / DeFi APIs
       -> Polymarket APIs
       -> xAI
       -> X Layer / Base / Arbitrum RPC pools
       -> Upstash KV
       -> Vercel Blob

Railway Analysis Worker
  -> paid report queues -> provider evidence -> calculations -> xAI -> encrypted Blob

Railway Trading Worker
  -> receipt indexer -> OKX order reconciler -> TP/SL trigger evaluator -> transaction tracker

Railway Autopilot Worker
  -> policy scheduler -> evidence -> optional Premium analysis -> risk engine -> simulation -> executor

Railway Telegram Worker
  -> webhook jobs -> checkout/report status -> Telegram delivery

X Layer / Base / Arbitrum
  -> PulseRegistryV1
  -> OracleRouterV1
  -> approved execution adapters
  -> SpotOrderAccountFactoryV1 + per-user SpotOrderAccountV1 clones
  -> AutopilotVaultFactoryV1 + isolated AutopilotVaultV1 clones
```

The workers can share TypeScript packages but run as separate processes with separate credentials and concurrency limits. Web deployments never run schedulers or keepers. The API never performs an autonomous trade inside an HTTP request.

### 19.2 Runtime responsibilities

| Component | Owns | Must not own |
|---|---|---|
| Web | presentation, wallet signatures, client validation | provider secrets, private keys, autonomous scheduling |
| API | authentication, schemas, quotes, transaction preparation, dashboards | long-running monitoring, final financial truth |
| Analysis worker | paid report generation and recovery | trading authorization |
| Trading worker | chain indexing, OKX reconciliation, deterministic Spot trigger execution | Autopilot decisions |
| Autopilot worker | strategy evaluation and restricted execution | Spot orders or owner policy changes |
| Telegram worker | chat delivery and checkout coordination | wallet custody or report generation logic |
| KV | operational ledger, indexes, queues, idempotency | secret keys or sole financial truth |
| Blob | encrypted immutable artifacts and recovery data | live mutable order state |
| Contracts | custody of allocated funds and enforcement | model inference or off-chain market discovery |

### 19.3 Queue topology

Use the existing leased sorted-set pattern with new queue names:

```text
analysis
chain-index
tx-reconcile
okx-order-reconcile
spot-trigger
autopilot-evaluate
autopilot-execute
telegram-deliver
snapshot-archive
```

Every task has deterministic identity, attempt count, next-available time, lease owner, lease expiry, correlation ID, and terminal/dead-letter state. Re-execution must be safe.

## 20. Smart-contract architecture

### 20.1 Toolchain and repository layout

Create `packages/contracts` as a workspace using:

- pinned Solidity `0.8.26`;
- pinned OpenZeppelin Contracts 5.x version in the lockfile;
- Hardhat with TypeScript and viem for compilation, unit tests, deployment, and explorer verification;
- Foundry in CI/Docker for fuzz and invariant tests;
- Slither in CI/Docker for static analysis;
- standard JSON compiler input retained as a release artifact.

```text
packages/contracts/
  contracts/
    registry/PulseRegistryV1.sol
    oracle/OracleRouterV1.sol
    adapters/IExecutionAdapter.sol
    adapters/OkxSwapAdapterV1.sol
    spot/SpotOrderAccountFactoryV1.sol
    spot/SpotOrderAccountV1.sol
    autopilot/AutopilotVaultFactoryV1.sol
    autopilot/AutopilotVaultV1.sol
    shared/PolicyTypes.sol
    shared/Errors.sol
  test/
  test/invariant/
  scripts/
    preflight.ts
    deploy.ts
    configure.ts
    verify.ts
    attest.ts
    canary.ts
  deployments/<chainId>.json
  hardhat.config.ts
```

Contracts are non-upgradeable in place. New behavior deploys a new version/factory; users explicitly migrate. This avoids an administrator silently changing custody logic. Registries may add or disable external integrations under controlled administration, but cannot replace vault/account code.

### 20.2 PulseRegistryV1

One registry is deployed per supported chain. It stores:

- approved token contracts and decimals;
- approved settlement assets;
- approved execution adapters and router targets;
- approved oracle configurations;
- Spot keepers and Autopilot executors as separate roles;
- global and integration-specific pause state;
- current factory versions;
- guardian and administration roles.

Expanding an allowlist is delayed through a timelocked admin after canary certification. A guardian may immediately remove/disable an integration or pause automated execution. A pause never disables owner withdrawal.

### 20.3 OracleRouterV1

`OracleRouterV1` normalizes prices to 18 decimals and returns source identity, observation time, and validity. Each asset configuration declares:

- primary source;
- optional independent secondary source;
- maximum age;
- maximum source disagreement;
- supported operating conditions;
- whether automated execution is allowed.

A Spot or Autopilot execution is rejected when the price is missing, stale, non-positive, outside configured source disagreement, or incompatible with the asset. An OKX API price can wake a worker, but it cannot alone satisfy the on-chain trigger. Assets without a defensible on-chain/signed-oracle policy remain manually tradable but cannot use automatic TP/SL or Autopilot.

### 20.4 Execution adapters

Contracts never call arbitrary router calldata. `IExecutionAdapter` exposes a bounded interface that receives exact sell token, buy token, sell amount, minimum buy amount, recipient, deadline, and provider payload. Each versioned adapter:

1. verifies its approved router and selector;
2. decodes the provider payload for the supported router ABI;
3. verifies tokens, amounts, recipient, and deadline;
4. approves only the exact required amount;
5. executes the router call;
6. resets residual approval where required;
7. calculates actual output using balance deltas;
8. reverts below minimum output;
9. emits adapter and route evidence.

An OKX route using an unknown selector or router is rejected until a reviewed adapter version is deployed and allowlisted. Provider output is treated as untrusted input.

### 20.5 SpotOrderAccountFactoryV1 and SpotOrderAccountV1

The factory creates a deterministic minimal clone for a connected wallet on a chain. The clone owner is immutable after initialization except through an explicit two-step owner transfer. It holds only assets the user allocates to protected orders.

Position states:

```text
DRAFT -> ENTRY_PENDING -> PROTECTED -> EXIT_PENDING -> CLOSED
   |          |              |             |
   +----------+--------------+-------------+-> CANCELLED
                              +-------------> PAUSED -> PROTECTED
Any non-terminal state may become FAILED_RETRYABLE without losing owner withdrawal rights.
```

Stored position data includes owner, entry/position/settlement tokens, funded amount, acquired amount, entry condition, TP, SL, trailing parameters/high-water mark, expiry, max slippage, oracle policy ID, adapter ID, state, nonce, and creation/update timestamps.

Only the owner may create, fund, edit, pause, resume, close manually, cancel, or withdraw. A Spot keeper may only checkpoint a trailing high-water mark or execute a condition already authorized by the owner and proven by the oracle policy. The keeper cannot add a market, change a price, enlarge an amount, change a receiver, or transfer funds elsewhere.

OCO is enforced in contract state: successful TP or SL execution closes the position before the adapter call completes, preventing the sibling branch from executing. Reentrancy protection and checks-effects-interactions are mandatory.

Required events:

```text
AccountCreated
PositionCreated
PositionFunded
ProtectionUpdated
PositionPaused
PositionResumed
TrailingCheckpointed
EntryExecuted
ExitExecuted
PositionCancelled
OwnerWithdrawal
```

### 20.6 AutopilotVaultFactoryV1 and AutopilotVaultV1

Autopilot vaults are separate clones with separate addresses and ledgers. A vault belongs to one owner, one network, and one settlement asset; the owner may create multiple isolated vaults for different strategies.

The vault stores the current policy hash/version, allowed assets, strategy identifiers, exposure and trade caps, daily turnover/loss counters, drawdown reference, slippage/oracle bounds, cooldown, expiry, analysis-service budget, executor role, pause state, and nonce.

The Autopilot executor submits an action containing:

```text
vault
policyVersion
decisionId
actionNonce
sellToken
buyToken
sellAmount
minBuyAmount
adapterId
oracleObservations
quoteHash
deadline
evidenceHash
```

The vault verifies the current policy version, nonce, deadline, asset/adapter allowlists, cooldown, current exposure, projected exposure, daily turnover/loss limits, drawdown, oracle evidence, minimum output, and recipient before execution. It records the policy/evidence hashes and actual balance deltas.

Only the owner changes policy, executor, or allocated capital. The executor cannot loosen policy, pay arbitrary recipients, or withdraw. Owner pause and withdrawal remain independent of the worker.

### 20.7 Premium-analysis billing from Autopilot

An optional policy budget permits Premium analysis. The worker creates a bounded invoice containing route, pair, timeframe, price, nonce, and expiry. The vault may pay only the configured PULSE seller, no more than the published route price and remaining daily service budget. The payment receipt and analysis job are bound to the invoice hash. If payment or report generation fails, no trade is authorized; recovery follows the existing paid-job receipt rules.

## 21. RPC, indexing, and finality architecture

### 21.1 Supported deployment matrix

| Network | Chain ID | Primary configuration | Required fallback | Explorer verification | New trading features |
|---|---:|---|---|---|---|
| X Layer | 196 | `X_LAYER_RPC` | `X_LAYER_RPC_FALLBACK` | OKLink verification API/plugin | enabled after certification |
| Base | 8453 | `BASE_RPC_URL` | `BASE_RPC_FALLBACK_URL` | Etherscan V2/BaseScan | enabled after certification |
| Arbitrum One | 42161 | `ARBITRUM_RPC_URL` | `ARBITRUM_RPC_FALLBACK_URL` | Etherscan V2/Arbiscan | enabled after certification |
| Arc Testnet | 5,042,002 | `ARC_RPC_URL` | optional read fallback | none required for new contracts | hidden/disabled |

Production activation of X Layer/Base/Arbitrum trading requires two usable RPC endpoints per chain. Public defaults may support development, but mainnet autonomous operation requires separately monitored primary and fallback endpoints.

### 21.2 RPC health gate

Before reads or writes, the RPC pool verifies:

- `eth_chainId` equals the configured chain;
- head block progresses;
- primary/fallback canonical block hashes agree at the chosen safe block;
- required contracts have non-empty code;
- fee estimation and `eth_call` work;
- latency/error thresholds remain acceptable.

If chain IDs differ, block hashes conflict beyond the tolerated reorg window, both endpoints are stale, or contract code hashes differ, automated execution stops for that network. Manual transaction preparation also fails closed rather than silently switching chains.

### 21.3 Finality and reorg handling

Each network manifest stores a certified finality policy. Prefer the RPC `safe`/`finalized` tags where consistently supported; otherwise use a configured confirmation depth established during chain certification. No hard-coded universal confirmation count is used.

The indexer maintains:

- observed head;
- safe/finalized head;
- last processed block/hash per contract;
- a bounded reorg window;
- unfinalized events separated from finalized projections.

Dashboard transactions may show `submitted` or `confirmed`; fills and P&L become final only after the configured finality rule. On reorg, unfinalized events are removed and replayed from the last canonical checkpoint.

### 21.4 Transaction lifecycle

```text
PREPARED -> AWAITING_SIGNATURE -> SIGNED -> BROADCAST
          -> PENDING -> CONFIRMED -> FINALIZED
                                +-> REVERTED
          +-> EXPIRED / REJECTED
```

The transaction hash, sender, nonce, chain, target, value, calldata hash, quote hash, submission time, receipt, and finality evidence are recorded. Replacement transactions are related by sender/nonce and never counted as separate fills.

## 22. Contract build, deployment, and verification workflow

### 22.1 Release artifact

Every contract release produces an immutable bundle containing:

- Git commit and clean-tree status;
- dependency lockfile hashes;
- Solidity compiler version and settings;
- standard JSON input/output;
- ABI, creation bytecode, deployed bytecode, storage layout, and selectors;
- unit/fuzz/invariant/static-analysis results;
- deployment scripts and expected constructor/initializer arguments;
- per-network external dependency manifest;
- SHA-256/keccak hashes for every artifact.

The release bundle is uploaded to encrypted/private Blob during testing; the public source/ABI subset may be published after deployment approval.

### 22.2 Pre-deployment gate per network

`scripts/preflight.ts --network <name>` performs read-only checks:

1. resolve the intended network manifest and exact RPC URLs;
2. query both RPC chain IDs and canonical heads;
3. verify the configured deployer address equals `TEST_WALLET_ADDRESS` for certification;
4. verify native gas balance and enforce the approved per-chain budget;
5. resolve approved settlement tokens, OKX routers, and oracle feeds from primary sources;
6. require runtime bytecode at every external address;
7. read token decimals/symbol and oracle freshness;
8. simulate every deployment/configuration transaction;
9. calculate maximum gas/value exposure;
10. write a preflight report without printing secrets.

No broadcast occurs in preflight mode.

### 22.3 Deployment order

For X Layer, Base, and Arbitrum independently:

1. deploy `PulseRegistryV1`;
2. deploy `OracleRouterV1` and bind it to the registry;
3. deploy reviewed execution adapter implementations;
4. deploy `SpotOrderAccountV1` implementation and factory;
5. deploy `AutopilotVaultV1` implementation and factory;
6. register factories, adapters, routers, tokens, oracle policies, and temporary certification roles;
7. run read-back assertions after every transaction;
8. wait for configured finality;
9. write the deployment manifest;
10. perform source and bytecode verification;
11. execute canary workflows;
12. transfer production administration to the configured timelock/multisig when supplied;
13. remove unintended deployer privileges;
14. publish the active capability manifest only after every gate passes.

Deployments are never automatic consequences of `npm run build`, web deployment, or API deployment.

### 22.4 Deployment manifest

`packages/contracts/deployments/<chainId>.json` records:

```json
{
  "schemaVersion": 1,
  "network": "base",
  "chainId": 8453,
  "releaseCommit": "<git commit>",
  "compiler": "0.8.26",
  "deploymentBlock": 0,
  "contracts": {
    "registry": { "address": "<address>", "txHash": "<hash>", "runtimeCodeHash": "<hash>" }
  },
  "externalDependencies": [],
  "roles": {},
  "oraclePolicies": [],
  "verification": {},
  "canary": {},
  "status": "deployed_not_active"
}
```

Addresses and hashes are copied only from fresh RPC/deployment output. The web and API consume generated capability artifacts from these manifests rather than handwritten addresses.

### 22.5 Source verification

- **Base and Arbitrum:** submit Solidity standard JSON input and constructor arguments through Etherscan V2 using chain IDs 8453 and 42161, then poll to success and retrieve published source/ABI.
- **X Layer:** submit standard JSON through the OKLink contract-verification API or supported Hardhat `okverify` plugin for chain 196, poll the GUID, and retrieve the published result.

Explorer source verification is necessary transparency but is not treated as an audit.

### 22.6 Independent bytecode and configuration verification

After explorer verification, `scripts/attest.ts`:

1. fetches runtime bytecode from both RPC endpoints;
2. compares their hashes;
3. matches the deployed code against the compiler artifact with immutable/link references accounted for;
4. verifies implementation/factory relationships;
5. reads every role, registry entry, pause flag, oracle policy, token, router, adapter, owner, and executor;
6. confirms no unknown privileged account;
7. checks explorer source/ABI availability;
8. writes a signed/checksummed attestation to Blob and its manifest to KV.

Any mismatch leaves the network `deployed_not_active` and hides the feature in the UI.

### 22.7 Mainnet canary

Using only the configured test wallet and approved budget, run on each supported chain:

1. create a Spot Order Account;
2. fund it with the smallest practical supported amount;
3. create, edit, pause, resume, and cancel a protected position;
4. perform one minimal direct market buy/sell through the connected/test wallet path;
5. create and cancel one OKX native limit order where supported;
6. execute one genuinely satisfied protected exit condition with minimal value;
7. create an Autopilot Vault with restrictive policy;
8. execute one minimal allowed action and prove one rejected over-limit action;
9. pause executor activity and prove owner withdrawal still works;
10. reconcile contract events, balances, fills, P&L, KV projections, and explorer links.

The script outputs a redacted report and never prints the private key. Mainnet tests require explicit configured per-transaction and total budgets and are not included in ordinary CI.

### 22.8 Activation and rollback

Activation changes the server-published network capability only after deployment, verification, attestation, and canary status are all successful. Rollback is:

1. set off-chain feature/kill switch;
2. stop new transaction preparation and keeper tasks;
3. pause automated contract execution through the guardian where necessary;
4. keep owner cancel/close/withdraw paths available;
5. reconcile in-flight transactions;
6. display incident state and recovery instructions;
7. deploy a new version rather than mutating old custody code.

## 23. End-to-end workflows

### 23.1 Global Premium report to manual trade

```text
User selects instrument/timeframe/network
  -> API verifies instrument and publishes price
  -> wallet performs x402 payment
  -> durable analysis job captures OKX candles + technical evidence + DeFi evidence
  -> worker validates Premium schema and stores encrypted report in Blob
  -> UI renders snapshot chart and recommendation
  -> user clicks Trade this recommendation
  -> execution resolver confirms token/route on selected chain
  -> user edits amount/order parameters
  -> API obtains short-lived OKX quote and simulates exact transaction
  -> browser validates chain/wallet/target/value/calldata hash
  -> connected wallet signs and broadcasts
  -> indexer finalizes receipt/fill
  -> KV atomically updates transaction, lot, P&L, indexes
  -> dashboard shows reconciled result
```

The report never directly broadcasts and an analysis-only pair never exposes an enabled trade button.

### 23.2 Native limit order

```text
User builds limit order
  -> API verifies allowance and returns approval if needed
  -> wallet confirms approval
  -> API returns OKX EIP-712 order data
  -> wallet signs typed data
  -> API validates signer/body/deadline and submits to OKX
  -> KV records provider order ID/hash
  -> reconciliation worker polls provider status and settlement evidence
  -> confirmed fills update lots/P&L atomically
```

Edit means cancel then replace; each owner authorization is explicit.

### 23.3 Protected Spot TP/SL

```text
User opens/creates Spot Order Account
  -> chooses existing-position protection or bracket entry
  -> API prepares exact funding + createPosition calls
  -> wallet signs transaction(s)
  -> finalized PositionCreated event enters KV
  -> trigger worker observes prices
  -> candidate is independently checked by OracleRouter and simulated
  -> Spot keeper calls executeEntry/executeExit
  -> contract rechecks trigger/policy and approved adapter
  -> adapter executes OKX route and measures balance delta
  -> contract atomically closes OCO sibling
  -> indexer finalizes events and updates dashboard/P&L
```

Changing TP/SL calls `updateProtection` from the owner wallet; the keeper cannot change it.

### 23.4 Autopilot

```text
User creates isolated vault and funds it
  -> user signs strategy policy
  -> policy finalizes on-chain and is indexed to KV
  -> scheduler enqueues evaluation when cadence/rules permit
  -> worker gathers market, route, oracle, balance, and risk evidence
  -> optional policy-bounded Premium analysis is paid/generated
  -> model proposes; deterministic risk engine may reduce or reject
  -> exact transaction is quoted and simulated
  -> executor submits action with policy version + evidence hash
  -> vault rechecks every cap and executes approved adapter or reverts
  -> finalized events and evidence Blob update independent Autopilot ledger/P&L
```

Changing an Autopilot policy requires the owner wallet. Spot orders and assets are never read as Autopilot authority.

### 23.5 Prediction Premium

```text
User selects one supported Polymarket question
  -> API validates live market context before payment
  -> paid job captures prediction evidence
  -> underlying resolver maps asset confidently or returns unknown
  -> when known, worker captures independent OKX 4H snapshot
  -> deterministic technical package calculates chart annotations
  -> model explains prediction evidence and spot structure separately
  -> schema validation -> encrypted Blob -> report delivery
```

### 23.6 Telegram purchase

```text
Telegram user selects service
  -> bot creates expiring checkout and Mini App link
  -> linked connected wallet pays x402 in Mini App
  -> payment receipt binds durable report job and Telegram delivery ID
  -> worker produces normal PULSE report
  -> Telegram worker sends concise result + authorized full-report link
  -> update/delivery IDs prevent duplicate charges or messages
```

## 24. API-to-contract security boundary

Every prepared contract action returns a signed server capability containing network, wallet, contract, function, normalized arguments hash, provider quote hash, maximum value, expiry, and nonce. The browser verifies it before requesting a wallet signature. The contract does not trust this capability for authorization; it independently enforces owner/executor roles and state.

Autonomous workers never accept raw model calldata. The path is:

```text
model intent -> typed domain action -> deterministic validation -> provider quote
-> adapter-specific decode -> simulation -> contract validation -> execution
```

Unknown tokens, routers, selectors, receivers, or oracle states fail closed.

## 25. E2E verification matrix

### 25.1 Automated CI

- all existing package tests;
- schema compatibility and legacy report rendering;
- technical-analysis golden fixtures;
- report Base/Premium state regression;
- trading KV Lua transition/idempotency tests;
- contract unit, fuzz, invariant, and static-analysis gates;
- fork simulations for X Layer, Base, and Arbitrum using pinned blocks;
- API/provider mocks and failure injection;
- browser component/accessibility tests;
- Telegram webhook/payment/job idempotency.

### 25.2 Deployed read-only certification

- two-RPC chain/head/code agreement;
- deployment bytecode and role/config attestation;
- explorer source/ABI availability;
- OKX token/quote/limit/DeFi provider readiness;
- oracle freshness and disagreement checks;
- KV queue/lease/Lua atomicity readiness;
- Blob encrypt/upload/read/checksum readiness.

### 25.3 Mainnet write certification

The canary in section 22.7 is executed per chain under an approved budget. Each run must produce transaction hashes, final receipts, indexed events, KV record IDs, balance deltas, P&L reconciliation, explorer/source links, and a redacted signed result artifact.

### 25.4 Browser E2E

Test OKX Wallet, MetaMask/Rabby-compatible injection, WalletConnect mobile, and supported Base connectors for connect, switch/reject, sign typed data, approve, broadcast, refresh, disconnect, and recovery. Arc verifies that new feature surfaces are absent.

### 25.5 Failure scenarios

Required scenarios include RPC disagreement, stale oracle, provider timeout, quote expiry, wallet rejection, replaced transaction, revert, partial limit fill, worker crash after broadcast, duplicate webhook, KV lease expiry, Blob outage, chain reorg, paused integration, revoked executor, depleted gas, insufficient token balance, and report generation failure after settled payment.

## 26. New configuration contract

Add server-only configuration for:

```text
BASE_RPC_FALLBACK_URL
ARBITRUM_RPC_FALLBACK_URL
TRADING_KEEPER_PRIVATE_KEY
AUTOPILOT_EXECUTOR_PRIVATE_KEY
ETHERSCAN_API_KEY
OKLINK_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TRADING_NAMESPACE
CONTRACT_RELEASE_ID
CONTRACT_MANIFEST_BLOB_KEY
MAINNET_TEST_MAX_TX_USD
MAINNET_TEST_MAX_TOTAL_USD
FINALITY_POLICY_XLAYER
FINALITY_POLICY_BASE
FINALITY_POLICY_ARBITRUM
```

For initial certification, the configured test private key may serve deployer/keeper/executor roles, but role separation remains supported and is required before broad user capital. Client-exposed variables contain only public contract addresses/capabilities generated from active manifests.

## 27. Definition of fully E2E-ready

The release is not described as ready merely because code compiles. It is E2E-ready only when:

1. all nine feature acceptance criteria pass locally and in deployed environments;
2. all required contracts are deployed, source-verified, bytecode-attested, configured, and canary-tested on X Layer/Base/Arbitrum;
3. KV atomicity/recovery and Blob encryption/restore drills pass;
4. every active execution asset has verified token, router, adapter, and oracle policy;
5. workers recover from lease expiry and crash-after-broadcast without duplicate financial effects;
6. dashboards reconcile to chain/OKX truth;
7. owner pause/cancel/withdraw paths work during provider and worker outages;
8. Arc hides unsupported functionality;
9. Telegram paid delivery completes without custody or duplicate charge;
10. deployment manifests, verification evidence, runbooks, and rollback controls are complete.

## 28. Implementation gates

Application implementation can begin from this proposal. The following values are operational gates rather than architecture blockers:

- maximum total and per-transaction mainnet test budget;
- final production contract admins and executor identities;
- Telegram bot token and public webhook origin;
- final Arc mainnet chain/provider configuration after public launch;
- external audit scheduling and public-capital limits.

## 29. Updated product architecture

### 29.1 Product information architecture

PULSE is one product with six route-level workspaces and one persistent application shell:

```text
PULSE shell
  /global-market
    instrument discovery -> Base/Premium analysis -> report -> independent Spot action
  /prediction-market
    question discovery -> Base/Premium analysis -> report
  /spot
    trade ticket -> orders -> protected positions -> holdings/P&L -> history
  /autopilot
    vaults -> strategy/policy builder -> decisions -> positions/P&L -> activity
  /telegram
    link account -> payment setup -> command guide -> delivery history
  /docs
    concepts -> workflows -> safety -> network support -> examples -> troubleshooting
```

The persistent shell owns wallet connection, selected payment/execution network, responsive navigation, locale, notification center, pending-transaction tray, and the network-themed `Pay on <network>` funding control. The existing funding drawer is renamed to reflect its x402 funding purpose; it is never reused or presented as a Spot swap/trade panel.

Global Market remains the complete OKX live SPOT discovery and analysis catalog, including supported xStocks and other RWA instruments. Execution eligibility is resolved separately. An instrument can therefore be `analysisAvailable: true` and `executionAvailable: false` on a selected chain without disappearing from Global Market.

### 29.2 Frontend composition and state ownership

Each workspace has a route container, feature components, typed API client, query keys, and an error boundary. The root `App.tsx` becomes composition only; it does not contain report, trading, or Autopilot business logic.

```text
AppShell
  WalletProvider
  NetworkCapabilityProvider
  AuthSessionProvider
  QueryClientProvider
  NotificationProvider
  Router
    GlobalMarketRoute
    PredictionMarketRoute
    SpotRoute
    AutopilotRoute
    TelegramRoute
    DocsRoute
```

Server state uses request/query caching keyed by wallet, chain, resource ID, schema version, and finality cursor. Local draft state—amounts, unsaved TP/SL, and strategy form values—stays in feature-local stores. Confirmed orders, positions, policies, reports, payments, and P&L are never treated as browser-local truth.

The report controller key is:

```text
product + subjectId + timeframe + network + tier + requestId
```

Changing Base to Premium always creates a new request/job identity. The report surface immediately enters the correct Premium loading state and may retain the old Base card only as a clearly labelled previous result. This eliminates the current tier-upgrade no-op/stale-render failure.

### 29.3 Product capability resolver

A single server-side capability service resolves what the selected wallet, instrument, and network can actually do. All route guards, buttons, API authorization, and worker scheduling consume the same signed/versioned result:

```ts
type ProductCapabilities = {
  version: string;
  chainId: number;
  analysis: { base: boolean; premium: boolean };
  prediction: { base: boolean; premium: boolean };
  payment: { x402: boolean; fundingAssets: string[] };
  spot: {
    visible: boolean;
    market: boolean;
    limit: boolean;
    protectedOrders: boolean;
    supportedInstrumentIds: string[];
  };
  autopilot: { visible: boolean; enabled: boolean; supportedPolicyIds: string[] };
  reasons: Record<string, string>;
  expiresAt: string;
};
```

Capabilities are calculated from the active deployment manifest, chain health, provider health, token registry, route/adapter registry, oracle policy, feature activation, and jurisdictional configuration. The browser cannot enable a disabled feature by changing a flag. Arc Testnet returns `spot.visible = false` and `autopilot.visible = false`; API and worker enforcement also reject those operations.

### 29.4 Product bounded contexts

| Context | Public responsibility | Authoritative state |
|---|---|---|
| Identity/session | wallet challenge, session, Telegram linkage | signed wallet proof + KV session/link record |
| Catalog | OKX instruments, classifications, chain execution matrix | provider snapshot + versioned token registry |
| Analysis | Base/Premium jobs, evidence, report delivery | payment receipt + KV job + encrypted Blob artifact |
| Prediction | Polymarket question context and underlying mapping | provider snapshot + reviewed resolver rules |
| Payment/funding | x402 quote, settlement, receipt recovery | chain/provider receipt; KV projection |
| Spot execution | quote, approval, market/limit/protected order lifecycle | chain events and OKX order/fill evidence |
| Portfolio | holdings, lots, fees, P&L | reconciled chain balances/fills; KV projection |
| Autopilot | vault policy, decisions, execution, independent P&L | vault events/balances; evidence artifacts |
| Telegram | commands, checkout binding, delivery | Telegram update ID + PULSE job/payment IDs |
| Documentation | guides, diagrams, examples, support states | versioned content shipped with the web app |

No bounded context writes another context's records directly. It emits a versioned event or calls the owning service. Spot and Autopilot can reuse catalog, oracle, adapter, portfolio-calculation, and UI primitives, but their accounts, events, queues, APIs, policies, dashboards, P&L views, and worker credentials remain independent.

### 29.5 UX architecture

Desktop uses a stable left navigation and contextual right-side action panel; mobile uses bottom navigation plus full-screen sheets. Every financial action presents, before signature:

- wallet and chain;
- exact input/output assets and token addresses;
- amount, allowance, estimated fee, slippage, deadline, and worst-case output;
- whether the action is direct wallet execution, a native limit signature, Spot-account funding, or Autopilot-vault funding;
- contract/router identity and explorer link;
- material risk and RWA availability/market-hours disclosures.

Base reports use a persistent `BASE` tier mark and restrained neutral treatment. Premium reports use a persistent `PREMIUM` tier mark, richer market-state header, annotated interactive chart, scenario cards, invalidation levels, trade-plan handoff, and evidence drawer. Tier identity is encoded in text and iconography as well as color.

The Spot workspace and Autopilot workspace may share a dashboard design system but never a combined position table. Each table clearly displays its source (`Wallet`, `Spot protection account`, `OKX limit`, or `Autopilot vault`) and chain.

## 30. Fully wired service and data flow

### 30.1 Request path

```text
Browser or Telegram Mini App
  -> edge/API request ID and authenticated wallet/Telegram link
  -> runtime schema validation
  -> capability and entitlement check
  -> idempotency check / atomic KV command
  -> provider, payment, or transaction-preparation adapter
  -> durable queue when work survives the HTTP request
  -> worker performs bounded operation
  -> chain/provider receipt reconciliation
  -> domain event append + projection update in one Lua transition
  -> encrypted evidence/report artifact in Blob when applicable
  -> SSE/polling response and notification
  -> UI renders authoritative status with explorer/provider evidence
```

Every mutating API accepts an idempotency key and expected resource version. Every response includes correlation ID, resource version, status, and recovery URL. The client retries only idempotent preparation/status operations; wallet signatures and provider submissions have explicit resume/reconcile paths.

### 30.2 Exact wiring map

| Product action | Web module | API owner | Durable worker | External/on-chain integration | Result surface |
|---|---|---|---|---|---|
| Global Base/Premium | `global-market` | analysis | analysis | OKX market, xAI, DeFi sources, x402 | tiered report |
| Prediction Base/Premium | `prediction-market` | analysis/prediction | analysis | Polymarket, OKX 4H context, xAI, x402 | tiered report |
| Fund x402 | shell/wallet funding drawer | payment | payment reconciliation | selected-chain payment route | balance/receipt |
| Market buy/sell | `spot-trading` | trading | chain index/tx reconcile | connected wallet, OKX DEX route | wallet lot/P&L |
| Native limit | `spot-trading` | trading | OKX order reconcile | connected-wallet EIP-712, OKX limit API | order/fills |
| TP/SL/OCO | `spot-trading` | trading | Spot trigger + chain index | SpotOrderAccount + OracleRouter + adapter | protected position |
| Autopilot | `autopilot` | autopilot | evaluate/execute + chain index | isolated vault + analysis/risk/oracle/adapter | vault dashboard |
| Telegram report | `telegram`/Mini App | telegram/analysis/payment | Telegram + analysis | Telegram API, x402, normal analysis pipeline | chat + full report link |
| Docs | `docs` | static/version endpoint | none | shipped assets and current capability schema | searchable guides |

### 30.3 Source-of-truth and reconciliation rules

1. A blockchain receipt/event is authoritative for on-chain approval, funding, execution, cancellation, withdrawal, and balance change.
2. OKX provider evidence plus settlement transaction is authoritative for native limit status and fills.
3. Polymarket/OKX snapshots are time-stamped report evidence, not current financial state.
4. KV is the durable operational ledger/projection and must be reproducible from retained events, provider evidence, chain logs, and Blob snapshots.
5. Blob is authoritative for an immutable report/evidence artifact only after its checksum manifest commits successfully in KV.
6. Browser and Telegram views are projections; neither can assert finality.

Reconcilers scan by finalized block ranges with overlap, deduplicate by `chainId + transactionHash + logIndex`, and persist the next safe cursor only after the projection transition succeeds. Provider orders reconcile by provider ID, order hash, and settlement hash. A periodic balance audit compares projected balances/lots to actual wallet/account/vault balances and opens an alert rather than silently adjusting financial history.

### 30.4 Availability and degradation

- If xAI is unavailable, paid report jobs remain retryable and no fabricated report is returned.
- If DeFi data is unavailable, the report explicitly marks the section unavailable with evidence timestamp; Premium generation follows the configured service/refund policy.
- If one RPC disagrees or is stale, transaction preparation and autonomous execution stop for that chain while read-only cached views remain labelled stale.
- If OKX execution routing is unavailable, analysis remains available and trade controls disable with a reason.
- If the oracle policy is invalid, manual connected-wallet market execution may remain available after fresh quote/simulation, but TP/SL and Autopilot fail closed.
- If KV is unavailable, no new paid or money-moving operation begins. Existing contracts remain owner-withdrawable.
- If Blob is unavailable, active financial reconciliation continues in KV, but report completion/archive commits wait for Blob recovery.

## 31. Complete product workflows

### 31.1 First session and network selection

1. The visitor can browse catalogs and Docs without connecting.
2. A paid or trading action requests the existing wallet connection and a nonce-bound sign-in message; no private key enters the browser app.
3. The user selects an RPC/network using the custom themed `Pay on <network>` popover.
4. The app retrieves signed product capabilities and explains payment assets, analysis availability, and execution availability separately.
5. On Arc Testnet, Spot and Autopilot navigation/actions are absent; direct API calls are rejected by the same capability policy.

### 31.2 Report lifecycle and tier upgrade

1. User selects the exact subject, timeframe, network, and Base or Premium tier.
2. API validates provider availability and returns an immutable quote/service request ID.
3. x402 payment settles or an existing valid entitlement is consumed.
4. Payment reconciliation atomically creates a durable analysis job exactly once.
5. UI subscribes/polls using the new request ID and shows the requested tier state immediately.
6. The worker captures raw evidence, computes deterministic indicators, requests structured narrative, validates the versioned schema, encrypts the artifact, and commits Blob/KV manifests.
7. UI renders the report with tier mark, evidence time, network, and subject. Premium renders annotated candles, Fibonacci, pivots, Elliott candidates, invalidation levels, scenario probabilities/ranges, and explanatory text.
8. Global Market reports resolve chain-specific DeFi opportunities with risk, liquidity, APY source, timestamp, and `not available` states. Prediction Premium adds the mapped asset's independent 4H chart context.
9. Generating Premium after Base never mutates the pair selector and never reuses the Base cache identity. Both receipts remain recoverable in history.

### 31.3 Manual Spot lifecycle

1. The user arrives from a report recommendation or opens Spot independently.
2. Capability resolution confirms exact token contracts, route, liquidity, oracle/security status, and chain.
3. The ticket defaults from the report but remains editable; the user chooses market, native limit, or protected order.
4. Market execution is prepared/simulated by the server and signed/broadcast by the already connected wallet.
5. Native limit uses connected-wallet approval plus EIP-712 order authorization; provider reconciliation tracks partial fills and settlement.
6. Protected TP/SL/OCO moves only the explicitly allocated amount into the user's Spot Order Account. The owner can update, pause, resume, close, cancel, or withdraw; the keeper can only execute already authorized conditions.
7. Finalized receipts/fills update lots, fees, realized/unrealized P&L, active orders, and history.
8. `Close selected` produces one reviewed execution plan. `Close all` groups independent chain/source operations and requires each necessary wallet authorization; partial completion is accurately displayed and resumable.

### 31.4 Autopilot lifecycle

1. The user opens the separate Autopilot tab, chooses chain, allowed tokens, strategy/rules, cadence, risk caps, stop conditions, analysis budget, and expiry.
2. UI validates the policy, displays worst-case authority, and prepares deployment/initialization of an isolated vault or selection of an existing compatible vault.
3. The connected wallet creates/configures the policy and separately funds the vault. No Spot position or wallet-wide allowance becomes Autopilot capital.
4. After finality, the scheduler begins evaluations only while policy, chain, oracle, executor, and provider health pass.
5. Each evaluation creates an immutable decision ID, captures evidence, optionally buys a Premium analysis within the on-chain budget, and produces a typed proposal.
6. A deterministic risk engine rejects or bounds the proposal. The exact route is quoted, decoded, simulated, and submitted by the restricted executor.
7. The vault independently revalidates the policy version, caps, nonce, deadline, assets, adapter, oracle, drawdown, cooldown, recipient, and minimum output.
8. The dashboard shows evaluation, rejection, trade, fee, balance, P&L, and evidence states independently from Spot.
9. The owner can pause immediately, revoke the executor, change policy through a new version, close positions, and withdraw. Automated execution cannot bypass pause or owner withdrawal rights.

### 31.5 Telegram lifecycle

1. The user starts the bot and receives commands plus a secure PULSE linking URL.
2. The Mini App/web flow links Telegram identity to a wallet only after wallet-signature proof and a short-lived one-time token.
3. The bot collects service, subject, timeframe/tier, and network through explicit buttons and shows price before payment.
4. Payment occurs in the Mini App through the same x402 flow; the bot never receives a key or asks for a seed phrase.
5. The normal durable report pipeline runs; payment ID, job ID, Telegram update ID, and delivery ID are idempotently bound.
6. The bot sends a concise tier-marked summary and an expiring authenticated link to the full report. Retry cannot charge twice or send conflicting results.
7. Users can inspect purchases, unlink the wallet, revoke sessions, and reopen delivered reports.

### 31.6 Documentation lifecycle

Docs ship as version-controlled content with product builds. Screenshots and diagrams are generated from the implemented interfaces after visual behavior stabilizes, checked for secret/test-address leakage, and tested for broken links. Network and feature tables consume the public capability manifest so documentation cannot claim enabled execution where production has disabled it.

## 32. Production operations and recovery

### 32.1 Deployment units and promotion

Web, API, each worker type, contracts, schemas, and Docs have immutable release identifiers. A release is promoted in this order:

1. compatible schemas and backward-reading code;
2. KV migrations/new projections with rollback-compatible readers;
3. contracts and per-chain verification/canaries;
4. API and workers with capabilities still disabled;
5. web and Docs;
6. internal/test-wallet certification;
7. chain-by-chain feature activation through the signed manifest.

Promotion is blocked when contract bytecode, ABI, role/config attestation, worker release, and frontend capability manifest do not reference the same release ID.

### 32.2 Key and role operations

The production design supports separate deployer, timelock admin, guardian, Spot keeper, Autopilot executor, x402 seller, and test-wallet identities. Keys are supplied only through the hosting secret manager. Before public capital:

- deployer privileges are removed or transferred to the documented timelock;
- guardian and executor roles are separated;
- keeper/executor hot-wallet balances and transaction value are monitored;
- key rotation and revocation are exercised on every chain;
- public-capital activation requires completed independent contract security review and resolved critical/high findings.

`TEST_WALLET_PRIVATE_KEY` is permitted only in isolated certification jobs with explicit mainnet spending caps. The job verifies the configured address before signing, redacts calldata secrets/logs, and cannot be invoked from a public route.

### 32.3 Incident controls

Operational controls include provider circuit breakers, per-chain automation pause, per-adapter pause, executor revocation, queue drain, read-only mode, owner-withdrawal runbook, stale-data banners, and status communication. Rollback means disabling new activity and reverting off-chain releases; immutable contracts are not pretend-rolled-back. Existing users migrate explicitly to a new audited version when required.

### 32.4 Financial reconciliation and evidence retention

Daily automated reconciliation produces per-chain/account/vault totals for starting balance, deposits, withdrawals, fills, fees, ending balance, projected lots, and discrepancy. Any non-zero unexplained discrepancy blocks new automation for the affected scope. Monthly restore drills rebuild a clean KV namespace from Blob snapshot/archive plus subsequent chain/provider evidence and compare checksums/projections.

## 33. Requirement-to-delivery traceability

| Point | Production deliverable | Required verification evidence |
|---|---|---|
| 1 | Global Market naming plus complete live OKX SPOT/RWA catalog and classification | catalog contract tests, UI/a11y copy scan, live provider smoke test |
| 2 | distinctive Base/Premium Global reports, Premium chart/technical scenarios, chain-specific DeFi | schema/golden tests, rendered visual tests, live evidence timestamps, paid E2E job |
| 3 | distinctive Prediction reports and Premium underlying 4H technical chart/explanation | resolver fixtures, Polymarket+OKX live E2E, unknown-underlying behavior |
| 4 | tier-aware request identity and deterministic Base-to-Premium UI replacement | regression test proving new payment/job/render without pair reselection |
| 5 | `Pay on <network>` custom themed capability-aware funding popover | per-network responsive/a11y visual tests and x402 mainnet receipt recovery |
| 6 | independent connected-wallet Spot market/limit/protected execution and dashboard/P&L/close actions | per-chain canaries, partial-fill/OCO/invariant tests, receipt-to-dashboard reconciliation |
| 7 | separate isolated-vault Autopilot with on-chain guardrails, strategy workflow, dashboard, pause/withdraw | audit, invariant/fork tests, policy rejection tests, per-chain mainnet canary |
| 8 | Telegram tab, linking guide, bot checkout, paid report delivery and history | webhook replay tests plus real bot/x402/report delivery certification |
| 9 | Docs tab with implemented screenshots, diagrams, examples, security/network/how-to content | content review, link/a11y tests, capability-table consistency check |

The proposal is satisfied only when the deliverable and its evidence both exist. A UI without a live API, an API returning fixture data, a worker without recovery, an undeployed contract, an unverified deployment, or a dashboard not reconciled to financial truth is incomplete.

## 34. No-mock production release gate

Mocks, local chains, forked chains, fixtures, and test providers are development tools only. They are forbidden in the production dependency graph and cannot satisfy release acceptance. Before PULSE is called fully operational:

1. production configuration validation rejects mock x402, mock market, mock oracle, placeholder contract address, localhost callback, and unencrypted artifact modes;
2. every enabled chain passes live primary/fallback RPC health, verified-contract, oracle, route, quote, simulation, receipt, indexer, and reconciliation checks;
3. every enabled provider path uses production credentials/endpoints and has a tested circuit breaker;
4. the deployed browser build exposes no server secret or private key and uses the active signed capability manifest;
5. mainnet certification with the approved test wallet proves real payment, report, market trade, limit lifecycle where supported, protected TP/SL lifecycle, Autopilot lifecycle, withdrawal, Telegram delivery, and recovery evidence;
6. dashboards reproduce chain/provider balances and fills within documented finality and pricing tolerances;
7. security review, operational runbooks, alert routing, backup/restore, key rotation, pause, and owner-recovery drills are complete;
8. unsupported asset/network combinations are explicitly unavailable, never emulated or silently routed to a different token;
9. the final release checklist links each requirement in section 33 to test runs, transaction hashes, explorer verification, artifacts, screenshots, and responsible sign-off.

This is the implementation contract for a fully wired E2E product. Development phases control sequencing only; none of them reclassifies a required integration as optional, mocked, or future work.

## 35. Deployed guardrail revision (V2)

Implementation review against Aumo's sense-score-reason-act-prove pattern produced two deliberately separate Spot accounts and a strengthened Autopilot vault:

- `SpotOrderAccountV1` remains the dual-trigger TP/SL/OCO protection account.
- `SpotOrderAccountV2` is the directional buy-below/sell-above limit account with minimum output and batch cancellation.
- `AutopilotVaultV2` replaces the initial V1 runtime factory. It enforces an owner-defined asset allowlist, oracle-valued trade and exposure caps, maximum slippage, daily turnover and drawdown bounds, cooldown/expiry, policy version and action nonce, approved executor/adapter, proof hash, global/vault pause and owner-only recovery.

The off-chain model may propose or tighten a plan, but it cannot add an asset, increase a cap, change an execution adapter, withdraw to itself or bypass the on-chain checks. All top-level V1 and V2 deployments are recorded in `packages/contracts/deployments`; active public addresses and role/router descriptions are in `.env` and the contract deployment guide.

## 36. Implemented trust-boundary and operations update

The wired implementation makes the following concrete choices where earlier workflow prose described alternatives:

- All conditional Spot execution uses the two connected-wallet-owned on-chain accounts: V1 OCO protection and V2 directional limit. There is no second user wallet, delegator, custodial signer, or provider-side EIP-712 order path.
- Keeper registration proves a confirmed owner-to-account transaction, configured-factory `accountOf`, account owner, active record, exact token addresses, and ERC-20 symbol direction against the OKX `BASE-QUOTE` instrument. Only explicit wrapped/bridged aliases are normalized.
- Browser activity may announce only a pending hash. Confirmation/failure comes from the chain receipt and sender; internal workers record their own confirmed receipts.
- Autopilot strategy activation requires a five-minute connected-wallet signature over the complete strategy payload. Registration additionally proves factory provenance through `vaultsOf`, vault owner, settlement asset, allowlist, policy hash, and token/instrument identity.
- Spot monitoring reads live order state and OKX mark price. OCO P&L is an explicitly labelled estimate from registration mark; it is not presented as connected-wallet-wide cost-basis accounting.
- Autopilot monitoring reads vault token balances and current mark, with a mark-to-market baseline captured at first activation. The evidence hash shown in the dashboard is the same hash committed to the `Executed` event; full evidence remains private in Blob.
- Telegram uses a chat-bound HMAC delivery capability, not a wallet-link session. KV deduplicates update IDs and durably queues failed delivery with exponential retry and distributed delivery locks. Full reports use opaque revocable retention-bound API shares, never direct Blob URLs.
- KV is the operational state/retry/index store. Blob holds encrypted reports and private Autopilot evidence. PostgreSQL is neither required nor used.
