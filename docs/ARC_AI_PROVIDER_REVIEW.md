# Arc AI provider review

Reviewed: 2026-08-03

## Decision

Keep `ARC_AI_MODE=fixture` as the Arc Testnet default and use the existing direct xAI integration when explicitly switched to `live`. Do not silently replace Grok with a marketplace service. A marketplace listing proves discoverability and payment compatibility; it does not prove PULSE's required model, strict schema behavior, latency, cost ceiling, or report quality.

BlockRun is the strongest current candidate for a later paid-provider adapter. It exposes an OpenAI-compatible chat endpoint, lists Grok 4.3 among its routed models, accepts `response_format` including JSON Schema, publishes live model pricing, and supports Circle Gateway nanopayments on its `nano.blockrun.ai` gateway. However, its documented nanopayment gateway currently names Polygon, Arbitrum, Optimism, and Unichain—not an Arc-native service endpoint. Circle's crosschain Gateway balance can fund service payments, but that is different from PULSE receiving an Arc Testnet payment and then making an Arc-native model call.

Therefore the first release architecture remains:

1. The user pays PULSE on Arc Testnet through the PULSE Circle Gateway adapter.
2. Fixture mode returns deterministic, explicitly labelled fixture output without real AI cost.
3. Live mode calls xAI server-to-server only after positive per-token prices, budgets, and alerts are configured.
4. A future `blockrun` provider must be a separate explicit adapter and analysis profile, with its own buyer wallet, quote validation, idempotency, receipt linkage, output validation, cost accounting, and quality canary. It must never be selected implicitly after an xAI failure.

## Evidence and qualification gates

| Requirement | Direct xAI | BlockRun candidate | Release consequence |
|---|---|---|---|
| Grok 4.3 selection | Configured directly | Listed by provider | Both still require a live model-ID probe |
| Strict JSON Schema | Implemented and locally revalidated | Documented as accepted | Must run the complete PULSE schema canary before adoption |
| Payment rail | API-key billing | x402/Gateway nanopayment | Separate buyer-side payment lifecycle is required |
| Arc-native endpoint | No | Not documented | Do not describe either path as Arc-native inference |
| Dynamic price | Contracted env values | Live model catalog and 402 quote | Never hard-code marketplace price |
| Failure semantics | Recoverable PULSE job | Not yet integrated | No fallback payment or second charge without explicit design |
| Quality evidence | Existing PULSE fixture and schemas | Missing PULSE-specific canary | Not production-approved yet |

## Required canary before adding BlockRun

- Inspect the live model catalog and unpaid 402 response.
- Pin the exact provider/model identifier for the canary.
- Verify the challenge network, asset, recipient, maximum amount, and resource URL before signing.
- Run the same frozen standard and premium PULSE contexts through direct xAI and BlockRun.
- Require exact local schema validation, source-ID preservation, no unselected markets, and correct `analysisProfile` disclosure.
- Compare output validity, limitations, latency p50/p95, token usage, paid amount, receipt, and recovery behavior.
- Confirm one authorization creates at most one model call and one provider payment.
- Establish a dedicated daily spend ceiling and reconciliation alert.

## Primary sources

- Circle Agent Stack overview: https://developers.circle.com/agent-stack
- Circle Agent Nanopayments: https://developers.circle.com/agent-stack/agent-nanopayments
- Circle supported agent-wallet blockchains: https://developers.circle.com/agent-stack/agent-wallets/supported-blockchains
- Circle CLI service discovery/payment reference: https://developers.circle.com/agent-stack/circle-cli/command-reference
- BlockRun x402 endpoints and gateway networks: https://blockrun.ai/docs/x402/endpoints
- BlockRun chat completions and structured-output parameter: https://www.blockrun.ai/docs/api-reference/chat-completions
