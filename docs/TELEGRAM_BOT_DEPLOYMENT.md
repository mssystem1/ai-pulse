# PULSE Telegram deployment quick reference

Updated October 4, 2026. **One PULSE bot: @pulsemi_bot.** It offers all five research services in chat, permanent read-only EVM history linking and its TON Connect Mini App. Both purchase interfaces share the same token, account and webhook.

Use [the complete deployment runbook](PULSE_TELEGRAM_DEPLOYMENT.md) for Railway and Vercel steps, exact variables and ordering. Use [the detailed BotFather configuration](PULSE_BOTFATHER_SETUP.md) for every name, description, command, menu, Main Mini App and asset setting. These documents replace earlier configuration examples on this path.

## Exact entry points

| Setting | Value |
| --- | --- |
| Display name | PULSE |
| Existing username | @pulsemi_bot |
| Main website | https://www.ai-pulse.tech |
| Public Telegram page | https://www.ai-pulse.tech/telegram |
| Main Mini App / persistent menu | https://www.ai-pulse.tech/ton-miniapp |
| Profile launch link | https://t.me/pulsemi_bot?startapp |
| One payment webhook | https://<VERIFIED_API_ORIGIN>/v1/telegram/webhook |
| TON Connect manifest | https://www.ai-pulse.tech/tonconnect-manifest.json |

The last read-only inspection matched the bot's webhook to pulse-api-production-7aae.up.railway.app. Verify the Railway service by its public hostname before deploying; do not copy the other historical API origin into this release. Development localhost settings remain development settings.

## Deployment sequence

1. Set a real monitored TELEGRAM_SUPPORT_CONTACT, preserve existing token/webhook secret/KV database/namespace/report encryption key and complete the build checks in the full runbook.
2. Deploy the API with TELEGRAM_STARS_ENABLED=0, TON Mini App enabled and all five approved prices configured.
3. Deploy the web build with the same verified VITE_API_URL. Confirm the actual TON Connect JSON manifest and PNG icon are served, rather than an HTML fallback.
4. Verify both chat and TON status/catalog views in the paused stage.
5. Preview the one-bot configuration, then apply it to this existing bot when the operator is ready:

```powershell
node --env-file=<OPERATOR_PRODUCTION_ENV> scripts/telegram-setup.mjs --stage paused
node --env-file=<OPERATOR_PRODUCTION_ENV> scripts/telegram-setup.mjs --stage paused --apply
node --env-file=<OPERATOR_PRODUCTION_ENV> scripts/telegram-setup.mjs --status
```

6. Finish the manual BotFather settings from the full configuration guide: same existing bot, display name PULSE, avatar, command list, disabled groups/inline mode, enabled privacy and Main Mini App. The chat menu uses commands; Mini App launch stays in the profile and welcome message. For a navigation-only update after deployment, use `node scripts/telegram-setup.mjs --menu-only --apply` without changing webhook or sales stage.
7. Run the read-only readiness command for both --view chat and --view ton. It proves only its performed technical checks.
8. In a staffed acceptance window, enable Stars and use --stage checkout to verify/update availability copy. There is no tester allowlist; do not publicly promote until acceptance passes.
9. Buy one of each chat service (65 Stars) and both TON tiers (25 Stars), then verify document delivery, shared account recovery, wallet persistence and a failed-report refund. Record real client/provider evidence.

The setup script checks the deployed identity, both catalogs and the manifest before mutations. Its six Bot API writes are sequential, not transactional. After a partial failure, inspect --status and correct the reported step. Keep pending payment updates: allowed types are message, callback_query and pre_checkout_query; never drop the queue during rollout.

## Release and rollback

The combined bot's EVM proof/history and website links need review under [Telegram's connected-bot blockchain guidelines](https://core.telegram.org/bots/blockchain-guidelines). A TON-only Mini App screen does not independently approve the connected bot's other interactions. This preparation keeps the requested one-bot architecture and does not claim a platform approval.

For rollback, pause new Stars purchases and acquisition. Keep the existing payment webhook, paid-job fulfillment, library, refund recovery and saved wallet associations running. Do not delete receipts, reports or pending payment updates, and do not restore code unable to handle outstanding Stars orders.

The [rollout playbook](TELEGRAM_ROLLOUT_GUIDE.md) covers acceptance, incidents and economics. The [marketing strategy](PULSE_MARKETING_STRATEGY.md) and [operator kit](launch/README.md) contain the launch plan, drafts, evidence templates and workbook. Nothing in this file indicates that deployment or a paid campaign has happened.
