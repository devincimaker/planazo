#!/usr/bin/env bash
# Shared helpers for the wt:* worktree commands.
#
# Design in one line: a worktree owns a Metro port and a simulator; its database
# is either main's local stack (default, free) or its own hosted Supabase branch
# (--db, for branches that touch migrations). Main is never managed by these
# scripts.

set -euo pipefail

# --- constants ---------------------------------------------------------------

# Passed explicitly to every CLI call. `supabase link` state is NOT trusted:
# it was found pointing at a deleted project, which fails in confusing ways.
WT_PROJECT_REF="leszgvpjonzjclhbgzju"

# Match main's simulator so QA differences are never an iOS-version artifact.
WT_SIM_DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro"
WT_SIM_RUNTIME="com.apple.CoreSimulator.SimRuntime.iOS-18-5"

# Main's local stack, from supabase/config.toml.
WT_LOCAL_API_URL="http://127.0.0.1:55321"

# Worktree Metro ports. Main and other Solopreneur projects live below this.
WT_METRO_PORT_MIN=8091
WT_METRO_PORT_MAX=8120

# Gitignored files that must be recreated in a worktree (git does not carry them).
WT_ENV_FILES=(".env" "apps/mobile/.env" "apps/web/.env.local")

WT_SEED_PRIMARY_EMAIL="demo.planazo@example.com"

# --- basics ------------------------------------------------------------------

wt_die() {
  echo "Error: $*" >&2
  exit 1
}

wt_info() { echo "  $*"; }
wt_step() { echo; echo "==> $*"; }

wt_git_common_dir() {
  git rev-parse --path-format=absolute --git-common-dir
}

# The primary checkout — deliberately unmanaged. Nothing here ever writes to it.
wt_primary_path() {
  dirname "$(wt_git_common_dir)"
}

wt_worktree_root() {
  local primary
  primary=$(wt_primary_path)
  printf '%s/%s-worktrees\n' "$(dirname "$primary")" "$(basename "$primary")"
}

wt_state_dir() {
  printf '%s/planazo-worktrees\n' "$(wt_git_common_dir)"
}

# --- env file helpers --------------------------------------------------------

wt_read_value() {
  local file=$1 key=$2
  [ -f "$file" ] || return 1
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

# Replace KEY=... in place, or append it. Keeps unrelated lines and comments.
wt_upsert_env() {
  local file=$1 key=$2 value=$3 temp
  mkdir -p "$(dirname "$file")"
  touch "$file"
  temp=$(mktemp "${file}.XXXXXX")
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { if (!found) print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$file" > "$temp"
  mv "$temp" "$file"
}

# --- locking -----------------------------------------------------------------
# Setup allocates ports and simulators by scanning what already exists, so two
# concurrent runs could hand out the same slot.

wt_lock() {
  local state_dir lock_dir owner attempt=0
  state_dir=$(wt_state_dir)
  mkdir -p "$state_dir"
  lock_dir="$state_dir/setup.lock"

  until mkdir "$lock_dir" 2>/dev/null; do
    # A killed run leaves the lock behind — its EXIT trap never fires. Steal the
    # lock when its owner is gone, instead of blocking every later run forever.
    owner=$(cat "$lock_dir/pid" 2>/dev/null || true)
    if [ -z "$owner" ] || ! kill -0 "$owner" 2>/dev/null; then
      wt_info "clearing a stale lock from pid ${owner:-unknown}"
      rm -rf "$lock_dir"
      continue
    fi
    attempt=$((attempt + 1))
    [ "$attempt" -lt 300 ] || wt_die "Timed out waiting for wt (pid $owner) to finish"
    sleep 0.2
  done

  printf '%s\n' "$$" > "$lock_dir/pid"
  # shellcheck disable=SC2064
  trap "rm -rf '$lock_dir' 2>/dev/null || true" EXIT
}

# --- worktree introspection --------------------------------------------------

wt_path_for_branch() {
  git worktree list --porcelain | awk -v ref="refs/heads/$1" '
    $1 == "worktree" { path = substr($0, 10) }
    $1 == "branch" && $2 == ref { print path; exit }
  '
}

wt_branch_for_path() {
  git worktree list --porcelain | awk -v wanted="$1" '
    $1 == "worktree" { path = substr($0, 10) }
    $1 == "branch" && path == wanted { sub("refs/heads/", "", $2); print $2; exit }
  '
}

# Every linked worktree path, excluding the primary checkout.
wt_linked_paths() {
  local primary
  primary=$(wt_primary_path)
  git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r p; do
    [ "$p" = "$primary" ] || printf '%s\n' "$p"
  done
}

# Branch name -> filesystem/simulator-safe slug.
wt_slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr '/ _' '-' | tr -cd '[:alnum:].-' | cut -c1-40
}

# --- allocation --------------------------------------------------------------

wt_metro_port_taken() {
  local wanted=$1 path assigned
  while IFS= read -r path; do
    assigned=$(wt_read_value "$path/.env.worktree" "PLANAZO_METRO_PORT" 2>/dev/null || true)
    [ "$assigned" = "$wanted" ] && return 0
  done < <(wt_linked_paths)
  lsof -nP -iTCP:"$wanted" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  return 1
}

wt_alloc_metro_port() {
  local port=$WT_METRO_PORT_MIN
  while [ "$port" -le "$WT_METRO_PORT_MAX" ]; do
    wt_metro_port_taken "$port" || { printf '%s\n' "$port"; return; }
    port=$((port + 1))
  done
  wt_die "No free Metro port in ${WT_METRO_PORT_MIN}-${WT_METRO_PORT_MAX}"
}

# --- simulator ---------------------------------------------------------------

wt_sim_udid_for_name() {
  xcrun simctl list devices -j 2>/dev/null | python3 -c '
import json,sys
name = sys.argv[1]
data = json.load(sys.stdin)
for devices in data.get("devices", {}).values():
    for d in devices:
        if d.get("name") == name:
            print(d["udid"]); sys.exit(0)
' "$1" 2>/dev/null || true
}

wt_sim_is_booted() {
  [ "$(xcrun simctl list devices -j 2>/dev/null | python3 -c '
import json,sys
udid = sys.argv[1]
data = json.load(sys.stdin)
for devices in data.get("devices", {}).values():
    for d in devices:
        if d.get("udid") == udid:
            print("yes" if d.get("state") == "Booted" else "no"); sys.exit(0)
print("no")
' "$1" 2>/dev/null)" = "yes" ]
}

# The Dev Client is a generic shell: it holds no JS, and EXPO_PUBLIC_* is inlined
# by Metro at bundle time. So one build serves every worktree, and a worktree
# only needs a rebuild when app.json or the native dep set changes.
wt_devclient_app() {
  ls -dt ~/Library/Developer/Xcode/DerivedData/Planazo-*/Build/Products/Debug-iphonesimulator/Planazo.app 2>/dev/null | head -1
}

# A brand-new simulator shows two one-time gates before the app is reachable:
# iOS asking to confirm the custom URL scheme ("Open in Planazo?"), and the Expo
# dev-menu intro sheet. Both are dismissed by LABEL out of the accessibility
# tree — never fixed coordinates, which would silently mistap when layouts move.
# Each is guarded by the surrounding text so we can't tap an app button that
# happens to share a label.
wt_dismiss_first_run_gates() {
  local udid=$1 idb attempt=0
  idb=$(command -v idb || echo "$HOME/.local/bin/idb")
  [ -x "$idb" ] || return 0

  while [ "$attempt" -lt 6 ]; do
    local hit
    hit=$("$idb" ui describe-all --udid "$udid" 2>/dev/null | python3 -c '
import json,sys
try: els = json.load(sys.stdin)
except Exception: sys.exit(0)
labels = {(e.get("AXLabel") or "").strip() for e in els}
gates = []
if any("Open in" in l for l in labels):            gates.append("Open")
if any("developer menu" in l for l in labels):     gates.append("Continue")
for e in els:
    if e.get("type") == "Button" and (e.get("AXLabel") or "").strip() in gates:
        f = e.get("frame", {})
        print("%.0f %.0f" % (f["x"] + f["width"]/2, f["y"] + f["height"]/2))
        break
' 2>/dev/null || true)

    [ -n "$hit" ] || return 0
    # shellcheck disable=SC2086
    "$idb" ui tap $hit --udid "$udid" >/dev/null 2>&1 || return 0
    attempt=$((attempt + 1))
    sleep 2
  done
}

# --- supabase ----------------------------------------------------------------

# Keys for main's local stack, read fresh (they are stable, but the stack may be down).
wt_local_keys() {
  local out
  out=$(supabase status -o env 2>/dev/null) || return 1
  printf '%s\n' "$out"
}

wt_require_local_stack() {
  supabase status >/dev/null 2>&1 || wt_die \
    "Main's local Supabase stack is not running. Start it with: (cd $(wt_primary_path) && supabase start)"
}

# `branches get -o json` returns the branch's CREDENTIALS, not metadata:
# SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, POSTGRES_URL and
# POSTGRES_URL_NON_POOLING. Everything setup needs is in that one call.
wt_branch_field() {
  local json=$1 key=$2
  printf '%s' "$json" | python3 -c '
import json,sys
try: data = json.load(sys.stdin)
except Exception: sys.exit(1)
v = data.get(sys.argv[1]) if isinstance(data, dict) else None
if not v: sys.exit(1)
print(v)
' "$key" 2>/dev/null || return 1
}

# Status lives in `branches list`, not `branches get`.
wt_branch_status() {
  supabase branches list --project-ref "$WT_PROJECT_REF" -o json 2>/dev/null | python3 -c '
import json,sys
name = sys.argv[1]
try: data = json.load(sys.stdin)
except Exception: sys.exit(0)
data = data if isinstance(data, list) else data.get("branches", [])
for b in data:
    if b.get("name") == name:
        print(b.get("status", "")); break
' "$1" 2>/dev/null || true
}

wt_branch_exists() {
  [ -n "$(wt_branch_status "$1")" ]
}

# --- port ownership ----------------------------------------------------------
# The assigned port is only ours while OUR Metro holds it. If that process died
# and something else took the port, connecting to it would misroute the app and
# tearing it down would kill an unrelated project.

wt_pid_on_port() {
  lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1
}

# 0 = our Metro is listening, 1 = port free, 2 = someone else has it
wt_port_ownership() {
  local port=$1 expected=$2 actual
  actual=$(wt_pid_on_port "$port")
  [ -n "$actual" ] || return 1
  [ -n "$expected" ] && [ "$actual" = "$expected" ] && return 0
  return 2
}
