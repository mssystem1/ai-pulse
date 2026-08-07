# PULSE token scan — 10 successful usages

This archive contains `pulse-token-scan-10-successes.mjs`.

The script finishes successfully only after receiving exactly **10 validated**
paid token-scan responses. A response counts only when it returns HTTP 200,
contains a `PAYMENT-RESPONSE` receipt, identifies `service: "token_scan"`,
matches the requested token address, and contains the `components` array.

## Install

Put the script in the `scripts` directory of the `mssystem1/Pulse` repository.

From the repository root:

```powershell
npm install
npm run build -w @pulse/buyer
```

## Configure

Create or edit `.env` in the repository root:

```env
TEST_WALLET_PRIVATE_KEY=YOUR_TEST_WALLET_PRIVATE_KEY
CONFIRM_LIVE_PAY=YES

TOKEN_ADDRESS=0x779ded0c9e1022225f8e0630b35a9b54be713736
PULSE_ENDPOINT=https://pulse-api-production-8d1f.up.railway.app/v1/token/scan

MAX_ATTEMPTS=20
RETRY_DELAY_MS=2000
```

Optional strict recipient protection:

```env
EXPECTED_PAY_TO=0xYOUR_VERIFIED_PROVIDER_PAYMENT_ADDRESS
```

## Run

```powershell
node .\scripts\pulse-token-scan-10-successes.mjs
```

The script writes a checkpoint JSON file after every successful or failed
attempt. It exits with code 0 only after `10/10` successful usages.

At a price of 0.01 USDT0 per successful usage, 10 successes normally cost
0.10 USDT0. Retries can increase the amount spent when a payment settles but
the response is malformed or unavailable, so use a disposable test wallet and
review `MAX_ATTEMPTS`.
