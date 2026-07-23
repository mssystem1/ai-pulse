# PULSE · OKX.AI moderation and x402 replay

This runbook addresses the review feedback for existing PULSE agent **#8355**. Update and resubmit that agent; do not register a duplicate.

## What failed in the moderator run

The web application and the OKX.AI task flow exercise different clients:

- The web app already knows the token address and sends a paid `POST`.
- An OKX.AI task client first probes the listed endpoint to discover required business input.
- The moderator's security policy blocked commands containing the submitted `*.vercel.app` host. Therefore `x402-check` and `task-402-pay` never called PULSE.
- `direct-accept` only changes task/payment state. It does not call the ASP endpoint and cannot contain a PULSE scan result.
- For x402 tasks, the official client deliberately skips ASP `deliver/submit`. A successful `task-402-pay` replay returns `replayBody` inline and saves it locally for `task-deliverable-list`.

The missing deliverable was therefore the downstream consequence of a blocked replay, not evidence that the paid POST returned an empty report.

## Contract implemented by PULSE

The token-scan service now supports the complete agent flow:

1. `GET /v1/token/scan` returns HTTP `400` with `status: "input_required"`, `requiredAnyOf`, `fields`, and an `outputSchema`.
2. A malformed `POST` returns the same input contract before the payment gate. A buyer cannot pay for an unusable request.
3. A valid unpaid `POST` returns HTTP `402`, a `PAYMENT-REQUIRED` header with `accepts[]`, and a JSON `outputSchema` declaring a `POST` body.
4. A valid paid replay returns the complete token-risk report inline as JSON.
5. The successful OKX task replay becomes `replayBody`; the current Onchain OS task client then auto-saves that body as the task deliverable.

Required request:

```json
{
  "address": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
  "chainId": "196"
}
```

Expected paid response markers:

```json
{
  "service": "token_scan",
  "chainId": "196",
  "address": "0x...",
  "riskScore": 0,
  "grade": "A",
  "verdict": "PASS",
  "components": [],
  "limitations": [],
  "generatedAt": "..."
}
```

The values above illustrate the response shape; scores and verdicts depend on the requested address.

## Production hostname

Do not resubmit a `*.vercel.app` endpoint. The moderator identified that literal host as blocked by a buyer-side security policy.

PULSE now uses this split production topology:

- Web app: `https://pulse-puce-nu.vercel.app`
- Marketplace API: `https://pulse-api-production-8d1f.up.railway.app`
- Token-scan service: `https://pulse-api-production-8d1f.up.railway.app/v1/token/scan`
- MCP: `https://pulse-api-production-8d1f.up.railway.app/mcp`
- Metadata: `https://pulse-api-production-8d1f.up.railway.app/v1/metadata`

Set Railway `BASE_URL=https://pulse-api-production-8d1f.up.railway.app`. Set Vercel
Production `VITE_API_URL` to the Railway origin and redeploy if the browser should
share the marketplace backend; leaving it unset keeps the web app on its functional
same-origin Vercel rewrites. In both cases, agent #8355 must advertise only Railway
URLs. A custom domain can replace the generated Railway hostname later without
changing the architecture.

GitHub Codespaces is suitable for CLI validation but not production hosting:
forwarded ports depend on the codespace remaining active and their visibility/URL
can change.

On Railway, bind with `HOST=0.0.0.0` or omit `HOST`. Do not set `HOST=[::]`; the brackets are URL notation and cause Node to attempt DNS lookup of a hostname literally named `[::]`.

## Non-spending verification

Run these against the final non-Vercel hostname:

```bash
export PULSE_URL="https://pulse-api-production-8d1f.up.railway.app"
export TEST_TOKEN="0x779ded0c9e1022225f8e0630b35a9b54be713736"

curl -sS -i "$PULSE_URL/v1/token/scan"

curl -sS -i -X POST "$PULSE_URL/v1/token/scan" \
  -H "content-type: application/json" \
  --data "{\"address\":\"$TEST_TOKEN\",\"chainId\":\"196\"}"

onchainos agent x402-check \
  --endpoint "$PULSE_URL/v1/token/scan" \
  --agent-id 8355

onchainos agent x402-check \
  --endpoint "$PULSE_URL/v1/token/scan" \
  --agent-id 8355 \
  --body "{\"address\":\"$TEST_TOKEN\",\"chainId\":\"196\"}"

node scripts/asp-compliance.mjs "$PULSE_URL"
```

The first `x402-check` should report `inputRequired: true`. The second should report `valid: true`, `amountHuman: "0.01"`, X Layer, USDT0, and a non-empty `acceptsJson`.

## One controlled paid proof

Only run the task payment command inside a real test task after checking the job ID, provider ID, `acceptsJson`, endpoint, recipient, asset, and `0.01` amount. It signs and spends funds.

The important argument is:

```text
--body '{"address":"0x779ded0c9e1022225f8e0630b35a9b54be713736","chainId":"196"}'
```

Success criteria:

- `replaySuccess: true`
- `replayStatus: 200`
- `replayBody.service: "token_scan"`
- `replayBody.components` is an array
- `deliverableSavedPath` is present
- `task-deliverable-list` shows the saved text deliverable

Production settlement proof completed on 2026-07-23:

- Paid replay: `POST /v1/token/scan`
- Amount: `0.01` USDT0 (`10000` atomic units)
- Inline result: `service: "token_scan"`, `riskScore: 96.1`, components present
- Receipt status: success
- Transaction:
  `0x58283dc47cd8285a5e8a3ec99b10697482004bd09fb488dfee11ef1fe2e4aab2`
- X Layer block: `66052371`

For a direct x402 proof outside a marketplace task, deliberately enable the repository's single-payment check:

```bash
RUN_LIVE_PAY=1 node scripts/asp-compliance.mjs "$PULSE_URL"
```

That path performs one `$0.01` token scan. It no longer spends on both analysis tiers or invokes the server checkout.

## Resubmission gate for agent #8355

- Deploy the fixed commit.
- Confirm the custom/non-Vercel hostname serves the new input-discovery response.
- Confirm a valid unpaid POST returns the 402 challenge.
- Complete exactly one controlled paid replay and retain its transaction/replay output.
- Fetch agent #8355 and its current service ID.
- Modify the existing service endpoint; do not add a duplicate service.
- Review the exact before/after diff.
- Update agent #8355, then activate it with preferred language `en-US` to resubmit for review.

## Primary references

- [Onchain OS x402 task replay and automatic deliverable save](https://github.com/okx/onchainos-skills/blob/main/cli/src/commands/agent_commerce/task/user/accept.rs)
- [Onchain OS ASP delivery rule: x402 tasks use endpoint replay](https://github.com/okx/onchainos-skills/blob/main/cli/src/commands/agent_commerce/task/asp/deliver.rs)
- [Vercel custom-domain setup](https://vercel.com/docs/domains/set-up-custom-domain)
- [Railway public and custom domains](https://docs.railway.com/networking/domains/working-with-domains)
- [GitHub Codespaces port-forwarding lifecycle](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)
