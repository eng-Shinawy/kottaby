#!/bin/bash
# Start PostgreSQL in user-space (sandbox)
PG_BIN=/tmp/pg-extract/usr/lib/postgresql/17/bin
PG_LIB=/tmp/pg-extract/usr/lib/postgresql/17/lib
PG_DATA=/tmp/pgdata
export LD_LIBRARY_PATH=$PG_LIB:$LD_LIBRARY_PATH

# Check if already running
if $PG_BIN/pg_ctl -D $PG_DATA status >/dev/null 2>&1; then
  echo "PostgreSQL already running"
  exit 0
fi

# Start if data dir exists
if [ -d "$PG_DATA" ]; then
  $PG_BIN/pg_ctl -D $PG_DATA -l /tmp/pg.log \
    -o "-c listen_addresses=127.0.0.1 -p 5432 -c unix_socket_directories=/tmp" start
else
  mkdir -p $PG_DATA
  $PG_BIN/initdb -D $PG_DATA --auth=trust --no-locale --encoding=UTF8
  $PG_BIN/pg_ctl -D $PG_DATA -l /tmp/pg.log \
    -o "-c listen_addresses=127.0.0.1 -p 5432 -c unix_socket_directories=/tmp" start
  sleep 2
  $PG_BIN/psql -h 127.0.0.1 -p 5432 -U z -d postgres -c "CREATE DATABASE app_db;" 2>/dev/null || true
fi
