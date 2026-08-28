# PULSE V6 Contract Deployment and Address Guide

The V6 contracts are non-upgradeable deployments. X Layer, Base, and Arbitrum receive separate instances and separate environment addresses. Arc Testnet receives none because Spot and Autopilot are disabled there.

## Contracts

- `PulseRegistryV1`: approved adapters, Spot keepers, Autopilot executors, and emergency automation pause.
- `OracleRouterV1`: fresh bounded price observations used for automatic Spot triggers.
- `SpotOrderAccountFactoryV1`: creates one owner-controlled TP/SL/OCO protection account per wallet.
- `SpotOrderAccountV1`: holds only explicitly allocated protected Spot assets and enforces TP/SL/OCO trigger checks.
- `SpotOrderAccountFactoryV2` / `SpotOrderAccountV2`: separate directional buy-below/sell-above limit account with minimum output and batch cancellation.
- `AutopilotVaultFactoryV2` / `AutopilotVaultV2`: isolated vault with asset allowlist, oracle-valued trade/exposure caps, slippage/drawdown/turnover limits, replay protection and owner recovery.

## Compile and test

```powershell
npm install
npm run build -w @pulse/contracts
npm run test -w @pulse/contracts
```

Artifacts are written to `packages/contracts/artifacts`. Compilation is pinned to Solidity 0.8.26, IR compilation, and optimizer runs set to 500.

Before deployment, complete independent review, static analysis, fuzz/invariant testing and fork simulations. The included compilation, source checks and public source verification do not replace an independent audit. Use minimal canary capital until that review is complete.

## Deployment identities

Set these server/operator secrets:

```dotenv
CONTRACT_DEPLOYER_PRIVATE_KEY=<0x_PRIVATE_KEY>
CONTRACT_GUARDIAN_ADDRESS=<EMERGENCY_PAUSE_ADDRESS>
ORACLE_UPDATER_ADDRESS=<ORACLE_PUBLISHER_ADDRESS>
TEST_WALLET_ADDRESS=<EXPECTED_DEPLOYER_ADDRESS_FOR_CERTIFICATION>
```

If `CONTRACT_DEPLOYER_PRIVATE_KEY` is absent, the script accepts `TEST_WALLET_PRIVATE_KEY`. When `TEST_WALLET_ADDRESS` is present, the script refuses to deploy if the key derives another address.

Use a dedicated funded deployer. Confirm the native-token balance and an explicit maximum deployment budget before each mainnet run.

## Deploy

```powershell
npm run deploy:xlayer -w @pulse/contracts
npm run deploy:base -w @pulse/contracts
npm run deploy:arbitrum -w @pulse/contracts
```

Each command waits for confirmations, writes `packages/contracts/deployments/<chainId>.json`, and prints the four public environment assignments.

## Environment addresses

Copy only successfully deployed and verified public addresses:

```dotenv
XLAYER_PULSE_REGISTRY_ADDRESS=0x814469ebed3a8466266a9fa9cdf78c381c16a146
XLAYER_ORACLE_ROUTER_ADDRESS=0x3df7a41d0b07ffcd25ecba43e9b4620c627ba8b0
XLAYER_SPOT_ORDER_FACTORY_ADDRESS=0x68faa8b82f9d305a193ba3640de9526479b66c54
XLAYER_SPOT_LIMIT_FACTORY_ADDRESS=0x3f53ed46e18152ac6903e49450e7b227b5236098
XLAYER_SPOT_BRACKET_FACTORY_ADDRESS=0x073784ac4aaadf755a887880280519535c584bfb
XLAYER_AUTOPILOT_VAULT_FACTORY_ADDRESS=0xd0fc9d162adde054479d7550a1b9a38f4a2ddc96

BASE_PULSE_REGISTRY_ADDRESS=0xa1fef7c527c0e039cb4724bd3a86ccfe49d4c169
BASE_ORACLE_ROUTER_ADDRESS=0x1448df2bda5f9bd4a53c8e3fdb123d15e4e6e33d
BASE_SPOT_ORDER_FACTORY_ADDRESS=0x70c8fe8080e43e9e11e61cbaf1ce17b2754183b3
BASE_SPOT_LIMIT_FACTORY_ADDRESS=0x6d63ac4e6845298d7a79c69f63531695cdc5aaa7
BASE_SPOT_BRACKET_FACTORY_ADDRESS=0x9fb833745c28d0a91a0afb58e6ae64dc0637b4c1
BASE_AUTOPILOT_VAULT_FACTORY_ADDRESS=0x8eb18bdce830a7ec6e342c50d9f693f6d7b03cc2

ARBITRUM_PULSE_REGISTRY_ADDRESS=0xe54dc99228463dad2c4f2762c9e1baf2d6f2ee07
ARBITRUM_ORACLE_ROUTER_ADDRESS=0xc2cf8dd0ba67142c539053c51fc1da9cc52e1af3
ARBITRUM_SPOT_ORDER_FACTORY_ADDRESS=0x951ac8cb1524a7856b2940966ab9751c2259af63
ARBITRUM_SPOT_LIMIT_FACTORY_ADDRESS=0x8f34357586bbb2c74d46b68ac71e8238bb3d7f63
ARBITRUM_SPOT_BRACKET_FACTORY_ADDRESS=0x80196239a939c4664cd1a12de3194c92685a929a
ARBITRUM_AUTOPILOT_VAULT_FACTORY_ADDRESS=0x45ba7d5282d0df187803f7f64ce9d7b8dbb4e8ed
```

`SpotBracketAccountFactoryV1` is the OTOCO factory used by “Limit + TP/SL.” Its entry is Pending until filled; a protected fill retains only the received asset under owner-defined TP/SL; either exit pays the owner. The X Layer, Base, and Arbitrum deployments above are verified with Sourcify v2. The Arbitrum factory was deployed in transaction `0x6913937ab5a176d0767ad5367ba02ef1dae56407ffe8d55bfdca5fb0cac171c5`.

The API exposes configured addresses through `GET /v1/trading/capabilities?network=<network>`. The browser never receives deployer, guardian, keeper, executor, oracle-publisher, or test-wallet private keys.

## Source verification

For each contract and chain:

1. Record compiler `0.8.26`, IR/optimizer enabled, 500 runs, constructor arguments, deployment transaction and artifact hash.
2. Submit the exact standard Solidity compiler input and creation transaction to Sourcify v2. The deployment manifests record each completed verification job and result.
3. Read deployed bytecode from two RPC providers and compare it to the locally compiled deployed bytecode after accounting for Solidity metadata.
4. Read the registry/factory immutable references and verify they point to the intended same-chain contracts.
5. Store explorer URLs, transaction receipts, bytecode hashes, role configuration and release ID in the signed deployment manifest/evidence Blob.
6. Do not enable a contract capability until source verification and the canary below pass.

## Post-deployment configuration

1. Add only reviewed execution adapters to `PulseRegistryV1`.
2. Add a funded restricted address as Spot keeper.
3. Add a separate restricted address as Autopilot executor.
4. Configure and test the oracle updater for each protected asset pair.
5. Exercise pause/unpause, keeper revocation and executor revocation.
6. Transfer administration to the documented timelock before public capital.

## Mainnet canary

Use the approved test wallet and smallest practical amounts:

1. Create a Spot Order Account and a Limit + TP/SL bracket account.
2. Approve and create one protected position.
3. Publish a valid oracle observation and prove a non-triggering exit reverts.
4. Trigger TP or SL and confirm only one terminal path succeeds.
5. Create a minimal bracket limit buy, prove it is Pending before its entry trigger, prove the fill becomes Protected, and prove either TP or SL produces one owner payout.
6. Create an Autopilot vault and configure restrictive limits.
7. Fund it with a minimal amount, run one approved action, and prove over-cap/cooldown/replay actions revert.
8. Pause and prove automation fails; prove owner withdrawal still succeeds.
9. Confirm all events reconcile into KV and the correct independent dashboard.

Record every transaction hash, receipt, event, balance delta, and explorer link. A network stays disabled if any expected invariant fails.
