#!/usr/bin/env bash
# Boot this worktree's simulator, start its Metro, and connect the app to it.
#
#   pnpm wt:start            # boot + Metro + connect
#   pnpm wt:start --login    # also sign in as the demo user

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=worktree-common.sh
source "$SCRIPT_DIR/worktree-common.sh"

do_login=""
for arg in "$@"; do
  case "$arg" in
    --login) do_login=1 ;;
    *) wt_die "Unknown flag: $arg" ;;
  esac
done

target=$(pwd)
primary=$(wt_primary_path)
[ "$target" != "$primary" ] || wt_die \
  "wt:start is for worktrees. On main, start Metro yourself — main is deliberately unmanaged."

metadata="$target/.env.worktree"
[ -f "$metadata" ] || wt_die "No .env.worktree here. Run: pnpm wt:setup"

port=$(wt_read_value "$metadata" "PLANAZO_METRO_PORT")
udid=$(wt_read_value "$metadata" "PLANAZO_SIM_UDID")
sim_name=$(wt_read_value "$metadata" "PLANAZO_SIM_NAME")
db_mode=$(wt_read_value "$metadata" "PLANAZO_DB_MODE")
[ -n "$port" ] && [ -n "$udid" ] || wt_die "Incomplete .env.worktree. Run: pnpm wt:setup"

# A shared-DB worktree writing migrations is editing MAIN's schema — and every
# other shared worktree's. This is a stop, not a warning: the mode is chosen
# before the work starts, so by the time migrations exist the guess was wrong,
# and the fix is one command.
if [ "$db_mode" = "shared" ]; then
  uncommitted=$(git -C "$target" status --porcelain -- supabase/migrations | wc -l | tr -d ' ')

  # Committed migrations count too, and are the likelier case: work a day on a
  # schema change, commit it, and the worktree is clean again. `git status`
  # alone would wave it straight through to main's database. Compare against the
  # point this branch left its base instead.
  committed=0
  base_ref=""
  merge_base=""
  for candidate in origin/main main; do
    if git -C "$target" rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
      base_ref=$candidate
      break
    fi
  done
  if [ -n "$base_ref" ]; then
    merge_base=$(git -C "$target" merge-base "$base_ref" HEAD 2>/dev/null || true)
    if [ -n "$merge_base" ]; then
      committed=$(git -C "$target" diff --name-only "$merge_base" HEAD -- supabase/migrations \
        | wc -l | tr -d ' ')
    fi
  fi

  if [ "$uncommitted" != "0" ] || [ "$committed" != "0" ]; then
    [ "$uncommitted" != "0" ] && git -C "$target" status --short -- supabase/migrations
    [ "$committed" != "0" ] && git -C "$target" diff --name-only "$merge_base" HEAD -- supabase/migrations \
      | sed 's/^/  committed  /'
    wt_die "This worktree shares main's local database, but has $uncommitted uncommitted
and $committed committed change(s) under supabase/migrations/ (vs $base_ref).
Applying them would change main's schema and every other shared worktree's
with it.

Give this branch its own database:  pnpm wt:setup --db
Or, if these changes are not yours to keep, revert them and start again."
  fi
fi

# Warn (don't stop) when this checkout carries migrations its database has not
# applied — after pulling main before its stack caught up, or rebasing a --db
# branch over someone else's schema PR. The integration suite refuses to run in
# this state; the app just misbehaves in subtler ways, hence the early warning.
db_url=$(wt_read_value "$target/.env" "SUPABASE_DB_URL" 2>/dev/null || true)
if [ -n "$db_url" ]; then
  missing=$(cd "$target/packages/integration-tests" 2>/dev/null && WT_DB_URL="$db_url" node -e '
    const { Client } = require("pg");
    const fs = require("fs");
    (async () => {
      const c = new Client({ connectionString: process.env.WT_DB_URL, connectionTimeoutMillis: 5000 });
      try {
        await c.connect();
        const r = await c.query("select version from supabase_migrations.schema_migrations");
        const applied = new Set(r.rows.map((x) => x.version));
        const files = fs.readdirSync("../../supabase/migrations").filter((f) => f.endsWith(".sql"));
        const miss = files.map((f) => f.split("_")[0]).filter((v) => !applied.has(v));
        if (miss.length) console.log(miss.join(", "));
      } catch {} finally { await c.end().catch(() => {}); }
    })();' 2>/dev/null) || true
  if [ -n "$missing" ]; then
    echo
    echo "WARNING: this checkout has migrations its database has not applied: $missing"
    if [ "$db_mode" = "shared" ]; then
      echo "Apply them to main's local stack:  (cd $primary && supabase migration up)"
    else
      echo "Apply them to this branch's database:  supabase db push --db-url \"\$SUPABASE_DB_URL\""
    fi
    echo
  fi
fi

wt_step "Simulator $sim_name"
if wt_sim_is_booted "$udid"; then
  wt_info "already booted"
else
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || true
  wt_info "booted"
fi
open -a Simulator --args -CurrentDeviceUDID "$udid" 2>/dev/null || true

wt_step "Metro on $port"
metro_pid=$(wt_read_value "$metadata" "PLANAZO_METRO_PID" 2>/dev/null || true)
own=0; wt_port_ownership "$port" "$metro_pid" || own=$?
case $own in
  0) wt_info "our Metro (pid $metro_pid) is already listening — leaving it alone" ;;
  2) wt_die "Port $port is held by pid $(wt_pid_on_port "$port"), which is NOT this
worktree's Metro. Refusing to connect the app to another project's bundler.
Stop that process, or re-run 'pnpm wt:setup' to get a different port." ;;
  *)
    # --clear matters: EXPO_PUBLIC_* is inlined at bundle time, so a cached
    # transform can keep serving the previous database URL.
    (cd "$target/apps/mobile" && nohup npx expo start --port "$port" --clear >"$target/.metro.log" 2>&1 &)
    wt_info "starting (log: $target/.metro.log)"
    for _ in $(seq 1 60); do
      [ -n "$(wt_pid_on_port "$port")" ] && break
      sleep 1
    done
    metro_pid=$(wt_pid_on_port "$port")
    [ -n "$metro_pid" ] || wt_die "Metro did not come up on $port — see $target/.metro.log"
    # Record the owner so wt:rm never kills a process it did not start.
    wt_upsert_env "$metadata" "PLANAZO_METRO_PID" "$metro_pid"
    wt_info "up (pid $metro_pid)"
    ;;
esac

wt_step "Connecting the app"
url="com.planazo.app://expo-development-client/?url=http%3A%2F%2Flocalhost%3A${port}"
xcrun simctl openurl "$udid" "$url"
sleep 2
wt_dismiss_first_run_gates "$udid"
wt_info "pointed at localhost:$port"

if [ -n "$do_login" ]; then
  # A cold planazo:// link is intercepted by the launcher, so give JS time first.
  sleep 5
  xcrun simctl openurl "$udid" \
    "planazo://dev-login?email=demo.planazo%40example.com&password=Planazo123%21"
  wt_info "signed in as demo.planazo@example.com"
fi

echo
wt_info "DB: $(wt_read_value "$target/apps/mobile/.env" "EXPO_PUBLIC_SUPABASE_URL")"
