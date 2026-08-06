#!/usr/bin/env bash
# Prepare (or repair) a worktree. Idempotent — safe to re-run on a half-built one.
#
#   pnpm wt:setup                 # this worktree, keeping its current DB mode
#   pnpm wt:setup --db            # give it (or move it to) its own branch DB
#   pnpm wt:setup --no-db         # move it back to main's shared local stack
#   pnpm wt:setup --no-sim        # skip the simulator: nothing on screen changes
#   pnpm wt:setup --sim           # build one after all, once the diff says so
#   pnpm wt:setup <path> --db

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=worktree-common.sh
source "$SCRIPT_DIR/worktree-common.sh"

target=""
db_mode=""
sim_mode=""
for arg in "$@"; do
  case "$arg" in
    --db)     db_mode="branch" ;;
    --no-db)  db_mode="shared" ;;
    --sim)    sim_mode="device" ;;
    --no-sim) sim_mode="none" ;;
    -*)       wt_die "Unknown flag: $arg" ;;
    *)        target="$arg" ;;
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

# Same sticky rule for the simulator. Default is to build one: a worktree that
# never says otherwise behaves exactly as it always has. `--no-sim` is what
# makes /start's "nothing on screen" routing actually save anything — before it,
# that decision only chose whether to run wt:start, while setup built, booted
# and installed a Dev Client either way.
if [ -z "$sim_mode" ]; then
  sim_mode=$(wt_read_value "$metadata" "PLANAZO_SIM_MODE" 2>/dev/null || true)
  sim_mode=${sim_mode:-device}
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

previous_branch_name=$(wt_read_value "$metadata" "PLANAZO_BRANCH_NAME" 2>/dev/null || true)

# Claim the slot NOW, not at the end. Allocation scans sibling .env.worktree
# files, so a slot that isn't written until setup finishes can be handed out
# twice — and setup can take minutes or die halfway.
wt_upsert_env "$metadata" "PLANAZO_SLUG" "$slug"
wt_upsert_env "$metadata" "PLANAZO_METRO_PORT" "$metro_port"
wt_upsert_env "$metadata" "PLANAZO_SIM_NAME" "$sim_name"

# The mode is claimed here too, but only when it is safe to claim early.
#
#   branch: MUST be written now. Provisioning, migrations and seeding all come
#   later and all can fail, and the recovery path is "re-run wt:setup". With no
#   mode on disk that re-run reads nothing, defaults to shared, and deletes the
#   branch it just spent minutes creating — silently putting the worktree on
#   main's database, which is the one outcome --db exists to prevent.
#
#   shared: only when there is no branch to lose. Writing shared while a branch
#   still exists, then dying before the delete, would leave it billing with the
#   ledger claiming otherwise.
if [ "$db_mode" = "branch" ] || [ -z "$previous_branch_name" ]; then
  wt_upsert_env "$metadata" "PLANAZO_DB_MODE" "$db_mode"
fi

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
  # Downgrading from a branch: delete it here, or it bills forever — wt:rm skips
  # deletion once the mode is shared, and wt:list treats a named branch in the
  # ledger as claimed, so it would never show up as orphaned either.
  if [ -n "$previous_branch_name" ]; then
    wt_step "Releasing the previous branch database '$previous_branch_name'"
    if supabase branches delete "$previous_branch_name" --project-ref "$WT_PROJECT_REF" --yes 2>/dev/null; then
      # Clear the name only now: while it is set, teardown still knows to delete.
      wt_upsert_env "$metadata" "PLANAZO_BRANCH_NAME" ""
      wt_upsert_env "$metadata" "PLANAZO_BRANCH_REF" ""
      # And record shared in the same breath. This is the exact moment it became
      # safe — the branch is confirmed gone, so there is nothing left for a
      # stale mode=branch to protect. Waiting until the end of setup instead
      # means any later failure leaves mode=branch on disk, and the bare
      # `wt:setup` retry creates a brand new billable branch rather than
      # finishing the downgrade that was asked for.
      wt_upsert_env "$metadata" "PLANAZO_DB_MODE" "shared"
      branch_name=""
      branch_ref=""
      wt_info "deleted (billing stops)"
    else
      wt_die "Could not delete branch '$previous_branch_name'. Refusing to switch to
shared mode while it may still exist and bill. Delete it and re-run:
  supabase branches delete $previous_branch_name --project-ref $WT_PROJECT_REF"
    fi
  fi

  wt_step "Database: main's local stack (shared)"
  wt_require_local_stack
  local_env=$(wt_local_keys) || wt_die "Could not read local stack keys"
  supabase_url=$WT_LOCAL_API_URL
  anon_key=$(printf '%s\n' "$local_env" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
  service_key=$(printf '%s\n' "$local_env" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
  db_url=$(printf '%s\n' "$local_env" | sed -n 's/^DB_URL="\(.*\)"$/\1/p')
  [ -n "$anon_key" ] && [ -n "$service_key" ] || wt_die "Could not parse keys from 'supabase status -o env'"
  wt_info "$supabase_url (shared with main — schema changes here affect main)"
else
  wt_step "Database: dedicated Supabase branch"
  branch_name=${branch_name:-$slug}

  if wt_branch_exists "$branch_name"; then
    wt_info "branch '$branch_name' already exists — reusing"
  else
    wt_info "creating branch '$branch_name' (the slow step — minutes)"
    supabase branches create "$branch_name" --project-ref "$WT_PROJECT_REF" --yes \
      || wt_die "Could not create branch '$branch_name'"
    # Record it immediately: if provisioning or seeding fails below, the ledger
    # still names the branch so wt:rm can delete it rather than leaving it billing.
    wt_upsert_env "$metadata" "PLANAZO_BRANCH_NAME" "$branch_name"
  fi

  wt_info "waiting for it to come up..."
  status=""
  for _ in $(seq 1 120); do
    # `|| true`: a blip in the listing API should retry the poll, not abort a
    # branch that is provisioning fine.
    status=$(wt_branch_status "$branch_name" || true)
    case "$status" in
      FUNCTIONS_DEPLOYED|MIGRATIONS_PASSED|ACTIVE_HEALTHY|RUNNING) break ;;
      MIGRATIONS_FAILED|FUNCTIONS_FAILED)
        wt_die "Branch '$branch_name' failed to provision (status $status).
Delete it with: supabase branches delete $branch_name --project-ref $WT_PROJECT_REF" ;;
    esac
    sleep 5
  done
  [ -n "$status" ] || wt_die "Branch '$branch_name' never reported a status"
  wt_info "status $status"

  # `branches get -o json` returns credentials, not metadata — one call has
  # everything: URL, anon key, service key and a direct Postgres URL.
  branch_json=$(supabase branches get "$branch_name" --project-ref "$WT_PROJECT_REF" -o json 2>/dev/null || true)
  # Never echo the payload itself — it carries the service-role key and Postgres
  # URLs with passwords in them. Key names are enough to diagnose a shape change.
  branch_keys=$(wt_branch_keys "$branch_json")
  supabase_url=$(wt_branch_field "$branch_json" "SUPABASE_URL") || wt_die \
    "Could not read SUPABASE_URL from the branch payload. Keys present: $branch_keys"
  anon_key=$(wt_branch_field "$branch_json" "SUPABASE_ANON_KEY") || wt_die \
    "Could not read SUPABASE_ANON_KEY from the branch payload. Keys present: $branch_keys"
  service_key=$(wt_branch_field "$branch_json" "SUPABASE_SERVICE_ROLE_KEY") || wt_die \
    "Could not read SUPABASE_SERVICE_ROLE_KEY from the branch payload. Keys present: $branch_keys"
  # Connection choice matters twice over. POSTGRES_URL_NON_POOLING points at
  # db.<ref>.supabase.co, which resolves IPv6-only and is unreachable from an
  # IPv4 network. POSTGRES_URL reaches the pooler over IPv4 but on 6543 —
  # transaction mode, where migrations lose advisory locks. Session mode is the
  # same host on 5432, which is what the old project's working db-url used.
  db_url=$(wt_branch_field "$branch_json" "POSTGRES_URL" | sed 's/:6543\//:5432\//' || true)
  [ -n "$db_url" ] || db_url=$(wt_branch_field "$branch_json" "POSTGRES_URL_NON_POOLING" || true)

  branch_ref=$(printf '%s' "$supabase_url" | sed -E 's#https://([^.]+)\..*#\1#')
  wt_upsert_env "$metadata" "PLANAZO_BRANCH_REF" "$branch_ref"
  wt_info "branch ref $branch_ref"

  wt_step "Aligning branch auth config with config.toml"
  # Hosted defaults require email confirmation and rate-limit signups to a
  # trickle, which breaks both the integration suite (it signs up throwaway
  # users and needs a session back immediately) and dev-login flows. Pushing
  # config.toml gives the branch the same auth behavior as the local stack.
  # Never the parent project: production's auth config keeps its own semantics.
  [ "$branch_ref" != "$WT_PROJECT_REF" ] || wt_die \
    "Branch ref equals the parent project ref — refusing to push config at production."
  (cd "$target" && echo y | supabase config push --project-ref "$branch_ref" >/dev/null) \
    || wt_die "Could not push config.toml to branch '$branch_name'"
  wt_info "auth config aligned (autoconfirm, signup rate limits)"

  wt_step "Applying this branch's migrations"
  # `db push` has no --project-ref; it takes a linked project or --db-url.
  if [ -n "$db_url" ]; then
    (cd "$target" && supabase db push --db-url "$db_url" --yes) || wt_die "Migration push failed"
  else
    wt_die "No POSTGRES_URL_NON_POOLING in the branch payload — cannot push migrations."
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
# Direct Postgres URL for the same database. The integration suite's drift
# check reads it to verify every migration in the checkout is applied before
# trusting a run's verdict. Carries a password in branch mode — .env is
# gitignored and already holds the service-role key.
wt_upsert_env "$target/.env" "SUPABASE_DB_URL" "${db_url:-}"

wt_upsert_env "$target/apps/mobile/.env" "EXPO_PUBLIC_SUPABASE_URL" "$supabase_url"
wt_upsert_env "$target/apps/mobile/.env" "EXPO_PUBLIC_SUPABASE_ANON_KEY" "$anon_key"
wt_upsert_env "$target/apps/mobile/.env" "EXPO_PORT" "$metro_port"
wt_upsert_env "$target/apps/mobile/.env" "IOS_SIMULATOR" "$sim_name"

# --- simulator ---------------------------------------------------------------

sim_udid=""
if [ "$sim_mode" = "none" ]; then
  wt_step "Simulator: skipped"
  wt_info "no simulator for this worktree (--no-sim)"
  wt_info "changed your mind? pnpm wt:setup --sim"
else
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
  # Pre-approve Planazo's URL schemes, or SpringBoard's "Open in Planazo?"
  # alert can appear on deep links fired while a modal is up — and that alert
  # ignores idb taps; only a device reboot clears it (see
  # .claude/skills/simulator-driving). Approved once here, it never shows.
  for scheme in planazo com.planazo.app exp+planazo; do
    xcrun simctl spawn "$sim_udid" defaults write com.apple.launchservices.schemeapproval \
      "com.apple.CoreSimulator.CoreSimulatorBridge-->$scheme" -string "com.planazo.app" 2>/dev/null || true
  done
fi
fi  # sim_mode

# --- ledger ------------------------------------------------------------------

# Upsert rather than rewrite: the slot was already claimed at the top, and
# PLANAZO_METRO_PID (written by wt:start) must survive a re-run.
wt_upsert_env "$metadata" "PLANAZO_SLUG" "$slug"
wt_upsert_env "$metadata" "PLANAZO_DB_MODE" "$db_mode"
wt_upsert_env "$metadata" "PLANAZO_METRO_PORT" "$metro_port"
wt_upsert_env "$metadata" "PLANAZO_SIM_MODE" "$sim_mode"
wt_upsert_env "$metadata" "PLANAZO_SIM_NAME" "$sim_name"
wt_upsert_env "$metadata" "PLANAZO_SIM_UDID" "$sim_udid"
wt_upsert_env "$metadata" "PLANAZO_BRANCH_NAME" "${branch_name:-}"
wt_upsert_env "$metadata" "PLANAZO_BRANCH_REF" "${branch_ref:-}"

wt_step "Ready"
# Only point at wt:start when there is a simulator for it to boot; on a --no-sim
# worktree that command now refuses, and suggesting it invites the round trip
# this mode exists to avoid.
if [ "$sim_mode" = "none" ]; then
  wt_info "cd $target"
  wt_info "No simulator: the tests are the proof here. Needs one after all? pnpm wt:setup --sim"
else
  wt_info "cd $target && pnpm wt:start"
fi
if [ "$db_mode" = "shared" ]; then
  wt_info "DB is main's local stack. Touching supabase/migrations here changes main's schema —"
  wt_info "run 'pnpm wt:setup --db' first if this branch needs its own database."
fi
