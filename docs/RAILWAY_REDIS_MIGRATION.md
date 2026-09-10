# Railway Redis + Vercel Blob

Status (September 10): native Redis support is implemented and locally tested.
The PULSE-only RDB snapshot has been imported into Railway Redis and verified.
The API remains stopped; application cutover and missing-payment reconciliation
are not complete. Keep the original backup and Upstash database.

## What goes where

| Storage | Contents |
| --- | --- |
| Railway Redis | Payment jobs/receipts, duplicate-payment protection, queue leases, report metadata/access sessions, AI budgets, trading and Autopilot records/passes, Telegram delivery retries |
| Existing Vercel Blob | Encrypted report bodies and archived Autopilot evidence |

The Redis command protocol changes from Upstash HTTPS to native Redis TCP.
Existing key names, JSON encodings and Lua atomic operations are preserved.
There is no automatic failover between the old and new databases: switching
backends during an outage could restore stale balances, passes or job leases.

## Create the service

1. Open the same Railway project **and environment** as `pulse-api`.
2. Choose **+ New → Database → Redis**. Start with one instance, not an HA cluster.
3. Open Redis → Variables. Railway creates `REDIS_URL` and password/host settings.
4. Verify an attached persistent volume and persistence configuration. Data in a
   container's ephemeral filesystem is not a durable database.
5. Review backup availability and cost. Never use an eviction policy that may
   silently remove payment, pass or receipt keys; use `noeviction` and monitor RAM.
   AOF with `appendfsync everysec` can lose roughly the last second after a crash;
   it is not a zero-loss guarantee. Choose persistence and backup policy explicitly.

Official guidance: [Redis](https://docs.railway.com/databases/redis),
[volume backups](https://docs.railway.com/volumes/backups).

## Variables for the eventual cutover

On **pulse-api**, using the actual database service name:

```dotenv
QUEUE_PROVIDER=redis
REDIS_URL=${{Redis.REDIS_URL}}
STORAGE_PROVIDER=vercel_blob
```

Keep the existing `BLOB_READ_WRITE_TOKEN`, `REPORT_ENCRYPTION_KEY`, `BLOB_ACCESS`,
retention settings and `PERSISTENCE_NAMESPACE`. Changing the encryption key would
make existing encrypted reports unreadable. Never prefix secrets with `VITE_`.

`QUEUE_PROVIDER=redis` selects Railway for every runtime store. Old
`KV_REST_API_URL`/`KV_REST_API_TOKEN` can remain temporarily for migration; runtime
does not use them in native Redis mode. `upstash_kv` remains an explicit legacy
mode, not an automatic fallback. Do not select `memory` in production.

The current repository's Vercel configuration serves the web frontend; database
credentials belong on Railway's API, not in browser code. A separately deployed
API/worker must use the same database and cannot use Railway private DNS from
outside the project network.

## Local .env is different from Railway Variables

Railway expands `${{...}}` references **inside Railway only**. A copied raw
variables export is not a usable local connection string. Local `REDIS_URL` must
contain a resolved connection string, not a reference or placeholder.

The private `*.railway.internal` hostname cannot be reached directly from your
PC. Prefer checks inside Railway. External access requires the service's Public
Access/TCP Proxy and resolved `REDIS_PUBLIC_URL`; public TCP is not automatically
TLS. Do not change `redis://` to `rediss://` unless the endpoint actually supports
TLS. Use a secure tunnel/private connection when transport security is required.
Never paste the connection string into chat, commit it, or print it in logs.

## Credential-safe checks (after building)

```powershell
npm.cmd run build -w @pulse/api
node --env-file=.env scripts/redis-readiness.mjs
node --env-file=.env scripts/redis-readiness.mjs --write-test
node --env-file=.env scripts/redis-integration.mjs --run --blob
```

For this PC, keep the private `REDIS_URL` and add the resolved public URL as
`REDIS_PUBLIC_URL`. Add `--public` to each check:

```powershell
node --env-file=.env scripts/redis-readiness.mjs --public --write-test
node --env-file=.env scripts/redis-integration.mjs --public --run --blob
```

These switches select the public URL only for that command. They do not edit
`.env`, change `QUEUE_PROVIDER`, or cut production over to Redis.

The September 10 check passed connectivity, locks, Lua updates, job deduplication,
leases, budget limits, paused-time accounting and encrypted Blob recovery. It
found `maxmemory-policy=noeviction`, but `appendonly=no`. Before migration, verify
the persistent volume and enable AOF in the Redis service's persistent startup
configuration while preserving its password and volume settings. Do not replace
the whole start command with an unauthenticated example. For an existing dataset,
follow the [Redis persistence transition procedure](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
before restarting. Confirm `aof_enabled=1` and a successful rewrite afterward.

Default check reads connectivity and persistence settings only. `--write-test`
uses random `pulse:readiness:*` keys, expires them within 60 seconds, and deletes
the exact probe key. Neither starts workers, calls AI, signs payments nor trades.
Do not run the normal production entrypoint for a connectivity test.

The integration command exercises concurrent job acquisition, receipt binding,
queue leases, shared AI budgets and pass pause/resume updates. `--blob` adds one
encrypted report round trip. It cleans up its exact random test namespace and
new Blob object, never existing PULSE records. Test writes consume small amounts
of normal infrastructure usage.

## Data migration is a separate, required step

1. Keep the old database. Take an available export/snapshot before changes.
2. Stop new payment acceptance and all database writers during the final copy.
   Coordinate trading downtime deliberately; do not silently pause owners' vaults.
3. Copy all PULSE string/hash/list/sorted-set/set records and their remaining
   TTLs. Include receipts, jobs, owner indexes, pass records, strategy policies,
   history, report metadata, access sessions and delivery queues—not just vaults.
4. If Upstash reads are blocked, recovery is **not complete**. Obtain a supported
   export or wait for access; check whether any existing snapshots are usable.
   Blob bodies and on-chain events alone cannot reconstruct every off-chain
   receipt, signed policy, AI decision or paid-time adjustment.
5. Compare source/target records and TTLs; reconcile any paid passes affected by
   earlier failed writes using actual settlement evidence. Do not invent credits
   or charge users again to conceal missing records.
6. Apply the native configuration, start one worker set, and verify report
   recovery, payment replay protection, pause/resume timers and complete history.
7. Retain the old database until reconciliation is confirmed. After new writes,
   pointing back to the stale source is not a safe rollback.

The migration helper defaults to a read-only inventory (no credentials or record
contents printed):

```powershell
node --env-file=.env scripts/redis-migrate.mjs
```

Only after **all source writers are stopped**, backup and persistence are checked:

```powershell
node --env-file=.env scripts/redis-migrate.mjs --public --copy --writers-stopped
```

The helper copies the `pulse:` namespace, preserves supported Redis types and
remaining TTLs, verifies destination content, and refuses conflicting existing
records. It does not delete the source, modify environment variables or deploy.
For a custom PULSE namespace, explicitly supply `--prefix=your-namespace:` and
inventory every namespace used by the app. Any failure means cutover is not ready;
do not use `--writers-stopped` while production is still accepting payments or
running workers. A failed partial copy is not an automatic rollback plan.

### RDB export recovery (September 10)

The Upstash SCAN route is quota-blocked, but the downloaded export is now usable.
Keep the original, private, gitignored backup at
`DB_backup/9615a8e6-7d88-414d-95d3-9402d9097406.rdb` unchanged.

| Export check | Result |
| --- | --- |
| Snapshot time | September 10, 2026, 05:49:57 UTC |
| Total Redis keys | 2,084 |
| PULSE keys selected (`pulse:` only) | 1,978 |
| Other projects excluded | 106: `arcforge:` (41), `mantle-payment:` (65) |
| Temporary restore + content/type/expiry verification | All 1,978 PULSE keys passed; exact test keys removed |
| Production import | All 1,978 PULSE keys restored and individually verified; no workers started |

These counts are Redis keys, not individual journal rows: a hash or list can
contain many records. The importer filters by the exact `pulse:` prefix; it does
not import unrelated projects or delete anything from the source. Do not discard
PULSE receipts, history or indexes just because they appear old. Preserve original
absolute expirations; expired records are skipped, not given a new lifetime.

Export SHA-256:
`aa712b7b962efe4927bda78e3a978523754d19c7275d83be1980fd2774c9933f`.
The exporter disabled its embedded RDB checksum (zero trailer). Full structural
decoding and destination round-trip checks passed; the SHA-256 pins this exact
file, but does not independently prove the export matches the source database.
The reader fails closed on unsupported encodings rather than silently dropping
data.

Offline inspection and namespace-filtered plan:

```powershell
node scripts/rdb-inspect.mjs DB_backup/9615a8e6-7d88-414d-95d3-9402d9097406.rdb
node scripts/rdb-restore.mjs DB_backup/9615a8e6-7d88-414d-95d3-9402d9097406.rdb
node --test scripts/rdb-reader.test.mjs scripts/rdb-scope.test.mjs
```

After building the API, a repeatable staging test uses random, isolated keys with
a 15-minute cleanup expiry. It verifies values, types and expiry handling, then
deletes only its own test keys. It does not start workers or modify real passes:

```powershell
node --env-file=.env scripts/rdb-restore.mjs DB_backup/9615a8e6-7d88-414d-95d3-9402d9097406.rdb --stage --public
```

The real import below has already completed for this backup/destination. **Do not
run it again against the populated database.** For a future recovery, before the
**real import**, stop all source/destination writers, verify the
attached persistent volume, enable persistent AOF configuration, and confirm
`noeviction`. The importer requires an empty destination and refuses conflicts.
Only after completing those checks:

```powershell
node --env-file=.env scripts/rdb-restore.mjs DB_backup/9615a8e6-7d88-414d-95d3-9402d9097406.rdb --restore --public --writers-stopped --volume-verified --sha256=aa712b7b962efe4927bda78e3a978523754d19c7275d83be1980fd2774c9933f
```

Never pass these acknowledgements merely to bypass a refusal. If an import fails
partway through, keep workers stopped and reconcile the partial destination;
do not clear it or retry blindly. Importing the snapshot is not authorization to
start trading workers. Review queued jobs and strategy/pass state before cutover.

This export contains six registered strategies and four saved passes. In
particular, Base Autopilot #2's saved pass was purchased September 8 and expired
September 9. A later expiry previously displayed by the API is absent from this
snapshot. Reconcile actual settled payments and confirmed pause events before
restoring missing paid runtime; do not infer payment from a cached display.
Missing registrations and history cannot be invented from this export.

The user enabled AOF in the Redis startup command and stopped the old `pulse-api`
deployment. Before import, its health endpoint returned HTTP 404; Redis was empty
with `appendonly=yes`, `appendfsync=everysec`, `noeviction`, and `dir=/data` on the
attached volume. The guarded import then restored and verified all 1,978 selected
keys without overwriting records, restarting workers, or touching the source.

The post-import inventory counted 1,977 keys, all PULSE: one original
`pulse:local:arc` record reached its preserved expiry at 10:49:38.760 UTC. Comparison
with the backup confirmed this was an expected expiration, not a dropped record.
AOF reported successful writes/rewrite, no pending fsync, and approximately 13.7 MB
of log data. These checks do not substitute for a restart/recovery test or backups.

The read-only audit found six registered strategies, four saved passes, 491
report metadata records, and 67 jobs (60 completed, six terminal failures, one
manual reconciliation). Ready and leased job queues were empty in both discovered
namespaces, `pulse:local` and `pulse:production`. Keep both namespaces intact;
do not rewrite one into the other. Empty job queues do not mean Autopilot is safe
to restart: its registered strategies are a separate worker input.

Read-only post-import inventory (including queues under discovered PULSE
sub-namespaces):

```powershell
node --env-file=.env scripts/redis-recovery-audit.mjs --public
```

Keep the API stopped until the updated code and native-backend variables are
ready. Preserve the existing `PERSISTENCE_NAMESPACE`, Blob token and report
encryption key. Do not restart the old Upstash-backed deployment. Review missing
paid runtime and strategy registrations before enabling automation; importing
this snapshot does not restore data that never reached it. No application
deployment, on-chain pause/resume, pass adjustment or trade was performed during
the import.

## Costs

Railway Redis is resource-billed, not billed per command. Hobby's $5 credit is
shared by the API and database; exceeding it increases the bill. Blob uses Vercel
Pro credit and can incur overages. Neither service is unlimited free storage.
Monitor projected usage, RAM and volume growth. A hard spending limit can stop
services, so it must not be presented as harmless for active Autopilots.

[Railway pricing](https://docs.railway.com/pricing/plans) ·
[Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)
