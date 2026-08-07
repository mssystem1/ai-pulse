# PULSE V2 localhost end-to-end testing guide

This guide tests PULSE locally before any commit, deployment, listing, or agent update. Automated tests use mock-shaped payments internally; interactive product testing uses the real providers only when `X402_MOCK=0` and a payment is deliberately confirmed.

## 1. Preconditions

- Node.js 22.x and npm 10+.
- A current `.env` copied from `.env.local.example` and kept untracked.
- Provider credentials remain server-side. Never create a `VITE_*` private key, API secret, passphrase, entity secret, or database token.
- `TEST_WALLET_ADDRESS` matches the address derived from `TEST_WALLET_PRIVATE_KEY`.
- The test wallet holds the payment asset and native gas asset on every network under test.
- Real payments have an agreed maximum spend and are confirmed individually.

Recommended local network configuration:

```dotenv
NODE_ENV=development
PORT=4000
BASE_URL=http://localhost:4000
VITE_API_URL=http://localhost:4000

ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet
VITE_ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet

FEATURE_POLYMARKET=1
FEATURE_WALLET_APPKIT=1
FEATURE_PREDICTION_ANALYSIS=1
FEATURE_FUSED_ANALYSIS=1
FEATURE_DIVERGENCE_ANALYSIS=1
FEATURE_EVENT_RISK_ANALYSIS=1
FEATURE_BASE_PAYMENTS=1
FEATURE_ARBITRUM_PAYMENTS=1
FEATURE_ARC_PAYMENTS=1
FEATURE_JOBS=1
CIRCLE_GATEWAY_ENABLED=1

X402_MOCK=0
ARC_AI_MODE=fixture
GROK_MAX_INPUT_FUSED_STANDARD=13000
```

Use `ARC_AI_MODE=fixture` first to certify Arc payment, receipt, queue, persistence, and UI delivery without model cost. Switch Arc to `live` only after its xAI cost variables and rate limits are intentionally approved.

## 2. Install and establish the clean baseline

```powershell
npm install
npm test
npm run build
```

Expected result: every workspace test passes and the Vite production build completes. Bundle-size and mixed dynamic/static-import messages are warnings; TypeScript, test, or build errors are blockers.

Optional non-spending release diagnostics:

```powershell
npm run readiness:okx
npm run readiness:upstash
npm run readiness:blob
npm run validate:alerts
```

These diagnostics are not required to start development. They check external configuration and should never replace `npm run dev`.

## 3. Start PULSE

```powershell
npm run dev
```

This starts:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/healthz`
- Metadata: `http://localhost:4000/v1/metadata`
- MCP: `http://localhost:4000/mcp`
- Metrics: `http://localhost:4000/metrics`

If separate terminals are preferable:

```powershell
npm run dev:api
npm run dev:web
```

Do not change the API origin to port 5173. Port 5173 is Vite; port 4000 is the API.

## 4. Non-spending API checks

1. Open `/healthz`. Confirm `ok=true`, expected enabled networks, real payment mode, and provider-key presence flags. Health must not expose key values.
2. Open `/v1/metadata`. Confirm version `2.0.0`, all enabled network aliases, configured prices, exact assets, public endpoints, and legacy X Layer routes.
3. Call free OKX endpoints:

   ```powershell
   curl.exe "http://localhost:4000/v1/market/instruments?q=BTC&limit=10"
   curl.exe "http://localhost:4000/v1/market/ticker?instId=BTC-USDT"
   curl.exe "http://localhost:4000/v1/market/candles?instId=BTC-USDT&bar=1H&limit=20"
   ```

4. Call free Polymarket discovery:

   ```powershell
   curl.exe "http://localhost:4000/v1/polymarket/trending?limit=20"
   ```

5. Verify invalid input and unavailable primary evidence fail before payment. Such responses must contain no payment challenge.
6. Send one valid unpaid POST per enabled network. Confirm HTTP 402, correct CAIP-2 network, exact asset, amount, payee, resource URL, input contract, and six-decimal metadata where declared.

## 5. Desktop web review

Use a viewport of at least 1440×900.

- Header: logo, selected network, provider indicator, Spot/Prediction navigation, and wallet button do not overlap.
- Spot: searchable live pair picker, timeframe, free preview, chart, standard/premium actions, report persistence after refresh.
- Prediction: three-column market grid, explicit market selection, read-only restriction disclosure, no implication that PULSE places orders.
- Network theme: X Layer, Base, Arbitrum, and Arc Testnet each show their designated visual treatment and payment asset.
- Wallet drawer: provider, address, chain, native balance, payment balance, refresh, receive/funding action, and clear testnet labeling on Arc.
- Paid lifecycle: challenge, wallet confirmation, settlement, real job stages, completion, report, and receipt are visible without fabricated progress.

## 6. Mobile web review

Use representative widths 390×844 and 430×932.

- Header becomes a grid: brand, navigation/network controls, and full-width wallet action do not overlap.
- Prediction cards become one column with no horizontal scroll.
- Funding drawer fits the viewport and keeps the primary action reachable.
- Long addresses, transaction hashes, market titles, warnings, and error messages wrap without clipping.
- WalletConnect/mobile return flow restores the selected network and pending job.
- Rotation and reload do not lose a recovery-capable paid job.

Physical-wallet certification requires the actual clients. A private key can exercise signing and on-chain execution, but it cannot certify the UI of OKX Wallet, MetaMask, Rabby, WalletConnect mobile, or Base Account by itself.

## 7. Wallet and funding checks

For each selected network:

1. Connect from the header once.
2. Confirm PULSE distinguishes selected PULSE network from the wallet’s current chain.
3. Switch/add the target chain.
4. Refresh native and payment balances.
5. Request the in-app funding quote.
6. Review token addresses, amount, slippage, route, gas estimate, spender/approval, recipient, and simulation.
7. Sign only after the wallet displays the expected transaction.
8. Wait for receipt and refresh balances.

Network-specific expectations:

- X Layer: OKB → USD₮0, official contract `0x779ded0c9e1022225f8e0630b35a9b54be713736`.
- Base: ETH → native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Arbitrum: ETH → native USDC `0xaf88d065e77c8cc2239327c5edb3a432268e5831`; USDC.e must not satisfy the payment check.
- Arc Testnet: faucet/test USDC and Circle Gateway deposit; label every balance and transaction as testnet.

## 8. Controlled real-payment proof

Do not attempt every service merely to prove a shared adapter. Use a representative matrix:

- One existing X Layer route to prove backward compatibility.
- One X Layer V2 fused route using USD₮0 and OKX facilitator.
- One Base V2 route using native USDC and CDP settlement.
- One Arbitrum V2 route using native USDC and CDP settlement.
- One Arc fixture route using test USDC and Circle settlement.
- One prediction-dependent route to prove Polymarket evidence reaches the report.
- One deterministic route to prove no unnecessary model dependency.

For every payment record:

- service and request parameters;
- network, asset, human and atomic amount, and payee;
- transaction hash and normalized receipt identifier;
- job ID and every stage;
- recovery result and report ID/checksum;
- provider calls, partial-data flags, model usage/cost when applicable;
- final balances.

Never record the private key, payment signature, provider secret, recovery token, or authorization header.

## 9. Failure and idempotency scenarios

- Invalid request: rejected before 402.
- Missing primary order book: rejected before 402.
- Insufficient balance: blocked before browser signing or rejected before settlement; no transaction.
- Stale signature: fresh challenge and signature required.
- Provider failure after settlement: job retains receipt and enters the documented recovery/regeneration state without another payment.
- Replayed authorization: returns the same job and never starts duplicate work.
- Wrong chain/asset/amount/payee/resource/body: server rejects before facilitator settlement.
- API restart: Upstash-backed jobs remain recoverable; memory mode is not a production persistence proof.

## 10. Exit criteria for localhost readiness

Localhost E2E may begin when:

- automated tests and production build pass;
- health, metadata, MCP, free discovery, and metrics respond;
- desktop/mobile layouts pass the checklist;
- exact network assets and prices match `.env` and metadata;
- no invalid/evidence-missing request can charge;
- representative real settlements complete with receipts and recoverable reports;
- remaining limitations are written as production gates rather than described as completed.

Localhost readiness is not production certification. Production still requires deployed-origin, persistence, wallet-client, discovery, observability, rollback, and marketplace review evidence.
