# PULSE · OKX.AI moderation and x402 replay

This runbook addresses the review feedback for existing PULSE agent **#8355**. Propose changes to that agent, not a duplicate. Updating or resubmitting requires explicit approval of the exact changes.

## Current integration review — September 11, 2026

The production API is `https://pulse-api-production-7aae.up.railway.app`; the web application is `https://www.ai-pulse.tech`. The registered eight services use the API's `/xlayer` prefix. The profile description and agreed catalog prices are correct and should remain unchanged.

Current non-spending REST/MCP checks: **268 passed, 0 failed, 12 valid-input Autopilot probes skipped** on X Layer/Arbitrum because no verified registered vault was provided. The previous approved Global Quick purchase delivered a final report after authenticated polling. Neither result proves all eight paid paths or resolves the evaluator's specific failed requests.

Two service-description changes need review before publishing:

1. **Global Quick/Pro and Prediction Quick/Pro:** explain asynchronous delivery, not merely a “recoverable report/job.” A successful new paid POST returns HTTP 202 with `job.id`, `recoveryToken` and `pollUrl`. Save the recovery token privately. Resolve `pollUrl` against the same API origin and GET it with `PULSE-RECOVERY-TOKEN: <recoveryToken>` until `job.stage` is `completed`, then GET `/v1/jobs/<job.id>/report` with the same header. MCP callers can use `job_status` and `job_report` with `jobId` and `recoveryToken`. An accepted job is not the final deliverable. Do not pay again while polling, and do not publish the token in logs or the listing. Risk Guard returns its report inline; do not describe it as requiring job polling.
2. **All three Autopilot passes:** replace the test-wallet owner/vault example with explicit caller-specific prerequisites and identifier discovery. `owner` is the paying wallet's EVM address, not PULSE's example wallet. `vault` is that owner's configured, funded, signed-and-registered X Layer Autopilot. Prepare it in `https://www.ai-pulse.tech/autopilot`, selecting X Layer. Discover existing accounts with `GET /v1/trading/accounts?network=xlayer&owner=<owner>` and verify registration with `GET /v1/autopilot/strategies?network=xlayer&owner=<owner>`. Funding alone does not register a strategy. If no eligible vault exists, finish owner-approved setup before requesting a pass. A pass purchase does not create a vault or grant another caller ownership of an example vault.

The logged-in Codespace wallet had no X Layer Autopilot vault at this review. Therefore an end-to-end pass purchase from that wallet requires separately authorized setup/funding first. Do not substitute the test wallet's vault into that buyer's paid request.

For Prediction inputs, use the free `/v1/polymarket/markets` or `/v1/polymarket/search` discovery routes, and validate the selected ID through `/v1/polymarket/markets/<encoded-market-id>` before quoting. A market ID in an example may stop being active. The currently published example resolved and its context data was available during this review; analysis is read-only and does not authorize trading.

For OKX CLI 4.5.3 REST payments, repeat all business parameters on **both** quote and pay. The observed replay did not inherit quote-time parameters. A missing-body 400 is not evidence of a successful charge; inspect the receipt and wallet transaction before attempting another payment. See [the verified paid-delivery evidence](AUTOPILOT_DEPLOYED_REVIEW.md#live-paid-delivery-result).

These are local review notes, not published listing changes. Preserve the approved profile description, eight service identities, prices and canonical endpoints. Present an exact description diff for approval before updating #8355. Historical material below documents the earlier token-scan review and must not be mistaken for the current eight-service paid acceptance result.

## Historical token-scan moderator run

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

The first `x402-check` should report `inputRequired: true`. The second should report `valid: true`, the currently advertised route price, X Layer, USDT0, and a non-empty `acceptsJson`. Do not reuse the historical $0.01 amount below. The public Token Risk Guard service is `/v1/preflight`, priced at $0.20; `/v1/token/scan` is a legacy API capability, not an additional public marketplace service.

## One controlled paid proof

Only run a task payment command inside a real test task after checking the job ID, provider ID, `acceptsJson`, endpoint, recipient, asset, current amount and explicit authorization. It signs and spends funds. The following token-scan result describes a historical acceptance run, not a current price or a new payment instruction.

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

For current non-spending REST/MCP validation:

```bash
node scripts/asp-compliance.mjs "$PULSE_URL"
```

This checks all eight public services without spending. It no longer loads wallet credentials or supports live-payment flags. Provide an active `--market-id` and registered `--owner` / `--vault-xlayer` / `--vault-base` / `--vault-arbitrum` for the valid-input challenge probes. Unpaid challenges do not prove paid delivery; perform that acceptance step separately with a freshly verified quote and explicit authorization.

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
