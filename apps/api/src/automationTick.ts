import { randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { AppConfig } from "@pulse/config";
import { runTradeAutomationCycle } from "./tradeAutomation.js";
import { runAutopilotCycle } from "./autopilotAutomation.js";
import { runTelegramDeliveryCycle } from "./telegram.js";
import { kvConfigured, runKvCommand } from "./resilientKv.js";

export type AutomationTickDependencies = {
  trade: typeof runTradeAutomationCycle;
  autopilot: typeof runAutopilotCycle;
  telegram: typeof runTelegramDeliveryCycle;
};

const defaults: AutomationTickDependencies = {
  trade: runTradeAutomationCycle,
  autopilot: runAutopilotCycle,
  telegram: runTelegramDeliveryCycle,
};

let localTickRunning = false;

function authorized(header: string | undefined, secret: string) {
  if (!header?.startsWith("Bearer ") || !secret) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function acquireTickLease(namespace: string) {
  if (!kvConfigured()) {
    if (localTickRunning) return null;
    localTickRunning = true;
    return "local";
  }
  const token = randomUUID();
  const key = `${namespace}:automation:cron-lease`;
  const result = await runKvCommand(["SET", key, token, "NX", "EX", 300], "Automation cron");
  return result === "OK" ? `${key}:${token}` : null;
}

async function releaseTickLease(lease: string) {
  if (lease === "local") {
    localTickRunning = false;
    return;
  }
  const separator = lease.lastIndexOf(":");
  const key = lease.slice(0, separator);
  const token = lease.slice(separator + 1);
  await runKvCommand([
    "EVAL",
    "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
    "1",
    key,
    token,
  ], "Automation cron");
}

/**
 * Durable serverless entry for all background reconciliation loops. Vercel
 * Cron sends GET plus `Authorization: Bearer ${CRON_SECRET}`. A shared KV
 * lease prevents overlapping invocations across serverless instances.
 */
export function createAutomationTickRouter(
  cfg: AppConfig,
  overrides: Partial<AutomationTickDependencies> = {},
) {
  const router = Router();
  const workers = { ...defaults, ...overrides };

  router.get("/v1/internal/automation/tick", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!cfg.CRON_SECRET) {
      return res.status(503).json({ ok: false, code: "CRON_NOT_CONFIGURED" });
    }
    if (!authorized(req.get("authorization"), cfg.CRON_SECRET)) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });
    }
    if (process.env.AUTOMATION_WORKER_ENABLED !== "1") {
      return res.status(503).json({ ok: false, code: "AUTOMATION_DISABLED" });
    }

    let lease: string | null = null;
    try {
      lease = await acquireTickLease(cfg.PERSISTENCE_NAMESPACE);
    } catch {
      res.setHeader("Retry-After", "30");
      return res.status(503).json({ ok: false, code: "SCHEDULER_LEASE_UNAVAILABLE", recoverable: true });
    }
    if (!lease) return res.status(202).json({ ok: true, status: "already_running" });

    const startedAt = new Date().toISOString();
    try {
      const tasks: Array<[string, Promise<unknown>]> = [
        ["spot", Promise.resolve().then(() => workers.trade(cfg))],
        ["autopilot", Promise.resolve().then(() => workers.autopilot(cfg))],
      ];
      if (cfg.FEATURE_TELEGRAM) tasks.push(["telegram", Promise.resolve().then(() => workers.telegram())]);
      const settled = await Promise.allSettled(tasks.map(([, task]) => task));
      const results = settled.map((result, index) => ({
        worker: tasks[index]![0],
        status: result.status,
        ...(result.status === "rejected" ? { error: "WORKER_CYCLE_FAILED" } : {}),
      }));
      const ok = settled.every((result) => result.status === "fulfilled");
      return res.status(ok ? 200 : 503).json({ ok, status: ok ? "completed" : "partial_failure", startedAt, results });
    } finally {
      await releaseTickLease(lease).catch(() => undefined);
    }
  });

  return router;
}
