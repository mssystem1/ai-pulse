# PULSE · Production deployment guide

PULSE needs a stable public HTTPS origin that serves the web app, REST, MCP, brand assets, and x402 payment headers. The current same-origin Vercel deployment is valid for the web product, but do not submit its `*.vercel.app` hostname to OKX.AI: moderator security tooling has blocked that literal host. Use a custom domain or a separate non-Vercel API origin.

## Production requirements

- Final HTTPS origin
- Non-zero X Layer `PAY_TO_ADDRESS`
- xAI key for Grok analysis
- OKX credentials authorized for live x402, Exchange OS DEX, and X Layer token-catalog calls
- `X402_MOCK=0`
- `ENABLE_SERVER_PAY=0`
- Node 22.x, pinned by the root `package.json`

The application also forces the operator-only server-funded checkout off when
`NODE_ENV=production`. Remove `TEST_WALLET_PRIVATE_KEY` from public environments
anyway; defense in depth is not a reason to keep a signing key on the server.

## Option A · Existing Vercel project plus custom domain (recommended)

The root [`vercel.json`](../vercel.json) builds the monorepo and routes API traffic to [`api/index.ts`](../api/index.ts). The web project configuration handles the Vite output.

1. Import the repository into Vercel.
2. Use repository root as the project root.
3. Install command: `npm install`.
4. Build command: `npm run build:vercel`.
5. Set the environment variables below for Production.
6. In Project Settings → Domains, add a domain you own and apply the exact DNS record Vercel displays.
7. Wait for verification and TLS, then set `BASE_URL` to the custom HTTPS origin.
8. Do not create `VITE_API_URL`; browser calls use the same origin.
9. Redeploy after changing `BASE_URL`.

This mode gives the cleanest wallet/CORS story and removes `vercel.app` from the submitted service URL. Confirm the platform timeout supports the configured Grok response time.

The root package must remain ESM (`"type": "module"`). The serverless entrypoint imports ESM-only `@pulse/*` workspace packages; removing that setting makes the function load as CommonJS and fail before `/healthz` can respond.

## Option B · Node API plus Vercel web

Deploy the API to Railway, Render, Cloud Run, Fly.io, or a VPS:

```bash
npm install
npm run build
npm run start:api
```

Then deploy `apps/web` to Vercel with:

```dotenv
VITE_API_URL=https://api.your-domain.example
```

Set API `BASE_URL` to that same API origin. The Express CORS configuration exposes `PAYMENT-REQUIRED` and `PAYMENT-RESPONSE`.

### Railway path without buying a domain

The repository's `railway.toml` selects the root `Dockerfile`, which builds and starts only the API:

1. In Railway, create a project from the GitHub repository and branch `main`.
2. Keep the repository root as the service root.
3. Add the production variables from the matrix below. Do not upload `.env` itself.
4. Deploy, then open Service → Settings → Networking → **Generate Domain**.
5. Set `BASE_URL=https://<GENERATED>.up.railway.app` and redeploy.
6. Run the non-spending checks against that Railway origin.
7. In Vercel Production, set `VITE_API_URL` to the Railway origin and redeploy the web project.
8. Update agent #8355's token-scan service endpoint to `https://<GENERATED>.up.railway.app/v1/token/scan`.

Railway's generated hostname avoids the moderator's literal `vercel` filter. A custom domain on Railway is stronger for a final public identity; Railway requires both the displayed CNAME and TXT verification records before it routes the custom hostname.

## Option C · Docker

```bash
docker build -t pulse-api .
docker run --env-file .env -p 4000:4000 pulse-api
```

Terminate TLS at the platform/load balancer and set `BASE_URL` to the external HTTPS origin.

## Environment matrix

| Variable | Local | Production |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:4000` | Final HTTPS API origin |
| `NODE_ENV` | `development` | `production` |
| `PRODUCT_NAME` | `PULSE` | `PULSE` |
| `X402_NETWORK` | `eip155:196` | `eip155:196` |
| `X402_ASSET` | USDT0 contract | USDT0 contract |
| `PAY_TO_ADDRESS` | zero allowed in mock | Real non-zero recipient |
| `X402_MOCK` | `1` | `0` |
| `OKX_API_KEY` | optional | required |
| `OKX_SECRET_KEY` | optional | required |
| `OKX_PASSPHRASE` | optional | required |
| `XAI_API_KEY` | optional | required for paid analysis |
| `ENABLE_SERVER_PAY` | `0` | `0` |
| `VITE_API_URL` | empty or localhost API | unset for same origin; API origin only if split |

The `OKX_XLAYER_API_*` aliases remain supported. Keep all credentials server-side.

For Railway, set `HOST=0.0.0.0` or omit `HOST` and use the application default. Do not use URL-form IPv6 notation such as `HOST=[::]`; Node interprets the brackets as a hostname. PULSE also normalizes `[::]` defensively in case a platform supplies it.

## Post-deploy verification

Set a shell variable to the final API origin and run:

```bash
curl -i https://YOUR_DOMAIN/healthz
curl -i https://YOUR_DOMAIN/v1/metadata
curl -i https://YOUR_DOMAIN/brand/logo.png
curl -i https://YOUR_DOMAIN/brand/logo.svg
curl -i "https://YOUR_DOMAIN/v1/market/instruments?q=ETH&limit=10"
curl -i "https://YOUR_DOMAIN/v1/xlayer/tokens?q=USDT0&limit=10"
curl -i https://YOUR_DOMAIN/v1/token/scan
curl -i -X POST https://YOUR_DOMAIN/v1/token/scan \
  -H "content-type: application/json" \
  -d '{"address":"0x779ded0c9e1022225f8e0630b35a9b54be713736","chainId":"196"}'
curl -i -X POST https://YOUR_DOMAIN/v1/analysis/base \
  -H "content-type: application/json" \
  -d '{"instId":"BTC-USDT","timeframe":"1H"}'
```

The token-scan GET must return HTTP 400 with `status: "input_required"`. Both valid unpaid POST calls must return HTTP 402. Decode `PAYMENT-REQUIRED` and verify:

- scheme `exact`;
- network `eip155:196`;
- USDT0 contract `0x779ded0c9e1022225f8e0630b35a9b54be713736`;
- correct route amount;
- intended `payTo` address.
- `outputSchema.method` is `POST` and required inputs use the `body` carrier.

Then run:

```bash
node scripts/asp-compliance.mjs https://YOUR_DOMAIN
```

This checks all non-spending surfaces and clearly reports that live settlement was not executed. Enable `RUN_LIVE_PAY=1` only for the final controlled run after verifying the wallet, recipient, and `$0.01` token-scan price. The script performs one paid token scan.

## Browser release check

- Header and hero are usable at 375px, 768px, and desktop widths.
- Market pair control opens a searchable live OKX list, selects only returned instruments, and has no arbitrary pair text input.
- X Layer token browser returns chain 196 addresses with source disclosure; selection fills the input and manual contract entry still works.
- Token and market dialogs cover the viewport, scroll internally, close by Escape/backdrop, and have no horizontal overflow at 390px.
- Loading ticker/candles updates the market preview without clearing the current report.
- Wallet connection requests X Layer.
- Header wallet control shows USDT0 and opens the drawer.
- Header is the only wallet connection entry point; the connected control is labeled **Wallet & funding**.
- Drawer shows OKB and USDT0 without clipping.
- A live OKX Exchange OS quote loads for X Layer OKB → USDT0 and the existing header wallet receives the prepared transaction without a second connect step.
- Direct OKX DEX fallback is visible.
- Insufficient USDT0 blocks before signature and opens the drawer.
- Disconnect survives a reload and explicit reconnect works from the header.
- Free contract inspection reports current X Layer RPC evidence; paid heuristic scores remain visibly separate and do not claim to be audits.
- Successful payment returns a report and refreshes balances.
- English and Chinese copy render without encoding corruption.

If you add a Content Security Policy, allow API `connect-src` access for the final same-origin/split origin and the configured X Layer RPC. Token discovery calls OKX and DexScreener from the API, not directly from the browser; token logos may require an explicit `img-src https: data:` policy. No third-party DEX iframe is required. Validate the exact production policy in a real wallet-enabled browser.

## Production safety check

- [ ] `X402_MOCK=0`
- [ ] `ENABLE_SERVER_PAY=0`
- [ ] Test private-key variables removed
- [ ] `PAY_TO_ADDRESS` independently verified
- [ ] Secrets exist only in the platform secret store
- [ ] Logs do not emit credentials or signatures
- [ ] Dependency advisories reviewed
- [ ] `/v1/xlayer/tokens` and `/v1/market/instruments` work from the production region and respect upstream quotas
- [ ] One low-value live payment completed
- [ ] Paid token scan returned `service: "token_scan"` inline with `PAYMENT-RESPONSE`
- [ ] OKX task replay produced `replaySuccess: true` and `deliverableSavedPath`
- [ ] Rollback deployment identified
- [ ] Custom domain and DNS stable before recording

## Railway troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `getaddrinfo ENOTFOUND [::]` | `HOST` contains URL-style IPv6 brackets | Set `HOST=0.0.0.0` or remove the variable, then redeploy |
| `/healthz` never becomes ready | Container crashed before binding | Read Deploy Logs; confirm the startup banner reports the Railway port |
| Logs say `Using mock x402 gate` | `X402_MOCK` is enabled or one of the three OKX credentials is missing | Set `X402_MOCK=0` and all key/secret/passphrase variables, then redeploy |

## OKX.AI handoff

Use the canonical copy in [`okx-listing.md`](okx-listing.md) and the review runbook in [`OKX_AI_MODERATION.md`](OKX_AI_MODERATION.md). Update and resubmit existing agent #8355. Register only the final custom/non-Vercel origin. Preview deployments, localhost metadata, mock-payment footage, and stale `asp.live.json` exports must not be submitted.
