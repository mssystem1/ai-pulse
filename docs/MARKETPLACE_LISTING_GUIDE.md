# PULSE marketplace and discovery guide

This is an operator guide. It does not authorize a deployment, listing submission, or on-chain agent mutation. Complete localhost testing first, deploy the final public HTTPS origins second, validate those origins third, and request explicit approval immediately before each external write.

## Shared publication package

Prepare one publication package from the deployed product:

- Name: PULSE.
- Public product identity: `product: "PULSE"`. PULSE has no public product version before launch; do not add `V6`, `6.x`, a version field, or a numbered methodology to marketplace metadata or listing copy unless the owner explicitly introduces versioning later.
- OKX.AI ASP category: Trading. Circle positioning remains Financial analysis / market intelligence.
- Square PNG logo and SVG brand asset served over public HTTPS.
- Short and long descriptions from `/v1/metadata`.
- Support/privacy/terms URLs if the destination requires them.
- Exact network, asset, provider, endpoint, HTTP method, body schema, and price for every service.
- Proof that free endpoints return directly and paid endpoints return a standard challenge followed by a successful paid replay.
- Transaction, receipt, job, report-recovery, uptime, and contact evidence kept privately.
- Polymarket disclosure: public read-only evidence, explicit selection, no orders.

Never publish localhost URLs, preview deployments, mock-payment evidence, test private keys, recovery tokens, or stale metadata exports.

## Base Dashboard visibility and ownership verification

PULSE is a Vite application, not Next.js. The Base ownership tag therefore belongs in `apps/web/index.html`:

```html
<meta name="base:app_id" content="6a71cfab2c28265d676172e4" />
```

The repository already includes this tag locally. After an explicitly approved deployment:

1. Open the production homepage source—not only the DOM inspector—and confirm the exact tag appears inside `<head>`.
2. Confirm the homepage is public, returns HTTP 200, and is not behind Vercel Deployment Protection or login.
3. In Base Dashboard, add the final production app URL and choose meta-tag verification.
4. Trigger verification and wait for ownership to become verified.
5. Complete the dashboard metadata, logo, categories, support links, and Base network details.
6. Validate the production URL and metadata in Base’s preview/dashboard interface.
7. Record the verified app ID, timestamp, public URL, and screenshots privately.

The meta tag proves control of the web origin. It does not by itself publish an x402 service, certify a Base USDC settlement, or make a Mini App. If PULSE is later packaged as a Base Mini App, add the required manifest/account association and validate it through Base’s current preview flow separately.

## Base API discovery through CDP Bazaar

Base paid services use the `/base` aliases, Base mainnet `eip155:8453`, and native USDC. To make them discoverable:

1. Deploy the final API origin with `FEATURE_BASE_PAYMENTS=1` and `BAZAAR_DISCOVERABLE=1` only after canary approval.
2. Confirm each published route returns the Bazaar extension and accurate POST input schema before payment.
3. Execute one controlled production settlement per distinct payment contract—not necessarily every business handler.
4. Capture the extension response, transaction, receipt, completed job, and report recovery.
5. Query the current CDP Bazaar discovery surface and confirm the final HTTPS resource appears with the correct method, price, Base chain, native-USDC address, and output schema.
6. Remove or disable any stale resource URL before advertising the new one.

Recommended Base paid resources (the complete eight-service execution-mainnet catalog):

- `/base/v1/analysis/spot/standard`
- `/base/v1/analysis/spot/premium`
- `/base/v1/analysis/prediction/standard`
- `/base/v1/analysis/prediction/premium`
- `/base/v1/preflight`
- `/base/v1/autopilot/pass/24h`
- `/base/v1/autopilot/pass/7d`
- `/base/v1/autopilot/pass/30d`

## Arbitrum API discovery

PULSE exposes the same approved eight-service catalog under `/arbitrum`, using `eip155:42161` and native USDC `0xaf88d065e77c8cc2239327c5edb3a432268e5831`: five analysis/risk services plus Start Autopilot for 24h, 7d and 30d.

1. Keep Arbitrum disabled until the Base CDP path has passed production canary gates.
2. Enable `FEATURE_ARBITRUM_PAYMENTS=1` and retain Bazaar discovery only after verifying CDP currently advertises Arbitrum resources in the target environment.
3. Confirm the challenge cannot use bridged USDC.e.
4. Complete a controlled native-USDC settlement, receipt, job, and recovery test.
5. Verify discovery metadata shows Arbitrum One, not Base, and uses the `/arbitrum` URL.
6. If submitting PULSE to an Arbitrum ecosystem directory or grants/showcase form, treat that as a separate editorial submission: use the web app URL, Arbitrum feature description, contract/payment evidence, logo, repository, and contact details. Do not claim that CDP Bazaar discovery automatically creates an Arbitrum ecosystem listing.

There is no repository-side action that can guarantee approval by an Arbitrum editorial directory. Follow the current official form/dashboard visible to the operator at submission time and save the resulting submission ID.

## Arc Testnet and Circle publication

Arc is testnet-only in PULSE. Use `/arc`, `eip155:5042002`, test USDC `0x3600000000000000000000000000000000000000`, and Circle Gateway.

1. Keep `ARC_AI_MODE=fixture` for the first deployed certification.
2. Verify Circle entity secret, wallet set, seller wallet, Gateway balance/deposit, and testnet RPC without exposing credentials.
3. Run a controlled Arc test-USDC settlement and recover its report.
4. Confirm every page, challenge, receipt, and listing field says Arc Testnet and test USDC.
5. Use `docs/CIRCLE_AGENT_MARKETPLACE_LISTING.md` as proposed copy, then reconcile every field with the live marketplace form/API available to the operator.
6. Submit only through Circle’s current official marketplace/discovery interface. Save the returned listing identifier and search result as proof.
7. Do not describe xAI or any routed provider as “Arc-native inference.” `docs/ARC_AI_PROVIDER_REVIEW.md` explains the provider boundary.

If Circle has no public self-service publication surface at submission time, the document remains listing material—not evidence of publication. Obtain the official partner/submission route from Circle and record that external dependency.

## Updating existing OKX.AI agent #8355

Agent #8355 is an existing X Layer ASP identity. Update it; do not create a replacement unless OKX explicitly requires migration.

Public record: https://www.okx.ai/agents/8355

### Preconditions

- Final non-preview API HTTPS origin is healthy.
- The web and API metadata are final and publicly reachable.
- X Layer paid challenges use `eip155:196` and official USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`.
- Challenges explicitly publish six decimals, `USDT0`, EIP-712 name `USD₮0`, and version `1`.
- The OKX.AI validator returns `valid: true`, a human amount, correct payee, and a non-empty accepted-options payload.
- At least one deployed paid replay returns the promised deliverable.
- The operator is logged into the Agentic Wallet that owns #8355.

### Proposed update flow

1. Ask the operator’s Onchain OS-enabled agent to show details and services for agent #8355.
2. Compare ownership, role, active state, name, logo, description, and every service with the approved publication package.
3. Prepare the updated ASP description using the focused PULSE metadata. Preserve the original OKX/X Layer identity; describe Base, Arbitrum and Arc as separate network/provider aliases without implying that OKX settles their payments.
4. Add services one at a time. For each service provide name, concise description, exact per-call price, method, input, and final production endpoint. After every service, explicitly choose whether to add another; finish the service list only when all intended rows are reviewed.
5. Run the marketplace validator against every paid endpoint with a valid body. A GET input-discovery probe may return `input_required`; the valid POST must return a compliant challenge.
6. Review the complete mutation card. Confirm that the target is #8355, not a new agent; verify all endpoints and prices character-for-character.
7. Only after a new explicit approval, perform the on-chain update. OKX covers the identity update network fee, but the mutation is still irreversible external state.
8. Re-check the marketplace detail page, service rows, active state, logo, search result, and validator output. Do not rely only on transaction success.
9. If listing review is required, submit #8355 and wait for the review result sent to the Agentic Wallet email. Record the review/submission identifier.

Recommended OKX.AI service rows should use X Layer URLs because OKX’s x402 facilitator and marketplace payment validation are X Layer-focused:

- Global Quick → Spot Market or Limit — `/xlayer/v1/analysis/spot/standard` — $0.20.
- Global Pro → Spot Market or Limit — `/xlayer/v1/analysis/spot/premium` — $0.30.
- Prediction Quick — `/xlayer/v1/analysis/prediction/standard` — $0.20.
- Prediction Pro — `/xlayer/v1/analysis/prediction/premium` — $0.30.
- Onchain Pre-Trade Risk Guard — `/xlayer/v1/preflight` — $0.15.
- Start Autopilot · 24h — `/xlayer/v1/autopilot/pass/24h` — $1.50.
- Start Autopilot · 7d — `/xlayer/v1/autopilot/pass/7d` — $10.50.
- Start Autopilot · 30d — `/xlayer/v1/autopilot/pass/30d` — $45.00.

Do not publish Fused, Divergence, Event-risk, route tickets, separate Market/Limit execution or Autopilot evaluation as extra marketplace services. Market/Limit are Agentic Wallet actions inside the two Global services. The three duration-specific Autopilot starts are the only separate Autopilot marketplace rows.

The two Global service descriptions must explicitly list the two report-linked next actions: a prefilled Agentic-Wallet-signed Spot Market order or Spot Limit order. Both Base/Quick and Premium/Pro expose those choices; Premium adds analysis depth rather than exclusive permission to trade. Autopilot starts independently through one of its three dedicated duration services and does not require a Global report.

Each Start Autopilot service mirrors the web six-step flow. The caller's Agentic Wallet owns and signs vault creation/selection, pair/route verification, strategy policy, capital deposit, registration and resume/start; PULSE never receives the private key. The duration-specific endpoint is the final x402 activation step. Pause freezes unused paid time; renewal extends it. Expiry blocks new AI-confirmed entries while deterministic monitoring, protective exits and owner withdrawals continue. Provider billing, permission or quota errors open a six-hour retry circuit instead of consuming calls every worker tick.

Do not place Base, Arbitrum, or Arc payment endpoints under an OKX-settled service description. Those networks use their own providers and discovery channels.

## Publication evidence checklist

For every destination retain:

- public URL and metadata version;
- submitted title, description, logo, categories, network, asset, price, and endpoint;
- validator output and any warning resolution;
- transaction/receipt/job/report proof where required;
- submission/listing/app identifier;
- review status and timestamp;
- rollback/unpublish procedure;
- operator who approved the external write.

Publication is complete only when the destination itself returns a searchable/verified record. A repository JSON file, README paragraph, successful local test, or proposed listing document is not publication proof.
