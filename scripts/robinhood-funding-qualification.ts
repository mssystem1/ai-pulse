/** Bounded mainnet funding test. One durable operation; reruns reconcile, never repeat it. */
import { config } from "dotenv";
import { readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import { createPublicClient, createWalletClient, decodeEventLog, erc20Abi, formatEther, formatUnits, http, keccak256, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const path = "packages/contracts/deployments/4663-funding-qualification.json";
const amount = parseEther("0.00004");
type Journal = { chainId: number; owner: string; hash: Hex; nonce: number; inputETH: string; minimumUSDG: string; minimumAtomic: string; status: string; receivedUSDG?: string; gasETH?: string; createdAt: string };
async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { prepareRobinhoodFunding, ROBINHOOD_FUNDING } = await import("../apps/api/src/robinhoodFunding.js");
  const cfg = loadConfig();
  if (!/^0x[\da-f]{64}$/i.test(cfg.TEST_WALLET_PRIVATE_KEY || "")) throw new Error("Qualification signer unavailable");
  const account = privateKeyToAccount(cfg.TEST_WALLET_PRIVATE_KEY as Hex);
  if (account.address.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Qualification wallet mismatch");
  const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.ROBINHOOD_RPC_URL] } } };
  const client = createPublicClient({ chain, transport: http(cfg.ROBINHOOD_RPC_URL, { timeout: 15_000, retryCount: 0 }) });
  if (await client.getChainId() !== 4663) throw new Error("Qualification chain mismatch");
  const lock = await open(`${path}.lock`, "wx");
  try {
    let journal: Journal | undefined;
    try { journal = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const save = async () => { await writeFile(`${path}.tmp`, JSON.stringify(journal, null, 2)); await rename(`${path}.tmp`, path); };
    if (journal && (journal.chainId !== 4663 || journal.owner.toLowerCase() !== account.address.toLowerCase() || journal.inputETH !== formatEther(amount))) throw new Error("Qualification journal identity mismatch");
    if (!journal) {
      const prepared = await prepareRobinhoodFunding(cfg, amount.toString(), account.address);
      const tx = { account, to: prepared.transaction.to as `0x${string}`, data: prepared.transaction.data as Hex, value: amount };
      await client.call(tx);
      const gas = (await client.estimateGas(tx)) * 125n / 100n;
      const fees = await client.estimateFeesPerGas();
      const maxCost = gas * fees.maxFeePerGas;
      if (maxCost > parseEther("0.00003")) throw new Error("Qualification gas exceeds 0.00003 ETH cap");
      if (await client.getBalance({ address: account.address }) < amount + maxCost + parseEther("0.0001")) throw new Error("Qualification would consume the reserved deployment gas");
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      if (nonce !== await client.getTransactionCount({ address: account.address, blockTag: "latest" })) throw new Error("Qualification wallet has a pending transaction");
      console.log(JSON.stringify({ mode: process.argv.includes("--broadcast") ? "broadcast" : "simulation", owner: account.address,
        inputETH: formatEther(amount), minimumUSDG: formatUnits(BigInt(prepared.minToAmount), 6), maxGasETH: formatEther(maxCost), simulation: "passed" }));
      if (!process.argv.includes("--broadcast")) return;
      if (Date.now() + 5000 >= prepared.expiresAt) throw new Error("Qualification quote expired before signing");
      const wallet = createWalletClient({ account, chain, transport: http(cfg.ROBINHOOD_RPC_URL, { retryCount: 0 }) });
      const signed = await wallet.signTransaction({ ...tx, chain, type: "eip1559", nonce, gas, ...fees });
      journal = { chainId: 4663, owner: account.address, hash: keccak256(signed), nonce, inputETH: formatEther(amount),
        minimumUSDG: formatUnits(BigInt(prepared.minToAmount), 6), minimumAtomic: prepared.minToAmount, status: "pending", createdAt: new Date().toISOString() };
      await save(); // no signed payload or private key is persisted
      const hash = await client.sendRawTransaction({ serializedTransaction: signed });
      if (hash !== journal.hash) throw new Error("Qualification broadcast hash mismatch");
    }
    // A missing/pending receipt stops this run. It never generates a second swap.
    const receipt = await client.waitForTransactionReceipt({ hash: journal.hash, confirmations: 2, timeout: 90_000 });
    const tx = await client.getTransaction({ hash: journal.hash });
    if (tx.from.toLowerCase() !== account.address.toLowerCase() || tx.to?.toLowerCase() !== ROBINHOOD_FUNDING.router || tx.value !== amount)
      throw new Error("Qualification confirmed transaction identity mismatch");
    journal.status = receipt.status;
    journal.gasETH = formatEther(receipt.gasUsed * receipt.effectiveGasPrice);
    let received = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== ROBINHOOD_FUNDING.usdg.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics, data: log.data });
        if (event.args.to.toLowerCase() === account.address.toLowerCase()) received += event.args.value;
        if (event.args.from.toLowerCase() === account.address.toLowerCase()) received -= event.args.value;
      } catch { /* non-Transfer token event */ }
    }
    journal.receivedUSDG = formatUnits(received, 6);
    await save();
    if (receipt.status !== "success" || received < BigInt(journal.minimumAtomic)) throw new Error("Qualification receipt failed minimum-received verification");
    console.log(JSON.stringify({ hash: journal.hash, status: journal.status, inputETH: journal.inputETH, receivedUSDG: journal.receivedUSDG,
      gasETH: journal.gasETH, receiptVerified: true, journal: path }));
  } finally { await lock.close(); await unlink(`${path}.lock`); }
}
main().catch(error => { console.error(error instanceof Error && error.message.startsWith("Qualification ") ? error.message : "Funding qualification stopped; inspect the saved transaction hash before retrying. No automatic repeat spending."); process.exitCode = 1; });
