/** Local qualification helper. Only public hashes/receipts are persisted. */
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, formatEther, http, keccak256, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export async function qualificationJournal(input: { path: string; rpcUrl: string; privateKey: Hex; owner: string; budgetETH: string; targets: Address[]; broadcast: boolean }) {
  const account = privateKeyToAccount(input.privateKey);
  if (account.address.toLowerCase() !== input.owner.toLowerCase()) throw new Error("Qualification signer mismatch");
  const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [input.rpcUrl] } } };
  const client = createPublicClient({ chain, transport: http(input.rpcUrl, { timeout: 15_000, retryCount: 0 }) });
  const wallet = createWalletClient({ account, chain, transport: http(input.rpcUrl, { retryCount: 0 }) });
  if (await client.getChainId() !== 4663) throw new Error("Qualification wrong chain");
  const lock = await open(`${input.path}.lock`, "wx");
  type Entry = { step: string; hash: Hex; to: Address; nonce: number; maxGasETH: string; status: string; gasETH?: string };
  let journal: { chainId: number; owner: Address; entries: Entry[]; data: Record<string, string | boolean> };
  try {
    try { journal = JSON.parse(await readFile(input.path, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; journal = { chainId: 4663, owner: account.address, entries: [], data: {} }; }
    if (journal.chainId !== 4663 || journal.owner.toLowerCase() !== account.address.toLowerCase()) throw new Error("Qualification journal mismatch");
  } catch (error) { await lock.close(); await unlink(`${input.path}.lock`); throw error; }
  const save = async () => { await writeFile(`${input.path}.tmp`, JSON.stringify(journal, null, 2)); await rename(`${input.path}.tmp`, input.path); };
  const receipt = async (entry: Entry) => {
    const result = await client.waitForTransactionReceipt({ hash: entry.hash, confirmations: 2, timeout: 90_000 });
    if (result.from.toLowerCase() !== account.address.toLowerCase() || result.to?.toLowerCase() !== entry.to.toLowerCase()) throw new Error("Qualification receipt mismatch");
    entry.status = result.status; entry.gasETH = formatEther(result.gasUsed * result.effectiveGasPrice); await save();
    if (result.status !== "success") throw new Error("Qualification transaction reverted; no automatic replacement");
    return result;
  };
  return {
    account, client, wallet, journal, save,
    close: async () => { await lock.close(); await unlink(`${input.path}.lock`); },
    reconcile: async () => { for (const entry of journal.entries) await receipt(entry); },
    send: async (step: string, to: Address, data: Hex, expiresAt?: number) => {
      if (!input.targets.some(target => target.toLowerCase() === to.toLowerCase())) throw new Error("Qualification transaction target outside scope");
      const previous = journal.entries.find(entry => entry.step === step);
      if (previous) return receipt(previous);
      if (!input.broadcast) throw new Error("Qualification is read-only; --broadcast is required");
      const tx = { account, to, data, value: 0n };
      await client.call(tx);
      const gas = (await client.estimateGas(tx)) * 125n / 100n, fees = await client.estimateFeesPerGas(), cost = gas * fees.maxFeePerGas;
      const total = journal.entries.reduce((sum, entry) => sum + parseEther(entry.maxGasETH), 0n);
      if (cost > parseEther("0.00006") || total + cost > parseEther(input.budgetETH)) throw new Error("Qualification gas budget exceeded");
      if (await client.getBalance({ address: account.address }) < cost + parseEther("0.0001")) throw new Error("Qualification gas reserve insufficient");
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      if (nonce !== await client.getTransactionCount({ address: account.address, blockTag: "latest" })) throw new Error("Qualification wallet has pending transactions");
      if (expiresAt && Date.now() + 3000 >= expiresAt) throw new Error("Qualification quote expired before signing");
      const signed = await wallet.signTransaction({ ...tx, chain, nonce, gas, ...fees, type: "eip1559" });
      const entry: Entry = { step, to, nonce, hash: keccak256(signed), status: "pending", maxGasETH: formatEther(cost) };
      journal.entries.push(entry); await save();
      if (await client.sendRawTransaction({ serializedTransaction: signed }) !== entry.hash) throw new Error("Qualification broadcast hash mismatch");
      const result = await receipt(entry);
      console.log(JSON.stringify({ step, hash: entry.hash, status: entry.status, gasETH: entry.gasETH }));
      return result;
    },
  };
}
