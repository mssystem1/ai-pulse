# PULSE Telegram Bot Deployment Guide

This guide deploys the real PULSE Telegram adapter. The bot is a delivery and navigation channel; it never holds a wallet key. x402 payment and wallet signatures happen in the PULSE web application opened as a Telegram Mini App.

## 1. Prerequisites

- A production PULSE web origin such as `https://pulse.example.com`.
- A production API origin with `POST /v1/telegram/webhook` reachable over HTTPS.
- Working Global and Prediction report payments and durable jobs.
- Upstash KV and Vercel Blob configured for production.
- A Telegram account that will own the bot.

Do not deploy the bot against localhost. For local webhook testing, use a temporary HTTPS tunnel and remove it after the test.

## 2. Create the bot with BotFather

1. Open the verified `@BotFather` account in Telegram.
2. Send `/newbot`.
3. Enter the public display name, for example `PULSE Market Intelligence`.
4. Enter a unique username ending in `bot`, for example `PulseMarketBot`.
5. Copy the token once and store it in the API host's secret manager as `TELEGRAM_BOT_TOKEN`.
6. Send `/setdescription` and explain that PULSE provides paid Global and Prediction analysis through a non-custodial Mini App.
7. Send `/setabouttext` and add a short security statement: “Wallet signing happens only in the PULSE Mini App. Never share a seed phrase.”
8. Send `/setuserpic` and upload the approved PULSE bot avatar.

Never put the bot token in `VITE_*`, frontend configuration, source control, KV, Blob, a screenshot, or a Telegram message.

## 3. Configure the Mini App

1. In BotFather, send `/newapp` and choose the bot.
2. Set the title and description.
3. Upload production screenshots after the final interface is deployed.
4. Set the Web App URL to the public PULSE origin, for example `https://pulse.example.com`.
5. If BotFather offers a menu button, set it to open the same URL.
6. Add the web origin to the application's allowed origins and wallet-connector configuration.

PULSE appends `source=telegram`, a requested service, and a 35-day chat-bound HMAC delivery capability to Mini App links. The lifetime covers the longest 30-day Autopilot pass plus its reminder window. The capability can route a completed report or Autopilot expiry reminder to that chat; it cannot authorize a payment, wallet action, trade, or report purchase. The web application still obtains a normal wallet connection and x402 authorization.

## 4. Configure commands

In BotFather, use `/setcommands` and paste:

```text
start - Open PULSE services
global - Buy a Global Market report
prediction - Buy a Prediction Market report
reports - Open report delivery history
wallet - Link, inspect, or unlink a wallet
help - Security and usage guide
```

The webhook handles `/start`, `/global`, `/prediction`, `/reports`, `/help`, `/wallet`, and callback navigation through the same service keyboard. Service selection opens the normal Mini App report flow.

## 5. Set production environment variables

Generate a high-entropy webhook secret. One option is:

```powershell
[Convert]::ToHexString((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Set these only on the API/worker host:

```dotenv
FEATURE_TELEGRAM=1
TELEGRAM_BOT_TOKEN=<TOKEN_FROM_BOTFATHER>
TELEGRAM_BOT_USERNAME=<BOTFATHER_USERNAME_WITHOUT_@>
TELEGRAM_WEBHOOK_SECRET=<RANDOM_SECRET>
TELEGRAM_MINI_APP_URL=https://pulse.example.com
BASE_URL=https://api.pulse.example.com
```

Restart the API and verify:

```powershell
Invoke-RestMethod https://api.pulse.example.com/v1/telegram/status
```

Expected: `configured: true`, the production Mini App URL, and `custody: false`.

## 6. Register the webhook

Run the following from a secure operator terminal. Avoid saving the expanded command to shell history when possible:

```powershell
$botToken = '<BOT_TOKEN>'
$secret = '<WEBHOOK_SECRET>'
$webhookUrl = 'https://api.pulse.example.com/v1/telegram/webhook'
$body = @{ url = $webhookUrl; secret_token = $secret; allowed_updates = @('message','callback_query'); drop_pending_updates = $true } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$botToken/setWebhook" -ContentType 'application/json' -Body $body
```

Check it:

```powershell
Invoke-RestMethod "https://api.telegram.org/bot$botToken/getWebhookInfo"
```

Verify the exact URL, zero pending updates after a test, and no recurring `last_error_message`.

## 7. End-to-end bot test

1. Open the bot from a normal Telegram user account and press Start.
2. Confirm the service buttons render.
3. Send `/help`; verify the non-custodial warning.
4. Send `/wallet`; verify the signed-link explanation.
5. Open Global Market from the Mini App button.
6. Connect a test wallet, select a mainnet payment network, and purchase a Base report.
7. Confirm only one x402 charge occurs.
8. Confirm the durable report completes and can be reopened after closing Telegram.
9. Repeat with a Premium Prediction report and verify the 4H underlying chart when mapping is available.
10. Replay the same Telegram `update_id` in staging. The API must return `duplicate: true`, send no duplicate navigation response, and never produce a charge.
11. Temporarily make the Telegram API unreachable after a paid report completes. Confirm the report job remains completed and a `pulse:v6:telegram:delivery:*` task plus due-set member appears in KV.
12. Restore connectivity and confirm the retry worker delivers once, removes the task, and does not re-run payment or analysis.

## 8. Security and operations

- Telegram's `x-telegram-bot-api-secret-token` header must equal `TELEGRAM_WEBHOOK_SECRET`; all other webhook calls receive HTTP 401.
- Rotate a leaked bot token immediately with BotFather, replace the host secret, and re-register the webhook.
- Do not log full Telegram payloads, wallet signatures, x402 authorizations, or report access tokens.
- Rate-limit per Telegram user/chat and wallet before public launch.
- Bind report delivery to Telegram update ID, PULSE job ID, payment ID, and delivery ID in KV.
- Full report links are opaque, revocable, and bounded by configured report retention. They resolve through the API; a private Blob URL is never sent to Telegram.
- During a Telegram outage, paid jobs continue normally and delivery retries after recovery.

Delivery retries begin after 30 seconds and back off to a maximum one-hour interval. KV supplies seven-day queue retention, update replay protection, and a per-delivery worker lock. Monitor the `pulse:v6:telegram:due` sorted set and alert on growing age or repeated `lastError` values.

## 9. Disable or remove the bot

Set `FEATURE_TELEGRAM=0`, disable the webhook route at deployment, then remove the webhook:

```powershell
Invoke-RestMethod -Method Post "https://api.telegram.org/bot$botToken/deleteWebhook" -ContentType 'application/json' -Body '{"drop_pending_updates":true}'
```

Rotate/revoke the bot token if the bot will not return. Disabling Telegram must not delete purchased reports or payment evidence.
