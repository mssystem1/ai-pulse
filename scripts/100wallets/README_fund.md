# Direct X Layer funding for 100 generated wallets

This version reads `PULSE_WALLETS_JSON` directly. It does not import or require
`wallet-registry.mjs`.

For each generated address, it tops balances up to:

```text
0.11 USDT0
0.00006 OKB
```

A fresh wallet receives those exact amounts. A partially funded wallet receives
only the missing amount, making the script safe to resume.

## Files

Place:

```text
fund-100-xlayer-from-treasury.mjs
```

at:

```text
scripts/100wallets/fund-100-xlayer-from-treasury.mjs
```

The generated `.env.wallets` file remains unchanged:

```env
PULSE_WALLETS_JSON='[{"id":"pulse-wallet-001","address":"0x...","privateKey":"0x..."},...]'
```

The script reads only `id` and `address`. It ignores all generated private keys.

## Environment

```env
CONFIRM_LIVE_FUNDING=YES

X_LAYER_TREASURY_PRIVATE_KEY=0xYOUR_X_LAYER_TREASURY_PRIVATE_KEY
X_LAYER_RPC_URL=https://rpc.xlayer.tech
XLAYER_USDT0_ADDRESS=0x779ded0c9e1022225f8e0630b35a9b54be713736

EXPECTED_WALLET_COUNT=100
TARGET_USDT0_PER_WALLET=0.11
TARGET_OKB_PER_WALLET=0.00006

# Kept in the treasury after planned transfers and estimated gas.
TREASURY_OKB_RESERVE=0.001

BALANCE_READ_DELAY_MS=50
TRANSACTION_DELAY_MS=250
RECEIPT_TIMEOUT_MS=120000
GAS_ESTIMATE_BUFFER_PERCENT=30
```

For 100 empty wallets, the destination funding totals are:

```text
11 USDT0
0.006 OKB
```

Additional OKB is required in the treasury for transaction gas and the configured
treasury reserve.

## Run

```powershell
node --check .\scripts\100wallets\fund-100-xlayer-from-treasury.mjs

node .\scripts\100wallets\fund-100-xlayer-from-treasury.mjs
```

## Resume behavior

```text
Wallet has 0 USDT0 and 0 OKB:
  sends 0.11 USDT0 and 0.00006 OKB

Wallet has 0.04 USDT0 and 0.00001 OKB:
  sends 0.07 USDT0 and 0.00005 OKB

Wallet already meets both targets:
  sends nothing
```

The script writes a checkpoint JSON file after every submitted and confirmed
transaction. If a submitted transaction reaches an uncertain state, execution
halts so the wallet is not funded twice during an automatic rerun.
