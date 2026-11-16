#!/bin/sh
# Redis-service startup only. Preserve the existing /data dataset and AOF.
set -eu

: "${REDIS_PASSWORD:?Redis password missing}"
: "${RAILWAY_VOLUME_MOUNT_PATH:?Redis volume missing}"
data=$(readlink -f "$RAILWAY_VOLUME_MOUNT_PATH")
if [ "$data" != /data ] || [ ! -d "$data" ]; then
  echo >&2 "Refusing permission repair: verify the existing Redis volume is mounted at /data."
  exit 1
fi
if [ "$(id -u)" != 0 ]; then
  echo >&2 "Redis volume ownership repair requires a root startup user. Redis itself runs after privilege drop."
  exit 1
fi
id redis >/dev/null

# With AOF enabled, an RDB-only volume needs an explicit recovery/migration.
# Do not let normal startup initialize an empty AOF over that recovery source.
if [ -f "$data/dump.rdb" ] &&
   [ ! -s "$data/appendonly.aof" ] &&
   [ ! -s "$data/appendonlydir/appendonly.aof.manifest" ]; then
  echo >&2 "Refusing startup: an RDB snapshot exists without a recognizable AOF source. Preserve the snapshot and review recovery before enabling AOF."
  exit 1
fi

# Redis 8.10.1 skips all automatic ownership changes when lost+found exists.
# Repair only Redis paths; leave lost+found and all file contents unchanged.
chown redis:redis "$data"
chmod u+rwx "$data"
for name in dump.rdb appendonly.aof; do
  path="$data/$name"
  if [ -L "$path" ]; then
    echo >&2 "Refusing permission repair on a symlinked Redis persistence file."
    exit 1
  fi
  if [ -e "$path" ]; then
    test -f "$path"
    chown redis:redis "$path"
    chmod u+rw "$path"
  fi
done
append="$data/appendonlydir"
if [ -L "$append" ]; then
  echo >&2 "Refusing permission repair on a symlinked AOF directory."
  exit 1
fi
if [ -e "$append" ]; then
  test -d "$append"
  if [ -n "$(find "$append" -xdev -type l -print -quit)" ]; then
    echo >&2 "Refusing permission repair: the AOF directory contains a symlink."
    exit 1
  fi
  if [ ! -s "$append/appendonly.aof.manifest" ] &&
     [ -n "$(find "$append" -xdev -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo >&2 "Refusing startup: the AOF directory has files but no nonempty manifest. Preserve these files and review recovery."
    exit 1
  fi
  find "$append" -xdev -type d -exec chown redis:redis {} +
  find "$append" -xdev -type d -exec chmod u+rwx {} +
  find "$append" -xdev -type f -exec chown redis:redis {} +
  find "$append" -xdev -type f -exec chmod u+rw {} +
fi

# Verify access as the same user the official entrypoint will select.
setpriv --reuid redis --regid redis --clear-groups /bin/sh -ec \
  'test -r "$1" && test -w "$1" && test -x "$1"' sh "$data"
cd "$data"
exec docker-entrypoint.sh redis-server \
  --requirepass "$REDIS_PASSWORD" \
  --save 60 1 --appendonly yes --appendfsync everysec \
  --maxmemory-policy noeviction --dir "$data"
