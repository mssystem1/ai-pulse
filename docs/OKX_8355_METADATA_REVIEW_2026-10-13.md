# Agent 8355 metadata correction — review draft

Prepared from the fetched existing five-service catalog and explicitly approved by the user. The five description updates were applied in [transaction 0xd33afa…4836b](https://www.oklink.com/xlayer/tx/0xd33afa208882bc52e660fde6bfcf8aba5b1386c07f2fb8909838c62d0f74836b). Names, endpoints, fees, agent profile and the existing five-service scope are preserved. The original before/after review text is retained below.

Post-update verification matched all five descriptions, but generated input schemas/request examples remained stale and agent 8355 remained delisted/rejected. The user subsequently approved an English listing-review submission; that submission was accepted with review status 2. One subsequent read returned status 2 / approvalStatus 3 and unchanged generated schemas/examples; publication remains unconfirmed. See the [audit and outstanding checks](./ASP_DISCOVERY_AUDIT_2026-10-13.md).

Current private moderation feedback identifies non-delivery for Prediction Quick and Prediction Pro. Successful current direct tests do not establish the cause of those earlier buyer failures.

| Service | Current derived inputs | Required contract after correction |
| --- | --- | --- | --- |
| Global Quick → Spot | instId | instId, timeframe, lang |
| Risk Guard | tokenAddress | tokenAddress, lang |
| Prediction Quick | primaryMarketId | primaryMarketId, lang |
| Global Pro → Spot | instId | instId, timeframe, lang |
| Prediction Pro | primaryMarketId | primaryMarketId, lang |

The current schemas also contain an invalid Global timeframe example (`12:00`), a Prediction ID example (`test`), and a fake Risk Guard field (`langInlineJSON`). Correct four-line descriptions and runnable examples are prepared below. Derived marketplace schemas must be re-read after updating; successful description submission alone is not proof they refreshed.

## Global Quick → Spot

### Current description

1. [Service Description] Quick OKX spot intelligence with trend, entry scenarios, targets and invalidation. Mapped pairs can prefill wallet-approved Spot Market or Limit orders; this service does not execute trades. A new paid request returns HTTP 202 with job.id, recoveryToken and pollUrl. Resolve pollUrl against https://pulse-api-production-7aae.up.railway.app; GET it with PULSE-RECOVERY-TOKEN set to recoveryToken until job.stage=completed, then GET /v1/jobs/{job.id}/report with the same header for the final report. Keep the token private. HTTP 409 means not ready; 403 means the recovery token is invalid; retry a storage 503 GET later, not the payment. HTTP 400 requires corrected input before payment. Repeat the same business body on payment replay; do not repay a pending job.
2. [Parameter Spec] instId(string, required): live OKX spot pair such as BTC-USDT; timeframe(string, optional): OKX candle interval such as 1H or 4H, default 1H; lang(string, optional): en or zh, default en; userNote(string, optional): research focus, default omitted
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/spot/standard -H 'Content-Type: application/json' -d '{"instId":"BTC-USDT","timeframe":"1H","lang":"en"}'

### Proposed description

1. [Service Description] Global Quick provides 520 saved completed OHLCV candles, conditional moves, supported Elliott labels or Count unclear, and one aligned Spot plan. Market/Limit and eligible TP/SL are reviewed separately; no trade is executed. Ask pair/timeframe/language together. 202 is a receipt, not delivery. Keep recoveryToken private; GET pollUrl with PULSE-RECOVERY-TOKEN until job.stage is completed or completed_partial, then GET reportUrl (or /v1/jobs/{job.id}/report) with the same header. Resolve relative URLs against https://pulse-api-production-7aae.up.railway.app. Deliver every reportMarkdown section and disclose partial evidence. 409: poll later; 403: check the original token; storage 503: retry the free GET; failed jobs: read failure stage/guidance and retry only when offered. Never repay to recover. Repeat instId/timeframe/lang on CLI payment pay; quote knownParams are not replayed.
2. [Parameter Spec] instId(string, required): live OKX spot pair, example BTC-USDT; timeframe(string, required): selected 15m, 1H, 4H, 1D or 1W, example 1H; lang(string, required): selected en or zh, example en; userNote(string, optional): research focus, omitted by default
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/spot/standard -H 'Content-Type: application/json' -d '{"instId":"BTC-USDT","timeframe":"1H","lang":"en"}'

## Risk Guard

### Current description

1. [Service Description] Token due diligence using GeckoTerminal market/project evidence and OKX on-chain data, with a Grok risk report, score, limitations and explicit unknowns. The paid POST returns the report inline as HTTP 200 JSON; no job polling is required. Missing evidence remains unknown, not proof of safety. Not a contract audit or profit forecast. The unpaid example returns 402; repeat its JSON body on payment replay. Correct HTTP 400 input errors before paying; after a 5xx inspect payment status before retrying.
2. [Parameter Spec] tokenAddress(string, required): exact X Layer token contract, 0x followed by 40 hexadecimal characters, obtained from its official project or explorer; chainId(string, optional): chain ID, default 196; lang(string, optional): en or zh, default en
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/preflight -H 'Content-Type: application/json' -d '{"tokenAddress":"0x779ded0c9e1022225f8e0630b35a9b54be713736","chainId":"196","lang":"en"}'

### Proposed description

1. [Service Description] Onchain Pre-Trade Risk Guard returns synchronous HTTP 200 with the entire reportMarkdown and recoverable history for the selected token: contract, market, source coverage, risks and limitations. Deliver all sections. No trade is executed. Required inputs must be collected before payment and repeated on CLI payment pay. 400: correct parameters before quoting; 403: check the original recovery token; storage 503: retry the free history/report GET, never repay to recover. Missing provider evidence is disclosed.
2. [Parameter Spec] tokenAddress(string, required): selected EVM token address; chainId(string, optional): chain identifier, default 196, example 196; lang(string, required): selected en or zh, example en
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/preflight -H 'Content-Type: application/json' -d '{"tokenAddress":"0x779ded0c9e1022225f8e0630b35a9b54be713736","chainId":"196","lang":"en"}'

## Prediction Quick

### Current description

1. [Service Description] Quick read-only intelligence for one Polymarket question: probability evidence, decision, risks and invalidation. No prediction-market trade is placed. A new paid request returns HTTP 202 with job.id, recoveryToken and pollUrl. Resolve pollUrl against https://pulse-api-production-7aae.up.railway.app; GET it with PULSE-RECOVERY-TOKEN set to recoveryToken until job.stage=completed, then GET /v1/jobs/{job.id}/report with the same header for the final report. Keep the token private. HTTP 409 means not ready; 403 means the recovery token is invalid; retry a storage 503 GET later, not the payment. HTTP 400 requires corrected input before payment. Repeat the same business body on payment replay; do not repay a pending job.
2. [Parameter Spec] primaryMarketId(string, required): active Polymarket ID in pm:0x plus 64 hexadecimal characters format, discover at https://pulse-api-production-7aae.up.railway.app/v1/polymarket/markets and verify /v1/polymarket/markets/{encodedId} is active before quoting; lang(string, optional): en or zh, default en
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/prediction/standard -H 'Content-Type: application/json' -d '{"primaryMarketId":"pm:0xa467b14d51f01b957109d9cbb1d6c124fab2a089d52ed8f471d23c2812e743b7","lang":"en"}'

### Proposed description

1. [Service Description] Prediction Quick analyzes one selected active Polymarket question read-only: probability evidence, scenarios, entry/no-trade conditions, invalidation and limitations. Ask market/language together. Verify the selected question and orderbook before payment; never substitute another market. 202 is a receipt, not delivery. Keep recoveryToken private; GET pollUrl with PULSE-RECOVERY-TOKEN until job.stage is completed or completed_partial, then GET reportUrl (or /v1/jobs/{job.id}/report) with the same header. Resolve relative URLs against https://pulse-api-production-7aae.up.railway.app. Deliver every reportMarkdown section and disclose partial evidence. 409: poll later; 403: check the original token; storage 503: retry the free GET; failed jobs: read failure stage/guidance and retry only when offered. Never repay to recover. Repeat primaryMarketId and lang explicitly on CLI payment pay; quote knownParams are not replayed.
2. [Parameter Spec] primaryMarketId(string, required): pm:0x followed by 64 hexadecimal characters; choose from https://pulse-api-production-7aae.up.railway.app/v1/polymarket/markets and recheck the encoded ID detail before quoting; lang(string, required): selected en or zh, example en
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/prediction/standard -H 'Content-Type: application/json' -d '{"primaryMarketId":"pm:0x8717c39520cadcb8ad6f88af148c30acf7d044c92a9cf48416b9b9a5ed65d6d8","lang":"en"}'

## Global Pro → Spot

### Current description

1. [Service Description] Deeper OKX spot analysis with scenarios, technical evidence, entry levels, targets and risk plans; no trade execution. Ask for pair, timeframe and report language TOGETHER before payment; never silently default missing answers. Paid POST returns HTTP 202 with job.id, recoveryToken and pollUrl: this is a receipt, not the deliverable. Resolve pollUrl against https://pulse-api-production-7aae.up.railway.app and poll GET with PULSE-RECOVERY-TOKEN: recoveryToken until job.stage is completed or completed_partial. Then GET /v1/jobs/{job.id}/report with the same header and deliver the entire reportMarkdown, including every section, not just a summary or job ID. Disclose partial completion. Keep recoveryToken private. HTTP 400: correct input before payment; 409: keep polling; 403: check the original recovery token; storage 503: retry GET later. For OKX CLI payment pay, repeat all three inputs explicitly: --param instId=BTC-USDT --param timeframe=4H --param lang=en. Quote-time knownParams are not replayed automatically. Use the user-selected values; never repay a pending job.
2. [Parameter Spec] instId(string, required): live OKX spot pair, e.g. BTC-USDT; timeframe(string, required): user-selected candle interval, e.g. 1H or 4H; lang(string, required): user-selected report language en or zh; userNote(string, optional): research focus, omitted by default
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/spot/premium -H 'Content-Type: application/json' -d '{"instId":"BTC-USDT","timeframe":"4H","lang":"en"}'

### Proposed description

1. [Service Description] Global Pro adds independent higher-timeframe context and optional studies to 520 saved completed OHLCV candles, conditional moves, supported Elliott labels or Count unclear, and one aligned Spot plan. Market/Limit and eligible TP/SL are reviewed separately; no trade is executed. Ask pair/timeframe/language together. 202 is a receipt, not delivery. Keep recoveryToken private; GET pollUrl with PULSE-RECOVERY-TOKEN until job.stage is completed or completed_partial, then GET reportUrl (or /v1/jobs/{job.id}/report) with the same header. Resolve relative URLs against https://pulse-api-production-7aae.up.railway.app. Deliver every reportMarkdown section and disclose partial evidence. 409: poll later; 403: check the original token; storage 503: retry the free GET; failed jobs: read failure stage/guidance and retry only when offered. Never repay to recover. Repeat instId/timeframe/lang on CLI payment pay; quote knownParams are not replayed.
2. [Parameter Spec] instId(string, required): live OKX spot pair, example BTC-USDT; timeframe(string, required): selected 15m, 1H, 4H, 1D or 1W, example 1H; lang(string, required): selected en or zh, example en; userNote(string, optional): research focus, omitted by default
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/spot/premium -H 'Content-Type: application/json' -d '{"instId":"BTC-USDT","timeframe":"1H","lang":"en"}'

## Prediction Pro

### Current description

1. [Service Description] Deeper read-only intelligence for one Polymarket question: evidence, scenarios, probability assessment, risks and invalidation. No prediction-market trade is placed. A new paid request returns HTTP 202 with job.id, recoveryToken and pollUrl. Resolve pollUrl against https://pulse-api-production-7aae.up.railway.app; GET it with PULSE-RECOVERY-TOKEN set to recoveryToken until job.stage=completed, then GET /v1/jobs/{job.id}/report with the same header for the final report. Keep the token private. HTTP 409 means not ready; 403 means the recovery token is invalid; retry a storage 503 GET later, not the payment. HTTP 400 requires corrected input before payment. Repeat the same business body on payment replay; do not repay a pending job.
2. [Parameter Spec] primaryMarketId(string, required): active Polymarket ID in pm:0x plus 64 hexadecimal characters format, discover at https://pulse-api-production-7aae.up.railway.app/v1/polymarket/markets and verify /v1/polymarket/markets/{encodedId} is active before quoting; lang(string, optional): en or zh, default en
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/prediction/premium -H 'Content-Type: application/json' -d '{"primaryMarketId":"pm:0xa467b14d51f01b957109d9cbb1d6c124fab2a089d52ed8f471d23c2812e743b7","lang":"en"}'

### Proposed description

1. [Service Description] Prediction Pro analyzes one selected active Polymarket question read-only: probability evidence, scenarios, entry/no-trade conditions, invalidation and limitations, with underlying spot context when available. Ask market/language together. Verify the selected question and orderbook before payment; never substitute another market. 202 is a receipt, not delivery. Keep recoveryToken private; GET pollUrl with PULSE-RECOVERY-TOKEN until job.stage is completed or completed_partial, then GET reportUrl (or /v1/jobs/{job.id}/report) with the same header. Resolve relative URLs against https://pulse-api-production-7aae.up.railway.app. Deliver every reportMarkdown section and disclose partial evidence. 409: poll later; 403: check the original token; storage 503: retry the free GET; failed jobs: read failure stage/guidance and retry only when offered. Never repay to recover. Repeat primaryMarketId and lang explicitly on CLI payment pay; quote knownParams are not replayed.
2. [Parameter Spec] primaryMarketId(string, required): pm:0x followed by 64 hexadecimal characters; choose from https://pulse-api-production-7aae.up.railway.app/v1/polymarket/markets and recheck the encoded ID detail before quoting; lang(string, required): selected en or zh, example en
3. [Request Method] POST
4. [Request Example] curl -i -X POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/prediction/premium -H 'Content-Type: application/json' -d '{"primaryMarketId":"pm:0x8717c39520cadcb8ad6f88af148c30acf7d044c92a9cf48416b9b9a5ed65d6d8","lang":"en"}'


Official listing QA passed once with no findings. The approved update succeeded after the required Codespace communication repair. Description submission did not refresh generated schemas or change the listing state; a marketplace resubmission/moderation decision remains separate.
