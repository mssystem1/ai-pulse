# PULSE Telegram release status

Prepared October 4, 2026. The release is ready for review and paused deployment. No cloud deployment, Telegram configuration write, live Stars purchase, campaign publication or paid acquisition was performed during preparation. Use the Git commit containing this note as the release revision; obtain its identifier with `git log -1 --format=%h`.

## One bot and three pages

The product uses **PULSE, @pulsemi_bot**, one existing bot token, one secret-verified webhook at `/v1/telegram/webhook`, and one Telegram account identity for research purchases.

| Entry | Purpose | Current prepared content |
| --- | --- | --- |
| `https://www.ai-pulse.tech/telegram` | Website introduction | Bot benefits, five service/price cards, chat and TON Mini App explanation, PULSE website links |
| PULSE app → Telegram, `https://app.ai-pulse.tech/telegram` | Practical user guide | Start, exact commands/input formats, Stars checkout, EVM ownership proof and chat confirmation, TON Connect, report recovery and payment help |
| `https://www.ai-pulse.tech/ton-miniapp` | Actual Telegram Mini App | Explore, Reports and TON wallet tabs; signed Telegram identity for private reports/checkout; optional TON Connect |

The bot's chat offers Global Quick **10**, Risk Guard **15**, Prediction Quick **10**, Global Pro **15**, and Prediction Pro **15 Stars** per report. The TON Mini App offers TON-USDT Global Quick **10** and Global Pro **15 Stars**. Both deliver a summary and complete report document to the same PULSE chat. Chat My reports includes both purchase interfaces; the TON library includes the TON subset.

The saved EVM history wallet is associated with the Telegram account server-side. Browser ownership proof plus exact-address confirmation in chat saves or replaces it. Closing Telegram, disconnecting a browser wallet, or disconnecting TON does not remove that association. History reads require no transaction, new signature or network selection. Retained paid website reports are read from their existing storage; linking does not re-upload reports. Current ownership proof supports EOA wallets.

TON Connect manages the Mini App's TON wallet session. A permanent server-verified TON wallet ownership association is not implemented. Stars reports belong to the Telegram account and remain accessible after the TON session disconnects.

## Completed local verification

| Check | Recorded result |
| --- | --- |
| API build | Passed |
| API suite | 270 tests: 269 passed, 1 skipped, 0 failed |
| Web suite | 112 passed, 0 failed |
| Setup/readiness script tests | 15 passed, 0 failed |
| Production frontend build | Passed, including the dedicated in-app guide |
| Website browser review | Desktop/mobile layout, five cards, one bot identity and Mini App entry passed |
| In-app guide browser review | Desktop/mobile layout, five prices, command copying, help disclosures, anchors, direct application-domain entry and reload passed |
| TON browser review | Explore/Reports/wallet views, disabled unsigned checkout, no EVM connector imports or execution links, and message-permission gate passed |
| Review isolation | Telegram changes typechecked with the unrelated Autopilot source change excluded |
| Staged diff | Whitespace check passed; private env files and unrelated Autopilot edit excluded |

The browser review used a local server and mock Telegram SDK/invoice responses; its application-domain test emulated the production HTTPS secure context. These results do not establish real Telegram client behavior, a real payment, provider completion or cloud configuration. Existing dependency/chunk-size build warnings remain.

Local logs and screenshots are in ignored `.tmp/telegram-*` paths. Private credentials and populated customer/payment evidence are not part of this release. For fresh checks, use the commands in the [deployment runbook](../PULSE_TELEGRAM_DEPLOYMENT.md#5-local-verification-and-review).

## Remaining deployment sequence

1. Select the existing Railway API service and Vercel frontend project by their verified production domains. Record their current deployment IDs for rollback and preserve the production queue, namespace, wallet associations, encryption key and report store.
2. Supply the actual monitored `TELEGRAM_SUPPORT_CONTACT`. Merge the [Railway](telegram-railway.env.example) and [Vercel](telegram-vercel.env.example) excerpts into existing settings. Keep `TELEGRAM_STARS_ENABLED=0` for initial deployment.
3. Deploy the reviewed API and frontend through the normal release process. Verify both Telegram status/catalog views, all three frontend entries, the real JSON TON Connect manifest, and PNG assets.
4. Preview `telegram-setup.mjs --stage paused` using the private production operator env file. After deployment and authorization to publish bot settings, apply that same paused plan. It verifies both deployed views before changing the existing bot and retains pending updates.
5. Complete the [BotFather walkthrough](../PULSE_BOTFATHER_SETUP.md), including Main Mini App, profile text, avatar, commands and menu. The Main Mini App URL is `/ton-miniapp`, not either Telegram introduction/guide page.
6. Run read-only setup status and readiness for both chat and TON. Test retained wallet/report recovery while new Stars sales remain paused.
7. Schedule a staffed acceptance window. Enable Stars only when ready; there is no tester allowlist. Complete five chat purchases plus two TON purchases (**90 Stars total**), report delivery/recovery, eligible failure refunds, and iOS/Android/Desktop connection/restore checks. Store actual evidence privately using [acceptance-results.csv](acceptance-results.csv).
8. Complete the rollout's support, restore and platform eligibility gates before announcing launch. The selected one-bot design is preserved; platform approval is not claimed by this note.
9. Use the [marketing strategy](../PULSE_MARKETING_STRATEGY.md) and [campaign registry](campaign-registry.csv) after acceptance. Website UTM links exist; stored-order campaign attribution, an approved advertising budget, creator agreements and paid campaigns remain unimplemented/unapproved.

The [complete deployment runbook](../PULSE_TELEGRAM_DEPLOYMENT.md) contains the exact variables and commands. The [rollout playbook](../TELEGRAM_ROLLOUT_GUIDE.md) defines owners, acceptance, recovery and launch gates. Continue with paused deployment only after deployment is authorized; this note does not publish changes itself.
