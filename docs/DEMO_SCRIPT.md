# PULSE · 75-second hackathon demo

**Objective:** prove the product loop—live market data, agent-native analysis, onchain payment, and safe funding—without spending the video on setup.

## Before recording

- Use a deployed HTTPS build with live OKX payment mode.
- Preconnect an OKX Wallet on X Layer.
- Hold enough OKB for gas and a deliberately low USDT0 balance for the first payment attempt.
- Prepare one funded wallet or complete the OKB → USDT0 swap during the demo.
- Use a liquid pair such as `BTC-USDT`, `1H`.
- Verify Grok output once immediately before recording.
- Keep the browser at 125–150% zoom only if text remains crisp; record at 1440p.

## Shot list

### 0:00–0:07 · Hook

**Visual:** PULSE logo, then the live console and chart.

**Voiceover:**

> Markets never wait. Why should intelligence require an account, a subscription, or a human checkout?

### 0:07–0:18 · Free value

**Visual:** Open the pair picker, choose `BTC-USDT` from the live OKX list, load the free preview, and show ticker stats plus chart. Briefly open Safety and show the X Layer token/memecoin browser alongside the still-available manual address field.

**Voiceover:**

> PULSE makes live OKX markets and X Layer token discovery searchable for free—then sells the exact signal a trader or agent needs.

### 0:18–0:31 · Funding UX and guard

**Visual:** Connect once from the header, then click Premium with insufficient USDT0. Show the clear error and automatically opened Wallet & funding drawer. Show OKB and USDT0, request a live OKX Exchange OS quote, and show that the same connected wallet is ready to sign the OKB → USDT0 transaction.

**Voiceover:**

> Before payment, PULSE checks USDT0. If funding is short, it stops before signature and opens the OKX swap route in context.

### 0:31–0:48 · Pay-per-signal moment

**Visual:** Use the funded state, request Premium, approve the wallet signature, and show the structured report.

**Voiceover:**

> One x402 payment in USDT0 on X Layer unlocks a Grok report grounded in live OKX candles—bias, scenarios, levels, invalidation, and risk.

### 0:48–1:02 · Agent-native proof

**Visual:** Split view: MCP `tools/list`, then `analysis_base` returning `structuredContent`. Briefly flash the 402 payment requirements.

**Voiceover:**

> The same product is callable through MCP, REST, and a typed SDK. Agents discover it, pay, and consume structured output without leaving their workflow.

### 1:02–1:15 · Close

**Visual:** Product hero, X Layer, x402, OKX, Grok, repository, final report.

**Voiceover:**

> PULSE. OKX spot intelligence—pay per signal on X Layer.

## Mandatory on-screen proof

- `PULSE`
- `Live OKX spot data`
- `Grok-powered · structured output`
- `x402 · USDT0 · X Layer`
- `Web · REST · MCP · SDK`
- `NFA · scenarios, not guarantees`

## Editing guidance

- Cut all wallet confirmation waiting time.
- Make the single-wallet proof explicit: the only connection CTA is in the header; the native swap flow never asks to connect again.
- Show that pair selection comes from the exchange list rather than arbitrary typing, and that token discovery clearly says listings are not safety endorsements.
- If a report is already visible, refresh free market data once and keep the report on screen; the chart should update without erasing work.
- When showing Safety, run the free contract inspection and point out its live X Layer RPC evidence. Describe paid scores separately as deterministic heuristics, not audits.
- Never expose `.env`, API keys, private keys, or full sensitive browser-extension views.
- Use real responses, not edited scores or fabricated transaction hashes.
- Keep the underfunded error visible long enough to read.
- If live settlement is not ready, label the footage **mock x402 flow**; do not imply mainnet settlement.
