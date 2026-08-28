# PULSE V6 Product Testing Guide

This guide starts with local UI/API verification and finishes with real mainnet certification. Local success does not certify money-moving production behavior.

## 1. Local setup

1. Install Node.js 22.
2. Copy `.env.local.example` to `.env` and replace required placeholders.
3. Configure live OKX, xAI, payment, RPC, Upstash KV and Vercel Blob credentials.
4. For local-only UI development, memory persistence is accepted. For recovery/trading tests, use `QUEUE_PROVIDER=upstash_kv`, `STORAGE_PROVIDER=vercel_blob`, and real credentials.
5. Keep `X402_MOCK=0` for manual payment certification.
6. Add verified contract addresses only after deployment.

Install, compile and test:

```powershell
npm install
npm run build
npm test
```

Start both applications:

```powershell
npm run dev
```

Expected defaults: web `http://localhost:5173`, API `http://localhost:4000`.

## 2. Health and capabilities

Open:

```text
http://localhost:4000/healthz
http://localhost:4000/v1/meta
http://localhost:4000/v1/trading/capabilities?network=xlayer
http://localhost:4000/v1/trading/capabilities?network=base
http://localhost:4000/v1/trading/capabilities?network=arbitrum
http://localhost:4000/v1/trading/capabilities?network=arc-testnet
http://localhost:4000/v1/telegram/status
```

Confirm Arc returns Spot and Autopilot hidden/disabled. Mainnet capabilities must explain every disabled provider or missing contract. With production KV configured, persistence must say `upstash_kv`.

## 3. Global Market

1. Confirm the navigation and hero say Global Market, not Crypto Market.
2. Confirm the product journey visibly explains `Analyze -> Spot trade` or `Analyze -> Autopilot`, and the Opportunity Radar appears in Global Market as research rather than a Buy recommendation.
3. Search BTC, ETH and an xStock/RWA exposed by the live OKX SPOT catalog.
4. Open the custom timeframe picker. Confirm it shows the meaning of 15m, 1H, 4H, 1D and 1W, uses the selected RPC theme/logo, closes with Escape/outside click, and becomes a touch-friendly panel on mobile.
5. Change pair and timeframe; confirm the chart and previous report clear.
6. Load free live market data.
7. Buy a Base report and confirm a persistent BASE mark.
8. Without changing the pair, buy Premium. The report must immediately enter Premium loading, create a new paid job, then render a PREMIUM mark.
9. Confirm Premium includes attached candles, Fibonacci levels, pivots, Elliott candidate/invalidation, bullish/bearish moves and explanation.
10. Confirm DeFi uses the selected RPC's identity-safe representation (`BTC -> cbBTC`, `ETH -> WETH`, etc.). If no exact product is verified, it must say unavailable and never invent APY.
11. From a Buy report choose Market, Limit or Autopilot and verify pair, timeframe, entry, TP and SL carry forward together.
12. Refresh during generation and confirm job recovery does not charge again.

## 4. Prediction Market

1. Select one supported live Polymarket question.
2. Buy Base and verify the BASE mark, probability evidence, bid/ask, liquidity, invalidation and limitations.
3. Buy Premium and verify the PREMIUM mark and deeper scenario/counter-case sections.
4. For BTC/ETH/SOL/XRP/BNB/DOGE questions, confirm an independent OKX 4H chart with Fibonacci, pivots and Elliott candidate.
5. For an unmapped question, confirm PULSE says no confident underlying mapping and does not attach an unrelated chart.
6. Verify payment/job recovery after reload.

## 5. Payment-network UX

1. Open the custom `Pay on` popover using mouse and keyboard.
2. Confirm each network shows payment asset and provider.
3. Switch X Layer, Base, Arbitrum and Arc Testnet and confirm theme/capability changes.
4. Confirm the wallet drawer is described as funding/payment readiness, not Spot Trading.
5. Test insufficient balance, wallet rejection, wrong network, successful x402 settlement and receipt recovery.

## 6. Spot Trading

Use minimal mainnet amounts.

1. Select X Layer, Base or Arbitrum and connect the existing wallet.
2. Open Spot Trading independently of any report.
3. Confirm PULSE discovers the wallet's existing Market-protection, Limit and Bracket accounts from each selected chain's factory. It must offer account creation only when that factory returns no account.
4. Select a report or a Global pair. Confirm PULSE resolves the analysis ticker to identity-safe chain assets without requiring contract addresses or atomic values from the trader.
5. Obtain a live OKX Onchain OS quote. Confirm expected output, route, impact, slippage and expiry.
6. Review and broadcast in the connected wallet.
7. Confirm the transaction hash appears in independent Spot activity and opens the correct explorer.
8. Test invalid mapping, unsupported route, expired quote, insufficient allowance/balance, wallet rejection and provider outage.
9. Create a directional buy-below or sell-above limit order. Confirm the API rejects a ticker whose base/quote symbols do not match the exact on-chain tokens.
10. On a certified asset, create and edit TP/SL, pause/resume, prove a premature keeper exit reverts, trigger one side, and prove OCO terminal exclusivity.
11. Test owner cancel/withdraw, row close, grouped close-all and emergency pause with owner withdrawal still available.
12. Verify the dashboard filters and semantics: Pending = unfilled limit entries or pending receipts; Active = assets governed by TP/SL; Executed = completed buy/sell orders without remaining protection; Cancelled = owner-closed orders/positions; Activity = every approval, account creation, order, fill and close transaction. Verify P&L is explicitly labelled an OKX-mark estimate from the recorded position basis, not wallet-wide accounting.
13. For Market, test Auto slippage with a maximum cap and Manual fixed slippage. For a report Buy, enable TP/SL, confirm the exact received balance delta is used, and sign the guided follow-up protection steps.
14. For Limit + TP/SL on each supported route, confirm the OTOCO row changes Pending → Active after entry fill → Executed after TP/SL, or Cancelled after an owner close.

### DOGE cross-network matrix

Run both Market and Limit from one fresh `DOGE-USDT` report:

- Base: verify the ticket explains `DOGE-USDT → cbDOGE/USDC`, checks USDC/cbDOGE balances, completes Buy → Active protection → Close → sell back to USDC, and records trigger, mark and estimated P&L.
- Arbitrum: when no identity-safe DOGE representation/live route exists, verify both order modes remain unavailable and the ticket recommends switching Network & Payment to Base.
- X Layer: when no identity-safe DOGE/USDT0 route exists, verify both order modes remain unavailable and the ticket recommends Base. Never substitute a similarly named token.
- Repeat the availability check whenever OKX's token catalog changes. A newly discovered candidate is enabled only after exact-symbol/official-wrapper validation and an amount-sized live quote.

## 7. Autopilot

### Trading acceptance for point 12.d

Vault creation, funding, pause, resume and withdrawal are setup/control checks only. Do not mark Autopilot trading complete unless the same strategy records all of the following:

1. A fresh Premium report and 120-candle market context.
2. A detailed evaluation containing every strategy rule and its observed/required value.
3. Monitoring activates independently of the first decision. Expect either a legitimate `Buy` only after every entry rule passes, or an auditable `Hold` that keeps the strategy active without sending a transaction.
4. An amount-sized OKX quote, successful vault simulation and confirmed guarded execution whenever the decision is `Buy` or `Sell`.
5. Reconciliation of actual target tokens received, portfolio capital, mark price and P&L.
6. A later cycle that holds the owned position unless a documented exit is active.
7. A `Sell` after TP, SL, bearish confirmation or strategy-specific structural exit. After a complete exit, a later qualified signal may `Buy` again without recreating the strategy. An owner pause/withdraw plus explicit Spot sell may safely unwind a bounded test, but must be labelled an operator exit rather than a strategy-qualified sell.
8. Evidence and transaction hashes visible in **Detailed trading report** and the reconciled Activity dashboard.

Test Trend following, Breakout and Mean reversion decision fixtures even when live market conditions do not produce all three entries. Exact rules and contract functions are in `docs/AUTOPILOT_TRADING_REPORT.md`.

1. Open the separate Autopilot tab and verify no Spot orders/positions are imported.
2. Choose pair/timeframe, settlement token, strategy text, maximum trade and daily loss/turnover rules.
3. Create an isolated vault through the configured factory.
4. Configure restrictive on-chain limits and fund only the intended amount.
5. Activate the strategy and sign the five-minute connected-wallet authorization. Confirm a copied/modified payload, expired signature, non-factory vault, or ticker/token mismatch is rejected.
6. Run one evaluation using Premium analysis when permitted by policy.
7. Confirm deterministic validation and exact transaction simulation precede executor submission.
8. Prove wrong policy version, nonce replay, unapproved adapter, over-cap amount, cooldown, expiry, global pause and revoked executor all revert.
9. Confirm pause, policy update, immediate owner withdrawal and independent Autopilot mark-to-market P&L/activity/proof hash. Fund and withdraw after activation and verify confirmed vault-specific cash flows change capital basis rather than appearing as trading P&L.
10. Confirm no Autopilot action can move connected-wallet or Spot-account funds.

### Multi-agent strategy acceptance

Create at least one vault for each preset rather than treating vault creation as proof of trading. A bounded low-capital matrix may use `0.5 USDC` on Base/Arbitrum and `0.5 USDT0` on X Layer:

1. Use different identity-safe execution assets and timeframes, for example WETH 15m Mean Reversion, cbDOGE 15m Breakout and WBTC 1H Mean Reversion.
2. Confirm every vault is independently discovered from its network factory before PULSE offers creation.
3. Confirm each selected-vault card shows only that vault's capital, while **Total portfolio value** and runtime P&L aggregate all strategies on the selected network.
4. Leave the browser tab, change networks, restart the API and confirm scheduled evaluations continue from KV-backed signed state.
5. For a legitimate Hold, inspect every PASS/WAIT rule in **Detailed trading report** and confirm no oracle update or swap transaction was sent.
6. Temporarily interrupt one dependency in a controlled test. The vault must fail closed as `hold_dependency_retry`, retain capital and policy, and recover on the next scheduler cycle without owner action.
7. Do not call the matrix complete until at least one agent has a confirmed Buy, protected Hold and strategy-qualified Sell, or clearly label the outstanding live-monitoring condition.

Current live reference: X Layer vault `0x64b4C9fc379EE1F4820fEC6597124f7f835374A1` is active for SOL-USDT 1D with exactly 1 USDT0. Its first completed cycle is an evidence-backed Hold, not a failed activation. Compare the UI rule table and balances with `docs/AUTOPILOT_TRADING_REPORT.md`.

## 8. Arc Testnet gate

1. Select Arc Testnet.
2. Confirm Spot and Autopilot tabs disappear.
3. Directly call their API routes with Arc and confirm rejection/hidden capability.
4. Confirm analysis and supported Arc payment testing continue.
5. Switch back to a supported mainnet and confirm the tabs return.

## 9. Telegram and Docs

Follow `docs/TELEGRAM_BOT_DEPLOYMENT.md` for real webhook deployment.

1. Confirm Telegram and Docs tabs render on every payment network.
2. Verify BotFather commands, webhook secret rejection, `/help`, `/wallet`, service buttons and Mini App opening.
3. Complete one real Base Global purchase and one Premium Prediction purchase through Telegram.
4. Verify no duplicate charge/delivery on repeated updates.
5. Verify authenticated full report access and unlink/revoke behavior.
6. Check Docs content on desktop/mobile, keyboard navigation, links, contrast, overflow, diagrams and exact feature availability.

### Responsive UI matrix

Test at minimum `1440x900`, `1024x768`, `768x1024`, `390x844` and `360x800`.

- X Layer dark and Base light: no page-level horizontal overflow; readable body text and disabled-state explanations.
- Arbitrum and Arc: real network logos remain undistorted in the header, network menu and timeframe picker.
- At 980px and below, the service switcher replaces the desktop tabs. No native horizontal browser scrollbar is shown; its bottom sheet scrolls internally with a themed scrollbar when required.
- Opportunity cards collapse from four to two to one column; action buttons remain at least 44px high on touch devices.
- The timeframe list stays inside the viewport, scrolls internally when needed and never covers an inaccessible close/action control.
- Report, Spot ticket, Autopilot builder, dashboards and Docs diagrams collapse to one column without clipped values or overlapping fields.
- With browser zoom at 200%, keyboard focus remains visible and all workflows remain operable.
- Reload each canonical deep link directly: `/global`, `/prediction`, `/safety`, `/spot`, `/autopilot`, `/telegram` and `/docs`. The matching workspace must remain selected after reload.
- Navigate among workspaces, then use browser Back and Forward. The selected workspace, canonical URL and mobile service-switcher label must stay synchronized. A legacy `?service=` link may load, but it must be replaced by the canonical path.

### Risk Guard matrix

For X Layer, Base, Arbitrum and Arc Testnet, open Risk Guard directly and confirm the token browser reads the selected network catalog. Native pseudo-addresses must not be offered as ERC-20 contracts. Select a real token, inspect bytecode/interface/proxy evidence, then simulate known calldata without broadcasting. A catalog listing must remain clearly distinct from a safety result or audit.

## 10. Recovery and failure testing

Exercise these deliberately in staging or with bounded mainnet amounts:

- primary RPC stale/disagreement;
- OKX timeout and unsupported token route;
- xAI timeout after settled payment;
- Blob upload outage;
- KV outage and expired lease;
- worker crash before and after broadcast;
- replaced/reverted transaction;
- partial limit fill;
- duplicate Telegram webhook;
- chain reorganization before configured finality;
- stale/missing oracle;
- depleted keeper/executor gas;
- guardian pause and role revocation.

No financial operation may duplicate. Uncertain state must become reconciliation/manual-attention state, not false success.

## 11. Production acceptance evidence

For X Layer, Base and Arbitrum retain:

- deployed/verified addresses and bytecode attestation;
- contract audit and resolved findings;
- RPC/provider/oracle readiness output;
- x402 payment and report receipts;
- market trade, limit (where supported), Spot protected order and Autopilot transaction hashes;
- owner pause/cancel/withdraw evidence;
- KV/Blob backup and clean-namespace restore result;
- dashboard-to-chain/provider reconciliation result;
- Telegram payment/delivery evidence;
- screenshots for every requirement and responsive breakpoint.

The release is operational only when live evidence exists for every enabled path. Fixtures, mocks, local chains and fork tests are useful CI tools but do not satisfy production acceptance.
