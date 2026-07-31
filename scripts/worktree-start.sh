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

# A shared-DB worktree writing migrations is editing MAIN's schema.
if [ "$db_mode" = "shared" ]; then
  changed=$(git -C "$target" status --porcelain -- supabase/migrations | wc -l | tr -d ' ')
  if [ "$changed" != "0" ]; then
    echo
    echo "  WARNING: this worktree shares main's local database, but you have" >&2
    echo "  $changed uncommitted change(s) under supabase/migrations/." >&2
    echo "  Applying them here changes main's schema too." >&2
    echo "  Give this branch its own database with:  pnpm wt:setup --db" >&2
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
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  wt_info "already listening — leaving it alone"
else
  # --clear matters: EXPO_PUBLIC_* is inlined at bundle time, so a cached
  # transform can keep serving the previous database URL.
  (cd "$target/apps/mobile" && nohup npx expo start --port "$port" --clear >"$target/.metro.log" 2>&1 &)
  wt_info "starting (log: $target/.metro.log)"
  for _ in $(seq 1 60); do
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 1
  done
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 \
    || wt_die "Metro did not come up on $port — see $target/.metro.log"
  wt_info "up"
fi

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
