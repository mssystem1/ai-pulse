# Robinhood Autopilot verification — October 3, 2026

## Live evidence

Qualification vault: `0x63DF1De362a58a439F92fF2b52DdAa1399907b2a`, Robinhood mainnet (4663).

The September 30 AI-approved AMAT entry was independently verified against its successful receipt and vault `Executed` event on October 3:

- Transaction: `0xfe4d8648ca143cea4f8e0be524a6ab084830bf94c48ad6495e24fc2be4a63617`.
- Spent: 0.1 USDG. Received: 0.000212587696488829 AMAT.
- Saved take profit: 515.5080312043573 USDG; stop loss: 506.822112651435 USDG per token.

On October 3, the fresh issuer-adjusted mark was approximately 535.86 USDG, above the saved take profit. The real worker latched the exit without buying another pass or requesting another AI confirmation. The first attempts did not broadcast an exit: the default executable quote failed the oracle minimum.

The position exceeds the 0.11 USDG per-trade valuation cap after appreciation. The worker splits it into balanced cap-compliant chunks to avoid leaving an unquoteable remainder. A read-only default quote for the first chunk (106293848244415 AMAT atomic units) returned 50100 USDG atomic units through Uniswap V3: approximately 12% below issuer valuation. A source-by-source comparison of the 17 liquidity sources returned 51815 atomic units through Uniswap V4, still approximately 9% below valuation; the remaining sources reported insufficient liquidity. The `directRoute` parameter is documented as Solana-only, so its unchanged Robinhood response is not evidence of a distinct direct-routing strategy. See [OKX quote parameters](https://web3.okx.com/ar/onchainos/dev-docs/trade/dex-get-quote) and [liquidity-source discovery](https://web3.okx.com/ua/onchainos/dev-docs/trade/dex-get-liquidity).

A bounded temporary 10% test tolerance initially also failed the default route. The improved worker then discovered the current provider source IDs, excluded the rejected source for one alternative request and selected the higher-output route. It retained all router, recipient, amount, oracle, simulation and daily-loss guards.

The third bounded test completed both autonomous sells under the temporary 10% tolerance:

- `0x5e60bc8db4566efc4af33928f3aeab08d013c38066b27ad3280f909f533f6ba2`: sold 0.000106293848244415 AMAT; received 0.051815 USDG.
- `0x79748c433c96eed593f870613b6ad05a17a6538a3d7ae47829dde1cd26761b48`: sold the remaining 0.000106293848244414 AMAT; received 0.051814 USDG.

Both successful receipts and exact vault `Executed` events were independently verified with two confirmations. Total sold exactly equals the original buy output; target balance is zero. The vault holds 0.203629 USDG, including its unspent 0.1 USDG. These proceeds exclude ETH gas and research/pass costs, and are not a net-profit claim. Pass confirmations used remained at two throughout the exits.

Cleanup paused the account and restored every original risk limit, including 1% slippage and 5% daily loss. Restoration transaction: `0xd314a9fb5ec165a76ca017977fbb3efe43b46d25ed9b46559d7674db52ac8c44`. Public transaction and cleanup evidence is recorded in `packages/contracts/deployments/4663-autopilot-exit-workflow.json`. No global registry setting was changed by this test.

## Local verification (simulated chain execution)

Worker regression tests cover rejected-entry and rejected-exit-quote retry, reuse of the last paid confirmation, pause/resume, durable TP/SL saved before broadcasting, receipt-timeout recovery without duplicate buys, protected partial/final exits after pass expiry, and owner-pause races. A separate reference-market variant checks price conversion between the research source and the executed token. Exit-route rejection is asserted to occur before any oracle or execution write.

Live read-only calls to the local setup preflight endpoint returned HTTP 200 for WETH at a 0.1 USDG buy size and HTTP 422 for AMAT, reporting the sell-route/tolerance mismatch with `walletTransactionsSent: false`. Preflight uses the UI-selected per-trade cap and tolerance; the worker repeats the exit-quote check immediately before entry. Quotes describe current availability, not a guarantee of future exits.

These regression tests are simulations; the live sells are evidenced separately above. The full API suite passed 259 tests with one skipped test; analysis passed 26 and web passed 109. Both worker variants passed separately. API and web TypeScript checks, the analysis build, and the production web build passed. A clean-install dry run also passed. The exit qualification script refuses a new attempt if its journal records unfinished restoration and verifies every original limit after cleanup, not just slippage.

The wallet dependencies are pinned to the compatible Wagmi 2.19.5, core 2.22.1 and connectors 6.2.0 tree supported by AppKit. This removes the previous production-build failure caused by newer wallet dependencies importing an unavailable `viem/tempo/zones` export. Production build warnings about large bundles remain non-blocking.

## Remaining release evidence

The live autonomous buy and full exit are proven for this test, but the AMAT exit is not qualified at 1% tolerance. Do not lower the oracle valuation to the swap quote, fabricate a signal, or silently enlarge owner-approved production limits. Listing a tradable token does not guarantee sufficient liquidity for a particular order size or strategy. Production scheduling and every catalog pair are not certified by this single-vault test.
