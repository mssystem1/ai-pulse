// Add the missing V1 market-protection factory without replacing the six existing deployments.
import { config } from "dotenv";
import { readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, encodeDeployData, formatEther, getContractAddress, http, keccak256, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

async function main() {
  const root = resolve(import.meta.dirname, "..");
  config({ path: resolve(root, "../../.env"), quiet: true });
  const path = resolve(root, "deployments/4663.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const artifact = JSON.parse(await readFile(resolve(root, "artifacts/SpotOrderAccountFactoryV1.json"), "utf8"));
  const source = JSON.parse(await readFile(resolve(root, "artifacts/standard-input.json"), "utf8"));
  if (manifest.chainId !== 4663 || JSON.stringify(source) !== JSON.stringify(manifest.standardInput)) throw new Error("Protection deployment source snapshot mismatch");
  const key = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY || process.env.TEST_WALLET_PRIVATE_KEY;
  if (!/^0x[\da-f]{64}$/i.test(key || "")) throw new Error("Protection deployment signer unavailable");
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== manifest.deployer.toLowerCase() || account.address.toLowerCase() !== process.env.TEST_WALLET_ADDRESS?.toLowerCase()) throw new Error("Protection deployment signer mismatch");
  const url = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
  const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } };
  const client = createPublicClient({ chain, transport: http(url, { timeout: 15_000, retryCount: 0 }) });
  const wallet = createWalletClient({ account, chain, transport: http(url, { retryCount: 0 }) });
  if (await client.getChainId() !== 4663) throw new Error("Protection deployment wrong chain");
  const lock = await open(`${path}.protection.lock`, "wx");
  try {
    const save = async () => { await writeFile(`${path}.tmp`, JSON.stringify(manifest, null, 2)); await rename(`${path}.tmp`, path); };
    const args = [manifest.contracts.registry.address, manifest.contracts.oracleRouter.address];
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    let entry = manifest.transactions.find(item => item.label === "SpotOrderAccountFactoryV1");
    if (!entry) {
      if (manifest.contracts.spotProtectionFactory) throw new Error("Protection deployment missing original transaction journal");
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      if (nonce !== await client.getTransactionCount({ address: account.address, blockTag: "latest" })) throw new Error("Protection deployment wallet has pending transactions");
      const gas = (await client.estimateGas({ account, data })) * 125n / 100n, fees = await client.estimateFeesPerGas();
      const cost = gas * fees.maxFeePerGas, balance = await client.getBalance({ address: account.address });
      const broadcast = process.argv.includes("--broadcast");
      console.log(JSON.stringify({ contract: artifact.contractName, broadcast, bufferedMaxETH: formatEther(cost), balanceETH: formatEther(balance) }));
      if (cost > parseEther("0.00015") || balance < cost + parseEther("0.00015")) throw new Error("Protection deployment gas budget/reserve unavailable");
      if (!broadcast) return;
      const signed = await wallet.signTransaction({ account, chain, type: "eip1559", nonce, gas, data, value: 0n, ...fees });
      entry = { label: "SpotOrderAccountFactoryV1", hash: keccak256(signed), nonce, dataHash: keccak256(data), status: "signed_not_confirmed", to: null,
        gasLimit: String(gas), maxFeePerGas: String(fees.maxFeePerGas), maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas) };
      manifest.transactions.push(entry); await save();
      if (await client.sendRawTransaction({ serializedTransaction: signed }) !== entry.hash) throw new Error("Protection deployment broadcast mismatch");
    }
    if (entry.dataHash !== keccak256(data)) throw new Error("Protection deployment journal data mismatch");
    const receipt = await client.waitForTransactionReceipt({ hash: entry.hash, confirmations: 5, timeout: 120_000 });
    entry.status = receipt.status; entry.blockNumber = String(receipt.blockNumber); entry.feeETH = formatEther(receipt.gasUsed * receipt.effectiveGasPrice); await save();
    if (receipt.status !== "success" || receipt.from.toLowerCase() !== account.address.toLowerCase() || receipt.contractAddress?.toLowerCase() !== getContractAddress({ from: account.address, nonce: BigInt(entry.nonce) }).toLowerCase()) throw new Error("Protection deployment receipt mismatch");
    const address = receipt.contractAddress;
    const code = await client.getCode({ address });
    if (!code || code === "0x") throw new Error("Protection deployment runtime missing");
    for (const [functionName, expected] of [["registry", args[0]], ["oracle", args[1]]]) {
      if ((await client.readContract({ address, abi: artifact.abi, functionName })).toLowerCase() !== expected.toLowerCase()) throw new Error("Protection deployment configuration mismatch");
    }
    manifest.contracts.spotProtectionFactory = { address, txHash: entry.hash, blockNumber: String(receipt.blockNumber), contractName: artifact.contractName,
      constructorArguments: args, creationDataHash: entry.dataHash, runtimeCodeHash: keccak256(code) };
    manifest.status = "protection_factory_verification_pending"; await save();
    console.log(JSON.stringify({ contract: artifact.contractName, address, hash: entry.hash, status: receipt.status, gasETH: entry.feeETH, verificationRequired: true }));
  } finally { await lock.close(); await unlink(`${path}.protection.lock`); }
}
main().catch(error => { console.error(error instanceof Error && error.message.startsWith("Protection deployment ") ? error.message : "Protection deployment stopped; reconcile the existing public hash before retrying."); process.exitCode = 1; });
