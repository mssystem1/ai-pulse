# Redis startup permission incident — November 16, 2026

Redis connectivity was repaired on the existing Railway Redis service. Historical data recovery remains a separate, unresolved check.

## Cause established from the supplied logs

The November 12 log contains eleven startup attempts, eleven `appendonlydir: Permission denied` failures, and no ready message. Each attempt first reports that the Docker entrypoint skipped ownership changes because it found `lost+found` in the data directory.

The [exact Redis 8.10.1 entrypoint](https://github.com/redis/docker-library-redis/blob/v8.10.1/debian/docker-entrypoint.sh) only repairs a simple data directory containing RDB files and the default AOF directory; another entry causes it to skip that repair before dropping privileges. The configured Railway volume was mounted at `/data`, so Redis could not create its AOF directory after privilege drop. The memory-overcommit warning was not the fatal startup error in these logs.

## Applied repair

The Redis service's Start Command now gives the Redis user access to `/data` and its known persistence paths before invoking the official entrypoint. The ownership repair does not write persistence-file contents; Redis continues its normal persistence writes after startup. Authentication, the existing volume, Redis version `8.10.1`, `appendonly yes`, `appendfsync everysec`, `save 60 1` and `noeviction` remain configured. It leaves `lost+found` alone and refuses unexpected mount paths or symlinked persistence paths.

The completed script also refuses an RDB-only layout while AOF is configured, or an AOF directory containing files without a nonempty manifest. These guards were added after the first successful startup. They prevent future startup from treating those incomplete layouts as a fresh database; they do not recover historical data.

Source: [railway-redis-start.sh](../scripts/railway-redis-start.sh). Generate a copyable inline command for the **Redis service** with:

```powershell
node scripts/railway-redis-start-command.mjs
```

The script is prepared for the verified `/data` mount. Inspect any different mount before adapting it. This repair is a storage ownership change; it is not a database import or restore.

The ordinary redeploy action replayed the previous startup command. The subsequent deployment of current service settings contained the repair and reached `Ready to accept connections tcp` at **2026-11-16 18:38:27 UTC**. Initial successful deployment ID: `3b96c496-9c5c-49c1-96ac-3fb3f163d3b0`.

The final deployment, including the guards, is `83eba177-a180-4ebb-ae41-4df0374f4589`. Its stored and deployed commands match the generated source. At **19:00:44 UTC** Redis loaded the current base and incremental AOF files successfully and became ready again. PULSE subsequently reported native Redis online. JavaScript syntax checks passed; a local Git Bash command-quoting roundtrip timed out, so that local check is not counted as passed. The actual deployed Linux command executed successfully.

## Verified and unresolved

- Redis returned `PONG` through its configured public endpoint.
- AOF was enabled with successful writes; RDB save status was successful. Configuration remained `/data`, `everysec`, `yes`, `noeviction` and `60 1`.
- PULSE's public health reported native Redis **online**. TEST wallet authentication and workspace/catalog/receipt reads succeeded without a payment.
- The TEST wallet's historical access, watches and purchased-indicator receipts were absent. The new startup log created new AOF files. Connectivity recovery therefore does **not** establish historical data recovery.
- Railway reports the logical volume was created September 9, but its current mounted volume instance was created **November 12 at 15:17:55 UTC**, immediately before the failed deployment. That instance lists no backups or backup schedules. This metadata does not by itself explain where earlier records went.
- The owner confirms they did not touch Redis around November 12. Deployment metadata labels the November 12 deployment `rollback`. A bounded project/environment audit query for 15:00-15:30 UTC returned no entries; that does not establish the actor or exclude platform events.
- After explicit approval, one temporary SSH key was registered for read-only persistence-file metadata inspection, then successfully removed. The local private/public key files were deleted. Inspection found only November 16 persistence files: an 89-byte base RDB, incremental AOF, manifest, and currently updated `dump.rdb`. `lost+found` is dated November 12, 15:17 UTC. No earlier persistence file was visible within the mounted volume's inspected paths.
- Files were not inspected before the first successful start. With AOF enabled, an older RDB-only layout can be ignored; normal later persistence could overwrite an older `dump.rdb`. We therefore cannot prove whether an earlier RDB existed then or was preserved. The newly added guards address this gap for future starts.
- No backup restore, data import, volume deletion, fresh payment or trade was performed. Connectivity recovery is verified; historical recovery is unresolved.

The original September 10 export remains a historical recovery source, not a current backup. It cannot reconstruct later purchases, passes, Radar history or indicator sales. Do not restore it over a live database or invent missing receipts. Continue inspecting existing files/recovery points and reconcile any recovery against original settlement evidence.

## Platform incident and required follow-up

[Railway's November 10 report](https://blog.railway.com/p/incident-report-october-security-incident) confirms an October 20-21 intrusion involving a subset of customer environment variables. It describes infrastructure hardening and credential/session invalidation. The evidence collected here does not establish a link between that incident and this service's November 12 volume instance. Project-specific storage provenance and recovery points require Railway's investigation.

A [support request with the exact identifiers and timeline](RAILWAY_REDIS_RECOVERY_SUPPORT_REQUEST_2026-11-16.md) is prepared. Request preservation and a separate recovery export/volume; avoid overwriting current newly written application data. This request has not been sent on the user's behalf.
