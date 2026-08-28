# PULSE environment guide

This document describes the implemented multichain configuration. The immutable registry supplies approved chain constants; environment variables control visibility, providers, prices, persistence, budgets, and staged activation.

## Copyable configuration templates

The tracked templates contain every configurable application/runtime variable, grouped by responsibility:

- `.env.local.example`: all four networks visible for funded, real-settlement localhost E2E testing; Arc uses live xAI and x402 mock mode is disabled.
- `.env.production.example`: first Railway/Vercel deployment with only the existing X Layer surface enabled.
- `.env.example`: aliases the recommended localhost starting profile for compatibility with existing setup instructions.

Copy the appropriate template, then replace every angle-bracket placeholder:

```powershell
Copy-Item .env.local.example .env
```

Do not copy either template over an existing populated `.env` without first preserving its credentials. Bulk-wallet, treasury-funding, and review automation variables are intentionally kept in `.env.wallets`, `.env.scripts`, and the script-specific examples; they are not application deployment settings.

## Local ports and Reown domains

The normal development commands run two processes:

```text
http://localhost:5173  Vite web application (the browser and wallet origin)
http://localhost:4000  Express API
```

Reown validates the origin hosting AppKit. Add `http://localhost:5173` to the Reown project allowlist. Add `http://localhost:4000` only if you also open a browser application served directly by the API origin. In production, add the Vercel web origin and the final custom web domain; the Railway API origin does not need to be a Reown web origin.

Browser-build variables are public by design:

| Variable | Guide |
|---|---|
| `VITE_API_URL` | API origin. Use `http://localhost:4000` locally and the Railway HTTPS origin on Vercel. |
| `VITE_REOWN_PROJECT_ID` | Create a project at Reown Cloud, add the web origins above, and copy its public project ID. |
| `CIRCLE_API_KEY` | Secret server key from Circle Console → API Keys for User-Controlled Wallets. Set only on the API process; never prefix with `VITE_`. |
| `VITE_CIRCLE_APP_ID` | Public Circle Web3 Services App ID used by the browser SDK for email OTP and challenge approval. Add it to the web environment. |
| `VITE_ENABLED_NETWORKS` | Must be equal to or narrower than the server allowlist. A change requires rebuilding/redeploying Vercel. |
| `VITE_PAY_TO_ADDRESS` | Public expected treasury address. It must equal server `PAY_TO_ADDRESS`; production signing fails closed if absent or mismatched. |
| `VITE_CIRCLE_GATEWAY_SELLER_ADDRESS` | Public expected Arc seller address. It must equal the server value when Arc is enabled. |
| `VITE_USE_PROXY` | `0` for direct local `:4000` calls; `1` only when the Vite `/api` proxy is deliberately used. |

Circle email OTP also requires outbound email configuration; the API key and App ID alone cannot send an OTP. In Circle Console open **Wallets → User Controlled → Configurator → Email**, set the From address and SMTP host, port, username, and password, preserve the OTP placeholder required by the current Console editor, then use **Send test email**. For Testnet, Circle's guide uses a Mailtrap Email Sandbox; those messages appear in Mailtrap unless forwarding is enabled. Production must use an SMTP provider that delivers to real inboxes.

The current Circle Console template editor labels its OTP variables `{{code}}` and `{{expiry_long}}`. Use subject `{{code}} is your PULSE verification code` and paste [CIRCLE_OTP_EMAIL_TEMPLATE.html](./CIRCLE_OTP_EMAIL_TEMPLATE.html) into the Email Template field. Preserve those variables exactly.

`OKX_BASE_URL` is the Exchange OS API origin. DEX quote/swap calls use the documented four authentication headers derived from the existing API key, secret, and passphrase; no separate project-ID environment variable is required. `OKX_FACILITATOR_URL` is independently configurable for x402 verify/settle routing; both origins currently default to `https://web3.okx.com`. A facilitator failure is not proof that the credentials are invalid: DEX and x402 are separate OKX services, so inspect the exact route, signed path, request body, network, and SDK response.

## Network activation model

`ENABLED_NETWORKS` is the server allowlist. `VITE_ENABLED_NETWORKS` is the public web-build allowlist. Supported values are:

```text
xlayer
base
arbitrum
arc-testnet
```

Use comma-separated values without spaces:

```env
ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet
VITE_ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet
```

A payment route is active only when the network is in the allowlist and its provider flag is enabled:

| Network | Required flags |
|---|---|
| X Layer | `xlayer` in `ENABLED_NETWORKS`; existing OKX configuration remains authoritative |
| Base | `base` plus `FEATURE_BASE_PAYMENTS=1` |
| Arbitrum | `arbitrum` plus `FEATURE_ARBITRUM_PAYMENTS=1` |
| Arc Testnet | `arc-testnet` plus `FEATURE_ARC_PAYMENTS=1` and `CIRCLE_GATEWAY_ENABLED=1` |

`DEFAULT_NETWORK` selects the initial network for an unprefixed web visit. Network-specific URLs override it. It does not override the connected wallet chain.

For production, set authenticated or otherwise production-grade primary endpoints in `BASE_RPC_URL` and `ARBITRUM_RPC_URL`. Keep the public endpoints in `BASE_RPC_FALLBACK_URL` and `ARBITRUM_RPC_FALLBACK_URL` only as fallbacks. API contract evidence and transaction simulation try configured endpoints in order and verify the returned chain ID. Local development may use the public defaults; production must not depend exclusively on a public Arbitrum RPC.

## Feature flags

| Variable | Effect when `1` |
|---|---|
| `FEATURE_POLYMARKET` | Enables Polymarket discovery and prediction context |
| `FEATURE_WALLET_APPKIT` | Server/deployment rollout flag for Reown AppKit |
| `VITE_FEATURE_WALLET_APPKIT` | Browser-build mirror; must match `FEATURE_WALLET_APPKIT` |
| `FEATURE_BASE_PAYMENTS` | Registers Base CDP x402 routes |
| `FEATURE_ARBITRUM_PAYMENTS` | Registers Arbitrum CDP x402 routes |
| `FEATURE_ARC_PAYMENTS` | Registers Arc Testnet payment routes |
| `FEATURE_JOBS` | Enables durable job, recovery, and report delivery paths |
| `FEATURE_LIVE_SAFETY` | Enables multichain RPC contract/ERC-20 evidence and non-broadcast transaction simulation. Missing observations are returned as `unknown`; this never converts evidence into an audit score. |
| `FEATURE_PREDICTION_ANALYSIS` | Enables the new prediction-only paid handlers after their prices are configured |
| `FEATURE_FUSED_ANALYSIS` | Enables the new fused OKX + selected-Polymarket handlers after their prices are configured |
| `FEATURE_DIVERGENCE_ANALYSIS` | Enables the separate divergence service after its price is configured |
| `FEATURE_EVENT_RISK_ANALYSIS` | Enables the separate event-risk preflight service after its price is configured |
| `CIRCLE_GATEWAY_ENABLED` | Enables the Circle Gateway payment adapter |

`XAI_INPUT_COST_PER_MILLION_USD=1.25`, `XAI_CACHED_INPUT_COST_PER_MILLION_USD=0.20`, and `XAI_OUTPUT_COST_PER_MILLION_USD=2.50` reflect xAI's published Grok 4.3 real-time short-context rates reviewed on 2026-08-03. Observed usage prices cached prompt tokens separately; pre-call budget reservations conservatively use the full input rate. Recheck https://docs.x.ai/developers/models/grok-4.3 before production rollout or when changing `GROK_MODEL`. PULSE's configured context limits are below xAI's 200k long-context threshold; if those limits change, update cost controls for the applicable long-context rates before enabling live mode.
| `BAZAAR_DISCOVERABLE` | Adds Bazaar discovery metadata to CDP routes; indexing still requires a successful CDP settlement |

Flags must fail closed: a missing, invalid, or incomplete provider configuration disables that provider and must not fall back to mock settlement in production.

## Required variable reference

This table is the operational checklist for variables that require a choice. Fixed chain IDs, CAIP-2 identifiers, native token contracts, explorer URLs, and provider URLs in the templates are registry constants and normally should not be changed.

| Variable | Allowed/format | Local funded E2E | Production | What it controls |
|---|---|---|---|---|
| `NODE_ENV` | `development` or `production` | `development` | `production` | Runtime error handling and production safety checks. |
| `BASE_URL` | Absolute API URL | `http://localhost:4000` | Railway HTTPS URL | Canonical API/resource URLs. Must be HTTPS for production Bazaar discovery. |
| `VITE_API_URL` | Absolute API URL | `http://localhost:4000` | Railway HTTPS URL | Browser destination for API calls; changing it requires rebuilding the web app. |
| `ENABLED_NETWORKS` | Comma-separated network keys | All four | Only certified networks | Server-side allowlist. This does not enable a provider by itself. |
| `VITE_ENABLED_NETWORKS` | Same or narrower list | All four | Mirror certified server networks | Networks shown in the browser; changing it requires a web rebuild. |
| `DEFAULT_NETWORK` | One enabled network key | `xlayer` | Product choice | Initial choice only when the browser has no saved selection. The user's last selection wins thereafter. |
| `X402_MOCK` | `0` or `1` | `0` for wallet E2E | Always `0` | `1` accepts test fixtures and must be used only by automated tests. It does not prove settlement. |
| `ENABLE_SERVER_PAY` | `0` or `1` | `0` | `0` | Allows operator-side payment scripts. It is never needed by the web wallet. |
| `RUN_LIVE_PAY` | `0` or `1` | `0` unless deliberately running a script | `0` | Extra guard for scripts that spend funded wallet assets. |
| `FEATURE_WALLET_APPKIT` / `VITE_FEATURE_WALLET_APPKIT` | `0` or `1` | `1` / `1` | Both equal | Enables wallet UI on server metadata and browser build. |
| `FEATURE_BASE_PAYMENTS` | `0` or `1` | `1` | `1` after certification | Registers Base CDP x402 routes. Requires Base in `ENABLED_NETWORKS` and CDP credentials. |
| `FEATURE_ARBITRUM_PAYMENTS` | `0` or `1` | `1` | `1` after certification | Registers Arbitrum CDP x402 routes. Requires Arbitrum in `ENABLED_NETWORKS` and CDP credentials. |
| `FEATURE_ARC_PAYMENTS` | `0` or `1` | `1` | `1` after certification | Registers Arc payment routes. Also requires `CIRCLE_GATEWAY_ENABLED=1`. |
| `CIRCLE_GATEWAY_ENABLED` | `0` or `1` | `1` | Match Arc rollout | Enables Circle Gateway verification/settlement; independent of AI mode. |
| `ARC_AI_MODE` | `fixture` or `live` | **`live` for real reports** | `live` when Arc is offered | `fixture` validates payment/job/report plumbing but intentionally skips xAI and returns no market inference. `live` uses the same real xAI analysis pipeline as other chains plus Arc budgets. API restart required. |
| `FEATURE_POLYMARKET` | `0` or `1` | `1` | `1` when discovery is offered | Enables public crypto prediction discovery/context. |
| `FEATURE_PREDICTION_ANALYSIS` | `0` or `1` | `1` | `1` after paid-route certification | Enables Standard and Premium prediction reports. |
| `FEATURE_FUSED_ANALYSIS` | `0` or `1` | `0` | `0` | Backward-compatible route only; not part of the current web product. |
| `FEATURE_DIVERGENCE_ANALYSIS` | `0` or `1` | `0` | `0` | Backward-compatible route only; not part of the current web product. |
| `FEATURE_EVENT_RISK_ANALYSIS` | `0` or `1` | `0` | `0` | Backward-compatible route only; not part of the current web product. |
| `FEATURE_JOBS` | `0` or `1` | `1` | `1` | Durable async execution, recovery, and paid-report delivery. |
| `FEATURE_LIVE_SAFETY` | `0` or `1` | `1` | `1` with production RPCs | Enables factual RPC evidence and non-broadcast simulation. |
| `BAZAAR_DISCOVERABLE` | `0` or `1` | `0` is quieter locally | `1` only with HTTPS `BASE_URL` | Sends CDP Bazaar discovery extensions. Local HTTP resources are correctly rejected by Bazaar and do not affect settlement. |
| `XAI_API_KEY` | Server secret | Required | Required | Authenticates real Standard/Premium reports on every chain. Never prefix with `VITE_`. |
| `GROK_MODEL` | Supported xAI model | Approved model | Approved model | Default report model. `ARC_GROK_MODEL` is retained as Arc-specific metadata/config compatibility. |
| `XAI_*_COST_PER_MILLION_USD` | Positive decimal USD values | Current prices | Current contracted prices | Cost accounting and Arc fail-closed budget reservations. `ARC_AI_MODE=live` refuses startup if input/output values are zero. |
| `GROK_REASONING_STANDARD` / `GROK_REASONING_PREMIUM` | Provider-supported effort | `none` / `low` | Product choice | Separates report depth and cost. |
| `GROK_MAX_INPUT_*` / `GROK_MAX_OUTPUT_*` | Positive token counts | Template values | Tune with cost gates | Hard request budgets; they are not prices charged to users. |
| `ARC_LIVE_WALLET_HOURLY_LIMIT` | Positive integer | Template value | Capacity policy | Maximum live Arc AI calls per payer per hour. |
| `ARC_LIVE_IP_HOURLY_LIMIT` | Positive integer | Template value | Capacity policy | Rejects abusive Arc sources before payment. |
| `ARC_LIVE_WALLET_DAILY_LIMIT` | Positive integer | Template value | Capacity policy | Maximum live Arc AI calls per payer per day. |
| `ARC_LIVE_DAILY_COST_LIMIT_USD` | Positive USD decimal | Template value | Approved daily budget | Global Arc xAI reservation ceiling. |
| `PRICE_*` | Positive USD decimal | Approved product prices | Same published prices | Amount requested by the corresponding paid route. A price is not a provider-cost budget. |
| `PAY_TO_ADDRESS` / `VITE_PAY_TO_ADDRESS` | Same EVM seller address | Same value | Same value | Server recipient and browser-side fail-closed expectation for X Layer/Base/Arbitrum. |
| `CIRCLE_GATEWAY_SELLER_ADDRESS` / `VITE_CIRCLE_GATEWAY_SELLER_ADDRESS` | Same EVM seller address | Same value | Same value | Arc seller and browser-side expected recipient. |
| `VITE_REOWN_PROJECT_ID` | Public Reown project ID | Local origin allowed | Production origin allowed | WalletConnect/AppKit project. It is safe to expose but is origin restricted. |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | Server secrets | Required for Base/Arbitrum | Required | CDP x402 and native-ETH-to-USDC quote authentication. |
| `OKX_XLAYER_API_*` | Server secrets | Required for X Layer | Required | Existing OKX x402/DEX compatibility credentials. |
| `STORAGE_PROVIDER` | `memory` or `vercel_blob` | `memory` for isolated testing, or configured Blob for recovery E2E | `vercel_blob` | Report-body persistence. Blob requires its token and KV metadata. |
| `QUEUE_PROVIDER` | `memory` or `upstash_kv` | `memory` for one process, or Upstash for durability E2E | `upstash_kv` | Jobs, locks, receipts, idempotency, and shared budgets. |
| `PERSISTENCE_NAMESPACE` | Stable unique prefix | `pulse:local` | `pulse:production` | Isolates jobs, reports, history, budgets and cron keys. V6 trading keys use a stable prefix, so never reuse the production KV database for localhost tests. |
| `BLOB_ACCESS` | `public` | `public` | `public` | The supplied PULSE Blob store is public; report bodies are encrypted before upload. |
| `REPORT_ENCRYPTION_KEY` | Base64url 32-byte key | Required for the supplied public Blob | Same stable key | Encrypts report bodies stored in public Blob. Changing it makes earlier encrypted reports unreadable. |
| `REPORT_DEFAULT_VISIBILITY` | `private` | `private` | `private` | Default paid-report access policy. |
| `REPORT_SHARE_LINK_ENABLED` | `0` or `1` | Product choice | Product choice | Allows explicit revocable sharing; it never makes reports public by default. |
| `AUTOMATION_WORKER_ENABLED` | `0` or `1` | `1` only during live acceptance | `1` on the single Railway worker | Enables guarded Spot reconciliation and Autopilot evaluation. Do not also run a Vercel cron. |
| `AUTOMATION_EXECUTOR_PRIVATE_KEY` | 32-byte server secret | Optional; TEST wallet is the acceptance fallback | Required only on the automation host (Railway in the recommended split) | Dedicated signer whose address currently needs Registry Spot keeper + Autopilot executor roles and the OracleRouter updater role. It cannot call owner-only vault withdrawal. Never use an owner, seller, treasury or test key. |
| `CRON_SECRET` | Long random server secret | Optional | Unset for Railway; required only for an all-in-one Vercel serverless API/cron | Authenticates `GET /v1/internal/automation/tick`; it is a scheduler secret, not an on-chain signer. |
| `AUTOPILOT_ANALYSIS_INTERVAL_MS` | Milliseconds, at least `60000` | `900000` | `900000` | Interval for Premium analysis and strategy/structure decisions. |
| `AUTOPILOT_RISK_INTERVAL_MS` | Milliseconds, at least `30000` | `60000` | `60000` | Independent live TP/SL and latched partial-exit monitor. It does not call xAI, continues during an AI outage, and still uses the vault cooldown, oracle, route, simulation and nonce safeguards. |
| `TEST_WALLET_ADDRESS` / `TEST_WALLET_PRIVATE_KEY` | Ignored operator secrets | Scripts and bounded acceptance only | Never deploy | Funded checkout automation. The browser never reads these values. |

The X Layer, Base and Arbitrum contract/router variables in the environment
templates are public deployment configuration, not secrets. The API embeds the
same verified release as a fail-safe: a valid environment value overrides it
for a deliberate migration, while a missing or malformed duplicate falls back
to the published release. Secrets, feature gates, the automation signer and RPC
URLs never receive such a fallback.

## Pricing: preserve current services, add V5 services

The existing pricing contract is unchanged and must remain wired to the existing routes, MCP tools, SDK behavior, metadata, and OKX.AI replay flow:

```env
PRICE_ANALYSIS_BASE=0.10
PRICE_ANALYSIS_PREMIUM=0.20
PRICE_TOKEN_SCAN=0.10
PRICE_PREFLIGHT=0.20
```

These are the four paid services exposed by the current web application. The existing wallet-scan, market-pulse, and heuristic swap-quote backend routes retain their code defaults for API/SDK compatibility; they are not presented as configurable web-product prices.

The V5 document leaves these prices open for product configuration. PULSE uses the following launch strategy:

```env
PRICE_ANALYSIS_PREDICTION_STANDARD=0.10
PRICE_ANALYSIS_PREDICTION_PREMIUM=0.20
PRICE_ANALYSIS_FUSED_STANDARD=0.15
PRICE_ANALYSIS_FUSED_PREMIUM=0.30
PRICE_ANALYSIS_DIVERGENCE=0.10
PRICE_PREFLIGHT_EVENT_RISK=0.20
```

Prediction pricing matches the configured standard/premium spot anchors. Fused pricing is higher because it validates and combines both OKX and selected Polymarket context. Divergence is a narrower specialized analysis at $0.10. Event-risk preflight extends the existing $0.20 preflight with fresh prediction-market validation and remains priced at $0.20. Existing price variables are never used as fallbacks for a different V5 service.

Local templates enable all four new service flags. The production-canary template keeps them disabled while retaining their configured prices, so activation later requires only a deliberate feature-flag change and redeployment.

The price-to-route mapping follows V5 exactly:

| Variable | Shared logical route |
|---|---|
| `PRICE_ANALYSIS_PREDICTION_STANDARD` | `POST /v1/analysis/prediction/standard` |
| `PRICE_ANALYSIS_PREDICTION_PREMIUM` | `POST /v1/analysis/prediction/premium` |
| `PRICE_ANALYSIS_FUSED_STANDARD` | `POST /v1/analysis/fused/standard` |
| `PRICE_ANALYSIS_FUSED_PREMIUM` | `POST /v1/analysis/fused/premium` |
| `PRICE_ANALYSIS_DIVERGENCE` | `POST /v1/analysis/divergence` |
| `PRICE_PREFLIGHT_EVENT_RISK` | `POST /v1/preflight/event-risk` |

Network-prefixed X Layer, Base, Arbitrum, and Arc routes reuse these service prices unless a future approved pricing policy explicitly introduces network-specific overrides.

## Recommended rollout profiles

### Local funded end-to-end integration

Exercise all planned surfaces with real wallet settlement and real Arc analysis:

```env
ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet
VITE_ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet
FEATURE_POLYMARKET=1
FEATURE_WALLET_APPKIT=1
FEATURE_BASE_PAYMENTS=1
FEATURE_ARBITRUM_PAYMENTS=1
FEATURE_ARC_PAYMENTS=1
FEATURE_JOBS=1
FEATURE_LIVE_SAFETY=1
FEATURE_PREDICTION_ANALYSIS=1
FEATURE_FUSED_ANALYSIS=0
FEATURE_DIVERGENCE_ANALYSIS=0
FEATURE_EVENT_RISK_ANALYSIS=0
CIRCLE_GATEWAY_ENABLED=1
BAZAAR_DISCOVERABLE=1
X402_MOCK=0
ARC_AI_MODE=live
```

Local flags expose routes, but real Base/Arbitrum/Arc settlement still requires valid credentials, balances, RPC access, and payment signatures. Automated tests should use explicit mock provider adapters, never a production fallback.

### First Railway/Vercel compatibility deployment

Deploy the new code with only the existing production network visible:

```env
ENABLED_NETWORKS=xlayer
VITE_ENABLED_NETWORKS=xlayer
FEATURE_POLYMARKET=0
FEATURE_WALLET_APPKIT=0
FEATURE_BASE_PAYMENTS=0
FEATURE_ARBITRUM_PAYMENTS=0
FEATURE_ARC_PAYMENTS=0
FEATURE_JOBS=1
FEATURE_LIVE_SAFETY=0
FEATURE_PREDICTION_ANALYSIS=0
FEATURE_FUSED_ANALYSIS=0
FEATURE_DIVERGENCE_ANALYSIS=0
FEATURE_EVENT_RISK_ANALYSIS=0
CIRCLE_GATEWAY_ENABLED=0
BAZAAR_DISCOVERABLE=0
ARC_AI_MODE=live
```

After the X Layer compatibility checks pass, enable the new wallet and Polymarket, then Base, Arbitrum, and Arc one at a time. `VITE_*` changes require a new Vercel build. Railway-only variables require an API redeploy/restart.

### Full production after staged rollout

After every network has passed its live settlement, replay, recovery, and monitoring gates, use:

```env
NODE_ENV=production
X402_MOCK=0
ENABLE_SERVER_PAY=0

ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet
VITE_ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet
FEATURE_POLYMARKET=1
FEATURE_WALLET_APPKIT=1
FEATURE_BASE_PAYMENTS=1
FEATURE_ARBITRUM_PAYMENTS=1
FEATURE_ARC_PAYMENTS=1
FEATURE_JOBS=1
FEATURE_LIVE_SAFETY=1
FEATURE_PREDICTION_ANALYSIS=1
FEATURE_FUSED_ANALYSIS=0
FEATURE_DIVERGENCE_ANALYSIS=0
FEATURE_EVENT_RISK_ANALYSIS=0
CIRCLE_GATEWAY_ENABLED=1
BAZAAR_DISCOVERABLE=1
ARC_AI_MODE=fixture
```

Use `ARC_AI_MODE=fixture` only for a pre-release plumbing canary that is explicitly labelled as non-analytical. A production surface offering Base/Premium Arc reports must use `ARC_AI_MODE=live`; enabling Arc payments alone does not enable xAI. `FEATURE_LIVE_SAFETY=1` enables factual contract/interface probes and exact transaction simulation; legacy heuristic scores remain X Layer-only and explicitly non-live.

Fused, divergence, and event-risk flags remain documented for backward-compatible API operation, but the current product strategy keeps all three disabled. The web product exposes only base and premium prediction analysis.

AI controls: `GROK_MAX_INPUT_STANDARD` / `GROK_MAX_INPUT_PREMIUM` are conservative hard prompt-size bounds checked before xAI is called. Prediction reports use separate `GROK_MAX_INPUT_PREDICTION_STANDARD=16000`, `GROK_MAX_INPUT_PREDICTION_PREMIUM=32000`, `GROK_MAX_OUTPUT_PREDICTION_STANDARD=1400`, and `GROK_MAX_OUTPUT_PREDICTION_PREMIUM=3200` budgets: Base stays concise, while Premium has room for deeper evidence weighting, counter-cases, catalysts, entry/no-trade conditions, and execution analysis. `GROK_MAX_INPUT_FUSED_STANDARD=13000` provides a separate ceiling for fused-standard requests, whose compact model context combines OKX spot and Polymarket features. Global Market V6 enforces effective output floors of `GROK_MAX_OUTPUT_STANDARD=1800` and `GROK_MAX_OUTPUT_PREMIUM=3200`; this prevents the strict Elliott-wave JSON object from being cut off before its closing braces. Higher configured values remain valid. `XAI_INPUT_COST_PER_MILLION_USD` and `XAI_OUTPUT_COST_PER_MILLION_USD` must contain the current contracted prices before `ARC_AI_MODE=live`; live mode fails closed at startup when either is zero.

Arc live-AI controls apply to every `/arc` route that can invoke xAI: legacy/canonical spot, prediction, and fused analysis. `ARC_LIVE_IP_HOURLY_LIMIT` is checked before presenting the payment flow. After the signed payer is available, PULSE atomically reserves `ARC_LIVE_WALLET_HOURLY_LIMIT`, `ARC_LIVE_WALLET_DAILY_LIMIT`, and the worst-case input/output cost against `ARC_LIVE_DAILY_COST_LIMIT_USD`. With `QUEUE_PROVIDER=upstash_kv`, these counters are shared across instances and survive deployments; `memory` is suitable only for a single local process. Fixture mode bypasses the counters and never calls xAI. Limit responses use HTTP 429 and `Retry-After`.

`GET /metrics` publishes Prometheus-compatible HTTP, provider, payment, job, report, queue, token, and cost series. Provider observations distinguish OKX, OKX DEX, Gamma, CLOB, Polymarket Data API, CDP Trade, and xAI. Payment middleware is measured as `challenge` or `verify_settle`; the official synchronous seller adapters do not expose truthful independent verify and settle timings. Structured JSON events carry the same `X-Correlation-ID` through payment, provider, job, xAI, and report work without logging request bodies, signatures, recovery tokens, or secrets.

`CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` authenticate both the CDP x402 facilitator and the server-side CDP Trade API quote used by the Base/Arbitrum in-app native ETH → native USDC funding flow. They are server-only and must never use a `VITE_` prefix.

Recommended staged changes from the canary:

1. Enable `FEATURE_JOBS=1` while X Layer remains the only network.
2. Enable `FEATURE_WALLET_APPKIT=1`, redeploy Vercel, and verify OKX Wallet replay.
3. Enable `FEATURE_POLYMARKET=1`; this is data functionality and does not enable a new payment chain. Then enable the four new analysis flags individually after their route tests pass.
4. Add `base` to both network lists, then set `FEATURE_BASE_PAYMENTS=1`.
5. Add `arbitrum`, then set `FEATURE_ARBITRUM_PAYMENTS=1`.
6. Add `arc-testnet`, set `FEATURE_ARC_PAYMENTS=1` and `CIRCLE_GATEWAY_ENABLED=1`, while keeping fixture AI.
7. Set `BAZAAR_DISCOVERABLE=1` only when Base and Arbitrum metadata validates and controlled CDP settlements are ready to create listings.

## Provider configuration

### Reown AppKit

Create an AppKit project at `https://dashboard.reown.com`, copy its project ID, and allowlist the web origins.

```env
VITE_REOWN_PROJECT_ID=<public Reown project ID>
```

The project ID is intentionally browser-visible. Never put private wallet or API credentials in a `VITE_*` variable.

### CDP x402

Required on Railway for Base and Arbitrum:

```env
CDP_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
CDP_API_KEY_ID=<rotated CDP key ID>
CDP_API_KEY_SECRET=<rotated CDP secret>
PAY_TO_ADDRESS=<seller EVM address>
```

Base and Arbitrum share CDP credentials but use separate CAIP-2 IDs, native USDC contracts, resources, receipts, and idempotency namespaces.

### Circle Gateway

The initial Arc seller path requires a receiving EVM address and Gateway URL, not Circle developer-controlled-wallet credentials:

```env
CIRCLE_GATEWAY_TESTNET_URL=https://gateway-api-testnet.circle.com
CIRCLE_GATEWAY_ACCEPTED_NETWORKS=eip155:5042002
CIRCLE_GATEWAY_SELLER_ADDRESS=<seller EVM address>
```

`CIRCLE_ENTITY_SECRET` and `CIRCLE_WALLET_SET_ID` remain intentionally absent. They belong to Developer-Controlled Wallets. PULSE uses Circle **User-Controlled Wallets**: email OTP plus the Circle browser approval UI, with wallets explicitly created as EOAs. Configure a Circle Testnet `CIRCLE_API_KEY` on the API and its matching `VITE_CIRCLE_APP_ID` on the web. The API key creates short-lived authentication and signing challenges but cannot sign without the user's Circle approval. This Circle email-wallet integration is Arc Testnet-only. X Layer, Base, and Arbitrum remain available through browser wallets and are hidden while a Circle email session is active. A Circle Mainnet key is not required for this rollout.

CCTP is also not required for accepting the initial Arc Gateway payment. Add CCTP configuration only when PULSE implements an in-product USDC bridge or withdrawal flow.

## Storage and queues

The approved initial durable-storage design is:

```text
Upstash KV: job metadata, queues, locks, idempotency, receipts, rate limits
Vercel Blob: immutable completed report bodies and larger artifacts
```

Configure the Blob and Upstash credentials on Railway because Railway runs the API and worker. Vercel may inject them automatically into the web project, but the browser must never receive them.

```env
STORAGE_PROVIDER=vercel_blob
BLOB_READ_WRITE_TOKEN=<rotated token>
QUEUE_PROVIDER=upstash_kv
PERSISTENCE_NAMESPACE=pulse:production
KV_REST_API_TOKEN=<rotated write token>
KV_REST_API_READ_ONLY_TOKEN=<rotated read token>
KV_REST_API_URL=<Upstash REST URL>
KV_URL=<Upstash Redis URL>
REDIS_URL=<same Redis URL when required by a library>
DATABASE_URL=
```

`DATABASE_URL` remains empty for this design. Blob is not used as a transactional database: a worker writes the report Blob first, then atomically marks the Upstash job complete with the Blob URL and checksum. If that bounded Blob write fails after payment—for example, during an access-mode mismatch or transient outage—the API stores report bodies up to 512 KiB in a private, retention-bound KV fallback and still verifies the SHA-256 checksum on read. This is a paid-delivery safety net, not the normal artifact path.

`PERSISTENCE_NAMESPACE` isolates job, idempotency, lease, report, share, wallet-history, Arc-budget, and cron keys. Use a stable value per environment; changing it intentionally creates a new recovery namespace, so keep the previous deployment online until its report-retention window expires. Spot activity, deterministic order state, Autopilot strategies/evidence, and Telegram delivery state retain stable `pulse:v6:*` keys to preserve existing mainnet continuity. Therefore local, canary, and production deployments must use separate Upstash databases; a different namespace alone is not sufficient isolation for V6 trading tests.

The supplied PULSE Blob store is public. Set `BLOB_ACCESS=public` and provide a server-only base64url encoding of 32 random bytes in `REPORT_ENCRYPTION_KEY`; PULSE stores only AES-256-GCM ciphertext in Blob and verifies the decrypted plaintext checksum. Keep the same encryption key across deployments so retained reports remain readable.

## Approved report privacy and paid-failure policy

Environment settings for the supplied public store:

    BLOB_ACCESS=public
    REPORT_ENCRYPTION_KEY=<BASE64URL_32_BYTE_REPORT_ENCRYPTION_KEY>
    REPORT_DEFAULT_VISIBILITY=private
    REPORT_SHARE_LINK_ENABLED=1
    PAID_REGENERATION_MAX_ATTEMPTS=2

- New paid reports are wallet-private by default.
- A user may explicitly create a revocable share link.
- Private Blob paths and ownership identifiers are never returned by V5 analysis responses.
- The settled `PAYMENT-SIGNATURE` authorizes private-report owner operations. PULSE stores only its hash.
- Read: `GET /v1/private/reports/:reportId`.
- Create share: `POST /v1/private/reports/:reportId/shares`.
- Revoke share: `DELETE /v1/private/reports/:reportId/shares/:shareToken`.
- Shared read: `GET /v1/shared/reports/:shareToken`; revoked tokens immediately return not found.
- Existing legacy preflight share-ID behavior remains compatible.
- Railway authorizes report retrieval and reads private Blob objects server-side; clients do not receive Blob credentials.
- If settlement succeeds but a required provider or Grok fails, the receipt grants up to two regeneration attempts without another payment.
- Regeneration uses the original normalized request and entitlement. It cannot change mode, tier, selected markets, payer, network, asset, or amount.
- After both attempts fail, the job enters `manual_reconciliation`; PULSE must not silently charge again.

## Secret placement

| Location | Variables |
|---|---|
| Vercel web | Public `VITE_API_URL`, `VITE_REOWN_PROJECT_ID`, `VITE_CIRCLE_APP_ID`, `VITE_ENABLED_NETWORKS`, public seller addresses and browser feature flags only |
| Railway API/worker | Automation executor, CDP, OKX, xAI, Circle, Telegram, Blob, Upstash, RPC, contracts and server feature flags |
| Local `.env` | development copies only; file remains gitignored |

Any credential pasted into chat, logs, screenshots, or tickets must be rotated before production use.
