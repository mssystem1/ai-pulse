/** Read-only factory simulations; never signs or sends a transaction. */
import { config } from "dotenv";
import { createPublicClient, encodeFunctionData, formatEther, http, keccak256, parseAbi, toHex, type Address } from "viem";
async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContracts } = await import("../apps/api/src/executionContracts.js");
  const { ROBINHOOD_USDG } = await import("../apps/api/src/robinhoodExecutionAssets.js");
  const cfg = loadConfig(), contracts = executionContracts("robinhood");
  const account = cfg.TEST_WALLET_ADDRESS as Address;
  const rpc = createPublicClient({ transport: http(cfg.ROBINHOOD_RPC_URL, { timeout: 15_000, retryCount: 0 }) });
  if (await rpc.getChainId() !== 4663) throw new Error();
  const fees = await rpc.estimateFeesPerGas();
  const balance = await rpc.getBalance({ address: account });
  const tests = [
    { name: "Autopilot account", to: contracts.autopilotFactory, data: encodeFunctionData({ abi: parseAbi(["function createVault(address,bytes32) returns(address)"]), functionName: "createVault", args: [ROBINHOOD_USDG, keccak256(toHex("PULSE bounded qualification estimate"))] }) },
    { name: "Spot limit account", to: contracts.spotLimitFactory, data: encodeFunctionData({ abi: parseAbi(["function createAccount() returns(address)"]), functionName: "createAccount" }) },
  ];
  let total = 0n;
  for (const test of tests) {
    if (!test.to) throw new Error();
    const gas = await rpc.estimateGas({ account, to: test.to, data: test.data });
    const maxCost = gas * 125n / 100n * fees.maxFeePerGas;
    total += maxCost;
    console.log(JSON.stringify({ accountType: test.name, estimatedGas: gas.toString(), bufferedMaxETH: formatEther(maxCost) }));
  }
  console.log(JSON.stringify({ wallet: account, balanceETH: formatEther(balance), totalFactoryBufferETH: formatEther(total), remainingAfterFactoriesETH: formatEther(balance - total), configurationAndExecutionNotIncluded: true, broadcast: false }));
}
main().catch(() => { console.error("Read-only account estimate unavailable; no transaction sent."); process.exitCode = 1; });
