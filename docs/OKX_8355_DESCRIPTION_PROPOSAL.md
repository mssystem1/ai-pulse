# Agent #8355 — proposed service-description update

Status: Owner approved this exact proposal on September 11, 2026. All eight description updates were saved, and resubmission returned `submitApproval: [{approvalStatus: 2, success: true}]` (under review). Update transaction: `0xdd697538b37ed2fa061d866af2700958c35cc0a5f35b46e4d5baae547d91099e`. OKX CLI listing validation passed with no findings. No services were added or deleted; profile, endpoints and prices were unchanged. Marketplace approval is still pending.

The Codespace communication package was upgraded from 0.2.11 to 0.2.14. Its systemd stub returned success without starting a listener; direct startup with the CLI's supported `--no-autostart` option resolved this. Readiness then passed all eight checks. If the Codespace restarts, it may need direct listener startup again; do not assume the installed systemd unit works inside the container.

## Unchanged identity and commercial terms

Agent: #8355, PULSE, ASP. Existing image, owner, all eight names, service types, IDs, prices and endpoints are unchanged. Profile description (unchanged):

> PULSE brings market intelligence, risk analysis, and trading into one platform. Explore Global and Prediction Markets, evaluate tokens with Risk Guard, and place wallet-approved Spot Market or Limit orders. Launch Autopilot for autonomous trading—it monitors markets and executes your strategy within your chosen capital and risk limits. Your strategy. Your funds. Your control.

Only the eight serviceDescription fields below were updated, using the owner's approved text. All services remain A2MCP. Fees below are marketplace display prices; X Layer settles using USDT0.

## Changes to review

| Service | Current wording / example | Proposed correction |
| --- | --- | --- |
| Global Quick → Spot | Returns a recoverable report/job. | Specify HTTP 202, private recovery token, authenticated polling and final report retrieval; explain error handling and repeat request parameters on paid replay. |
| Global Pro → Spot | Returns a recoverable report/job. | Same explicit delivery and recovery instructions. |
| Prediction Quick | Recoverable report/job; selected active Polymarket market ID. | Same explicit delivery; add market-ID format and discovery/validation source. |
| Prediction Pro | Recoverable report/job; selected active Polymarket market ID. | Same explicit delivery; add market-ID format and discovery/validation source. |
| Risk Guard | Returns a recoverable report/job. | Correct to HTTP 200 inline JSON report, with no job polling; clarify exact contract address and failures. |
| Start Autopilot 24h | Paying Agentic Wallet address and configured vault, with hardcoded example wallet/vault. | Buyer-owned identifiers, setup and discovery sources, guarded variable-based curl, 24h and 3 new confirmations. |
| Start Autopilot 7d | Same hardcoded example wallet/vault. | Same ownership/setup corrections, 7d and 21 new confirmations. |
| Start Autopilot 30d | Same hardcoded example wallet/vault. | Same ownership/setup corrections, 30d and 90 new confirmations. |

The Autopilot examples intentionally require OWNER and VAULT from the buyer's own wallet and completed setup. There is no universal funded vault that every caller can legitimately use. They are unsigned challenge requests, not automatic payments or setup transactions. The Prediction example resolved during verification; callers must validate it is still active.

## Exact proposed descriptions

### Global Quick → Spot

Fee: 0.20 USDT (unchanged). Endpoint: `https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/spot/standard` (unchanged).

✏️ Drafted from the product's verified behavior — please review.

```text
1. [Service Description] Quick OKX spot intelligence with trend, entry scenarios, targets and invalidation. Mapped pairs can prefill wallet-approved Spot Market or Limit orders; this service does not execute trades. A new paid request returns HTTP 202 with job.id, recoveryToken and pollUrl. Resolve pollUrl against https://pulse-api-production-7aae.up.railway.app; GET it with PULSE-RECOVERY-TOKEN set to recoveryToken until job.stage=completed, then GET /v1/jobs/{job.id}/report with the same header for the final report. Keep the token private. HTTP 409 means not ready; 403 means the recovery token is invalid; retry a storage 503 GET later, not the payment. HTTP 400 requires corrected input before payment. Repeat the same business body on payment replay; do not repay a pending job.
2. [Parameter Spec] instId(string, required): live OKX spot pair such as BTC-USDT; timeframe(string, optional): OKX candle interval such as 1H or 4H, default 1H; lang(string, optional): en or zh, default en; userNote(string, optional): research focus, default omitted
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/spot/standard -H 'Content-Type: application/json' -d '{"instId":"BTC-USDT","timeframe":"1H","lang":"en"}'
```

### Risk Guard

Fee: 0.20 USDT (unchanged). Endpoint: `https://pulse-api-production-7aae.up.railway.app/xlayer/v1/preflight` (unchanged).

✏️ Drafted from the product's verified behavior — please review.

```text
1. [Service Description] Token due diligence using GeckoTerminal market/project evidence and OKX on-chain data, with a Grok risk report, score, limitations and explicit unknowns. The paid POST returns the report inline as HTTP 200 JSON; no job polling is required. Missing evidence remains unknown, not proof of safety. Not a contract audit or profit forecast. The unpaid example returns 402; repeat its JSON body on payment replay. Correct HTTP 400 input errors before paying; after a 5xx inspect payment status before retrying.
2. [Parameter Spec] tokenAddress(string, required): exact X Layer token contract, 0x followed by 40 hexadecimal characters, obtained from its official project or explorer; chainId(string, optional): chain ID, default 196; lang(string, optional): en or zh, default en
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/preflight -H 'Content-Type: application/json' -d '{"tokenAddress":"0x779ded0c9e1022225f8e0630b35a9b54be713736","chainId":"196","lang":"en"}'
```

### Prediction Quick

Fee: 0.20 USDT (unchanged). Endpoint: `https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/prediction/standard` (unchanged).

✏️ Drafted from the product's verified behavior — please review.

```text
1. [Service Description] Quick read-only intelligence for one Polymarket question: probability evidence, decision, risks and invalidation. No prediction-market trade is placed. A new paid request returns HTTP 202 with job.id, recoveryToken and pollUrl. Resolve pollUrl against https://pulse-api-production-7aae.up.railway.app; GET it with PULSE-RECOVERY-TOKEN set to recoveryToken until job.stage=completed, then GET /v1/jobs/{job.id}/report with the same header for the final report. Keep the token private. HTTP 409 means not ready; 403 means the recovery token is invalid; retry a storage 503 GET later, not the payment. HTTP 400 requires corrected input before payment. Repeat the same business body on payment replay; do not repay a pending job.
2. [Parameter Spec] primaryMarketId(string, required): active Polymarket ID in pm:0x plus 64 hexadecimal characters format, discover at https://pulse-api-production-7aae.up.railway.app/v1/polymarket/markets and verify /v1/polymarket/markets/{encodedId} is active before quoting; lang(string, optional): en or zh, default en
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/prediction/standard -H 'Content-Type: application/json' -d '{"primaryMarketId":"pm:0xa467b14d51f01b957109d9cbb1d6c124fab2a089d52ed8f471d23c2812e743b7","lang":"en"}'
```

### Global Pro → Spot

Fee: 0.30 USDT (unchanged). Endpoint: `https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/spot/premium` (unchanged).

✏️ Drafted from the product's verified behavior — please review.

```text
1. [Service Description] Deeper OKX spot intelligence with scenarios, technical evidence, entry levels, targets and risk plans. Mapped pairs can prefill wallet-approved Spot Market or Limit orders; this service does not execute trades. A new paid request returns HTTP 202 with job.id, recoveryToken and pollUrl. Resolve pollUrl against https://pulse-api-production-7aae.up.railway.app; GET it with PULSE-RECOVERY-TOKEN set to recoveryToken until job.stage=completed, then GET /v1/jobs/{job.id}/report with the same header for the final report. Keep the token private. HTTP 409 means not ready; 403 means the recovery token is invalid; retry a storage 503 GET later, not the payment. HTTP 400 requires corrected input before payment. Repeat the same business body on payment replay; do not repay a pending job.
2. [Parameter Spec] instId(string, required): live OKX spot pair such as BTC-USDT; timeframe(string, optional): OKX candle interval such as 1H or 4H, default 1H; lang(string, optional): en or zh, default en; userNote(string, optional): research focus, default omitted
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/spot/premium -H 'Content-Type: application/json' -d '{"instId":"BTC-USDT","timeframe":"4H","lang":"en"}'
```

### Prediction Pro

Fee: 0.30 USDT (unchanged). Endpoint: `https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/prediction/premium` (unchanged).

✏️ Drafted from the product's verified behavior — please review.

```text
1. [Service Description] Deeper read-only intelligence for one Polymarket question: evidence, scenarios, probability assessment, risks and invalidation. No prediction-market trade is placed. A new paid request returns HTTP 202 with job.id, recoveryToken and pollUrl. Resolve pollUrl against https://pulse-api-production-7aae.up.railway.app; GET it with PULSE-RECOVERY-TOKEN set to recoveryToken until job.stage=completed, then GET /v1/jobs/{job.id}/report with the same header for the final report. Keep the token private. HTTP 409 means not ready; 403 means the recovery token is invalid; retry a storage 503 GET later, not the payment. HTTP 400 requires corrected input before payment. Repeat the same business body on payment replay; do not repay a pending job.
2. [Parameter Spec] primaryMarketId(string, required): active Polymarket ID in pm:0x plus 64 hexadecimal characters format, discover at https://pulse-api-production-7aae.up.railway.app/v1/polymarket/markets and verify /v1/polymarket/markets/{encodedId} is active before quoting; lang(string, optional): en or zh, default en
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/prediction/premium -H 'Content-Type: application/json' -d '{"primaryMarketId":"pm:0xa467b14d51f01b957109d9cbb1d6c124fab2a089d52ed8f471d23c2812e743b7","lang":"en"}'
```

### Start Autopilot 24h

Fee: 1.50 USDT (unchanged). Endpoint: `https://pulse-api-production-7aae.up.railway.app/xlayer/v1/autopilot/pass/24h` (unchanged).

✏️ Drafted from the product's verified behavior — please review.

```text
1. [Service Description] Start or extend 24h of prepaid autonomous-trading entry runtime with 3 new AI confirmations, for an existing owner-controlled X Layer Autopilot. First configure, fund and sign strategy registration at https://www.ai-pulse.tech/autopilot on X Layer; this purchase does not create a vault. Paid POST returns pass details. Manual pause freezes remaining time; expiry or exhausted confirmations blocks new AI entries, not deterministic protection on an unpaused vault. A paused vault needs a separate owner-signed resume. No Global report or automatic renewal. Unpaid POST returns 402; replay the same JSON body after payment. Correct 400 setup errors before paying; never use another wallet's vault. Set OWNER and VAULT below from the following sources.
2. [Parameter Spec] owner(string, required): paying wallet EVM address from that wallet, 0x plus 40 hexadecimal characters; vault(string, required): same owner's configured funded registered X Layer vault, 0x plus 40 hexadecimal characters, find at https://pulse-api-production-7aae.up.railway.app/v1/trading/accounts?network=xlayer&owner={owner} and verify /v1/autopilot/strategies?network=xlayer&owner={owner}; telegramDelivery(string, optional): chat-bound reminder capability, default omitted
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/autopilot/pass/24h -H 'Content-Type: application/json' -d "{\"owner\":\"${OWNER:?Set OWNER to your paying wallet address}\",\"vault\":\"${VAULT:?Set VAULT to your registered X Layer vault}\"}"
```

### Start Autopilot 7d

Fee: 10.50 USDT (unchanged). Endpoint: `https://pulse-api-production-7aae.up.railway.app/xlayer/v1/autopilot/pass/7d` (unchanged).

✏️ Drafted from the product's verified behavior — please review.

```text
1. [Service Description] Start or extend 7d of prepaid autonomous-trading entry runtime with 21 new AI confirmations, for an existing owner-controlled X Layer Autopilot. First configure, fund and sign strategy registration at https://www.ai-pulse.tech/autopilot on X Layer; this purchase does not create a vault. Paid POST returns pass details. Manual pause freezes remaining time; expiry or exhausted confirmations blocks new AI entries, not deterministic protection on an unpaused vault. A paused vault needs a separate owner-signed resume. No Global report or automatic renewal. Unpaid POST returns 402; replay the same JSON body after payment. Correct 400 setup errors before paying; never use another wallet's vault. Set OWNER and VAULT below from the following sources.
2. [Parameter Spec] owner(string, required): paying wallet EVM address from that wallet, 0x plus 40 hexadecimal characters; vault(string, required): same owner's configured funded registered X Layer vault, 0x plus 40 hexadecimal characters, find at https://pulse-api-production-7aae.up.railway.app/v1/trading/accounts?network=xlayer&owner={owner} and verify /v1/autopilot/strategies?network=xlayer&owner={owner}; telegramDelivery(string, optional): chat-bound reminder capability, default omitted
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/autopilot/pass/7d -H 'Content-Type: application/json' -d "{\"owner\":\"${OWNER:?Set OWNER to your paying wallet address}\",\"vault\":\"${VAULT:?Set VAULT to your registered X Layer vault}\"}"
```

### Start Autopilot 30d

Fee: 45.00 USDT (unchanged). Endpoint: `https://pulse-api-production-7aae.up.railway.app/xlayer/v1/autopilot/pass/30d` (unchanged).

✏️ Drafted from the product's verified behavior — please review.

```text
1. [Service Description] Start or extend 30d of prepaid autonomous-trading entry runtime with 90 new AI confirmations, for an existing owner-controlled X Layer Autopilot. First configure, fund and sign strategy registration at https://www.ai-pulse.tech/autopilot on X Layer; this purchase does not create a vault. Paid POST returns pass details. Manual pause freezes remaining time; expiry or exhausted confirmations blocks new AI entries, not deterministic protection on an unpaused vault. A paused vault needs a separate owner-signed resume. No Global report or automatic renewal. Unpaid POST returns 402; replay the same JSON body after payment. Correct 400 setup errors before paying; never use another wallet's vault. Set OWNER and VAULT below from the following sources.
2. [Parameter Spec] owner(string, required): paying wallet EVM address from that wallet, 0x plus 40 hexadecimal characters; vault(string, required): same owner's configured funded registered X Layer vault, 0x plus 40 hexadecimal characters, find at https://pulse-api-production-7aae.up.railway.app/v1/trading/accounts?network=xlayer&owner={owner} and verify /v1/autopilot/strategies?network=xlayer&owner={owner}; telegramDelivery(string, optional): chat-bound reminder capability, default omitted
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/autopilot/pass/30d -H 'Content-Type: application/json' -d "{\"owner\":\"${OWNER:?Set OWNER to your paying wallet address}\",\"vault\":\"${VAULT:?Set VAULT to your registered X Layer vault}\"}"
```

## Evidence and limits

The production non-spending runner previously passed 268 checks with zero failures and 12 Autopilot valid-input probes skipped. One approved Global Quick purchase completed authenticated final-report retrieval. No new paid test was made while drafting this update. Listing validation checks description compliance; it does not prove all eight paid workflows or guarantee marketplace approval. The Codespace wallet still requires its own configured funded registered X Layer vault before an Autopilot paid acceptance test.

References: [OKX A2MCP guide](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp), [seller SDK](https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk), and [production review](AUTOPILOT_DEPLOYED_REVIEW.md).

After explicit approval of this exact proposal, update the existing eight services by their current IDs and resubmit the same agent if its returned state requires activation. Do not change the profile description, create another agent, spend funds, or change Autopilot configuration as part of that operation.
