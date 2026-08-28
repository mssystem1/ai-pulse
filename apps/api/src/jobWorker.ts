import { randomUUID } from "node:crypto";
import type { AnalysisJob, JobStore } from "./jobs.js";

export class DurableJobWorker {
  private active = 0;
  private draining = false;
  private readonly workerId = randomUUID();
  private maintenanceTimer?: ReturnType<typeof setInterval>;
  private maintenanceRunning = false;
  private persistenceFailures = 0;
  private lastFailureLogAt = 0;

  constructor(
    private readonly store: JobStore,
    private readonly concurrency: number,
    private readonly execute: (job: AnalysisJob) => Promise<void>,
    private readonly leaseSeconds = 300,
  ) {}

  async start() {
    if (!this.maintenanceTimer) {
      this.maintenanceTimer = setInterval(() => {
        void this.maintain();
      }, Math.min(30_000, Math.max(1_000, Math.floor(this.leaseSeconds * 1000 / 3))));
      this.maintenanceTimer.unref?.();
    }
    await this.maintain();
  }

  async notify() { await this.maintain(); }

  private persistenceFailed(error: unknown) {
    this.persistenceFailures += 1;
    const now = Date.now();
    if (now - this.lastFailureLogAt >= 30_000) {
      this.lastFailureLogAt = now;
      console.warn(`[jobs] persistence temporarily unavailable; worker remains alive and will retry (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  private persistenceRecovered() {
    if (this.persistenceFailures > 0) console.info("[jobs] persistence restored; durable processing resumed");
    this.persistenceFailures = 0;
  }

  private async maintain() {
    if (this.maintenanceRunning) return;
    this.maintenanceRunning = true;
    try {
      await this.store.recoverExpired();
      await this.drain();
      this.persistenceRecovered();
    } catch (error) {
      this.persistenceFailed(error);
    } finally {
      this.maintenanceRunning = false;
    }
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.active < this.concurrency) {
        const job = await this.store.claim(this.workerId, this.leaseSeconds);
        if (!job) break;
        this.active += 1;
        void this.run(job).finally(() => { this.active -= 1; void this.maintain(); });
      }
    } finally { this.draining = false; }
  }

  private async run(job: AnalysisJob) {
    const heartbeat = setInterval(() => {
      void this.store.extendLease(job.id, this.workerId, this.leaseSeconds).catch((error) => this.persistenceFailed(error));
    }, Math.max(500, Math.floor(this.leaseSeconds * 1000 / 3)));
    heartbeat.unref?.();
    try {
      await this.execute(job);
      await this.store.ack(job.id, this.workerId);
    } catch (error) {
      try {
        const current = await this.store.get(job.id);
        const terminal = current?.stage === "failed_terminal" || current?.stage === "manual_reconciliation";
        if (terminal) await this.store.ack(job.id, this.workerId);
        else await this.store.requeue(job.id, this.workerId, 5);
        const retry = setTimeout(() => void this.maintain(), 5_000);
        retry.unref?.();
      } catch (persistenceError) {
        // Do not invent an acknowledgement or in-memory queue state. The
        // durable lease expires and recoverExpired reclaims it after KV returns.
        this.persistenceFailed(persistenceError);
      }
    } finally { clearInterval(heartbeat); }
  }
}
