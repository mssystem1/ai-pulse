# PULSE · Product audit and release gates

Last repository audit: **2026-07-23**. This is an internal implementation audit, not a claim of third-party security certification. Operator-dependent production proof is kept separate from code-level verification.

## Canonical product decision

- Brand: **PULSE**
- Tagline: **OKX spot intelligence. Pay per signal on X Layer.**
- “Preflight” names one composite safety capability and `/v1/preflight`; it is never the product identity.
- Workspace namespace: `@pulse/*`
- Methodology: `pulse-v2.0.0`
- Network: X Layer mainnet · chain `196` · CAIP-2 `eip155:196`
- Settlement asset: USDT0 · `0x779ded0c9e1022225f8e0630b35a9b54be713736`

## Verified repository state

| Area | Evidence | State |
| --- | --- | --- |
| Live OKX market data | `packages/market` calls OKX public spot endpoints | Implemented |
| Market selection | Searchable modal backed by live OKX instruments; arbitrary pair input removed | Implemented |
| X Layer token discovery | Chain-196 OKX Onchain OS catalog with optional DexScreener enrichment and source labels | Implemented; OKX credentials required |
| Grok analysis | `packages/analysis` builds structured reports from OKX OHLCV | Implemented; xAI key required |
| Responsive console | Market/Safety tabs, chart, reports, bilingual states | Implemented |
| Wallet entry point | One connect CTA in sticky header | Implemented |
| Disconnect | Immediate app clear, persisted opt-out, permission revocation attempt | Implemented |
| Balances | Native OKB + USDT0 reads from X Layer RPC | Implemented |
| Payment guard | Fresh USDT0 read before browser x402 signing | Implemented |
| Funding | Native OKB → USDT0 UI backed by OKX Exchange OS DEX API | Implemented; credentials required |
| Wallet handoff | Prepared transaction validated and submitted through the same EIP-1193 provider | Implemented |
| Contract evidence | Live chain/block/code/balance/nonce/common-proxy reads for any X Layer address | Implemented |
| Paid safety | Token and pre-trade deterministic heuristics with limitations | Implemented; prototype methodology |
| REST/MCP/SDK | Structured human and agent surfaces | Implemented |
| Payments | Mock development gate + official OKX x402 seller middleware | Implemented |
| OKX.AI paid replay | Input discovery, POST/body schema, pre-payment token validation, inline paid JSON | Implemented; final-host live proof required |
| Metadata/assets | Runtime ASP metadata and public SVG/PNG routes | Implemented |
| Report continuity | Free ticker/candle refresh does not mutate or clear the current report | Implemented |

## Architecture decision from the HAR audit

The supplied capture contained 1,473 requests. The earlier official DEX widget document and most of its resources loaded; the visible second **Connect wallet** prompt was therefore not a network failure. It came from a separate iframe/wallet-session boundary that was hard for users to understand and impossible to make feel like one continuous PULSE account session across every injected provider.

The final decision is architectural:

1. Remove `@okxweb3/dex-widget`, its provider adapter, React peer workaround, and iframe.
2. Keep exactly one app connection in the header.
3. Request authenticated quote/swap data from the official OKX Exchange OS DEX API on the server.
4. Return only sanitized quote data or an unsigned prepared transaction.
5. Validate wallet, target, calldata shape, and exact native amount in the browser.
6. Ask the already-connected wallet to submit the transaction.

This removes the duplicate connection, eliminates the widget's large transitive dependency graph, and gives desktop/mobile layouts deterministic control. It does not make PULSE a custodian: the server never signs the user's transaction.

## Safety claim boundary

The Safety screen intentionally exposes two evidence levels:

- **Discovery metadata (free):** token identity and available market fields from chain-196 catalog sources. Being listed is not a safety result.
- **Live contract evidence (free):** current X Layer RPC observations—chain, block, runtime bytecode, fingerprint, nonce, balance, and common proxy patterns.
- **Scored safety (paid):** deterministic token/pre-trade heuristics designed for the hackathon product flow.

Safe claims:

- “Live OKX spot ticker and candles.”
- “Grok-powered market scenarios based on OKX OHLCV.”
- “Live X Layer RPC contract evidence.”
- “x402 integration on X Layer with a pre-signature USDT0 balance guard.”
- “Official OKX payment middleware and Exchange OS DEX API integration.”
- “One connected wallet powers balances, funding, and browser signing.”
- “REST, MCP, TypeScript SDK, and bilingual web console.”
- “Searchable live OKX spot instruments and an X Layer token catalog with disclosed sources.”

Claims that are not supported:

- A contract is “safe” because code exists or no common proxy was detected.
- Live holder, liquidity, tax, honeypot, ownership, or wallet-reputation facts from current scored endpoints.
- Safety, verification, or endorsement merely because a token appears in OKX or DexScreener discovery results.
- A cross-chain DexScreener match represented as an X Layer token; the catalog rejects non-X-Layer pair data.
- Transaction simulation, guaranteed execution, or a smart-contract audit.
- Guaranteed profitable or accurate market predictions.
- Production settlement, OKX.AI listing, user volume, or third-party audit without external proof.

## Security and operational risks

### Exchange OS trust boundary

OKX API credentials stay server-side and authenticate quote/swap requests. The browser receives prepared transaction data and validates its own address and exact native value before presenting it to the wallet. The user must still inspect and approve the wallet prompt. Add server-side rate limiting/abuse controls at the deployment edge and monitor OKX quota/errors.

### Payment modes

The service can operate in mock mode. `/healthz` exposes `paymentMode`. A production release fails if it is not `okx`; a shaped 402 response is not settlement proof.

The OKX.AI task client first probes a paid endpoint without business input. PULSE returns `400 input_required`, then a valid POST returns the 402 challenge and machine-readable body schema. The paid replay returns its result inline. For x402 tasks, deliverable persistence is performed by the buyer CLI after a successful replay; `direct-accept` itself does not call PULSE or carry service output.

The `*.vercel.app` hostname was blocked by a moderator-side deploy-tool policy.
The web deployment remains functional, while the marketplace service now uses the
separate Railway origin `https://pulse-api-production-8d1f.up.railway.app`. Agent
#8355 must advertise the Railway REST, MCP, metadata, and brand URLs.

### Operator checkout

`/v1/checkout` can use a server-held test key only when explicitly enabled outside
production. It is for controlled local E2E verification, not product-user
payments. The configuration forces it off when `NODE_ENV=production`; public
environments must also set `ENABLE_SERVER_PAY=0` and omit test private keys.

### Contract evidence limits

Public RPC state can change between reads and submission. Common EIP-1967/EIP-1167 detection is not exhaustive. Current inspection does not fetch verified source, trace transactions, execute simulations, or audit logic. Its response states all three limitations.

### Token catalog trust boundary

The catalog is for address discovery, not risk certification. Its primary inventory comes from authenticated OKX Onchain OS chain `196` token endpoints. DexScreener search/enrichment is accepted only when the returned pair declares X Layer; absent coverage is treated as absent enrichment, never replaced with a same-name token from another chain. External price, liquidity, image, and token metadata can be stale or user-influenced. The UI discloses sources and keeps manual address entry available.

### Report persistence

Pre-trade reports use process-local memory. Share IDs are not durable across serverless cold starts or deployments. Do not promise durable history until external storage is added.

### Frontend bundle

The x402/viem browser buyer is dynamically imported only when a paid request begins. It remains a sizeable lazy chunk but no longer blocks first render. This is a performance consideration, not an embedded DEX dependency or Vercel compatibility blocker.

### Dependency audit

The 2026-08-20 V6 audit reports 12 production findings (11 moderate, 1 high). They are transitive dependencies of Circle's current `@circle-fin/w3s-pw-web-sdk@1.1.11`: Firebase 10.14.1 pins vulnerable Undici 6.x builds and the Circle package pins UUID 9.x. npm offers only a downgrade to Circle SDK 1.0.13, which is not a safe or compatible remediation. PULSE confines that SDK to the Arc Testnet email-wallet path; Spot and Autopilot are hidden on Arc and do not import it in their API workers. Track the upstream Circle release and upgrade once it carries patched dependencies. Do not use `npm audit fix --force` or pretend an ineffective nested override resolved these findings. The full tree currently reports 20 findings (7 low, 11 moderate, 2 high), including development tooling.

## Completed local verification

- [x] Marketplace avatar is a real 512×512 PNG, under 1 MB, with square outer corners
- [x] PNG and SVG use the same PULSE waveform identity
- [x] Production x402 token scan settled 0.01 USDT0 on X Layer and returned the
  complete `token_scan` report inline (`riskScore: 96.1`, components present)
- [x] Settlement receipt succeeded in block `66052371`:
  `0x58283dc47cd8285a5e8a3ec99b10697482004bd09fb488dfee11ef1fe2e4aab2`
- [x] On-chain `Transfer` evidence is exactly `10000` atomic USDT0 to the configured
  `PAY_TO_ADDRESS`
- [x] The compliance runner makes only the explicitly enabled $0.01 REST proof;
  optional MCP settlement requires a separate `RUN_LIVE_MCP_PAY=1` authorization

- [x] Monorepo TypeScript/Vite production build passes
- [x] Official DEX widget dependency removed from the workspace graph
- [x] Exchange OS quote returned a real X Layer OKB → USDT0 route
- [x] Exchange OS swap endpoint returned an unsigned transaction without broadcasting
- [x] Browser handoff reached `eth_sendTransaction` using a non-broadcasting test provider
- [x] Public wallet address showed non-zero OKB and USDT0 from X Layer RPC
- [x] Disconnect cleared the UI, attempted revocation, and survived reload
- [x] Only one disconnected-state Connect button was present
- [x] USDT0 contract inspection returned chain 196, bytecode, block, and EIP-1967 implementation evidence
- [x] Pair selector returned ranked live OKX instruments and selected ETH-USDT without manual symbol entry
- [x] X Layer catalog returned chain 196 tokens, token addresses, source labels, and market metadata
- [x] Selecting a catalog token populated the safety address while manual entry remained available
- [x] A free market refresh preserved an existing live contract-evidence report
- [x] Token scan GET discovery returns `400 input_required` with an address field
- [x] Valid unpaid token scan exposes a POST/body `outputSchema` and x402 `accepts[]`
- [x] Invalid or non-X-Layer token scans fail before the payment gate
- [x] Paid mock replay returns the complete `token_scan` JSON and `PAYMENT-RESPONSE`
- [x] Onchain OS `payment quote` resolves `address` and `chainId` to body carriers
- [x] Production dependency audit reviewed; current Circle SDK transitive exceptions documented
- [x] Desktop and 390px mobile picker dialogs were inspected for viewport containment and horizontal overflow
- [x] Secret/private-key values were not printed or embedded in browser code
- [x] Mobile Lighthouse rerun: Accessibility 100, Best Practices 100, SEO 100, Agentic Browsing 100; 0 failed checks
- [x] `npm audit --omit=dev`: 12 findings reviewed on 2026-08-20; all trace to the isolated Circle browser-wallet dependency tree

## Release checklist

### Code

- [ ] Clean-checkout `npm install` succeeds
- [ ] `npm run build` passes on the release commit
- [ ] `npm test` passes on the release commit
- [ ] `npm audit --omit=dev` is reviewed; fixes/exceptions are documented
- [ ] No stale product name, widget dependency, secret, or test key is committed

### Product

- [ ] Final English and Chinese copy renders correctly
- [ ] Desktop and 390px mobile empty/loading/error/success states are inspected
- [ ] Market and token picker search/selection/empty/error states are inspected against the deployed APIs
- [ ] Escape, backdrop, scroll lock, focus order, and visible focus are checked
- [ ] Disconnect → reload remains disconnected; reconnect works only from the header
- [ ] Live quote and prepared transaction use the intended account, chain, pair, and amount
- [ ] Insufficient USDT0 never opens a signature request
- [ ] Contract evidence and heuristic limitations remain visible
- [ ] Catalog disclosure remains visible and no listing is presented as a safety endorsement
- [ ] Direct OKX DEX and OKLink transaction links work

### Deployment

- [ ] Canonical HTTPS origin and rollback deployment are ready
- [ ] `PAY_TO_ADDRESS`, prices, network, and asset are independently verified
- [ ] `/healthz` shows `paymentMode: okx`, OKX credentials, and xAI readiness
- [ ] Exchange OS quote works from the deployed API without exposing credentials
- [ ] One approved low-value x402 settlement has transaction proof
- [ ] One approved low-value OKB → USDT0 swap has transaction proof, if shown as live
- [ ] MCP free and paid calls work from the final endpoint
- [ ] Metadata has no localhost/preview URLs; logos load in incognito

### Submission

- [ ] PULSE identity matches app, README, metadata, listing, video, and post
- [ ] Demo uses the final deployment and labels mock footage honestly
- [ ] All placeholders are replaced
- [ ] No statement exceeds the verified evidence above
- [ ] Listing URL and approved transaction proof are archived
