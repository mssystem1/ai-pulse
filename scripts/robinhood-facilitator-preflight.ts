/** Read-only signer readiness. Derives a public address locally; never signs,
 * broadcasts, transfers, calls /settle, or prints a key/credential-bearing URL. */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { createPublicClient, http, formatEther, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
if (!process.argv.includes("--run")) {
  console.log("Read-only facilitator key/address/balance checks. Run with --run.");
  process.exit(0);
}
async function main() {
  config({ quiet: true });
  const key = process.env.ROBINHOOD_FACILITATOR_PRIVATE_KEY?.trim() || "";
  if (!/^0x[\da-f]{64}$/i.test(key)) { console.log(JSON.stringify({ ready: false, reason: "Dedicated facilitator private key missing or invalid; set it locally, never in chat" })); return; }
  const account = privateKeyToAccount(key as Hex);
  const manifest = JSON.parse(await readFile(new URL("../packages/contracts/deployments/4663.json", import.meta.url), "utf8"));
  const separateFrom = { admin: manifest.deployer, testBuyer: process.env.TEST_WALLET_ADDRESS, merchant: process.env.PAY_TO_ADDRESS };
  const separation = Object.fromEntries(Object.entries(separateFrom).map(([role, address]) => [role, typeof address === "string" && /^0x[\da-f]{40}$/i.test(address) ? account.address.toLowerCase() !== address.toLowerCase() : null]));
  const rpc = createPublicClient({ transport: http(process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", { timeout: 12_000, retryCount: 0 }) });
  if (await rpc.getChainId() !== 4663) throw new Error("WrongChain");
  const [balance, latest, pending, code] = await Promise.all([
    rpc.getBalance({ address: account.address }),
    rpc.getTransactionCount({ address: account.address, blockTag: "latest" }),
    rpc.getTransactionCount({ address: account.address, blockTag: "pending" }),
    rpc.getCode({ address: account.address }),
  ]);
  const cap = parseEther(process.env.ROBINHOOD_FACILITATOR_MAX_GAS_ETH || "0.00001");
  console.log(JSON.stringify({ at: new Date().toISOString(), chainId: 4663, address: account.address, balanceETH: formatEther(balance),
    separateFrom: separation, contractCodePresent: !!code && code !== "0x", pendingTransactions: pending - latest,
    perTransferGasCeilingETH: formatEther(cap), gasFunded: cap > 0n && balance >= cap,
    readyForBoundedTest: Object.values(separation).every(value => value === true) && (!code || code === "0x") && pending === latest && cap > 0n && balance >= cap,
    signed: false, broadcast: false,
  }, null, 2));
}
main().catch(() => { console.error("Facilitator preflight unavailable; check local key format and Robinhood RPC. No transaction was signed or sent."); process.exitCode = 1; });
