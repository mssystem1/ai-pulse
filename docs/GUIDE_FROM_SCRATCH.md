# PULSE · Local setup and operator guide

This guide takes a clean checkout to a working web, REST, and MCP development environment. For production, continue with [`DEPLOY.md`](DEPLOY.md).

## 1. Requirements

- Node.js 20+
- npm 10+
- Git
- OKX Wallet or another injected EVM wallet for browser testing
- Optional: xAI API key for real analysis
- Optional: OKX API key, secret, and passphrase for live x402 settlement, Exchange OS funding, and the X Layer token catalog

## 2. Install

```bash
git clone <REPOSITORY_URL> pulse
cd pulse
copy .env.example .env
npm install
```

## 3. Configure local mode

For safe local development:

```dotenv
BASE_URL=http://localhost:4000
X402_MOCK=1
PAY_TO_ADDRESS=0x0000000000000000000000000000000000000000
ENABLE_SERVER_PAY=0
PRODUCT_NAME=PULSE
```

Set `XAI_API_KEY` if you want base/premium analysis to return a real Grok response. Without it, free OKX market endpoints still work and paid analysis correctly returns a configuration error after the payment gate.

Never put secrets in `VITE_*` variables. Those are embedded in browser assets.

## 4. Build and test

```bash
npm run build
npm test
```

The monorepo build order is encoded in the root script. Workspace packages use the `@pulse/*` scope.

## 5. Run

Terminal 1:

```bash
npm run dev:api
```

Terminal 2:

```bash
npm run dev:web
```

Open `http://localhost:5173`. The API runs at `http://localhost:4000`.

## 6. Validate each surface

### Free REST

```bash
curl http://localhost:4000/healthz
curl "http://localhost:4000/v1/market/instruments?q=ETH&limit=10"
curl "http://localhost:4000/v1/market/ticker?instId=BTC-USDT"
curl "http://localhost:4000/v1/market/candles?instId=BTC-USDT&bar=1H&limit=20"
curl "http://localhost:4000/v1/xlayer/tokens?q=USDT0&limit=10"
curl -X POST http://localhost:4000/v1/contract/inspect -H "content-type: application/json" -d '{"address":"0x779ded0c9e1022225f8e0630b35a9b54be713736"}'
```

The public market-instrument route works without credentials. The X Layer catalog uses authenticated OKX Onchain OS token data and therefore needs the three OKX credentials; DexScreener enrichment is best-effort and never substitutes a token from another chain.

### Paid REST challenge

```bash
curl -i -X POST http://localhost:4000/v1/analysis/base \
  -H "content-type: application/json" \
  -d '{"instId":"BTC-USDT","timeframe":"1H"}'
```

Expect HTTP 402 and a `PAYMENT-REQUIRED` header.

### MCP discovery

```bash
curl -X POST http://localhost:4000/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Web wallet

1. Open the market picker, search `ETH`, select `ETH-USDT`, and verify there is no editable pair field.
2. Load free market data and confirm the ticker/chart update.
3. Open Safety, browse X Layer tokens, select one address, then confirm manual address editing still works.
4. Run free contract inspection, return to Market, reload free market data, and confirm the report remains visible.
5. Connect from the header and approve the switch/add request for X Layer.
6. Open the same header control and verify OKB and USDT0 balances.
7. Request an OKB → USDT0 quote and confirm the native swap card uses the same connected account with no second connect prompt.
8. Try a paid action with insufficient USDT0 and verify no signature is requested.
9. Disconnect and reload; PULSE must remain disconnected until the header CTA is used again.

## 7. Understand the packages

| Workspace | Responsibility |
| --- | --- |
| `@pulse/web` | Product UI, browser wallet, balances, funding, paid fetch |
| `@pulse/api` | REST, MCP, metadata, report store, route orchestration |
| `@pulse/market` | Live OKX public spot data |
| `@pulse/analysis` | Grok prompts and structured market output |
| `@pulse/payments` | Mock and official OKX x402 seller paths |
| `@pulse/buyer` | Programmatic paid buyer used for controlled tests |
| `@pulse/domain` | Deterministic safety methodology |
| `@pulse/schemas` | Shared Zod contracts |
| `@pulse/config` | Environment, pricing, metadata |
| `@pulse/sdk` | Typed client |

## 8. Switch to live settlement

Set a real non-zero `PAY_TO_ADDRESS`, `X402_MOCK=0`, and the three OKX credentials. Restart the API and inspect `/healthz`; it must show `paymentMode: "okx"` and `hasOkxCredentials: true`.

Do not enable `ENABLE_SERVER_PAY` on the public service. It exists only for controlled operator/E2E use with a throwaway wallet.

## 9. Common problems

| Symptom | Resolution |
| --- | --- |
| API offline in UI | Start `npm run dev:api`; confirm port 4000 |
| Funding quote unavailable | Confirm all three server-side OKX credentials and Exchange OS API access; use **Open OKX DEX** as the fallback |
| X Layer token catalog unavailable | Confirm all three server-side OKX credentials; inspect OKX Market/DEX quota and authorization errors on the API |
| DexScreener details are missing | This is valid when DexScreener has no X Layer pair. PULSE keeps the OKX catalog result and source label |
| Swap asks to connect again | The old embedded integration is still deployed; rebuild the current native Exchange OS flow |
| Contract inspection returns 502 | Verify `X_LAYER_RPC` returns chain `0xc4` and permits standard JSON-RPC reads |
| Wallet reconnects after Disconnect | Clear old application storage once, then verify the persisted disconnect flow |
| Analysis returns 503 | Configure `XAI_API_KEY` on the API server |
| Every paid call accepts a dummy signature | You are in mock mode; never describe it as live settlement |
| Wallet balance is stale | Use Refresh; paid actions always perform their own fresh read |
| Wrong x402 recipient | Fix `PAY_TO_ADDRESS`, restart, and decode a new 402 challenge |
| API tests fail on Windows esbuild | Install optional dependencies from the lockfile; do not use `--omit=optional` |

## 10. Release path

1. Complete [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md).
2. Deploy using [`DEPLOY.md`](DEPLOY.md).
3. Validate copy and service fields with [`okx-listing.md`](okx-listing.md).
4. Record [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).
5. Publish only after the live URL and payment proof exist.
