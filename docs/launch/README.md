# Launch operator kit

These files support the [rollout playbook](../TELEGRAM_ROLLOUT_GUIDE.md) and [marketing strategy](../PULSE_MARKETING_STRATEGY.md). They do not deploy, change Telegram, purchase reports or publish campaigns.

The release uses one PULSE bot for both chat and the TON Mini App. Start with [BotFather configuration](../PULSE_BOTFATHER_SETUP.md) and [deployment](../PULSE_TELEGRAM_DEPLOYMENT.md). Use `telegram-setup.mjs --stage paused|checkout` and `telegram-readiness.mjs --view chat|ton`. Both views verify the same identity/webhook. [Railway](telegram-railway.env.example) and [Vercel](telegram-vercel.env.example) templates contain placeholders/public settings only.

Read the [release-status note](release-status.md) for completed local verification, the website/guide/Mini App distinction, and the remaining deployment sequence. It records preparation status, not live acceptance or launch approval.

## Read-only readiness inspection

```powershell
node scripts/telegram-readiness.mjs --help
node scripts/telegram-readiness.mjs --offline --view chat
node scripts/telegram-readiness.mjs --offline --view ton
node --env-file=<OPERATOR_PRODUCTION_ENV> scripts/telegram-readiness.mjs --api-origin https://<VERIFIED_API_ORIGIN> --stage paused
node --env-file=<OPERATOR_PRODUCTION_ENV> scripts/telegram-readiness.mjs --api-origin https://<VERIFIED_API_ORIGIN> --stage checkout
```

Run from repository root with Node 22. Replace angle-bracket placeholders; they are not literal filenames/hosts. Without an operator env file, the script reads local `.env`, which may intentionally contain development URLs. Such a failure means the operator expectations are unsuitable for production inspection; it does not prove deployed cloud variables are wrong. The Node `--env-file` values and existing process environment take precedence over fallback local `.env`; use a clean process without unrelated overrides.

Offline mode makes no network requests. Live mode sends only GET requests to public status/catalog/TON manifest and Telegram `getMe`/`getWebhookInfo`, with timeouts and no redirects. It validates exact service IDs/prices, identity, webhook URL/update types, sales state and local durability/origin expectations. It never prints credentials or raw Bot API errors. `--stage paused` expects hidden catalog prices because paused sales deliberately suppress prices in the public catalog.

Exit 1 indicates a technical check failed. Exit 0 means only that the performed technical checks passed: warnings and manual launch gates may remain. `launchApproved` is always false. No checker can substitute for combined-bot eligibility review, real payments, ownership acceptance, human support, restore testing and measured economics. Inspect both views: chat checks all five services; TON checks the two active Global tiers, disabled chat-only services and the actual JSON manifest. Real client acceptance remains required.

Tests: `node --test scripts/telegram-readiness.test.mjs scripts/telegram-setup.test.mjs`.

## Acceptance evidence

Copy [acceptance-results.csv](acceptance-results.csv) into a restricted operator workspace. Record `pass`, `fail`, `not_run` or `not_applicable` with reason; add cases/device permutations from the playbook. Record each required chat/EVM and TON case; `not_applicable` needs a specific reason and cannot replace an untested retained feature. Do not commit populated order identifiers, charge identifiers or customer data. Use a restricted evidence reference rather than including bearer URLs or wallet signatures.

## Campaign registry

Copy [campaign-registry.csv](campaign-registry.csv) to track plans separately from approved/actual spending. All rows are drafts and amounts are blank. There are no creator agreements or campaigns behind these example codes. A code does not become attributable until the measurement work in the marketing strategy is implemented. Use cohort-specific proceeds/costs; do not attribute all company revenue to one campaign.

## Offline economics workbook

Open [pulse-launch-workbook.html](pulse-launch-workbook.html) in a browser. It is a standalone local artifact, not a public app route. Enter whole order/refund/buyer counts and measured total proceeds/costs in one accounting currency. Zero out unused services explicitly. The workbook calculates gross/net Stars, contribution, CAC, repeat rate and the proposed margin-based acquisition gate. It blocks a scale recommendation for incomplete/immature cohorts, impossible counts or negative service contribution.

Export JSON to keep a local record; closing the browser discards unexported values. Import accepts only the workbook schema and validates field lengths/numeric values without executing content. No network requests, third-party scripts, analytics or persistent browser storage are used. Keep private evidence and identifying customer data outside this aggregate workbook. A passing economics gate is not launch approval or spend authorization.
