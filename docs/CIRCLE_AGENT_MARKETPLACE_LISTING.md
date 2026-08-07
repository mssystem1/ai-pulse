# PULSE · Circle Agent Marketplace listing

## Listing copy

| Field | Value |
|---|---|
| Name | PULSE |
| Category | Financial analysis / market intelligence |
| Tagline | Spot and prediction-market intelligence, paid per report in USDC. |
| Environment | Arc Testnet — test-value payments; live market data and model calls may incur real provider cost. |
| Short description | PULSE combines live OKX spot evidence with explicitly selected Polymarket markets and delivers structured, recoverable analysis through Circle Gateway-compatible x402 services. |
| Networks | Arc Testnet for this listing; PULSE also publishes separate X Layer, Base, and Arbitrum resources. |
| Payment asset | Arc Testnet USDC |
| Delivery | Immediate `202` job acceptance, opaque recovery capability, authenticated polling, normalized payment receipt, and private final report. |
| Safety | Decision support only; selected market IDs, source timestamps, missing sources, limitations, invalidation conditions, analysis profile, and methodology version are disclosed. |

## Long description

PULSE is one multichain intelligence product for humans and agents. On Arc Testnet, callers pay test USDC through Circle Gateway for structured spot, prediction-only, fused OKX + Polymarket, divergence, or event-risk analysis. Prediction context is always explicitly selected by the caller and reloaded server-side after payment. PULSE does not trade on Polymarket and does not accept Polygon as a PULSE payment network.

Paid analysis is delivered as a durable job so a slow provider or closed browser does not lose a settled purchase. The response includes a recovery capability; the final private report records the payment network, Gateway batch settlement mode, selected/rejected market IDs, data freshness, partial sources, model/fixture profile, limitations, and cost evidence. Arc is visibly testnet/test-value. `ARC_AI_MODE=fixture` is the default; live Grok is enabled only after explicit cost and alert gates.

## Published Arc service paths

Use the final custom API origin in place of `<API_ORIGIN>`:

- `POST <API_ORIGIN>/arc/v1/analysis/spot/standard`
- `POST <API_ORIGIN>/arc/v1/analysis/spot/premium`
- `POST <API_ORIGIN>/arc/v1/analysis/prediction/standard`
- `POST <API_ORIGIN>/arc/v1/analysis/prediction/premium`
- `POST <API_ORIGIN>/arc/v1/analysis/fused/standard`
- `POST <API_ORIGIN>/arc/v1/analysis/fused/premium`
- `POST <API_ORIGIN>/arc/v1/analysis/divergence`
- `POST <API_ORIGIN>/arc/v1/preflight/event-risk`

Machine-readable schemas, examples, prices, payment provider, CAIP-2 network, asset, and payee are published at `<API_ORIGIN>/v1/metadata`. Free service inspection must return the declared input contract before payment.

## Publication gate

- Deploy the exact release candidate with `arc-testnet` enabled, Circle Gateway enabled, and fixture mode first.
- Confirm the seller address, Arc Testnet USDC, price, resource URL, and Gateway batch semantics in the 402 challenge.
- Complete one controlled test-USDC payment through the deployed route and recover the private report without repaying.
- Confirm the receipt says `gateway_batch`, finality says `gateway_batch_accepted`, and no immediate on-chain transaction is fabricated.
- Verify listing search/inspection from Circle CLI and save the returned marketplace identifier.
- Enable live AI only after current xAI rates, budget ceilings, and notifications are verified.
