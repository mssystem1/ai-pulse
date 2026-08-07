import { randomUUID } from "node:crypto";
import type { AnalysisJob, JobStore } from "./jobs.js";

export class DurableJobWorker {
  private active = 0;
  private draining = false;
  private readonly workerId = randomUUID();
  private maintenanceTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly store: JobStore,
    private readonly concurrency: number,
    private readonly execute: (job: AnalysisJob) => Promise<void>,
    private readonly leaseSeconds = 300,
  ) {}

  async start() {
    await this.store.recoverExpired();
    await this.drain();
    if (!this.maintenanceTimer) {
      this.maintenanceTimer = setInterval(() => {
        void this.store.recoverExpired().then(() => this.drain());
      }, Math.max(1_000, Math.floor(this.leaseSeconds * 1000 / 3)));
      this.maintenanceTimer.unref?.();
    }
  }

  async notify() { await this.drain(); }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.active < this.concurrency) {
        const job = await this.store.claim(this.workerId, this.leaseSeconds);
        if (!job) break;
        this.active += 1;
        void this.run(job).finally(() => { this.active -= 1; void this.drain(); });
      }
    } finally { this.draining = false; }
  }

  private async run(job: AnalysisJob) {
    const heartbeat = setInterval(() => {
      void this.store.extendLease(job.id, this.workerId, this.leaseSeconds);
    }, Math.max(500, Math.floor(this.leaseSeconds * 1000 / 3)));
    heartbeat.unref?.();
    try {
      await this.execute(job);
      await this.store.ack(job.id, this.workerId);
    } catch (error) {
      const current = await this.store.get(job.id);
      const terminal = current?.stage === "failed_terminal" || current?.stage === "manual_reconciliation";
      if (terminal) await this.store.ack(job.id, this.workerId);
      else {
        await this.store.requeue(job.id, this.workerId, 5);
        const retry = setTimeout(() => void this.drain(), 5_000);
        retry.unref?.();
      }
    } finally { clearInterval(heartbeat); }
  }
}
