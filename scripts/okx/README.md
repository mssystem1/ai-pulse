# PULSE full-payload safe review runner

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
