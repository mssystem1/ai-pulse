# Arc mobile Gateway, Market review and balances — October 8, 2026

The reported UI issues have local fixes, with [sanitized evidence](ARC_MAINNET_UI_FIXES_2026-10-08.json). No hosting deployment, push, payment, withdrawal or transaction broadcast was performed in this audit. Production Circle email wallets remain disabled and Arc automation remains unpaused. Physical OKX mobile signing still requires acceptance after the user's manual release.

## Gateway signing

The screenshot reports `Provided chainId "NaN" must match the active chainId "5042"`. This is consistent with a wallet bridge trying to validate a chain ID omitted from Circle's domain. Circle intentionally hashes only `name` and `version` in its [Gateway EIP-712 domain](https://github.com/circlefin/evm-gateway-contracts/blob/master/src/lib/EIP712Domain.sol); changing its signed domain to include chain ID would produce an incompatible signature.

PULSE first requests the original Circle signature with explicit domain types. Only that specific `NaN`/5042 validation error permits one compatibility retry: it provides the active chain as request metadata while retaining the declared name/version domain fields. The retry must hash identically to the original intent. The wallet account and chain are rechecked, and the returned signature must recover the owner against Circle's original intent before storage or submission. Rejections, authorization failures, genuine chain mismatches and uncertain signing outcomes are not retried. A wallet that hashes the extra chain field is rejected without submitting a withdrawal.

Tests reproduce the nested mobile error, verify the identical digest, complete one simulated transfer/mint, and reject changed-domain signatures. Existing fee, gas, replay protection and interrupted-withdrawal recovery checks remain intact. These fixtures do not certify a particular physical OKX mobile release.

## Market action

The supplied HAR contains 63 requests with no HTTP error status. Response bodies are absent. Its only quote request is the automatic **1-USDC route probe**; there is no entered-amount ticket quote or `prepare-swap` call, and no withdrawal estimate or transfer request. It therefore cannot establish response-body correctness or capture the separate mobile signing failure.

Previously, Review remained disabled until the separate Get live quote action completed. The main action now clearly says **Get quote to review buy/sell**. It only quotes the entered amount. A positive-output response changes it to **Review buy/sell in wallet**, which performs fresh preparation and the existing explicit wallet approval flow. An empty or zero-output quote cannot enable review. Mapping, balance, protection and signing guards continue to apply; OKX market selection and Base/Arbitrum mappings are unchanged.

## Balances and validation

The Arc header shows labelled **Wallet** and **Gateway** USDC rows on desktop and mobile. Wallet funds trading and gas; Gateway funds research and passes. Missing evidence renders a dash, and the native/ERC-20 views of wallet USDC are never added together. README and English/Chinese app Docs describe both rows and the quote/review steps.

- All **163 frontend tests passed**, including 11 Gateway tests.
- TypeScript and the production frontend build passed. The browser artifact scan checked 236 files against 28 server-secret values and found no leaks.
- Isolated production-build browser checks passed at **320, 390 and 1440 pixels**, with both balance rows visible, no horizontal overflow or JavaScript render errors, an exact 0.1-USDC ticket quote, and no wallet transaction requested until the separate review action. A zero-output quote was blocked. The wallet rejects at review, so no real signature or broadcast occurs.
- Public reads at approximately **08:58 UTC** returned a positive live quote for 0.1 USDC into official cirBTC (120 atomic units), enabled Arc capabilities and `automationPaused=false`.
- The payment-recipient wallet `0xa05b83c9a2228b1f4e32952a71e5b189df4f3973` held **0.1 wallet USDC** and **3.9 Gateway USDC** in that dated snapshot. Neither balance was moved by this audit.

The remaining migration acceptance requirements in the [completion audit](ARC_MAINNET_COMPLETION_AUDIT_2026-10-07.md) still apply. Local fixtures and read-only quotes do not complete physical wallet signing, remaining funded contract workflows or the user's manual hosting release.
