# Autopilot incident fixes — local verification

September 10, 2026. Application changes are local, not deployed. The PULSE-only
database import is complete; the API remains stopped. No real pass payments or
mainnet wallet transactions were sent during verification.

| Issue | Local correction | Verification |
| --- | --- | --- |
| Early/missing pass expiry | Durable entitlement reads fail explicitly instead of inventing expiry from an empty process cache. Atomic updates preserve renewals and signal usage. New pass timers reconcile verified pause/resume receipt timestamps, including delayed indexing. | Timer regression tests and concurrent live Railway Redis checks |
| Blockscout 503 | PRO keys use the unified chain gateway. Temporary REST failures have one indexed legacy fallback for token/source/holders; authentication failures are not retried. | Live Base AERO and Arbitrum USDC legacy checks; complete AERO evidence collection succeeded with all three Blockscout v2 sources; fallback/auth tests |
| Shortlist reloads | Expanding cards is local state. Auto-refresh and already-in-flight background updates cannot replace expanded cards; collapse is a separate action. | Global, Spot and Autopilot browser fixtures at 1440px and 390px |
| Funded vaults missing after incomplete setup | Dashboard includes all factory accounts, numbered in factory order, including unfinished registrations. Readiness checks precede wallet transactions. Registration/storage problems block pass challenges rather than incorrectly declaring non-ownership. | Four-account browser fixture, registration/payment precheck tests |
| Resume and pause controls | Resume requires a funded, registered, paused vault and a valid entry entitlement, or an existing position needing exit protection. Incomplete setup and unavailable storage disable checkout. Paid renewal retains the owner-confirmed resume flow. | Control-state tests, renewal tests and desktop/mobile browser checks |
| Misleading setup failure after payment/resume | A later refresh failure preserves the confirmed payment/resume outcome instead of claiming the vault is still paused or inviting another payment. | Setup-outcome regression test; web build |

The full repository test command, API build and web production build passed.
Live destination tests covered job idempotency, receipt/queue atomicity, exclusive
leases, budget reservations, pass updates, encrypted Blob recovery and share
revocation. Isolated Redis/Blob test records were removed afterward.
One repeated public-TCP integration run failed on a transient connection error;
its six leftover fixture records were identified and removed explicitly. A full
rerun then passed and cleaned up successfully. Production should use the private
Railway connection, with persistence and backups configured separately.

## Not completed by these local changes

- Production deployment and the Redis cutover remain under the owner's control.
- Upstash SCAN remains quota-blocked, but its RDB export has been restored:
  1,978 PULSE keys verified, 106 unrelated-project keys excluded. Original TTLs
  are preserved, so expired records subsequently disappear normally. Keep the source.
- Old entitlements lost during failed persistence need actual payment evidence
  and reconciliation; no historical paid time has been invented or refunded.
- Existing incomplete strategies must be reviewed and signed by their owner.
  The UI reuses funded vaults; it does not silently fabricate a signed policy.
- Redis now reports AOF enabled, successful writes, `noeviction`, and `/data`
  storage. Browser checks use fixtures; the local EVM uses simulated funds and
  mock payments, not a live facilitator checkout.

## Recovery evidence and additional simulation

- The only `manual_reconciliation` job is an August 31 X Layer Global Quick
  analysis for the test wallet ($0.20), not an Autopilot pass. Its saved receipt
  records settlement, but Grok returned a credits/spending-limit 403 throughout
  regeneration. It remains unchanged; no paid regeneration or refund was initiated.
- Supplied HAR entries show unsigned Base pass requests returning 404. They omit
  response bodies and contain no settled receipt for those attempts. The entries
  are timestamped September 9, while the owner says the capture was September 8;
  treat the capture date as disputed, not independently verified.
- Indexed Base history was checked for **both September 8 and 9** using the test
  wallet address, native USDC transfer events, and Blockscout pagination. No
  outgoing 1.50 USDC pass payment was found in that range. This supports failed
  checkout attempts but does not establish a vault-specific entitlement, justify
  deleting saved passes, or warrant inventing a new expiry. Existing passes remain
  intact. The index reported completed indexing during the check.
- The old registration precheck returned “wallet does not own” when its stored
  strategy lookup returned no match. Missing registration/storage is not proof
  of an on-chain ownership change. The local code reports incomplete registration
  or unavailable storage before payment instead.

`scripts/autopilot-local-workflow.mjs --simulate` passed with the test wallet's
address and a disposable Hardhat chain (31337): real V2 vault/factory bytecode,
asset/risk setup, 0.70 simulated USDC deposit, blocked checkout before registration,
short-lived owner-signed registration to the loopback API, unpaid challenge,
mock pass purchase, resume, four hours of timer runtime, 96 hours paused,
resume with 20 hours retained, expiry, and full owner withdrawal. Production
credentials are cleared before app imports, outbound fetch is restricted to two
loopback origins, storage is memory-only, and background workers are disabled.
The payment itself is deliberately mocked: this is not proof of live settlement.

Latest regression results: API 166/166, web 55/55; web production build passed
with existing dependency/bundle warnings. Browser fixtures using the test wallet
address passed Global/Spot/Autopilot at 1440px and 390px, including four-vault
numbering, resume eligibility, stable shortlist expansion and no horizontal overflow.

See [Railway Redis migration](RAILWAY_REDIS_MIGRATION.md) for configuration,
credential-safe checks and the guarded copy procedure.
