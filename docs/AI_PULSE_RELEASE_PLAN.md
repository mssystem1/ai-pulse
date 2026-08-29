# PULSE V2 `ai-pulse` repository, deployment, and marketplace plan

PULSE V2 keeps the product name **PULSE**. Only its repository, cloud-project slug, and future domain use `ai-pulse`. PULSE v1 remains unchanged in `mssystem1/Pulse` and remains the OKX.AI Genesis hackathon entry until the event ends. PULSE V2 is published from a separate `mssystem1/ai-pulse` repository and separate Vercel and Railway projects.

## Repository separation

1. Complete the localhost test matrix in `LOCALHOST_E2E_GUIDE.md`.
2. Create the new private or public GitHub repository `mssystem1/ai-pulse` without initializing it.
3. Copy the validated V2 tree without `.git`, `.env`, `.env.cloud`, local test artifacts, `node_modules`, or wallet material.
4. Initialize the copied directory, commit the validated baseline, and push only to `mssystem1/ai-pulse`.
5. Confirm `mssystem1/Pulse` has received no new commit and its deployments remain connected to the old repository.

## Separate cloud projects

Create new projects instead of relinking the existing PULSE projects:

- Vercel project: `ai-pulse`
- Railway project/service: `ai-pulse-api`
- Railway public API hostname: a new `ai-pulse` hostname
- Vercel custom domain: the chosen `ai-pulse` domain

Import `.env.cloud` into both projects, then override only deployment-specific URLs:

- Railway: `BASE_URL=https://<ai-pulse-api-host>` and no `VITE_API_URL` requirement.
- Vercel: `BASE_URL=https://<ai-pulse-api-host>`, `VITE_API_URL=https://<ai-pulse-api-host>`, and `PRODUCT_LOGO_URL=https://<ai-pulse-web-domain>/brand/logo.png`.
- Both: `PRODUCT_NAME=PULSE` and a new `PERSISTENCE_NAMESPACE=ai-pulse:production` so V1 and V2 never share job keys.

Do not reuse or rename the existing PULSE V1 Vercel or Railway project. Validate `/healthz`, `/v1/metadata`, the web application, and one deliberately approved paid route per enabled payment provider before attaching marketplace listings.

## Marketplace publication

### Circle / Arc Testnet

Use the copy and evidence checklist in `CIRCLE_AGENT_MARKETPLACE_LISTING.md`. Submit the final PULSE web URL, Railway API URL, `/arc` paid endpoints, Arc Testnet chain ID `5042002`, test-USDC asset, Circle Gateway payment evidence, logo URL, privacy/terms URLs, and support contact. A document is preparation, not proof of publication; retain the marketplace listing URL and acceptance evidence.

### Base

1. Keep the Base ownership meta tag in `apps/web/index.html` and verify it on the final custom domain.
2. Set `BAZAAR_DISCOVERABLE=1` only after the production seller is reachable and real Base x402 settlement succeeds.
3. Execute and retain a receipt for each advertised `/base` paid service.
4. Verify the resources appear in CDP Bazaar discovery; the ownership tag and Bazaar discovery are separate checks.
5. If publishing as a Base App, add and validate the current Base App manifest/account association separately.

### Arbitrum

1. Publish the equivalent `/arbitrum` resources with `eip155:42161` and native USDC, not USDC.e.
2. Execute and retain real settlement receipts for the advertised services.
3. Verify x402/Bazaar discovery where supported.
4. Submit PULSE separately to the current Arbitrum ecosystem directory or marketplace with the web URL, repository, logo, payment evidence, and support links. Bazaar discovery does not automatically create an Arbitrum editorial listing.

Marketplace forms and requirements change. Recheck the current official submission pages immediately before publication and do not claim a listing until its public page is visible.

## OKX.AI agent #8355 update discipline

Agent `8355` is the existing PULSE identity: https://www.okx.ai/agents/8355. Do not create a replacement or mutate the public record from repository work alone. Prepare an exact before/after diff containing the PULSE V6.1 description, logo, custom web domain, Railway endpoint, five service rows, current pricing, and successful X Layer USDT0 x402 evidence. Update agent `8355` only after the operator reviews that final diff and explicitly confirms the external write.
