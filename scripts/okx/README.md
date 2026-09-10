# PULSE payment verification

## Current direct endpoint check

Use the logged-in Codespace wallet, quote the exact service first, and obtain explicit approval of its price, network, token, recipient and business parameters. The verified Global Quick endpoint is `POST https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/spot/standard` (0.20 USDT0).

```bash
onchainos payment quote https://pulse-api-production-7aae.up.railway.app/xlayer/v1/analysis/spot/standard --method POST --param instId=BTC-USDT --param timeframe=4H --param lang=en
```

Important for CLI 4.5.3: REST replay drops quote-time business parameters unless they are repeated on `payment pay`. After approval, include the same `--param instId=BTC-USDT --param timeframe=4H --param lang=en` on that command. Do not change the approved request or weaken server-side input validation.

The local helper `live-delivery-check.mjs <codespace> <payment-id>` defaults to a non-paying dry run. Only after verifying the quote and obtaining approval, append `--execute-approved-payment`. It submits one payment for this exact BTC-USDT/4H/English request and follows the returned durable job through authenticated GET polling to final report retrieval. Recovery credentials remain in memory. It does not update listings, create marketplace tasks or submit reviews.

Never repeat payment after success, a timeout, or an uncertain settlement. Recover/check the existing job first. See [live verification evidence](../../docs/AUTOPILOT_DEPLOYED_REVIEW.md).

## Historical runner notes — do not use for the current catalog

The instructions and prices below describe a retired four-service workflow. They are not the current eight-service agent #8355 catalog, and the referenced runner is not present here. Do not run this workflow or use its old prices for current payments.

### Original full-payload safe review runner

This is the replacement for the unsafe runner that used:

```bash
onchainos agent task-402-pay --accepts ...
```

That old path reconstructed the payment request from only `accepts[]`. This
runner instead passes the complete base64 `PAYMENT-REQUIRED` challenge to:

```bash
onchainos payment pay --payload <FULL_CHALLENGE>
```

It then performs exactly one paid replay, saves the real response as a
deliverable, calls `direct-accept`, completes the marketplace task, and prompts
for honest feedback.

## First run: no payment

Copy `.env.example` to `.env` and keep:

```env
DRY_RUN=YES
```

Run:

```bash
node --check ./scripts/okx/pulse-review-full-payload-safe.mjs
node ./scripts/okx/pulse-review-full-payload-safe.mjs
```

Dry-run mode does not create tasks, sign payments, move funds, or leave reviews.

## Live run

Only after dry-run succeeds, set:

```env
DRY_RUN=NO
```

The four services require exactly:

- scan: 0.01 USD₮0
- preflight: 0.05 USD₮0
- base: 0.03 USD₮0
- premium: 0.06 USD₮0
- total: 0.15 USD₮0

The script validates the total balance before creating any task. It also asks
you to type `PAY` before every payment and `REVIEW` before every review.

## Safety behavior

- A paid HTTP request is never retried automatically.
- HTTP 402 after signing is treated as reconciliation-required because funds may
  already have moved.
- A task is never completed without a genuine saved deliverable.
- Feedback is never submitted before the marketplace task reaches `complete`.
- The full payment signature is not written to the report.
