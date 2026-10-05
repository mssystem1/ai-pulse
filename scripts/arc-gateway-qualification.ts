/** Deposit only the bounded acceptance budget into production Gateway. */
import { config } from "dotenv";
import { encodeFunctionData, erc20Abi, formatUnits, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { qualificationJournal } from "./arc-qualification-journal.js";

async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const cfg = loadConfig();
  const usdc = "0x3600000000000000000000000000000000000000" as Address;
  const gateway = "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" as Address;
  const q = await qualificationJournal({ path: "packages/contracts/deployments/5042-gateway-qualification.json", rpcUrl: cfg.ARC_RPC_URL,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS,
    budgetUSDC: "0.05", targets: [usdc, gateway], broadcast: process.argv.includes("--broadcast") });
  const balance = async () => {
    const response = await fetch(`${cfg.CIRCLE_GATEWAY_MAINNET_URL}/v1/balances`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "USDC", sources: [{ domain: 26, depositor: q.account.address }] }), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("Qualification Gateway balance unavailable");
    const body = await response.json() as { balances: Array<{ domain: number; balance: string }> };
    if (!Array.isArray(body.balances) || body.balances.length !== 1 || Number(body.balances[0].domain) !== 26
      || !/^\d+(?:\.\d{1,6})?$/.test(body.balances[0].balance || "")) throw new Error("Qualification Gateway balance evidence invalid");
    return parseUnits(body.balances[0].balance, 6);
  };
  try {
    await q.reconcile();
    const before = await balance();
    if (q.journal.data.completed) { console.log(JSON.stringify({ alreadyQualified: true, gatewayUSDC: formatUnits(before, 6) })); return; }
    const budget = parseUnits("2.70", 6);
    const amount = q.journal.data.depositAtomic ? BigInt(String(q.journal.data.depositAtomic)) : before >= budget ? 0n : budget - before;
    console.log(JSON.stringify({ broadcast: process.argv.includes("--broadcast"), chainId: 5042, domain: 26,
      gatewayUSDC: formatUnits(before, 6), maximumDepositUSDC: formatUnits(amount, 6), fiveReportsAndPassUSDC: "2.70" }));
    if (!process.argv.includes("--broadcast")) return;
    if (amount > budget) throw new Error("Qualification Gateway deposit exceeds acceptance budget");
    if (!q.journal.data.depositAtomic) { q.journal.data.depositAtomic = amount.toString(); q.journal.data.initialGatewayAtomic = before.toString(); await q.save(); }
    if (amount > 0n) {
      await q.send("approve-gateway", usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [gateway, amount] }));
      await q.send("deposit-gateway", gateway, encodeFunctionData({ abi: parseAbi(["function deposit(address,uint256)"]), functionName: "deposit", args: [usdc, amount] }), undefined, amount);
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      const available = await balance();
      if (available >= BigInt(String(q.journal.data.initialGatewayAtomic)) + amount) {
        q.journal.data.completed = true; q.journal.data.observedGatewayAtomic = available.toString(); await q.save();
        console.log(JSON.stringify({ completed: true, depositedUSDC: formatUnits(amount, 6), gatewayUSDC: formatUnits(available, 6) })); return;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error("Qualification Gateway deposit mined; API credit pending. Reconcile before paying");
  } finally { await q.close(); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error && error.message.startsWith("Qualification ") ? error.message : "Qualification Gateway stopped; inspect the public journal before retrying."); process.exit(1); });
