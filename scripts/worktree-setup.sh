#!/usr/bin/env bash
# Prepare (or repair) a worktree. Idempotent — safe to re-run on a half-built one.
#
#   pnpm wt:setup                 # this worktree, keeping its current DB mode
#   pnpm wt:setup --db            # give it (or move it to) its own branch DB
#   pnpm wt:setup --no-db         # move it back to main's shared local stack
#   pnpm wt:setup <path> --db

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=worktree-common.sh
source "$SCRIPT_DIR/worktree-common.sh"

target=""
db_mode=""
for arg in "$@"; do
  case "$arg" in
    --db)    db_mode="branch" ;;
    --no-db) db_mode="shared" ;;
    -*)      wt_die "Unknown flag: $arg" ;;
    *)       target="$arg" ;;
  esac
done
target=${target:-$(pwd)}

# --- guards ------------------------------------------------------------------

[ -d "$target" ] || wt_die "No such directory: $target"
target=$(cd "$target" && pwd)

primary=$(wt_primary_path)
[ "$target" != "$primary" ] || wt_die \
  "The primary checkout stays unmanaged — wt:setup is only for linked worktrees."

target_common=$(git -C "$target" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
[ "$target_common" = "$(wt_git_common_dir)" ] || wt_die "$target is not a worktree of this repository"

branch=$(git -C "$target" branch --show-current)
[ -n "$branch" ] || wt_die "Worktree must be on a branch, not a detached HEAD"

wt_lock

metadata="$target/.env.worktree"
slug=$(wt_slug "$branch")

# Flags win; otherwise keep whatever this worktree already is; default shared.
if [ -z "$db_mode" ]; then
  db_mode=$(wt_read_value "$metadata" "PLANAZO_DB_MODE" 2>/dev/null || true)
  db_mode=${db_mode:-shared}
fi

# --- slot: metro port + simulator name (sticky across re-runs) ----------------

metro_port=$(wt_read_value "$metadata" "PLANAZO_METRO_PORT" 2>/dev/null || true)
[ -n "$metro_port" ] || metro_port=$(wt_alloc_metro_port)

sim_name=$(wt_read_value "$metadata" "PLANAZO_SIM_NAME" 2>/dev/null || true)
[ -n "$sim_name" ] || sim_name="planazo-$slug"

wt_step "Worktree $branch"
wt_info "path       $target"
wt_info "db mode    $db_mode"
wt_info "metro      $metro_port"
wt_info "simulator  $sim_name"

# --- env files ---------------------------------------------------------------
# Gitignored, so git does not carry them into a new worktree. Seed from the
# primary, then override the parts that must differ.

wt_step "Environment files"
for rel in "${WT_ENV_FILES[@]}"; do
  if [ ! -f "$target/$rel" ] && [ -f "$primary/$rel" ]; then
    mkdir -p "$(dirname "$target/$rel")"
    cp "$primary/$rel" "$target/$rel"
    wt_info "copied $rel from the primary checkout"
  fi
done

# --- dependencies ------------------------------------------------------------

if [ ! -d "$target/node_modules" ]; then
  wt_step "Installing dependencies (pnpm hardlinks from the shared store)"
  (cd "$target" && pnpm install --prefer-offline)
fi

# --- database ----------------------------------------------------------------

supabase_url=""
anon_key=""
service_key=""
branch_name=$(wt_read_value "$metadata" "PLANAZO_BRANCH_NAME" 2>/dev/null || true)
branch_ref=$(wt_read_value "$metadata" "PLANAZO_BRANCH_REF" 2>/dev/null || true)

if [ "$db_mode" = "shared" ]; then
  wt_step "Database: main's local stack (shared)"
  wt_require_local_stack
  local_env=$(wt_local_keys) || wt_die "Could not read local stack keys"
  supabase_url=$WT_LOCAL_API_URL
  anon_key=$(printf '%s\n' "$local_env" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
  service_key=$(printf '%s\n' "$local_env" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
  [ -n "$anon_key" ] && [ -n "$service_key" ] || wt_die "Could not parse keys from 'supabase status -o env'"
  wt_info "$supabase_url (shared with main — schema changes here affect main)"
else
  wt_step "Database: dedicated Supabase branch"
  branch_name=${branch_name:-$slug}

  if ! supabase branches get "$branch_name" --project-ref "$WT_PROJECT_REF" >/dev/null 2>&1; then
    wt_info "creating branch '$branch_name' (this is the slow step — minutes)"
    supabase branches create "$branch_name" --project-ref "$WT_PROJECT_REF" --yes \
      || wt_die "Could not create branch '$branch_name'"
  else
    wt_info "branch '$branch_name' already exists — reusing"
  fi

  wt_info "waiting for the branch to come up..."
  branch_json=""
  for _ in $(seq 1 120); do
    branch_json=$(supabase branches get "$branch_name" --project-ref "$WT_PROJECT_REF" -o json 2>/dev/null || true)
    status=$(wt_branch_field "$branch_json" "status" || true)
    case "$status" in
      FUNCTIONS_DEPLOYED|MIGRATIONS_PASSED|ACTIVE_HEALTHY|RUNNING) break ;;
      MIGRATIONS_FAILED|FUNCTIONS_FAILED) wt_die "Branch '$branch_name' failed to provision (status $status)" ;;
    esac
    sleep 5
  done

  branch_ref=$(wt_branch_field "$branch_json" "ref" "project_ref" "id" "database.ref") \
    || wt_die "Could not read the branch project ref. Raw payload:
$branch_json"
  db_pass=$(wt_branch_field "$branch_json" "db_pass" "database.password" "postgres_password" || true)

  supabase_url="https://${branch_ref}.supabase.co"
  keys_json=$(supabase projects api-keys --project-ref "$branch_ref" -o json 2>/dev/null || true)
  anon_key=$(printf '%s' "$keys_json" | python3 -c '
import json,sys
try: data = json.load(sys.stdin)
except Exception: sys.exit(1)
for k in data:
    if k.get("name") in ("anon","publishable"): print(k.get("api_key") or k.get("apiKey","")); sys.exit(0)
sys.exit(1)' 2>/dev/null || true)
  service_key=$(printf '%s' "$keys_json" | python3 -c '
import json,sys
try: data = json.load(sys.stdin)
except Exception: sys.exit(1)
for k in data:
    if k.get("name") in ("service_role","secret"): print(k.get("api_key") or k.get("apiKey","")); sys.exit(0)
sys.exit(1)' 2>/dev/null || true)
  [ -n "$anon_key" ] && [ -n "$service_key" ] || wt_die \
    "Could not read API keys for branch ref $branch_ref. Raw payload:
$keys_json"

  wt_info "branch ref $branch_ref"

  wt_step "Applying this branch's migrations"
  if [ -n "$db_pass" ]; then
    (cd "$target" && supabase db push --project-ref "$branch_ref" --password "$db_pass" --yes) \
      || wt_die "Migration push failed"
  else
    wt_info "no DB password in the branch payload — skipping push."
    wt_info "Apply manually: supabase db push --project-ref $branch_ref"
  fi

  wt_step "Seeding demo data"
  (cd "$target" && SUPABASE_URL="$supabase_url" SUPABASE_ANON_KEY="$anon_key" \
     SUPABASE_SERVICE_ROLE_KEY="$service_key" SEED_PRIMARY_EMAIL="$WT_SEED_PRIMARY_EMAIL" \
     node scripts/seed-demo-data.mjs) || wt_die "Seeding failed"
fi

# --- write env ---------------------------------------------------------------

wt_upsert_env "$target/.env" "SUPABASE_URL" "$supabase_url"
wt_upsert_env "$target/.env" "SUPABASE_ANON_KEY" "$anon_key"
wt_upsert_env "$target/.env" "SUPABASE_SERVICE_ROLE_KEY" "$service_key"

wt_upsert_env "$target/apps/mobile/.env" "EXPO_PUBLIC_SUPABASE_URL" "$supabase_url"
wt_upsert_env "$target/apps/mobile/.env" "EXPO_PUBLIC_SUPABASE_ANON_KEY" "$anon_key"
wt_upsert_env "$target/apps/mobile/.env" "EXPO_PORT" "$metro_port"
wt_upsert_env "$target/apps/mobile/.env" "IOS_SIMULATOR" "$sim_name"

# --- simulator ---------------------------------------------------------------

wt_step "Simulator"
sim_udid=$(wt_sim_udid_for_name "$sim_name")
if [ -z "$sim_udid" ]; then
  sim_udid=$(xcrun simctl create "$sim_name" "$WT_SIM_DEVICE_TYPE" "$WT_SIM_RUNTIME")
  wt_info "created $sim_name ($sim_udid)"
else
  wt_info "reusing $sim_name ($sim_udid)"
fi
wt_upsert_env "$target/apps/mobile/.env" "IOS_SIMULATOR_UDID" "$sim_udid"

app=$(wt_devclient_app)
if [ -z "$app" ]; then
  wt_info "No built Planazo.app found in DerivedData."
  wt_info "Build once from the primary checkout, then re-run wt:setup:"
  wt_info "  (cd $primary/apps/mobile && npx expo run:ios --device 'iPhone 16 Pro' --no-bundler)"
else
  xcrun simctl bootstatus "$sim_udid" -b >/dev/null 2>&1 || true
  xcrun simctl install "$sim_udid" "$app"
  wt_info "installed $(basename "$app") ($(du -sh "$app" | awk '{print $1}'))"
  # The dev menu's onboarding gate blocks deep links on a fresh device.
  xcrun simctl spawn "$sim_udid" defaults write com.planazo.app isOnboardingFinished -bool true 2>/dev/null || true
fi

# --- ledger ------------------------------------------------------------------

cat > "$metadata" <<EOF
# Written by wt:setup. This worktree's slot — do not hand these to another worktree.
PLANAZO_SLUG=$slug
PLANAZO_DB_MODE=$db_mode
PLANAZO_METRO_PORT=$metro_port
PLANAZO_SIM_NAME=$sim_name
PLANAZO_SIM_UDID=$sim_udid
PLANAZO_BRANCH_NAME=${branch_name:-}
PLANAZO_BRANCH_REF=${branch_ref:-}
EOF

wt_step "Ready"
wt_info "cd $target && pnpm wt:start"
if [ "$db_mode" = "shared" ]; then
  wt_info "DB is main's local stack. Touching supabase/migrations here changes main's schema —"
  wt_info "run 'pnpm wt:setup --db' first if this branch needs its own database."
fi
