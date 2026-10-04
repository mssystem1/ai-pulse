# PULSE Telegram rollout playbook

Prepared October 4, 2026. This is an operator plan, not evidence that deployment or real payments have completed. Day 0 means the launch date chosen after the gates below pass. Prices are approved; dates, budgets and numerical performance targets are proposed planning assumptions.

**Selected release architecture: one PULSE bot, @pulsemi_bot.** All five Stars research services and persistent EVM history linking run in its private chat. The same bot launches the TON Connect Mini App, whose current research offer is TON-USDT Global Quick/Pro. They share one token, one payment webhook and one Telegram report account. This is the user's selected architecture; deployment is not completed.

Related documents: [every BotFather setting](PULSE_BOTFATHER_SETUP.md), [complete deployment package](PULSE_TELEGRAM_DEPLOYMENT.md), [implementation and API](TELEGRAM_WORKFLOW.md), [marketing strategy](PULSE_MARKETING_STRATEGY.md) and [operator kit](launch/README.md).

## 1. Launch scope and current status

The local implementation contains a separate website introduction, an in-app Telegram user guide, five-service native chat checkout, permanent EVM history association, complete report document delivery, shared Stars fulfillment and a filtered TON Connect Mini App. The user guide explains exact commands and inputs, Stars checkout, browser ownership proof plus chat confirmation, TON Connect, and report recovery. Both purchase interfaces use the existing PULSE identity. See the [release-status note](launch/release-status.md) for local validation and remaining deployment work.

Technical preparation and platform eligibility are different gates. Telegram's blockchain guidelines cover a Mini App and its connected bot. The remaining review concerns are the EVM browser ownership-proof interaction and linked main-site non-TON wallet/trading functionality; merely reading market research or storing a report is a different behavior. A TON-only Mini App screen does not create an exception for its connected bot. Keep the requested one-bot implementation, inventory the actual interactions/links and record eligibility clarification before public acquisition. This playbook does not claim platform approval or require another bot. [Developer terms, section 7](https://telegram.org/tos/bot-developers#7-blockchain-integration), [blockchain guidelines](https://core.telegram.org/bots/blockchain-guidelines).

Local builds, automated tests and browser reviews verify implementation behavior. Real Stars purchase/refund, mobile Telegram acceptance, provider output, monitored support and production restore evidence remain deployment/launch work. Preserve existing EVM association records and wallet-owned website access throughout rollout.

### Launch blockers and owners

One person may hold multiple roles, but every row needs a named operator and evidence.

| Gate | Owner | Evidence required |
| --- | --- | --- |
| Platform/product scope | Product lead | Requested one-bot feature/link inventory, eligibility review and required clarifications recorded |
| Production origins | Release engineer | One verified Railway API origin used consistently by API, frontend and setup script |
| Durability | Release engineer | KV persistence and encrypted report roundtrip, stable namespace, restore procedure |
| Five services | Research owner | Valid production request/report for each service, supported input restrictions documented |
| Payments | Release engineer | Real Stars receipts, replay/recovery evidence, failure/refund evidence |
| Persistent EVM association | Release engineer | Signed ownership plus account confirmation; restart and replacement tests |
| Support/privacy/terms | Support lead | Human contact, published terms, retention/deletion process, response coverage |
| Economics | Product lead | Measured per-service cost and net Stars proceeds; spending ceiling |
| Launch content | Marketing lead | Accurate price/service claims and approved asset/content set |

## 2. Product and customer contract

| Service | Service ID | Price per report | Input | Delivered value |
| --- | --- | --- | --- | --- |
| Global Quick | `global-quick` | 10 Stars | Supported pair and timeframe | Structured market thesis, conditions and risk levels |
| Risk Guard | `risk-guard` | 15 Stars | Exact supported network and token contract | Risk evidence and limitations; not a safety guarantee |
| Prediction Quick | `prediction-quick` | 10 Stars | Supported selected market ID | Probability/fair-value research with assumptions |
| Global Pro | `global-pro` | 15 Stars | Supported pair and timeframe | Expanded scenarios and context |
| Prediction Pro | `prediction-pro` | 15 Stars | Supported selected market ID | Expanded evidence and context |

These are one-off purchases. Subscriptions, bundles, free credits, referral payouts and discounts are not implemented. A Pro price is 50% above Quick, so Pro generation cost must be measured separately. Stars purchase research, not deposits, execution fees or trading authorization. Do not label Telegram orders as an additional OKX AI marketplace purchase: they reuse the PULSE worker but have their own payment receipt.

Publish supported networks, markets, timeframes, expected latency, report availability period and service limits before asking customers to buy. The production example has Prediction analysis disabled: set `FEATURE_PREDICTION_ANALYSIS=1` only when providers and scope have been verified. Risk Guard support must be checked against the actual validator; library coverage across five networks does not establish that every network accepts new purchases.

Telegram requires Stars for digital goods/services sold inside Telegram apps. The platform requires payment support, and `refundStarPayment` is available for Stars purchases. [Stars payments documentation](https://core.telegram.org/bots/payments-stars).

## 3. Environment and release preparation

### Origins: resolve the mismatch first

The website introduction is `https://www.ai-pulse.tech/telegram`; the practical in-app guide is the Telegram tab at `https://app.ai-pulse.tech/telegram`. The dedicated TON Mini App is `https://www.ai-pulse.tech/ton-miniapp` and EVM browser ownership proof uses `/wallet-link` on the website. The legacy `/miniapp` entry renders the TON interface; use `/ton-miniapp` as the BotFather URL.

A previous read-only inspection found the webhook at `https://pulse-api-production-7aae.up.railway.app/v1/telegram/webhook`. The production example also contains `pulse-api-production-8d1f.up.railway.app` for other API values. Treat both as candidates until the deployment owner verifies the active service. Do not copy either blindly. Choose a single `https://<VERIFIED_API_ORIGIN>` and align `BASE_URL`, `TELEGRAM_WEBHOOK_BASE_URL`, frontend `VITE_API_URL`, deployment routing and health checks. A local `.env` does not change Railway variables.

### API/worker variables

```dotenv
NODE_ENV=production
BASE_URL=https://<VERIFIED_API_ORIGIN>
FEATURE_JOBS=1
FEATURE_TELEGRAM=1
FEATURE_PREDICTION_ANALYSIS=1
TELEGRAM_BOT_TOKEN=<SERVER_SECRET>
TELEGRAM_BOT_USERNAME=pulsemi_bot
TELEGRAM_WEBHOOK_SECRET=<SERVER_SECRET_AZ_az_09_underscore_hyphen>
TELEGRAM_MINI_APP_URL=https://www.ai-pulse.tech
TELEGRAM_TON_MINI_APP_ENABLED=1
TELEGRAM_TON_MINI_APP_URL=https://www.ai-pulse.tech/ton-miniapp
TELEGRAM_SUPPORT_CONTACT=<REAL_MONITORED_CONTACT>
TELEGRAM_WEBHOOK_BASE_URL=https://<VERIFIED_API_ORIGIN>
TELEGRAM_STARS_ENABLED=0
TELEGRAM_STARS_GLOBAL_QUICK=10
TELEGRAM_STARS_RISK_GUARD=15
TELEGRAM_STARS_PREDICTION_QUICK=10
TELEGRAM_STARS_GLOBAL_PRO=15
TELEGRAM_STARS_PREDICTION_PRO=15
QUEUE_PROVIDER=upstash_kv
STORAGE_PROVIDER=vercel_blob
PERSISTENCE_NAMESPACE=<EXISTING_STABLE_PRODUCTION_NAMESPACE>
KV_REST_API_URL=<KV_HTTPS_ENDPOINT>
KV_REST_API_TOKEN=<KV_WRITE_SECRET>
BLOB_READ_WRITE_TOKEN=<BLOB_SECRET>
BLOB_ACCESS=public
REPORT_ENCRYPTION_KEY=<EXISTING_BASE64URL_32_BYTE_KEY>
REPORT_SHARE_LINK_ENABLED=1
REPORT_RETENTION_DAYS=90
JOB_STAGE_RETENTION_DAYS=90
IDEMPOTENCY_RETENTION_DAYS=180
JOB_WORKER_CONCURRENCY=2
```

This one-bot sample contains only Telegram and durability settings. Use the [Railway excerpt](launch/telegram-railway.env.example), [Vercel excerpt](launch/telegram-vercel.env.example) and full deployment runbook for the actual environment. Provider credentials and other PULSE settings remain required. Preserve the existing production queue provider; Redis and Upstash have different credentials and migration requirements.

Start with new sales paused. Keep existing namespace, encryption key and database across releases. Exercise automated staging fixtures with an isolated namespace and appropriate test stores; never repoint the production webhook to an unready local build. No additional product bot is required by this release. Telegram delivery records currently use fixed `pulse:v6:telegram:*` keys, so a different namespace alone does not isolate staging delivery on a shared KV database. Use a separate staging KV database.

The frontend receives only public settings, including:

```dotenv
VITE_API_URL=https://<VERIFIED_API_ORIGIN>
VITE_TELEGRAM_TON_APP_RETURN_URL=https://t.me/pulsemi_bot?startapp
```

Verify the actual frontend allow-origin/routing behavior and that browser requests can send `PULSE-TELEGRAM-INIT-DATA`. Never expose bot token, webhook secret, KV/Blob credentials or encryption key in `VITE_*`, URLs or screenshots.

### Pre-release checks

From repository root, using Node 22 and the lockfile:

```powershell
npm.cmd ci
npm.cmd run build:vercel
npm.cmd run test -w @pulse/api
npm.cmd run test -w @pulse/web
node --test scripts/telegram-readiness.test.mjs scripts/telegram-setup.test.mjs
git diff --check
node scripts/telegram-setup.mjs
```

Inspect results and record commit/build IDs. A dry run prints planned commands/URLs without mutating Telegram. Use the existing normal Railway and Vercel deployment process; do not change the hosting provider for this release. Retain the last known compatible release IDs.

Readiness scripts `npm run readiness:upstash` and `npm run readiness:blob` create temporary records and clean them up. They are write checks, not read-only health probes. Run in staging first, then the approved production environment; ensure cleanup succeeds. A check proves access at that moment, not backups or regional availability.

### Backup and recovery evidence

Record KV provider backup/export procedure, Blob preservation, encryption-key escrow, access owner and restore destination. Restore a small sample to an isolated environment and verify that a report, payment receipt and account association can be read. Proposed launch objective: recovery point no worse than one hour, recovery time no worse than four hours; do not advertise these until the provider configuration and a drill substantiate them.

## 4. Ordered deployment and bot setup

Use [the full deployment runbook](PULSE_TELEGRAM_DEPLOYMENT.md) for click-by-click host steps and [the BotFather guide](PULSE_BOTFATHER_SETUP.md) for exact names/copy and every manual bot setting.

1. Finish local checks and publish purchase/privacy/support information. Configure a real monitored payment contact and assign the launch operator. Record the combined-bot eligibility review.
2. Confirm the Railway service by its public domain. Deploy its API/worker with TELEGRAM_STARS_ENABLED=0 and TON Mini App enabled. Preserve the existing KV database, namespace, encryption key and primary bot credentials.
3. Deploy Vercel web against this same API origin. Check /telegram, /ton-miniapp, /wallet-link, the real JSON manifest and PNG icon. The Mini App and wallet-link routes stay out of search indexing; /telegram is public.
4. Inspect both chat and TON status/catalog views using telegram-readiness.mjs --view chat|ton --stage paused. Check the shared username and /v1/telegram/webhook path. Prices hidden in a paused catalog are expected.
5. Dry-run telegram-setup.mjs --stage paused from an explicit production operator environment. Once the deployed views and manifest pass, use --apply to set the name, commands, paused descriptions, command menu and one payment webhook. The script checks readiness before writes and does not enable sales. For an existing live bot's navigation-only update, use `--menu-only --apply` instead: it preserves webhook, profile and sales stage. Keep Main Mini App enabled for the separate profile launcher.
6. Complete manual BotFather settings on @pulsemi_bot: name PULSE, avatar, disabled groups/inline, enabled privacy, Main Mini App /ton-miniapp, loading appearance and actual TON screenshots. Follow the detailed guide; no second bot is created.
7. Run --status. Confirm matching identity/menu/webhook, Main Mini App enabled and allowed update types message, callback_query, pre_checkout_query. Preserve pending updates; successful_payment arrives within message.
8. Open the chat/menu/Main Mini App from iOS, Android and Desktop. Verify the unsigned browser preview cannot purchase and both entry points lead to the same PULSE bot account.
9. During a staffed controlled acceptance window, set TELEGRAM_STARS_ENABLED=1 in the API host and operator environment. There is no tester allowlist. Keep public acquisition closed until acceptance passes.
10. Run readiness for both views with --stage checkout. Chat must expose all five approved prices; TON must expose Quick 10 and Pro 15 with the other services disabled. Run setup --stage checkout --apply to replace paused profile copy once those deployed checks pass.
11. Complete the real purchase/recovery/refund matrix below. Record actual client/provider evidence and the release identifier. A technical checker does not substitute for these cases.
12. Preview metadata and every marketing destination, run an isolated restore drill, review measured costs, then release the approved launch assets and staffed public window.

Setup writes are sequential, not transactional. If an action fails, inspect the completed-step report and --status before resuming. Never drop pending payment updates in rollout or rollback. Keep receipt handling, paid-job fulfillment and account history online while sales are paused.

## 5. Acceptance matrix and evidence

Use two Telegram accounts, two EVM wallets, iOS, Android and Desktop. Record client versions, release ID, service/input, order ID, charge ID in restricted evidence, observed result and operator. Never put signed initData, secret headers, ownership capabilities or private report links into public tickets.

| Case | Procedure | Pass condition |
| --- | --- | --- |
| Five live services | Buy each service using a valid supported input; 65 Stars total for one of each | Exact price, one charge, one job, correct tier/report, readable library and notification |
| TON Mini App tiers | Buy TON-USDT Global Quick and Global Pro from this bot’s Mini App; 25 Stars total | Same bot receives complete documents; chat library includes both; TON library excludes EVM/chat orders |
| Quick versus Pro | Use comparable supported inputs in both tiers | Actual content depth matches the advertised distinction |
| Close after payment | Close before generation finishes; reopen on another device | Same account recovers the same purchased result; no second checkout needed |
| Cancel checkout | Cancel native invoice, then reopen library | No settled purchase or generation caused by cancellation |
| Expired checkout | Use an invoice older than 15 minutes | Rejection before charging; new invoice creation remains possible |
| Signed session expiry | Leave Mini App open beyond one hour | Auth failure asks user to reopen, not relink wallet or pay again |
| Duplicate callback | In staging replay authenticated fixtures for the same paid order | One settled receipt/job; no duplicate bill or generation |
| Crash recovery | In staging interrupt after saved charge, before job attachment | Reading the owned order repairs fulfillment using the existing payment |
| Pause new sales | Pause while an existing paid job is pending | New checkout blocked; paid generation/recovery/refund still works |
| Failed generation | Inject terminal failure in staging; exercise a controlled live case if feasible | No report, owned refund succeeds once, Stars return, library marks refund |
| Cross-account isolation | Account B requests A's order/link/refund | Rejected without disclosing A's report or association |
| Direct Mini App launch | Open ?startapp before starting a bot chat; allow messages, then purchase. Also test declining the prompt | Native message permission precedes invoice creation; denial creates no invoice; permitted purchase delivers to the same bot chat |
| Browser preview | Open Mini App outside Telegram | Clearly marked preview; no purchasing with unsigned identity |
| Invalid input | Unsupported pair, missing market, malformed contract | Rejected before invoice creation with useful correction |
| Delivery interruption | Temporarily fail delivery in staging | Report stays in library; durable retry resumes independently |

Real purchases test integration; mocks test failure paths safely. Do not fabricate duplicate Telegram payment events against production or intentionally damage live stores. If a real refund path cannot yet be exercised safely, record that gap and keep broad launch closed.

### Persistent EVM wallet cases

1. Link wallet A: browser signature alone must not bind it; confirm the exact address from the authenticated Telegram account.
2. Close Telegram and the Mini App, disconnect the browser wallet, restart the bot, reopen from another phone, and redeploy the API. The same saved association must remain. A network/storage failure must show an error instead of an empty account state.
3. Begin change to B and abandon it: A remains associated. Sign B and confirm: replacement occurs once and A's imported history is no longer exposed through the Telegram association.
4. Restart a pending link: old browser capability fails. Test a capability older than 10 minutes. Another Telegram account cannot complete the confirmation.
5. Wallet A already belongs to account A: account B cannot claim it. Wallet ownership alone cannot bypass the existing account binding. Recovery requires an explicit support policy; do not silently steal or reassign an association.
6. Verify old paid website/mobile-wallet reports appear within original job/report retention. This is account-authorized history lookup, not upload or migration. Test each actually populated network.
7. Explicit unlink removes Telegram access to wallet history and preserves Stars orders. Check browser access remains valid. Previously issued bearer report shares have their own revocation policy; unlink is not universal share revocation.
8. On the main website, connect the wrong browser wallet and verify account-specific trading is blocked for that account. The correct wallet must still review and sign separately. Do not place a real trade merely to prove navigation.

Contract wallets using ERC-1271 are not supported by the current proof verifier. Document that limitation before asking such users to link; do not imply all wallet types work.

## 6. Monitoring, support and incidents

The following dashboard/alerts are launch requirements to implement or configure, not claims of an installed monitoring system.

| Signal | Proposed initial trigger | Response |
| --- | --- | --- |
| Webhook transport | Any sustained error or pending-update growth for 5 minutes | Inspect API reachability/secret, preserve pending updates |
| Pre-checkout latency | p95 above 5 seconds or repeated deadline rejection | Inspect KV/Bot API; pause new sales if worsening |
| Paid without job | Older than 2 minutes | Reconcile existing order/charge; recover without rebilling |
| Report failures | More than 5% over 50 settled orders, or 3 consecutive failures | Pause sales, inspect providers, offer eligible refunds |
| Wallet ownership anomaly | Any cross-account disclosure or unexpected association replacement | Stop affected account surface; preserve records and escalate |
| Refund ambiguity | Telegram success but local status not saved | Inspect transaction history before retrying; mark operator reconciliation |
| Delivery backlog | Oldest due task over 10 minutes and increasing | Restore delivery; keep library accessible |
| Unit margin | Any service has negative measured contribution | Stop buying traffic; review costs before changing prices |

Use Telegram `getStarTransactions` and the owned order/receipt ledger for reconciliation. An operator may need to page through history; export a restricted daily ledger and compare charges, refunds and job outcomes. There is no finished reconciliation console in this change. Do not implement an emergency workflow by accepting an arbitrary client-supplied charge ID. [Bot API transaction history and refunds](https://core.telegram.org/bots/api#getstartransactions).

### Support coverage and refund rules

Before launch, publish an actual monitored contact and connect `/paysupport` to a human workflow. Current support copy routes users back to the bot; it is not a staffed inbox by itself. Assign coverage for launch plus the next 48 hours. Proposed response targets: payment acknowledgement within 4 staffed hours; resolution/update within one business day. Publish the actual timezone and coverage, using Europe/Samara if that is the operating team's schedule.

Ask for order ID, approximate purchase time, service and issue. Do not request seed phrases, keys, signatures, raw initData or public posting of report links. Check verified account ownership through the authenticated workflow.

- Pending generation: recover the existing paid order; do not ask for another purchase.
- Terminal failed/manual-reconciliation job without a report: use the owned Stars refund endpoint, which calls `refundStarPayment` under a processing lock.
- Completed report/content complaint: automatic refund is not available in the current implementation; route to the published human policy and applicable consumer requirements. Do not promise a blanket no-refund rule.
- Missing historic wallet report: check correct association and original retention. Wallet-funded reports cannot be refunded through the Stars endpoint.
- Storage unavailable: explain temporary recovery outage; do not unlink or overwrite the account.

Publish privacy policy covering Telegram ID, wallet association consent, purchase identifiers, research inputs, retention and deletion requests. The current order metadata and association have no automatic expiry; the library displays the latest 30 Stars orders. Report bodies and jobs have separate configured retention. Document how an operator locates older purchases and handles archival/deletion; no self-service delete/export dashboard is implied.

### Rollback order

1. Pause new sales with `TELEGRAM_STARS_ENABLED=0`; stop marketing and paid campaigns.
2. Keep `FEATURE_TELEGRAM=1`, the payment webhook, queue worker, library and refunds operating where safe. Do not remove webhook or delete charge/account records for an ordinary rollout failure.
3. Record the incident window and reconcile received payments. If storage is down, restore it before attempting ad hoc fulfillment.
4. Revert UI separately if possible. Do not blindly roll API back to a pre-Stars version that cannot process pending payments. Use a compatible prior release or a forward fix.
5. On credential compromise, contain access, rotate affected credentials and coordinate webhook/header update. Expect a delivery interruption and verify recovery afterward. Preserve the existing report encryption key unless a supported re-encryption migration is performed.
6. Re-run affected acceptance cases and obtain the named launch owner's signoff before reopening sales. Publish a factual status update through the approved communication process.

## 7. Launch stages

| Stage | Timing relative to Day 0 | Scope | Exit gate |
| --- | --- | --- | --- |
| Scope and staging | D-14 to D-8, extend if needed | Product path, content review, isolated payment/account tests, cost instrumentation | No unresolved platform/ownership blocker |
| Quiet production acceptance | D-7 to D-4 | Staffed real payment window; no marketing | Five live service cases, recovery/refund, stable deployed origins |
| Invited beta | D-3 to D-1 | Proposed 20-30 voluntary testers, capped acquisition | At least 50 settled orders; no critical defect; support handles all issues |
| Soft launch | D0 to D7 | Existing audience and a few approved communities; daily review | Positive contribution estimate and acceptable fulfillment/activation |
| Controlled acquisition | D8 to D30 | Small attributable creator/paid tests if permitted | Cohort-based repeat purchases and CAC meet the budget gate |
| Expansion | D31 to D90 | Winning channels/locales and measured UX improvements | Stable operations; funded support; sustained margin |

These stages are organizational, not an access-control feature. Invitations do not restrict who can purchase. Build an allowlist/rate-control feature if a technically closed beta is required. Current launch changes do not create one.

### Final launch record

Copy into a restricted release ticket:

```text
Release ID / commit:
Selected product path and scope decision:
Production frontend / verified API / bot username:
KV database and stable namespace (no credentials):
Report encryption key reference (not key material):
API / web deployment IDs and compatible rollback target:
Acceptance results, order IDs and restricted evidence location:
Support contact / staffed hours / incident owner:
Actual per-service cost and approved spend cap:
Open limitations / approved launch content:
Launch owner / approval time / planned Day 0:
```

## 8. Sources and review cadence

Platform references were checked October 3, 2026. Recheck before activation and before a new paid channel or wallet integration. Source links support platform facts; the proposed schedule, budgets and targets are PULSE planning assumptions.

- [Stars purchases](https://core.telegram.org/bots/payments-stars)
- [Mini App launch, SDK and authentication](https://core.telegram.org/bots/webapps)
- [Bot API](https://core.telegram.org/bots/api)
- [Developer terms](https://telegram.org/tos/bot-developers)
- [Blockchain guidelines](https://core.telegram.org/bots/blockchain-guidelines)
- [Telegram advertising guidelines](https://ads.telegram.org/guidelines)
