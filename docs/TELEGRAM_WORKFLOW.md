# PULSE Telegram implementation and account workflow

Updated October 4, 2026. The implementation uses **one bot, @pulsemi_bot**, one bot token, one Telegram account identity and one secret-verified webhook. Chat provides all five services and retained EVM wallet history; the TON Mini App provides a focused TON research and TON Connect interface.

For operator instructions use [BotFather setup](PULSE_BOTFATHER_SETUP.md), [deployment](PULSE_TELEGRAM_DEPLOYMENT.md), [rollout acceptance](TELEGRAM_ROLLOUT_GUIDE.md) and [marketing](PULSE_MARKETING_STRATEGY.md). The following describes local code, not completed production acceptance.

## Customer flow

| Entry | Purchase | Recovery | Wallet use |
| --- | --- | --- | --- |
| PULSE private chat | Global Quick 10, Risk Guard 15, Prediction Quick 10, Global Pro 15, Prediction Pro 15 Stars | All owned Telegram purchases plus retained reports from the linked EVM wallet | Read-only EVM history association; initial ownership proof and chat confirmation |
| This bot's TON Mini App | TON-USDT Global Quick 10 or Global Pro 15 Stars | Owned TON Mini App orders only | Optional TON Connect connection; does not replace the EVM history wallet |
| Main website/mobile wallet browser | Existing website payment and execution workflow | Existing wallet-owned report history | User-controlled wallet; trades require their own approval |

1. Press Start in PULSE, choose a service and send its requested supported pair/timeframe, network/token contract or selected prediction-market input. Chat drafts expire after ten minutes; changing a draft does not change the account wallet.
2. Review the exact Stars invoice. No wallet transaction is needed for Stars checkout. Canceling or selecting a service does not start generation.
3. Telegram sends pre-checkout and successful_payment to /v1/telegram/webhook. The server verifies the secret, private account, owned order, invoice age, amount and currency. Successful payment is a message update, not another webhook endpoint.
4. Persist the charge and recoverably attach exactly one durable PULSE report job. If the process stops after receipt persistence, owned order recovery repairs fulfillment without another purchase.
5. Generate the normal service report and save it privately. Deliver a compact formatted overview and all curated research sections in a labelled TXT document to the same PULSE chat. Global Pro and mapped Prediction Pro attach a PNG of their saved chart snapshot when valid candle data exists. Chart delivery retries independently of already confirmed document/overview delivery. TON notifications link to the same bot's Mini App; chat reports can use a revocable browser share when sharing is enabled.
6. My reports reads server-owned order/history indexes. Global entries include pair and timeframe; Prediction entries identify the market; Risk Guard identifies the contract and network. Service, readable status and date distinguish repeated purchases. Reopening applies the same presentation to retained reports, including linked-wallet history, without regenerating or charging. The TON Mini App uses the same curated sections, TXT download and expandable chart. Another Telegram account cannot read, refund or claim the order. A reopened browser preview cannot purchase using unsigned identity.
7. Terminal failed research without a report can request an owned Stars refund under a processing lock. Pending reports should be recovered, not repurchased. Content complaints need the published human support policy.

## Permanent EVM history association

The association belongs to the Telegram account, not to a browser session, WalletConnect session or selected network.

1. Choose History wallet or /wallet in chat. The bot issues a short-lived browser capability. An existing address stays associated while a replacement is pending.
2. Open /wallet-link in the user's browser or wallet browser. Connect the EVM wallet and sign the scoped ownership challenge. This is a message signature, not an asset transfer or approval.
3. Return to the same Telegram account and confirm the exact proved address in chat. Browser proof alone cannot change the association.
4. Store the account-to-address association server-side without a session expiry. Disconnecting the browser wallet, closing the Mini App, changing Telegram clients and restarting the API must not unlink it.
5. On history reads, use that saved address to recover eligible paid reports from existing wallet/network indexes. No new wallet transaction, chain switch or report upload is required. Original retention still applies.
6. To replace it, prove and explicitly confirm the new address. To unlink, explicitly confirm the unlink action. These actions preserve Stars orders and original wallet-owned reports. Previously issued report shares follow their own revocation lifecycle.

A wallet already bound to another Telegram account cannot be claimed through proof alone. Storage errors must be shown as temporary errors, not as a missing wallet or an instruction to reconnect. Current proof supports EOA addresses; ERC-1271 contract-wallet verification is not implemented.

## TON Mini App and account separation

Open PULSE's profile/Main Mini App, the separate Launch PULSE Mini App button in the welcome message, the direct https://t.me/pulsemi_bot?startapp link, or the legacy /miniapp shortcut. The bottom-left Menu button lists commands rather than launching the app. /start and /menu show the control centre; Global/Prediction open Quick/Pro submenus, with reports, wallet history, settings, support, help and legal information accessible by buttons. The exact URL is https://www.ai-pulse.tech/ton-miniapp. The legacy /miniapp route renders this TON interface.

Before TON checkout, the Mini App requests Telegram message permission when it is not already present. Declining or an unsupported client stops before invoice creation. The signed TON API verifies PULSE's Telegram initData with the primary bot token. It limits new requests to TON-USDT Global Quick/Pro and rejects EVM wallet linking, EVM execution handoffs and non-TON report reads/refunds. The TON Connect SDK manages its connection session; durable server-verified TON wallet ownership is not implemented. Purchasing with Stars and recovering TON orders uses the verified Telegram account, so report access does not depend on the wallet staying connected.

TON orders carry surface=ton but use the same canonical report payer telegram:<userID>. They are indexed in both the main Telegram order library and the filtered TON library. Chat orders and EVM wallet reports stay out of the TON API. Both interfaces send payments and documents through the same bot.

## API map

| Route | Access / behavior |
| --- | --- |
| GET /v1/telegram/status | Public one-bot status, mode pulse |
| GET /v1/telegram/services | Public catalog for five chat services; paused prices are hidden |
| POST /v1/telegram/webhook | The only Telegram webhook; verifies X-Telegram-Bot-Api-Secret-Token |
| GET /v1/telegram/ton/status | Public TON view, same username/token/webhook |
| GET /v1/telegram/ton/services | Public catalog; active TON Global tiers, other services disabled |
| GET /v1/telegram/ton/session | Signed Mini App account; wallet is not required for purchase |
| POST /v1/telegram/ton/orders | Signed Mini App input validation and Stars invoice creation |
| GET /v1/telegram/ton/orders | Signed owned TON order library |
| GET /v1/telegram/ton/orders/:id | Signed owned TON result/recovery |
| POST /v1/telegram/ton/orders/:id/refund | Signed owned failed TON report refund |
| POST /v1/telegram/wallet-link/challenge | Short-lived browser capability plus exact wallet |
| POST /v1/telegram/wallet-link/signature | Browser capability and scoped EOA ownership signature |

The Mini App header is PULSE-TELEGRAM-INIT-DATA. The main /session, /orders and /wallet Mini App API paths are blocked: native chat handles its orders and account confirmation instead. There is no /v1/telegram/ton/webhook. User-supplied account IDs, charge IDs or wallet strings do not establish access.

## State, durability and delivery

- Commerce receipt, order indexes, association and pending-link state use durable KV in production. Memory-only stores are test helpers.
- Chat and TON views share account/order state and payment locks. Existing primary receipt/idempotency keys are preserved.
- Report jobs retain encrypted storage and existing worker/provider validation. Do not change production database, namespace or encryption key during the rollout.
- Replayed payment events recover the same receipt/job. Invoice creation and payment are separate states; an invoice URL alone is not a settled order.
- Document delivery and summary delivery retry independently of report generation. Existing paid jobs, order reads and refunds continue while new sales are paused.
- Delivery queue keys use fixed pulse:v6:telegram:* prefixes. A different general namespace alone does not isolate these records; use isolated KV for staging exercises.
- A signed delivery capability identifies a chat destination only. It does not authenticate history, authorize a trade or charge a wallet.

## Source and verification

Core files: apps/api/src/telegram.ts, telegramBotChat.ts, telegramCommerce.ts and telegramWalletLink.ts; apps/web/src/TelegramExperience.tsx, TelegramGuide.tsx, TelegramTonMiniApp.tsx and TelegramWalletLinkPage.tsx. TelegramLanding is the separate website introduction at www.ai-pulse.tech/telegram. The in-app Telegram workspace uses TelegramGuide: exact commands/input formats, Stars checkout, browser ownership proof plus chat confirmation, TON Connect, report recovery and payment help. The guide starts wallet linking from chat rather than connecting the current browser wallet automatically. V6Workspaces.tsx also documents the current user flow in Docs.

The single-bot integration test covers shared identity/webhook, five native chat services, filtered TON purchase/history, replay recovery, complete document delivery and rejected cross-account/EVM API access. Dedicated payment and wallet tests cover refunds, restoration and explicit address replacement. Setup/readiness tests cover paused deployment bootstrap and mutation-free rejection before misconfiguration.

Real iOS/Android/Desktop behavior, live Stars purchase/refund, full provider output and combined-bot platform eligibility still require recorded acceptance. [Telegram's blockchain guidelines](https://core.telegram.org/bots/blockchain-guidelines) cover the connected bot too; chat research text and EVM browser-proof/website interactions need distinct review. This does not change the requested one-bot design or claim Telegram approval.
