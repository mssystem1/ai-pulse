# Corrected PULSE 100-wallet environment architecture

Only the wallet-storage architecture is changed. The funding and PULSE payment
logic remain:

```text
1. Generate 100 wallets
        ↓
2. Store all 100 address/private-key pairs in one environment variable
   PULSE_WALLETS_JSON, persisted in .env.wallets
        ↓
3. Funding script reads only the 100 addresses
   native MON on Monad
        → Relay EXACT_OUTPUT route
        → 0.11 USDT0 on X Layer for each address
        ↓
4. PULSE runner reads the matching private keys
   10 confirmed x402 token-scan usages per sufficiently funded wallet
```

There is no Monad USDT0 input token. The Relay funding source is native MON,
represented by:

```text
0x0000000000000000000000000000000000000000
```

## Files

- `wallet-registry.mjs`
- `generate-100-wallets-env.mjs`
- `fund-100-xlayer-from-monad-relay.mjs`
- `pulse-token-scan-100-wallets.mjs`
- `.env.example`

Place all MJS files in the PULSE repository `scripts` directory.

## 1. Install

```powershell
npm install
npm run build -w @pulse/buyer
```

Add to `.gitignore`:

```gitignore
.env
.env.wallets
*-results.json
relay-monad-xlayer-funding-*.json
```

## 2. Generate 100 wallets

```powershell
node .\scripts\100wallets\generate-100-wallets-env.mjs
```

The generator writes:

```text
.env.wallets
```

with one variable:

```env
PULSE_WALLETS_JSON='[{"id":"pulse-wallet-001","address":"0x...","privateKey":"0x..."},...]'
```

A generator process cannot permanently modify its parent shell environment,
so `.env.wallets` is the persistent source. The later scripts load it into
`process.env`.

## 3. Fund their X Layer addresses with native MON through Relay

The funding script loads the same registry with `requirePrivateKeys: false` and
uses only each wallet's public address.

Configure `.env`:

```env
CONFIRM_LIVE_BRIDGE=YES
MONAD_RPC_URL=https://YOUR_MONAD_RPC
MONAD_TREASURY_PRIVATE_KEY=0xYOUR_MONAD_TREASURY_PRIVATE_KEY

X_LAYER_RPC_URL=https://rpc.xlayer.tech
XLAYER_USDT0_ADDRESS=0x779ded0c9e1022225f8e0630b35a9b54be713736
TARGET_USDT0_PER_WALLET=0.11

# Expressed in MON; choose after reviewing a live Relay quote.
MAX_SOURCE_PER_WALLET=
MAX_TOTAL_SOURCE_SPEND=
MIN_MON_GAS_RESERVE=0.01
```

Run:

```powershell
node .\scripts\100wallets\fund-100-xlayer-from-monad-relay.mjs
```

For every generated address, it requests an `EXACT_OUTPUT` quote:

```text
native MON on Monad → exactly the missing USDT0 amount on X Layer
```

Wallets already holding at least 0.11 USDT0 are skipped.

## 4. Perform PULSE usages with the generated private keys

The PULSE runner loads the same registry with `requirePrivateKeys: true`.
It verifies that every private key derives the stored address.

Configure:

```env
CONFIRM_LIVE_PAY=YES
```

Run:

```powershell
node .\scripts\100wallets\pulse-token-scan-100-wallets.mjs
```

The PULSE payment logic is unchanged:

- the wallet must have enough X Layer USDT0;
- each wallet targets 10 confirmed usages;
- underfunded wallets are skipped;
- a success requires the valid PULSE report, payment response, unique
  transaction hash, and successful X Layer receipt.

Maximum target:

```text
100 wallets × 10 confirmed usages = 1,000 confirmed usages
```

## Security

`.env.wallets` contains all 100 private keys. Never commit, upload or expose it
through a frontend variable. Keep an encrypted offline backup before funding.
