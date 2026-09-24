/** Read only: inspect the single qualification vault, never enumerate other owners. */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
async function main() {
  config({ quiet: true });
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.QUEUE_PROVIDER = "redis";
  const { runKvCommand } = await import("../apps/api/src/resilientKv.js");
  const { readJournal } = await import("../apps/api/src/autopilotJournal.js");
  const setup = JSON.parse(await readFile("packages/contracts/deployments/4663-autopilot-setup-qualification.json", "utf8"));
  if (!setup.data.strategyId || setup.owner.toLowerCase() !== process.env.TEST_WALLET_ADDRESS?.toLowerCase()) throw new Error();
  const raw = await runKvCommand(["HGET", "pulse:v6:autopilot:strategy-map", setup.data.strategyId]);
  if (typeof raw !== "string") throw new Error();
  const strategy = JSON.parse(raw);
  if (process.argv.includes("--pause-registration")) {
    // Only this owner-authorized qualification record; preserve every audit row.
    if (strategy.owner.toLowerCase() !== setup.owner.toLowerCase() || strategy.vault.toLowerCase() !== setup.data.vault.toLowerCase()) throw new Error();
    const next = { ...strategy, status: "paused", updatedAt: new Date().toISOString() };
    const changed = await runKvCommand(["EVAL", "if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end; redis.call('HSET', KEYS[1], ARGV[1], ARGV[3]); return 1", 1,
      "pulse:v6:autopilot:strategy-map", setup.data.strategyId, raw, JSON.stringify(next)]);
    if (Number(changed) !== 1) throw new Error();
    console.log("Qualification registration paused with compare-and-swap; audit history preserved.");
    return;
  }
  const history = await readJournal(strategy, runKvCommand);
  console.log(JSON.stringify({ vault: strategy.vault, status: strategy.status, lastRunAt: strategy.lastRunAt, lastDecision: strategy.lastDecision,
    lastError: String(strategy.lastError || "").split("\n")[0].replace(/https?:\/\/\S+/g, "[provider]").slice(0, 220),
    evaluationCount: strategy.evaluationCount, failureCount: strategy.failureCount, aiCallsToday: strategy.aiCallsToday || 0,
    journalStorage: history.storage, rows: history.rows.slice(-20).map((row: any) => ({ at: row.evaluatedAt, action: row.action, status: row.status,
      reason: String(row.reason || "").split("\n")[0].replace(/https?:\/\/\S+/g, "[provider]").slice(0, 220),
      error: String(row.error || "").split("\n")[0].replace(/https?:\/\/\S+/g, "[provider]").slice(0, 220), aiSource: row.context?.aiSource })) }));
}
main().then(() => process.exit(0)).catch(() => { console.error("Qualification vault journal unavailable; no writes performed."); process.exit(1); });
