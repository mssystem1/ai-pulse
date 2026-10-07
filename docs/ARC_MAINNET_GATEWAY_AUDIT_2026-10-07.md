# Arc execution and Gateway audit — October 7, 2026

Registry automation is **unpaused**, following the owner’s explicit request. [The confirmed transaction](https://explorer.arc.io/tx/0x64a753bbaefb3de358199296920c889760039efe670305fc574377ca815c4944) cost **0.00055260002765763 USDC**. The hosted API returns Market, Limit, bracket/protection and Autopilot enabled, with cirBTC mapping and live OKX history ready. Individual owner orders/vaults and remaining acceptance retain their existing controls. Circle email wallets stay disabled.

## USDC locations

At 2026-10-07T17:48:49.184Z, the configured payment recipient remains **0xa05b83c9a2228b1f4e32952a71e5b189df4f3973**. Arc service payments credit its Circle Gateway balance. Its ordinary wallet balance is zero; this does not imply the Gateway proceeds are missing.

| Location | USDC |
| --- | ---: |
| Buyer wallet (0xa7d827622c4f9c884ca8f751b2060dd767f18683) | 0.912159778152194113 |
| Buyer Gateway, domain 26 | 0.106500 |
| Recipient Gateway, domain 26 | 3.900000 |
| Confirmed gas across 99 owner transactions | 0.44117018185679908 |
| Prior instant Gateway withdrawal fee | 0.0035 |
| Net trade/USDC precision adjustment, reconciled residual | 0.002741039991006807 |

These balances and costs reconcile the historical opening **5.366071 USDC**. Native wallet USDC and its six-decimal ERC-20 view are one balance and are counted once. Qualification records account for **3.10 USDC** of earlier reports/pass charges. The HAR directly shows successful **0.30 USDC Prediction Pro** and **0.20 USDC Risk Guard** payments to the same recipient. It does not contain private job response bodies; uncaptured payment timing is not assigned to a particular private job. No HAR credentials were replayed.

[Circle’s seller flow](https://www.circle.com/fr/blog/turn-your-api-into-a-storefront-for-agents) describes receiving Gateway credits and then withdrawing to a wallet. Connect the recipient wallet, fund its ordinary Arc wallet with USDC for mint gas, then use **Wallet & funding → Withdraw to wallet**. The 3.9 USDC Gateway balance cannot itself pay that mint transaction’s gas. An unsigned production estimate returned **3.89615 USDC received**, **0.00385 USDC maximum Gateway fee**, and **3.9 USDC maximum debit**. No seller withdrawal was signed or submitted by this audit.

## Fixes and evidence

All payment challenges, validation, browser checks and metadata now use **PAY_TO_ADDRESS / VITE_PAY_TO_ADDRESS**. Deprecated Circle recipient variables no longer select another payee. Deposit Max reads live native USDC, floors to six decimals and reserves approval/deposit gas. Deposit checks balance and gas again after approval. Withdrawal Max subtracts a live maximum fee and rechecks available Gateway USDC; it does not sign. Mobile flows avoid redundant Arc switching, use public RPC gas reads, explain an empty gas wallet, and decode nested wallet errors instead of showing [object Object].

The cirBTC limit estimate now floors to eight decimals before display and signing. Arc workers reject stale OKX observations and non-reviewed on-chain order assets before oracle or trading writes. Base and Arbitrum market policy is unchanged.

The HAR has **252 requests**, **no recorded server 5xx**, one canceled opportunities request, and three missing third-party token logos. Its two 402 challenges are followed by successful paid responses. Response bodies were omitted from the export. Risk Guard’s longest request was about 17 seconds. Existing logo fallback covers missing images.

[Machine-readable audit](ARC_MAINNET_GATEWAY_AUDIT_2026-10-07.json) and [public receipt movements](ARC_MAINNET_USDC_RECEIPTS_2026-10-07.json) contain evidence without keys, cookies, recovery tokens or payment signatures. The only new on-chain action by this continuation was the authorized unpause; no new paid services, trades, seller withdrawals, hosting deployment or push occurred. The local changes are prepared for the owner’s manual release. Remaining physical mobile signing and production Circle acceptance are not certified by an isolated browser fixture.


## Validation

341 API tests passed (one optional Redis fixture skipped), 160 web tests, 38 payment tests, 10 config tests, eight Arc worker tests, and seven cloud export tests passed. API/frontend builds and qualification-script TypeScript checks passed. An isolated 390px browser fixture checked fee-aware withdrawal Max, gas-reserving deposit Max, the zero-gas block, readable nested mobile error, Chinese copy and 44px Max controls without horizontal overflow. Desktop was also checked; host DPI yielded an actual 2160px CSS viewport. The fixture refused its synthetic signing attempt and performed no real wallet signing, Gateway transfer, deposit or withdrawal.
