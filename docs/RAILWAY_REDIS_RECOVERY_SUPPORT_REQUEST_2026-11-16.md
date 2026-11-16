# Railway Redis volume recovery request

Send this request through [Railway Support](https://station.railway.com). It contains resource identifiers and timestamps, with no passwords, API keys or customer record contents.

Subject: Redis previous volume data missing after November 12 volume-instance change

Please preserve any retained storage, snapshots and audit evidence for this service and investigate recovery of its previous Redis dataset. Please do not replace the currently mounted volume or restore an old snapshot over it. If recovery is possible, expose a separate recovery volume/export for inspection and reconciliation first.

Resource identifiers:

- Project: `ai-pulse` / `b4db2c6c-b95e-4934-9490-e706de579d00`
- Production environment: `969bbb27-04f7-475d-821c-f4d1d5260def`
- Redis service: `e2a920cd-b139-41a5-9beb-aa38bc458fde`
- Logical volume: `redis-volume` / `11de3308-490e-4c67-8277-f60f89fbd5a6`, created September 9, 2026
- Current volume instance: `22fd6788-08b0-448a-b6ea-e9c337eb3db0`, created **November 12, 2026 at 15:17:55.864 UTC**, mounted at `/data` in `sfo`
- Volume identifier printed in the November 12 logs: `vol_b2858t6mz8rnahat`
- Redis deployment immediately afterward: `3549ab83-cf21-44f5-b9b5-a955a3f93ae7`, created **November 12 at 15:18:10.424 UTC**, metadata reason `rollback`

What we found:

1. The owner reports no Redis or volume changes around November 12.
2. This Redis service had a populated dataset after the September 10 migration. Its configuration used AOF, RDB, `/data`, and a persistent volume. Later application data included paid-access and indicator records.
3. The supplied November 12 logs show eleven failed starts: the Redis 8.10.1 entrypoint skipped permission repair after finding `lost+found`, then Redis failed to create `appendonlydir` with `Permission denied`. No successful startup appears in those supplied logs.
4. On November 16 we repaired ownership of the existing mount and known Redis persistence paths, preserving the existing volume and enabling the same AOF/RDB settings. Redis became reachable at **18:38:27 UTC**. Its startup created a new 89-byte AOF base file rather than reporting a previous dataset load. We did not inspect persistence files before that startup, so we cannot establish whether an older RDB file was present then.
5. Subsequent read-only file inspection found only the AOF files created November 16 and a currently updated `dump.rdb`. `lost+found` is dated November 12, 15:17 UTC. Historical TEST-wallet workspace, paid-access and indicator purchase records are absent.
6. The public API exposes only the current volume instance, with no backups or backup schedules. A project/environment audit query for November 12, 15:00-15:30 UTC returned no entries; this does not prove that no platform or account event occurred.

Please investigate:

- What created the November 12 volume instance and triggered the deployment marked `rollback`? Was it an account action, infrastructure migration, recovery action or another event?
- Where is the volume data used by the service before November 12? Are earlier volume instances, block devices, snapshots, migration artifacts or disaster-recovery copies retained internally?
- Can Railway provide a separate export/recovery volume containing the most recent pre-November 12 dataset, with its timestamp and provenance?
- Was this project affected by the October security incident or any later storage/hardening change? Please provide project-specific evidence rather than inferring from the general incident.

We have a September 10 local RDB export, but it is too old to reconstruct later payments and indicator records. We have not imported it or fabricated missing receipts. Current newly written application data must be preserved during any recovery.
