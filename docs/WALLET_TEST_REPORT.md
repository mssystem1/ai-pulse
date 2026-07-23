# PULSE · Wallet and x402 verification record

This is a repeatable evidence template, not a claim that the current checkout has completed live settlement. Fill the result column against the final deployment and attach transaction proof privately where appropriate.

## Test context

| Field | Value |
| --- | --- |
| Build / commit | `<COMMIT_SHA>` |
| Date | `<UTC_DATE>` |
| Environment | `<local mock / staging live / production live>` |
| API origin | `<HTTPS_ORIGIN>` |
| Wallet | `<SHORT_ADDRESS>` |
| Network | X Layer · `eip155:196` |
| Settlement asset | USDT0 · `0x779ded0c9e1022225f8e0630b35a9b54be713736` |
| Payment mode from `/healthz` | `<mock / okx>` |

Never paste a private key, full credential, or reusable payment signature into this report.

## Browser checks

| Check | Expected | Result |
| --- | --- | --- |
| Connect wallet | Account connects and switches/adds X Layer | `<PASS/FAIL>` |
| Single connection CTA | No duplicate app-level Connect button outside the sticky header | `<PASS/FAIL>` |
| Native swap account | Swap card uses the header-connected account without another connection | `<PASS/FAIL>` |
| Disconnect persistence | Disconnect, reload, and remain disconnected until explicit Connect | `<PASS/FAIL>` |
| OKB balance | Matches X Layer explorer/RPC | `<PASS/FAIL>` |
| USDT0 balance | Matches ERC-20 balance, 6 decimals | `<PASS/FAIL>` |
| Underfunded action | No signature; exact shortfall shown; drawer opens | `<PASS/FAIL>` |
| Exchange OS defaults | Fixed X Layer, OKB → USDT0 pair; live quote returned | `<PASS/FAIL>` |
| Exchange OS submit | Prepared transaction matches wallet and amount; wallet submits it | `<PASS/FAIL>` |
| Contract evidence | Known X Layer contract returns chain 196, block, code, and limitations | `<PASS/FAIL>` |
| Paid analysis | x402 signature requested only after balance preflight | `<PASS/FAIL>` |
| Post-payment refresh | USDT0 updates after response | `<PASS/FAIL>` |

## Protocol checks

| Check | Expected | Result |
| --- | --- | --- |
| Unpaid paid route | HTTP 402 + `PAYMENT-REQUIRED` | `<PASS/FAIL>` |
| Challenge network | `eip155:196` | `<PASS/FAIL>` |
| Challenge asset | Canonical USDT0 contract | `<PASS/FAIL>` |
| Challenge recipient | Intended deployment recipient | `<PASS/FAIL>` |
| Mock signature | Accepted only when explicitly in mock mode | `<PASS/FAIL>` |
| Live settlement | Facilitator verification and transaction proof | `<PASS/FAIL/N/A>` |
| MCP payment gate | Same price and challenge semantics as REST | `<PASS/FAIL>` |

## Automated commands

```bash
node scripts/check-wallet.mjs
npm run build
npm test
node scripts/asp-compliance.mjs https://YOUR_DOMAIN
```

Use `RUN_LIVE_PAY=1 node scripts/asp-compliance.mjs https://YOUR_DOMAIN` or `node scripts/e2e-paid.mjs` only with the intended controlled wallet configuration. Confirm funding, route prices, and recipient before execution.

## Acceptance rule

Mock mode is valid development evidence for challenge shape and route gating, but it is not live-payment proof. A winner-ready release needs one documented low-value payment through the OKX facilitator and a clean final run of [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md).
