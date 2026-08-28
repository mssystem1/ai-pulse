# PULSE · Production deployment guide

This is the release runbook for the checked-in production topology:

```text
Browser / wallet
      |
      v
Vercel web (static Vite application)
      |
      | HTTPS via VITE_API_URL
      v
Railway API + durable worker (one long-lived Node service)
      |-- REST, MCP, x402 and Telegram webhooks
      |-- report jobs and recovery
      |-- Spot order reconciliation
      |-- Autopilot analysis, risk monitoring and execution
      |
      +--> Upstash KV (state, queues, leases and indexes)
      +--> Vercel Blob (private report/evidence bodies)
      +--> OKX, xAI, CDP, Circle and chain RPCs
      +--> deployed PULSE contracts
```

Do not run the Railway worker and a Vercel automation cron at the same time. Shared KV leases reduce accidental overlap, but two intentionally active production schedulers remain an avoidable operational risk.

## What belongs on each host

| Host | Responsibility | Secrets |
| --- | --- | --- |
| Vercel | Static web application only | None. Set only the public browser variables listed below. |
| Railway | API, MCP, x402, report jobs, Telegram and the automation worker | OKX, xAI, CDP, Circle, Blob, KV, RPC and automation secrets. |
| Chain contracts | Owner-controlled Spot accounts and Autopilot vaults | No off-chain secret is stored in a contract. |

`AUTOMATION_EXECUTOR_PRIVATE_KEY` is not a Vercel requirement and it is not a user wallet. It is the private key of the restricted server signer used by the Railway worker for contract-authorized Spot keeper calls, bounded Autopilot execution and current oracle updates. Never expose it through a `VITE_*` variable and never put it in the Vercel web project.

The corresponding public address must be authorized on every enabled mainnet as all three roles currently used by the worker:

- `PulseRegistryV1.spotKeepers(address) == true`;
- `PulseRegistryV1.autopilotExecutors(address) == true`;
- `OracleRouterV1.updaters(address) == true`.

The signer needs only enough native gas on each enabled chain: OKB on X Layer and ETH on Base and Arbitrum. It must not be the seller wallet, test wallet, treasury, user wallet or contract owner. User capital remains in owner-controlled accounts and vaults; the executor cannot use the vault owner's withdrawal function, and contract policy limits every automated action.

`CRON_SECRET` has a different purpose: it authenticates `GET /v1/internal/automation/tick` when a serverless scheduler invokes that route. It is not an on-chain key. The recommended Railway topology uses in-process timers, so leave `CRON_SECRET` unset there and do not add it to Vercel.

## Before committing

Run these checks from the repository root:

```bash
npm install
npm test
npm run build
git status --short
```

Review the diff before committing. Do not commit `.env`, private keys, API credentials, Blob/KV tokens, Telegram secrets, payment signatures, wallet exports or HAR files containing authorization headers.

The repository pins Node `22.x`. Use Node 22 locally, in Railway and for the Vercel build.

## 1. Prepare production resources

Before either deployment, prepare:

- a Railway project connected to the intended GitHub repository and production branch;
- a Vercel project connected to the same repository and branch;
- a stable HTTPS API hostname, initially a Railway-generated domain or preferably a custom API domain;
- a stable HTTPS web hostname, preferably a custom web domain;
- an Upstash database dedicated to production;
- a private Vercel Blob store, or the documented encrypted-public-store fallback;
- production OKX, xAI, CDP/Circle and Telegram credentials required by enabled features;
- the already deployed and verified PULSE contract addresses for each enabled chain;
- a dedicated automation signer whose address has the required on-chain roles and native gas.

Do not share the Upstash database used by local mainnet tests with production. Several trading and Autopilot keys intentionally use stable `pulse:v6:*` namespaces for continuity; a different `PERSISTENCE_NAMESPACE` alone is not full isolation.

## 2. Deploy Railway API and worker first

The checked-in [`railway.toml`](../railway.toml) selects the root [`Dockerfile`](../Dockerfile), builds the API workspace and starts `@pulse/api`.

1. Create a Railway service from the repository and production branch.
2. Keep the repository root as the service root.
3. Keep the Dockerfile builder selected.
4. Add the Railway variables described below. Add values in Railway's variable UI; do not upload `.env`.
5. Keep exactly one production replica for the initial release.
6. Disable Railway Serverless/app sleeping for this service. Spot and Autopilot use continuous timers and must not wait for an incoming HTTP request to wake the process.
7. Deploy, then generate a Railway domain under **Service → Settings → Networking**.
8. Set `BASE_URL` to that exact HTTPS API origin, without a trailing slash, and redeploy.
9. Confirm `/healthz` before deploying the web app.

Recommended core Railway values:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
BASE_URL=https://api.example.com

X402_MOCK=0
ENABLE_SERVER_PAY=0
AUTOMATION_WORKER_ENABLED=1
AUTOMATION_EXECUTOR_PRIVATE_KEY=<dedicated-restricted-executor-key>

STORAGE_PROVIDER=vercel_blob
# The supplied PULSE store is public transport with server-side AES-GCM.
BLOB_ACCESS=public
REPORT_ENCRYPTION_KEY=<BASE64URL_32_BYTE_REPORT_ENCRYPTION_KEY>
QUEUE_PROVIDER=upstash_kv
PERSISTENCE_NAMESPACE=pulse:production

# V6 Global reports require enough room to complete the strict Elliott schema.
GROK_MAX_OUTPUT_STANDARD=1800
GROK_MAX_OUTPUT_PREMIUM=3200
```

Use [`.env.production.example`](../.env.production.example) as the complete server-variable checklist, not as a file to upload verbatim. Replace every placeholder, remove disabled-provider secrets that are not needed and preserve the verified public contract addresses.

Important Railway rules:

- Do not set any private value with a `VITE_` prefix.
- Do not deploy `TEST_WALLET_PRIVATE_KEY`, even when the test wallet was used for local mainnet acceptance.
- Keep `ENABLE_SERVER_PAY=0`; production users sign payment and trading transactions in their own wallets.
- Keep `X402_MOCK=0`.
- `PAY_TO_ADDRESS` must be a deliberately verified non-zero seller address.
- The supplied PULSE Blob store is public, so Railway must use `BLOB_ACCESS=public` with the same server-only 32-byte `REPORT_ENCRYPTION_KEY` used for all report reads. Do not change this access mode during deployment.
- Production startup fails closed before accepting traffic if `STORAGE_PROVIDER=vercel_blob` is combined with any Blob access mode other than `public`, or if the encryption key is missing or invalid.
- Do not reduce `GROK_MAX_OUTPUT_STANDARD` below `1800` or `GROK_MAX_OUTPUT_PREMIUM` below `3200`. The runtime clamps obsolete lower values, but the environment should reflect the actual cost ceiling used by V6 reports.
- `DATABASE_URL` remains empty. PULSE uses KV and Blob, not PostgreSQL.
- Leave `CRON_SECRET` empty in this Railway topology.

### Automation activation gate

Do not set `AUTOMATION_WORKER_ENABLED=1` merely because a syntactically valid private key exists. Before activation, verify all of the following:

- the derived executor address is the expected dedicated address;
- the address is an approved Spot keeper, Autopilot executor and oracle updater on X Layer, Base and Arbitrum if those chains are enabled;
- every configured factory, registry, router, adapter and oracle address belongs to the selected chain;
- the executor has a small native gas balance on every enabled chain;
- Upstash is reachable and uses the production database;
- `AUTOPILOT_KILL_SWITCH=0` only after the above checks pass;
- the API starts with no missing-role, missing-contract or storage-readiness warning.

If the gate is not complete, deploy safely with:

```dotenv
AUTOMATION_WORKER_ENABLED=0
FEATURE_TRADING=0
FEATURE_AUTOPILOT=0
```

Analysis and other non-automation services can be verified first. Enable trading and Autopilot only after the on-chain authority checks pass.

## 3. Deploy the Vercel web application

The checked-in [`vercel.json`](../vercel.json) is intentionally web-only for the recommended split deployment. It builds the Vite app and provides the SPA fallback; it does not deploy `api/index.ts` and it does not schedule automation.

1. Import the repository into Vercel.
2. Use the repository root as the project root.
3. Keep the checked-in install/build/output settings.
4. Add only the browser-safe variables below.
5. Set `VITE_API_URL` to the working Railway API origin, without a trailing slash.
6. Add the Vercel preview and production web origins to the Reown project allowlist.
7. Deploy and confirm the application reports **API live**.
8. Add the final web custom domain, update the Reown allowlist and redeploy if any `VITE_*` value changed.

Vercel Production variables:

```dotenv
VITE_API_URL=https://api.example.com
VITE_REOWN_PROJECT_ID=<public-reown-project-id>
VITE_CIRCLE_APP_ID=<public-circle-app-id>
VITE_FEATURE_WALLET_APPKIT=1
VITE_ENABLED_NETWORKS=xlayer,base,arbitrum,arc-testnet
VITE_PAY_TO_ADDRESS=<public-seller-address>
VITE_CIRCLE_GATEWAY_SELLER_ADDRESS=<public-seller-address>
VITE_USE_PROXY=0
```

Only include networks and public integration IDs actually enabled by the Railway API. `VITE_*` values are compiled into browser JavaScript and are not secrets. A change requires a new Vercel build.

Never add these to the Vercel web project:

- `AUTOMATION_EXECUTOR_PRIVATE_KEY`;
- `TEST_WALLET_PRIVATE_KEY`;
- `CRON_SECRET` in the recommended split topology;
- OKX, xAI, CDP or Circle API secrets;
- Blob or Upstash tokens;
- Telegram bot/webhook secrets;
- report encryption keys.

## 4. Verify Railway before enabling user traffic

Use the final API origin in the following commands:

```bash
curl -i https://API_DOMAIN/healthz
curl -i https://API_DOMAIN/v1/metadata
curl -i https://API_DOMAIN/brand/logo.png
curl -i https://API_DOMAIN/brand/logo.svg
curl -i "https://API_DOMAIN/v1/market/instruments?q=ETH&limit=10"
curl -i "https://API_DOMAIN/v1/xlayer/tokens?q=USDT0&limit=10"
curl -i https://API_DOMAIN/v1/token/scan
curl -i -X POST https://API_DOMAIN/v1/token/scan \
  -H "content-type: application/json" \
  -d '{"address":"0x779ded0c9e1022225f8e0630b35a9b54be713736","chainId":"196"}'
curl -i -X POST https://API_DOMAIN/v1/analysis/base \
  -H "content-type: application/json" \
  -d '{"instId":"BTC-USDT","timeframe":"1H"}'
```

Expected results:

- `/healthz`, `/v1/metadata` and brand assets return successfully;
- token-scan `GET` returns HTTP 400 with `status: "input_required"`;
- valid unpaid paid-service `POST` requests return HTTP 402;
- `PAYMENT-REQUIRED` decodes to the intended service, network, asset, amount and `payTo` address;
- no response or log contains a private key, provider secret, recovery capability or payment signature.

For the X Layer token-scan challenge, verify scheme `exact`, network `eip155:196`, USDT0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`, the route price, intended `payTo`, `outputSchema.method=POST`, and body-carried required inputs.

Then run the read-only checks from a trusted operator machine:

```bash
npm run readiness:okx
node scripts/asp-compliance.mjs https://API_DOMAIN
```

`readiness:okx` performs authenticated read-only catalog/quote checks and does not sign or broadcast a wallet transaction. Provider access can differ by deployment region, so verify it from the Railway environment as well. A business code such as `50125` means OKX received the request; investigate account/service/region authorization instead of rewriting it as a missing credential.

Keep `RUN_LIVE_PAY=0` for non-spending checks. Set it to `1` only for a deliberate, low-value final payment acceptance run after independently checking the seller, network, token and price.

## 5. Verify the complete browser workflow

Test production at desktop widths and at 390 px mobile width:

- header, network selector and mobile navigation have no browser-level horizontal scrollbar;
- OKX Wallet is visible through AppKit and can connect, disconnect and reconnect;
- wallet balance and selected network update without reloading the app;
- Global Market loads live instruments, candles, Base/Premium reports and cross-device report history;
- report charts fit their card and click to zoom in/out;
- a Premium report clearly offers Market, Limit and Autopilot next actions;
- Spot accepts direct pair selection and report-prefilled selection, validates chain mapping and balances, and preserves pending/active/executed/cancelled activity across tabs and devices;
- Autopilot shows the strategy account's real capital, the connected wallet's available settlement balance, separate Add/Withdraw flows and Max controls;
- Prediction Market, Telegram, Docs and Risk Guard load without stale API state;
- changing X Layer, Base, Arbitrum and Arc themes keeps every pop-up readable;
- paid report recovery works after refresh and on another signed device;
- insufficient settlement balance blocks before signature and explains the remedy;
- English and Chinese copy render without encoding corruption.

Complete at least one deliberately bounded real-user flow on each production-enabled mainnet before announcing support. Do not use the automation executor or test wallet as the browser user.

## 6. Observability and rollback

Before launch:

- confirm Railway deploy logs show one API process and one enabled automation worker;
- confirm there is no Vercel automation cron and no second API receiving production automation ticks;
- check `/metrics` from the monitoring system without publishing it as a user-facing page;
- alert on API health, worker-cycle failures, KV/Blob errors, provider errors, executor gas and repeated transaction reverts;
- record the last known-good Railway and Vercel deployments;
- know how to set `AUTOPILOT_KILL_SWITCH=1` and redeploy/restart Railway;
- preserve the previous Upstash/Blob data while rolling application code back.

Changing Railway variables creates a new deployment. Changing Vercel `VITE_*` variables requires a new web build. Treat both as release changes.

## Production safety checklist

- [ ] `NODE_ENV=production`
- [ ] `X402_MOCK=0`
- [ ] `ENABLE_SERVER_PAY=0`
- [ ] no test private key on either host
- [ ] no server secret on Vercel web
- [ ] one Railway API/worker replica and no competing Vercel cron
- [ ] Railway service sleeping/serverless mode disabled
- [ ] `PAY_TO_ADDRESS` independently verified
- [ ] production Upstash database is isolated from local testing
- [ ] Blob privacy/encryption mode verified
- [ ] executor address and all three on-chain roles verified per enabled chain
- [ ] executor native gas checked per enabled chain
- [ ] configured contract addresses checked against chain IDs
- [ ] API, storage, provider and automation readiness checks pass
- [ ] one controlled low-value payment passes
- [ ] one bounded Spot and Autopilot lifecycle passes per advertised mainnet
- [ ] logs contain no credentials, signatures or recovery secrets
- [ ] web/API custom domains and TLS are stable
- [ ] rollback deployments identified

## Railway troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `getaddrinfo ENOTFOUND [::]` | `HOST` contains URL-style IPv6 brackets | Set `HOST=0.0.0.0` or remove it, then redeploy. |
| `/healthz` never becomes ready | Container crashed before binding | Inspect Deploy Logs and confirm the process binds Railway's `PORT`. |
| Product becomes stale after inactivity | Railway Serverless/app sleeping is enabled or the service restarted | Disable sleeping, inspect restart logs and verify KV recovery. |
| Logs say `Using mock x402 gate` | Mock mode is enabled or required OKX credentials are absent | Set `X402_MOCK=0`, supply the complete credentials and redeploy. |
| Analysis works but automation does not | Worker disabled, role missing, contract mismatch, no native gas or kill switch active | Check the automation activation gate and logs before retrying. |
| Browser says API offline | Wrong build-time `VITE_API_URL`, failed Railway health or TLS/CORS issue | Open Railway `/healthz`, compare the exact API origin, then rebuild Vercel. |
| Reports or dashboards disappear | Vercel and Railway point to different KV/Blob resources or namespaces | Verify Railway storage variables; Vercel web must not own authoritative storage. |
| Paid report reaches `failed terminal` or `manual reconciliation` with `Cannot use private access on a public store` | Railway `BLOB_ACCESS` does not match the Vercel Blob store | For the supplied public store, set `BLOB_ACCESS=public` and the stable server-only `REPORT_ENCRYPTION_KEY`; redeploy, sign into Paid report history and press **Retry**. The settled receipt is reused and no second payment occurs. |
| Global report logs show `Unterminated string` near the end of Grok JSON | Obsolete Global output limits truncated the strict V6 schema | Set `GROK_MAX_OUTPUT_STANDARD=1800` and `GROK_MAX_OUTPUT_PREMIUM=3200`, redeploy, then retry the settled job from report history. |

## Alternative: all-in-one Vercel serverless

This is supported by the API entrypoint but is not the checked-in production default. Use it only instead of Railway, not alongside Railway automation.

An all-in-one setup requires restoring the API rewrites/function and an authenticated cron in `vercel.json`, placing server secrets (including the executor key) in the Vercel server environment, setting a long random `CRON_SECRET`, and using shared KV leases and idempotent workers. Vercel Cron invokes production routes with HTTP GET; when `CRON_SECRET` is configured it sends `Authorization: Bearer <CRON_SECRET>`. Function duration limits still apply, failed cron invocations are not automatically retried and invocations can overlap. The every-minute schedule used by PULSE is not available on the Vercel Hobby plan.

For these reasons, the Railway long-lived worker is the recommended topology for production Spot and Autopilot.

## Marketplace and public metadata handoff

Use the canonical listing copy in [`okx-listing.md`](okx-listing.md) and the review runbook in [`OKX_AI_MODERATION.md`](OKX_AI_MODERATION.md). Update the existing PULSE registration only after the final public API origin passes this runbook. Do not submit localhost, preview URLs, mock-payment footage or stale metadata exports.

Use the final web URL for social/search previews and user entry. Use the final API URL for REST, MCP, OpenAPI, brand assets and marketplace service endpoints. Verify both URLs in `/v1/metadata` and the repository metadata before submission.

## Platform references

- [Vercel project configuration and SPA rewrites](https://vercel.com/docs/project-configuration/vercel-json)
- [Vercel Cron behavior and `CRON_SECRET`](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Vercel function runtime limits](https://vercel.com/docs/functions/runtimes)
- [Railway service variables](https://docs.railway.com/variables)
- [Railway monorepo deployment](https://docs.railway.com/guides/deploying-a-monorepo)
- [Railway Serverless/app sleeping behavior](https://docs.railway.com/deployments/serverless)
- [Railway restart policies](https://docs.railway.com/deployments/restart-policy)
