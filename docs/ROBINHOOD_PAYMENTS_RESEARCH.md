# Robinhood mainnet payment readiness

Checked 2026-09-19 UTC. Payment research and unsigned validation only: no USDG spent,
no payment signatures submitted and no `/settle` calls. Contract deployment was
subsequently completed with owner-funded ETH (see deployment update below). Provider
claims and capability discovery are not proof of successful PULSE settlement.

## Decision

Use **USDG with standard x402 v2 `exact` / EIP-3009**, through a configurable
facilitator. Qualify Primer first; keep Aeron as another candidate, not an
automatic failover. Production enablement remains blocked on successful paid
end-to-end tests, operational terms and the readiness checks below. Leave all
existing PULSE payment routes unchanged during qualification.

Neither an OKX wallet connection nor an EVM-compatible SDK implies that its
hosted payment facilitator supports the selected chain.

## Provider comparison

| Provider | Evidence | PULSE conclusion |
| --- | --- | --- |
| OKX | [Official matrix](https://web3.okx.com/onchainos/dev-docs/home/supported-chain) lists Robinhood wallet, trade and market support, but no payments | Can investigate trading/funding separately; cannot use its payment adapter for Robinhood now |
| Coinbase CDP | [Hosted facilitator networks](https://docs.cdp.coinbase.com/x402/support/faq) omit Robinhood; authenticated live `/supported` also omitted `eip155:4663` | Existing CDP adapter cannot settle Robinhood payments; open-source x402 SDK is still usable with another facilitator |
| Circle | [Gateway chain list](https://developers.circle.com/gateway/references/supported-blockchains) omits Robinhood; [nanopayments](https://developers.circle.com/agent-stack/agent-nanopayments) use USDC | Not a USDG-on-Robinhood solution; do not silently substitute another asset/network |
| Primer | [Docs](https://docs.primer.systems/facilitator.html) advertise Robinhood and USDG EIP-3009. Live `/supported` returned v2 exact on 4663; unsigned empty `/verify` returned `isValid:false` | First interoperability candidate. Production fees, limits, reliability and actual settlement still need validation |
| Aeron | [Facilitator](https://x402.aeron.sh/) advertises USDG EIP-3009; live `/supported` returned v2 exact. Empty `/verify` rejected with HTTP 400 | Candidate with time-limited sponsorship; not a permanently free dependency |
| Vantis | [Provider site](https://facilitator.vantis.sh/) advertises USDG exact/EIP-3009 but labels the surface POC. Live supported response matched; empty verification returned HTTP 401 | Requires merchant credentials and operational qualification before integration |
| Canopy | [Provider site](https://facilitator.canopyfinance.io/) and live capabilities expose `exact-permit2-v2`, service ID and custom witness/spender | Not a drop-in replacement for standard exact/EIP-3009; additional allowance and contract review required |
| Self-hosted | Standard x402 EVM settlement can be operated with a funded relayer | Avoids reliance on a sponsored public endpoint, but adds ETH gas, hot-key security, abuse controls and maintenance; not free |

Aeron's [gas policy](https://docs.aeron.sh/x402/gas/) limits its sponsored window
to September 30, 2026 and a shared one-million-settlement allowance; credits are
planned from October 1. Pricing was not specified in the reviewed policy.
Its [documentation](https://docs.aeron.sh/) also states that the implementation
has not been audited. Some reference examples still show v1, while live
capabilities advertise v2: test the actual v2 wire format before enabling it.
No permanent-free or production-SLA claim was established for these candidates.

## Independently checked chain facts

Official [Robinhood connection details](https://docs.robinhood.com/chain/connecting/)
and [contracts](https://docs.robinhood.com/chain/contracts/) were checked against
mainnet RPC:

- Chain ID: 4663; live blocks observed.
- USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`; bytecode present,
  symbol USDG, name Global Dollar, decimals 6.
- USDG `DOMAIN_SEPARATOR()` matched EIP-712 name `Global Dollar`, version `1`,
  chain ID 4663 and that exact token address. This alone is not a full transfer test.
- WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`; bytecode present,
  symbol/name WETH, decimals 18.
- Existing manifest deployer `0xA7d827622c4F9c884cA8F751b2060DD767F18683`
  initially had **0 ETH**; the owner later funded it and deployment completed.
  Estimate required gas before further transactions. Relayed payment gas does
  not cover PULSE contract deployments, swaps or owner transactions.

GeckoTerminal network discovery returned ID `robinhood`. Pool/token evidence
must still be checked against exact contract identities. Blockscout's USDG
contract API returned HTTP 403 from this environment; do not treat this as an
unverified contract, a safe token, or a working explorer integration.

## Implementation and release gates

1. Explicit USDG price object (six decimals), recipient and checked domain;
   never the SDK's default `$price` to USDC mapping. The staged builder is in
   `packages/payments/src/robinhoodPayment.ts`; it is not routed into production.
2. Server-only facilitator URL/auth configuration, startup validation, bounded
   timeouts and advertised protocol/chain checks. Do not expose credentials to
   browsers or reuse Coinbase credentials with a third-party host.
3. Invalid research input, unsupported tokens and invalid vault ownership/setup
   must fail **before** a challenge. Reuse current input and ownership checks.
4. Independently validate the authorization, chain, asset, recipient, amount and
   signature domain. Use existing x402 libraries, not bespoke signing code.
5. Persist payment attempt and recovery identity before settlement. Treat a
   timeout or pending hash as an uncertain payment, not a declined payment.
   Reconcile receipt and nonce before retrying. Do not create a new authorization
   or switch facilitators blindly after an ambiguous settlement.
6. Deliver research / credit an Entry Pass once, only after confirmed settlement.
   Reuse paid recovery, receipt/transaction deduplication and paused timer rules.
   Reject a facilitator's success claim if independent receipt/transfer evidence
   does not match the authorized payment. Define confirmation/finality policy.
7. Test all catalog prices, wrong chain/asset/signature/recipient, expiration,
   insufficient balance, replay, timeout-after-broadcast, provider outage,
   reload recovery and report delivery failures without charging twice.
8. Validate ETH→USDG and asset/USDG quotes separately: supported payment rails
   do not establish swap liquidity, router approval safety or Autopilot readiness.
9. Only enable the network in the UI once its capabilities are honestly gated;
   incomplete trading or contract deployment must not look ready.

## Reproduce the read-only checks

```powershell
npx.cmd tsx scripts/robinhood-readiness.ts --run
# Optional malformed, unsigned verification request; still never calls /settle:
npx.cmd tsx scripts/robinhood-readiness.ts --run --verify-invalid
npx.cmd tsx --test packages/payments/src/robinhoodPayment.test.ts
```

The probe reads local CDP credentials only for authenticated capability discovery
at Coinbase's fixed official host. It does not read a private key, sign, approve,
swap, deploy or settle. Output contains public metadata and sanitized errors.

Validation on September 19: payment package build and all 14 payment tests passed,
including an installed-SDK check for explicit USDG requirements; web TypeScript
and six appearance/routing tests passed. Robinhood landing browser fixtures passed
at 390px and 1440px. These are local checks, not mainnet settlement certification.

## Deployment update

September 20 decision: the owner chose an embedded self-hosted SDK facilitator to
avoid a private operator dependency. See [implementation and operator guide](ROBINHOOD_SELF_HOSTED_FACILITATOR.md).
Third-party paid settlement was not tested; lack of qualification is not proof
that those providers are broken. The self-hosted path also requires qualification.

The six current PULSE contracts were deployed and verified on Robinhood mainnet
after owner funding. `packages/contracts/deployments/4663.json` is the authoritative
record, including every transaction and Sourcify exact-match result. Deployment
and initial configuration receipt gas totals are approximately 0.00047 ETH. Registry automation
remains paused, and no trading router/spender or execution roles were enabled.
No USDG payment was executed; do not conflate deployment with working payments.

New seller integration: `packages/payments/src/robinhoodServer.ts` initializes the
official x402 SDK against a selected, allowlisted facilitator and builds explicit
USDG requirements only after live capability discovery. It is not wired into
production routes yet. Do not enable settlement without durable recovery and
independent transaction validation described above.
