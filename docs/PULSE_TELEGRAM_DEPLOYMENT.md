# PULSE Telegram deployment package

Prepared October 4, 2026. Prepare and deploy **one PULSE bot, @pulsemi_bot**, with chat research/EVM history and the TON Mini App. This package does not perform deployment or publish bot changes. Use the [complete BotFather walkthrough](PULSE_BOTFATHER_SETUP.md) for exact names, descriptions, commands and menu settings.

## 1. Release contents and identity

| Item | Deployment value |
| --- | --- |
| Product / bot name | PULSE |
| Existing username | pulsemi_bot |
| Token / secret | Reuse the existing PULSE credentials on the API host |
| Telegram account owner | Existing verified Telegram user ID; no new customer account |
| Chat checkout | Five approved services, 10/15 Stars |
| Mini App checkout | TON-USDT Global Quick 10 / Global Pro 15 Stars |
| Main Mini App | https://www.ai-pulse.tech/ton-miniapp |
| Website introduction | https://www.ai-pulse.tech/telegram |
| In-app user guide | PULSE app → Telegram; https://app.ai-pulse.tech/telegram |
| One payment/message webhook | `/v1/telegram/webhook` |
| Chat status/catalog | `/v1/telegram/status`, `/v1/telegram/services` |
| TON interface status/catalog | `/v1/telegram/ton/status`, `/v1/telegram/ton/services` |
| TON signed requests | Same PULSE token validates Telegram initData |
| Report owner / payer | `telegram:<userId>` for purchases in either interface |

TON orders have an interface marker and separate library index; they still use the same payment records, account owner and webhook. `/reports` in chat includes chat and TON purchases plus retained linked-wallet history. TON Reports shows the TON subset, with no EVM wallet or execution controls. Reading/refunding another user's order is rejected. Both contexts deliver reports in the same PULSE conversation.

Preserve the existing production KV database, queue, namespace, report encryption key, Blob store, webhook secret and original wallet association records. Browser disconnects do not delete the EVM history binding. Initial message-signature ownership proof and bot confirmation are required; subsequent history reads need no transaction, gas, signature or chain switch.

## 2. Operator inputs before deployment

1. Use the existing owner account that manages @pulsemi_bot in BotFather.
2. Identify the Railway API service currently receiving the bot webhook. The October 4 read-only check confirmed `pulse-api-production-7aae.up.railway.app` for this bot. Open the service's public networking/domain settings and match that hostname before editing variables.
3. Identify the Vercel frontend project whose production domains include `www.ai-pulse.tech`. Select that project by its domain; do not guess another project's name.
4. Confirm the API/frontend release branch and normal Git-based deployment process with your existing host settings. These instructions do not push the working tree automatically.
5. Supply the actual staffed contact for `TELEGRAM_SUPPORT_CONTACT`; support text is not a substitute for someone monitoring it.
6. Keep existing cloud secrets private. Local development values such as `localhost` and `pulse:local` must not replace production values.

The required new public/Telegram variables are in [Railway template](launch/telegram-railway.env.example) and [Vercel template](launch/telegram-vercel.env.example). They are excerpts to merge into the existing configuration, not replacements for the full application's secrets/storage/provider settings.

## 3. Railway variables

On the existing API service, open **Variables** and configure:

```dotenv
FEATURE_TELEGRAM=1
FEATURE_JOBS=1
FEATURE_PREDICTION_ANALYSIS=1
TELEGRAM_BOT_TOKEN=<KEEP_EXISTING_PULSE_TOKEN>
TELEGRAM_BOT_USERNAME=pulsemi_bot
TELEGRAM_WEBHOOK_SECRET=<KEEP_EXISTING_WEBHOOK_SECRET>
# Existing variable name: this is the web origin for chat report/wallet-proof pages.
TELEGRAM_MINI_APP_URL=https://www.ai-pulse.tech
TELEGRAM_TON_MINI_APP_ENABLED=1
TELEGRAM_TON_MINI_APP_URL=https://www.ai-pulse.tech/ton-miniapp
TELEGRAM_WEBHOOK_BASE_URL=https://pulse-api-production-7aae.up.railway.app
BASE_URL=https://pulse-api-production-7aae.up.railway.app
TELEGRAM_SUPPORT_CONTACT=<ACTUAL_MONITORED_HANDLE_OR_EMAIL>
TELEGRAM_STARS_ENABLED=0
TELEGRAM_STARS_GLOBAL_QUICK=10
TELEGRAM_STARS_RISK_GUARD=15
TELEGRAM_STARS_PREDICTION_QUICK=10
TELEGRAM_STARS_GLOBAL_PRO=15
TELEGRAM_STARS_PREDICTION_PRO=15
REPORT_SHARE_LINK_ENABLED=1
```

If the active API is deliberately moved, replace both API-origin variables and the frontend API URL consistently after verifying the target. The prepared script checks both views before changing the webhook.

Retain the existing production values of `QUEUE_PROVIDER`, `REDIS_URL` or legacy Upstash credentials, `STORAGE_PROVIDER`, `BLOB_READ_WRITE_TOKEN`, `REPORT_ENCRYPTION_KEY`, `PERSISTENCE_NAMESPACE`, worker/provider configuration and all unrelated PULSE settings. Follow [the existing deployment runbook](DEPLOY.md) for those resources. Do not migrate storage during this Telegram release simply because another queue provider appears in a template.

The removed `TELEGRAM_TON_BOT_TOKEN`, `TELEGRAM_TON_BOT_USERNAME`, `TELEGRAM_TON_WEBHOOK_SECRET` and `TELEGRAM_BOT_ONLY` variables are not used by this design. There is one token and one webhook secret.

## 4. Vercel public variables

On the frontend project serving www.ai-pulse.tech, open **Settings → Environment Variables**. Add/update the following public values for the intended deployment environment:

```dotenv
VITE_API_URL=https://pulse-api-production-7aae.up.railway.app
VITE_TELEGRAM_TON_APP_RETURN_URL=https://t.me/pulsemi_bot?startapp
```

Retain the other existing frontend variables. Bot tokens, webhook secrets, KV credentials, Blob tokens and report encryption keys stay on Railway. A `VITE_*` variable is compiled into browser assets. Updating Vercel variables requires a new frontend build for those values to take effect.

The repo uses Node 22, Railway's checked-in Dockerfile/worker start command, and the existing Vercel static Vite deployment. Keep those hosts and the normal release process. Serve `apps/web/public/tonconnect-manifest.json` as a static JSON file, not through a wildcard HTML fallback.

Report PNG rendering uses the pinned `@resvg/resvg-js` dependency and bundled `assets/fonts/Inter.ttf` with its open-font license. The existing Dockerfile copies `assets`; retain that directory in the runtime image and install optional native dependencies for the host architecture (including Linux musl for Alpine). Frontend `prebuild` compiles `@pulse/schemas` and `@pulse/domain` so Vercel's web-only build can resolve the shared presentation from a fresh checkout. No new environment variables or BotFather settings are required for report formatting or chart attachments.

## 5. Local verification and review

From `C:\Users\maksim.shishkov\ai-pulse`:

```powershell
npm.cmd run build:vercel
npm.cmd run test --workspace @pulse/api
npm.cmd run test --workspace @pulse/web
node --test scripts/telegram-readiness.test.mjs scripts/telegram-setup.test.mjs
git diff --check
```

Review the code/configuration diff before committing your intended release. The working tree also contains other PULSE edits; include only the intended release scope. Do not commit `.env`, `.env.cloud`, actual tokens or populated customer/payment evidence.

Expected results: API and frontend builds pass, API/web tests pass, setup/readiness tests pass and no whitespace errors. Tests establish deterministic behavior, not real Stars payments or wallet-client acceptance.

## 6. Deployment order with sales paused

1. Record the current API/frontend deployment IDs and a compatible rollback release. Preserve paid-job support during rollback.
2. Merge the Railway variables with `TELEGRAM_STARS_ENABLED=0`. Apply them through the normal host deployment flow.
3. Deploy the API release. Confirm `/healthz` is successful and the worker starts using the existing production store.
4. Read `/v1/telegram/status`. Expect `mode=pulse`, username `pulsemi_bot`, `chatEnabled=true`, `tonMiniAppEnabled=true`, and the TON URL.
5. Read `/v1/telegram/ton/status`. Expect `mode=ton_miniapp`, the same username and `webhookPath=/v1/telegram/webhook`.
6. Read both `/services` routes. With sales paused, expect `checkoutReady=false`, currency `XTR`, five known service entries disabled and their public prices hidden. TON's enabled catalog later contains only the two Global tiers.
7. Deploy the Vercel frontend with the matching API URL.
8. Open and reload `https://www.ai-pulse.tech/telegram` for the website introduction and `https://app.ai-pulse.tech/telegram` for the practical in-app guide. Navigate to the Telegram tab from another PULSE workspace too. Open `/wallet-link` on the website for browser ownership proof and `/ton-miniapp` for the dedicated TON interface; the Mini App has Explore, Reports and TON wallet tabs. A regular browser preview cannot purchase or retrieve private Telegram reports. Launch it from @pulsemi_bot for signed client acceptance.
9. Check the manifest response is JSON, its icon is a PNG, and `og-image-v8.png` is a PNG. HTTP 200 with HTML is a failed asset deployment.
10. Create/update an ignored local `.env.cloud` operator file with the same production expectations and private existing credentials. An external env file is also acceptable. Preserve local development `.env` separately.
11. Preview the bot setup, inspect all fields, then apply the paused configuration:

```powershell
node --env-file=.env.cloud scripts/telegram-setup.mjs --stage paused
node --env-file=.env.cloud scripts/telegram-setup.mjs --stage paused --apply
```

12. Complete [BotFather manual steps](PULSE_BOTFATHER_SETUP.md): name/about/description/avatar, command labels, group/privacy/inline settings, Main Mini App, menu, loading appearance and current previews. The script duplicates name/copy/commands/menu deliberately; it does not handle the other manual fields.
13. Inspect identity/menu/webhook:

```powershell
node --env-file=.env.cloud scripts/telegram-setup.mjs --status
node --env-file=.env.cloud scripts/telegram-readiness.mjs --view chat --stage paused
node --env-file=.env.cloud scripts/telegram-readiness.mjs --view ton --stage paused
```

Expect one matching identity/webhook and accepted update types `message`, `callback_query`, `pre_checkout_query`. Main Mini App must be enabled manually. Pending updates are retained, never discarded for convenience.

## 7. Controlled Stars acceptance

Use a staffed acceptance window before announcing the release. There is no tester allowlist in this implementation; enabling Stars makes the reachable checkout available to anyone who finds it.

1. Set `TELEGRAM_STARS_ENABLED=1` on Railway and redeploy/restart as required. Match the operator env file's sales state.
2. Run readiness with `--stage checkout` for both views. Chat must enable all five approved services/prices. TON must enable Global Quick/Pro at 10/15 and keep Risk/Prediction disabled.
3. Preview and apply the checkout-stage bot configuration, removing paused profile text:

```powershell
node --env-file=.env.cloud scripts/telegram-setup.mjs --stage checkout
node --env-file=.env.cloud scripts/telegram-setup.mjs --stage checkout --apply
```

4. Run one real purchase of every chat service (65 Stars total) and both TON tiers (25 Stars total). Record order/charge identifiers only in restricted evidence.
5. Verify each amount, service/tier, one recorded charge, one worker job, document delivery and owned recovery. Both the first delivery and `/reports` recovery must show the correct market/pair and Global timeframe. TXT and chat must use readable research sections, retain invalidation/risk/evidence caveats, and exclude raw provider payloads and nested field paths. Pro reports with valid saved chart data must attach their snapshot as a PNG; Quick, Risk Guard and unmapped Prediction Pro reports must not invent a chart. In TON Reports, verify pair/timeframe/date, TXT download and chart enlargement on mobile.
6. From the same PULSE chat, `/reports` must include purchases made through both interfaces. TON Reports must show TON purchases and reject unrelated EVM/chat orders by direct API request.
7. Test native invoice cancel/close, delayed provider response, close/reopen recovery and an eligible failed undelivered report refund. Never rebuy an order just to recover it.
8. Link an existing EVM history wallet, sign the displayed ownership message, return to this bot and confirm the exact address. Disconnect/restart the browser and reload the API; the saved association must remain. Change/unlink must be explicit.
9. Connect/restore/disconnect through TON Connect on iOS, Android and Desktop. This is a wallet session, not a server-verified permanent TON ownership association. Report ownership stays with Telegram.
10. Check `/website` and the X entry link; use a fresh `/start` to receive the new menu. Old messages keep their old keyboards.
11. Record real results in [acceptance-results.csv](launch/acceptance-results.csv), expanding device cases as necessary.

If acceptance is incomplete or a payment/ownership defect occurs, pause new Stars purchases and acquisition while leaving paid fulfillment, recovery and refunds available.

## 8. Readiness decision

**Prepared code is suitable for staging/paused deployment once local verification passes. Public launch is not established by preparation.** Required remaining evidence is cloud deployment, actual support staffing, real payment/refund/report delivery, real wallet/client persistence, restore verification and platform eligibility review of the combined links/wallet workflow.

The [release-status note](launch/release-status.md) records completed local checks, the three page purposes and the remaining manual deployment sequence. Consult it before starting the host changes; local screenshots and mock invoices are not real purchase evidence.

The October 4 read-only inspection found the old API without the new Stars catalog/TON routes, a webhook missing `pre_checkout_query`, and HTML fallbacks at the new manifest/preview-image URLs. This is expected before deployment; it is not a failed deployment of this package.

Telegram's rules apply to a Mini App's connected bot too, so chat placement alone is not an exemption for EVM wallet or non-TON site links. The requested single-bot implementation preserves those features and leaves eligibility explicitly unresolved. [Telegram blockchain guidelines](https://core.telegram.org/bots/blockchain-guidelines).

The [marketing strategy](PULSE_MARKETING_STRATEGY.md) covers the X → PULSE bot → website entry, approved offers, content calendar, economics and measurement. Website UTMs exist; saved-order campaign attribution and paid acquisition are not activated by deploying this package.
