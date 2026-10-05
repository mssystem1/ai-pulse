/** Read-only confirmation that bounded qualification capital and approvals are cleared. */
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, erc20Abi, http, parseAbi, type Address } from "viem";

async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContractAddress } = await import("../apps/api/src/executionContracts.js");
  const cfg = loadConfig();
  const client = createPublicClient({ transport: http(cfg.ARC_RPC_URL, { timeout: 20_000, retryCount: 1 }) });
  if (await client.getChainId() !== 5042) throw new Error("Wrong chain");
  const directory = "packages/contracts/deployments";
  const manifest = JSON.parse(await readFile(`${directory}/5042.json`, "utf8"));
  const accounts = JSON.parse(await readFile(`${directory}/5042-account-qualification.json`, "utf8"));
  const owner = cfg.TEST_WALLET_ADDRESS as Address;
  if (accounts.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("Wrong qualification owner");
  const usdc = "0x3600000000000000000000000000000000000000" as Address;
  const weth = "0x128cC466B61f542da60c70e3aA11c10e19B84EDB" as Address;
  const blockNumber = await client.getBlockNumber();
  const balances = await Promise.all(accounts.entries.map(async (entry: { kind: string; account: Address }) => {
    const [cash, token] = await Promise.all([usdc, weth].map(address => client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [entry.account], blockNumber })));
    return { kind: entry.kind, account: entry.account, usdcAtomic: String(cash), wethAtomic: String(token) };
  }));
  const targets = [executionContractAddress("arc", "okxApproval"), "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE", ...accounts.entries.map((entry: { account: Address }) => entry.account)] as Address[];
  const allowances = await Promise.all(targets.flatMap(spender => [usdc, weth].map(async token => ({ token, spender,
    amountAtomic: String(await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender], blockNumber })) }))));
  const pauseAbi = parseAbi(["function automationPaused() view returns(bool)", "function paused() view returns(bool)"]);
  const vault = accounts.entries.find((entry: { kind: string }) => entry.kind === "autopilot").account as Address;
  const [registryPaused, vaultPaused] = await Promise.all([
    client.readContract({ address: manifest.contracts.registry.address, abi: pauseAbi, functionName: "automationPaused", blockNumber }),
    client.readContract({ address: vault, abi: pauseAbi, functionName: "paused", blockNumber })
  ]);
  const result = { chainId: 5042, owner, auditedAt: new Date().toISOString(), blockNumber: String(blockNumber), balances, allowances,
    qualificationCapitalRecovered: balances.every(item => item.usdcAtomic === "0" && item.wethAtomic === "0"),
    qualificationApprovalsCleared: allowances.every(item => item.amountAtomic === "0"), registryPaused, vaultPaused };
  await writeFile("docs/ARC_MAINNET_CAPITAL_AUDIT_2026-10-05.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, balances: undefined, allowances: undefined }));
}
main().catch(() => { console.error("Arc capital audit stopped; inspect qualification balances and permissions before proceeding."); process.exitCode = 1; });
