/** Read-only accounting. Native and ERC-20 USDC are one balance on Arc. */
import { config } from "dotenv";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http, parseAbiItem, parseEther, parseUnits, type Address, type Hex } from "viem";

async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const cfg = loadConfig();
  const owner = cfg.TEST_WALLET_ADDRESS as Address;
  const client = createPublicClient({ transport: http(cfg.ARC_RPC_URL, { timeout: 20_000, retryCount: 1 }) });
  if (await client.getChainId() !== 5042) throw new Error("Budget audit wrong chain");
  const directory = "packages/contracts/deployments";
  const names = (await readdir(directory)).filter(name => /^5042(?:-.*)?\.json$/.test(name));
  const proofs = new Map<string, any>();
  const transactions = new Map<Hex, string>();
  function collect(value: any, proof: string) {
    if (!value || typeof value !== "object") return;
    if (/^0x[0-9a-fA-F]{64}$/.test(value.hash) && typeof value.nonce === "number") transactions.set(value.hash, proof);
    for (const [key, item] of Object.entries(value)) {
      if (["txHash", "transactionHash", "executionHash", "lastTxHash"].includes(key) && typeof item === "string" && /^0x[0-9a-fA-F]{64}$/.test(item)) transactions.set(item as Hex, proof);
      else if (typeof item === "object") collect(item, proof);
    }
  }
  for (const name of names) { const proof = JSON.parse(await readFile(`${directory}/${name}`, "utf8")); proofs.set(name, proof); collect(proof, name); }
  const manifest = proofs.get("5042.json");
  // Worker oracle/execution writes are not qualification-helper entries. Recover
  // their real receipt hashes from the actual phase's block range and events.
  for (const name of ["5042-keeper-qualification.json", "5042-autopilot-cycle-qualification.json", "5042-autopilot-exit-qualification.json"]) {
    const proof = proofs.get(name);
    const start = proof?.entries?.find((entry: any) => entry.step === "registry-resume");
    const end = proof?.entries?.findLast((entry: any) => entry.step === "registry-pause");
    if (!start || !end) continue;
    const [first, last] = await Promise.all([client.getTransactionReceipt({ hash: start.hash }), client.getTransactionReceipt({ hash: end.hash })]);
    for (const address of [manifest.contracts.oracleRouter.address, proofs.get("5042-autopilot-setup-qualification.json").data.vault] as Address[]) {
      const logs = await client.getLogs({ address, fromBlock: first.blockNumber, toBlock: last.blockNumber });
      for (const log of logs) if (log.transactionHash) transactions.set(log.transactionHash, name);
    }
  }
  const evidence: Array<{ hash: Hex; nonce: number; proof: string; gasUSDC: string; status: string }> = [];
  let gas = 0n;
  for (const [hash, proof] of transactions) {
    const [receipt, transaction] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })]);
    if (receipt.from.toLowerCase() !== owner.toLowerCase() || transaction.chainId !== 5042) throw new Error("Budget receipt identity mismatch");
    const fee = receipt.gasUsed * receipt.effectiveGasPrice; gas += fee;
    evidence.push({ hash, nonce: transaction.nonce, proof, gasUSDC: formatEther(fee), status: receipt.status });
  }
  evidence.sort((a, b) => a.nonce - b.nonce);
  const blockNumber = await client.getBlockNumber();
  const vault = proofs.get("5042-autopilot-setup-qualification.json").data.vault as Address;
  const usdc = "0x3600000000000000000000000000000000000000" as Address;
  const weth = "0x128cC466B61f542da60c70e3aA11c10e19B84EDB" as Address;
  const [wallet, vaultCash, vaultWeth, latest, pending] = await Promise.all([
    client.getBalance({ address: owner, blockNumber }),
    client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [vault], blockNumber }),
    client.readContract({ address: weth, abi: erc20Abi, functionName: "balanceOf", args: [vault], blockNumber }),
    client.getTransactionCount({ address: owner, blockTag: "latest" }), client.getTransactionCount({ address: owner, blockTag: "pending" })
  ]);
  if (latest !== pending) throw new Error("Budget wallet has pending transactions; audit after reconciliation");
  const response = await fetch(`${cfg.CIRCLE_GATEWAY_MAINNET_URL}/v1/balances`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [{ domain: 26, depositor: owner }] }), signal: AbortSignal.timeout(20_000) });
  const body = await response.json() as { balances: Array<{ domain: number; balance: string }> };
  if (!response.ok || body.balances?.length !== 1 || body.balances[0].domain !== 26 || !/^\d+(?:\.\d{1,6})?$/.test(body.balances[0].balance || "")) throw new Error("Budget Gateway evidence unavailable");
  const gateway = parseUnits(body.balances[0].balance, 6);
  const cash = wallet + (vaultCash + gateway) * 1_000_000_000_000n;
  const starting = parseEther("5.366071");
  const conservativeSpend = starting - cash; // Any unsold test WETH is valued at zero.
  if (conservativeSpend < 0n || conservativeSpend > parseEther("5")) throw new Error("Budget starting balance or 5 USDC limit requires reconciliation");
  const nonceSet = new Set(evidence.map(item => item.nonce));
  const missingNonces = Array.from({ length: latest - evidence[0].nonce }, (_, index) => index + evidence[0].nonce).filter(nonce => !nonceSet.has(nonce));
  const paidEvidence = names.filter(name => /-paid-qualification\.json$/.test(name)).map(name => ({ proof: name, service: proofs.get(name).service, chargeUSDC: String(proofs.get(name).paidUSDC) }));
  if (proofs.has("5042-autopilot-pass-qualification.json")) paidEvidence.push({ proof: "5042-autopilot-pass-qualification.json", service: "autopilot-24h", chargeUSDC: proofs.get("5042-autopilot-pass-qualification.json").paidUSDC });
  const paid = paidEvidence.reduce((sum, item) => sum + parseUnits(item.chargeUSDC, 6), 0n);
  const result = { chainId: 5042, owner, auditedAt: new Date().toISOString(), blockNumber: String(blockNumber), maximumTotalSpendUSDC: "5",
    walletUSDC: formatEther(wallet), gatewayUSDC: formatUnits(gateway, 6), vaultUSDC: formatUnits(vaultCash, 6), vaultWETH: formatUnits(vaultWeth, 18),
    confirmedTransactionGasUSDC: formatEther(gas), confirmedPaidChargesUSDC: formatUnits(paid, 6), conservativeSpentUSDC: formatEther(conservativeSpend),
    remainingAuthorizedSpendUSDC: formatEther(parseEther("5") - conservativeSpend), unvaluedTestCapital: vaultWeth > 0n, transactionCount: evidence.length,
    latestNonce: latest, missingNonces, receiptAccountingComplete: missingNonces.length === 0, paidEvidence, transactions: evidence };
  const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
  if (output) await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, transactions: undefined, paidEvidence: undefined }));
}
main().catch(() => { console.error("Arc budget audit stopped; reconcile balances and receipts before further spending."); process.exitCode = 1; });
