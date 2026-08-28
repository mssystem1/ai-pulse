# PULSE · Wallet, funding, and payment UX

PULSE has one wallet entry point: the header. After connection, that control becomes **Wallet & funding**, shows the current USDT0 balance, and opens a responsive drawer containing account state, OKB/USDT0 balances, payment readiness, and the OKB → USDT0 funding flow.

The layout is designed for desktop and mobile. The main two-column workspace collapses to one column, essential wallet wording stays visible in the narrow header, and the drawer becomes a full-width scrolling surface without horizontal overflow.

## User flow

1. Open **Connect wallet** in the header and choose **OKX Wallet** (preferred) or **Other wallets**.
   - **OKX Wallet** calls the injected OKX EIP-1193 provider directly. PULSE also discovers OKX through EIP-6963 and multi-provider injection, so MetaMask owning `window.ethereum` cannot hide it.
   - **Other wallets** opens Reown AppKit for WalletConnect, MetaMask, Trust Wallet and Base-compatible connectors. AppKit is a fallback; enabling it must never replace the direct OKX path.
2. PULSE switches or adds X Layer (`eip155:196`) and reads native OKB plus USDT0.
3. Open **Wallet & funding** to see both balances and payment readiness.
4. Enter native OKB and request a live OKX Exchange OS quote for USDT0.
5. Review route and price impact, then ask the already-connected wallet to submit the prepared transaction. There is no iframe or second wallet session.
6. Choose a paid analysis or safety action.
7. Immediately before x402 signing, PULSE refreshes USDT0 and compares it with that route's price.
8. If funding is short, signing never starts; PULSE explains the shortfall and opens the drawer.

## Balance and payment rules

| Asset | Address / type | Decimals | Purpose |
| --- | --- | ---: | --- |
| OKB | X Layer native asset | 18 | Network gas and funding input |
| USDT0 (USD₮0) | `0x779ded0c9e1022225f8e0630b35a9b54be713736` | 6 | x402 settlement |

Browser prices live in `apps/web/src/balances.ts`: Global/Prediction Base $0.10, Global/Prediction Premium $0.20, and Onchain Pre-Trade Risk Guard $0.05. The browser guard is UX protection; seller middleware and the facilitator remain authoritative.

Balance reads use the configured X Layer RPC with `eth_getBalance` and ERC-20 `balanceOf`. A paid action always performs a fresh read, so a stale header value cannot authorize an underfunded attempt.

## Connection and disconnect semantics

EIP-1193 has no universal disconnect operation. PULSE therefore makes app-level disconnect authoritative: it clears account/balance/payment state immediately, closes the drawer, persists the choice across reloads, and attempts `wallet_revokePermissions` plus provider-native disconnect when available. An explicit header Connect clears that marker.

PULSE retains the exact selected provider for all later chain switching, x402 typed-data signing, swaps, Spot orders and Autopilot approvals. It does not silently change from OKX to an AppKit wallet after connection.

`accountsChanged` keeps the interface synchronized. An empty list disconnects the app; an allowed new account refreshes both balances.

## Native Exchange OS integration

PULSE deliberately owns the small swap surface instead of embedding a second wallet application:

```text
amount → PULSE API → authenticated OKX Exchange OS quote
review → PULSE API → authenticated OKX Exchange OS swap preparation
unsigned tx → browser validation → connected EIP-1193 wallet
```

- Pair and chain are fixed to X Layer native OKB → USDT0.
- OKX credentials never enter the browser.
- Quote responses are reduced to the fields the UI needs.
- Prepared transaction `from`, `to`, calldata, and native value are validated before the wallet request.
- The wallet—not PULSE—signs and submits `eth_sendTransaction`.
- Native OKB needs no ERC-20 approval transaction.
- A small OKB gas reserve is enforced in the UI.
- The transaction hash links to OKLink.
- **Open OKX DEX** remains a direct external fallback.

The supplied HAR showed that the earlier official widget loaded successfully but maintained a separate iframe wallet boundary, which produced a confusing second **Connect wallet** prompt. The package and adapter were removed. The current design resolves the product problem instead of disguising that prompt.

## Failure behavior

- No injected wallet: show a connection/install error and never request payment.
- Wrong network: request X Layer switch/add before use.
- Balance RPC failure: stop before x402 signing.
- Insufficient USDT0: show required versus available, open the drawer, and do not invoke paid fetch.
- Missing/unauthorized OKX credentials: keep balances available, show a clear quote error, and preserve the external DEX fallback.
- Invalid prepared transaction: reject locally before `eth_sendTransaction`.
- User rejection: display the wallet error without losing the quote or connection.
- Successful x402 response: refresh OKB and USDT0.
- User disconnect: stay disconnected across reload until explicit Connect.

## Safety RPC boundary

The Safety address field supports two intentional paths: choose a chain-196 token from the searchable catalog, or paste any X Layer EVM address manually. Catalog results come primarily from OKX Onchain OS and may be enriched by DexScreener only when the returned pair declares X Layer. The picker labels those sources and states that a listing is not an endorsement or safety check.

The free **Inspect contract on X Layer** action works for any valid EVM address and uses the configured X Layer mainnet RPC. It records chain and block, code presence/size/hash, balance, transaction count, and common EIP-1967/EIP-1167 proxy patterns. These are factual observations, not proof that a contract is safe.

Paid token and pre-trade scores remain deterministic heuristics. Liquidity, holder distribution, tax/honeypot behavior, verified source, and transaction outcomes require indexer, DEX, explorer, simulation, or audit evidence and are never inferred from bytecode presence.

## Acceptance test

1. Connect once and verify header account plus USDT0.
   - With OKX and MetaMask installed together, choose **OKX Wallet** and confirm the OKX popup opens directly—not the generic Reown selector.
   - Disconnect, choose **Other wallets**, and confirm Reown opens only for that explicit choice.
2. Open the drawer and compare OKB/USDT0 with public X Layer RPC/explorer values.
3. Request a live OKB → USDT0 quote; verify route, output, and price impact.
4. Review a prepared transaction and confirm the wallet receives the connected account, exact input value, X Layer target, and calldata.
5. With less USDT0 than a paid action requires, click it and verify no signature is requested.
6. Run contract inspection on USDT0; verify chain 196, deployed bytecode, proxy evidence, current block, and limitations.
7. Open the token catalog, search and select an entry, verify source disclosure, then edit the address manually.
8. Test 390px mobile and desktop widths for clipping, overflow, focus, Escape, and backdrop close.
9. Disconnect, reload, and confirm PULSE remains disconnected; reconnect only from the header.

Do not broadcast a swap or x402 payment during automated UI tests. Submission evidence should use a separately approved, low-value live run.
