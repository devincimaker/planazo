#!/usr/bin/env bash
# Wipe THIS worktree's branch database, re-apply every migration in this
# checkout, and reseed. The re-apply primitive for iterating on migration SQL:
# `db push` matches by version and silently skips a recorded migration whose
# file you edited — a reset is how edited content actually reaches the DB.
#
#   pnpm wt:db:reset
#
# Branch mode only, and only against this worktree's own database. A shared
# worktree's database is main's local stack, which is never reset from here.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=worktree-common.sh
source "$SCRIPT_DIR/worktree-common.sh"

target=$(pwd)
primary=$(wt_primary_path)
[ "$target" != "$primary" ] || wt_die \
  "wt:db:reset is for branch-mode worktrees. Main's local stack is reset with 'supabase db reset'."

metadata="$target/.env.worktree"
[ -f "$metadata" ] || wt_die "No .env.worktree here. Run: pnpm wt:setup --db"

db_mode=$(wt_read_value "$metadata" "PLANAZO_DB_MODE" 2>/dev/null || true)
[ "$db_mode" = "branch" ] || wt_die \
  "This worktree is in '$db_mode' mode — its database is main's local stack, and
resetting that wipes every shared worktree's data. If this branch needs its own
resettable database: pnpm wt:setup --db"

branch_ref=$(wt_read_value "$metadata" "PLANAZO_BRANCH_REF" 2>/dev/null || true)
[ -n "$branch_ref" ] || wt_die "No PLANAZO_BRANCH_REF recorded. Run: pnpm wt:setup --db"

db_url=$(wt_read_value "$target/.env" "SUPABASE_DB_URL" 2>/dev/null || true)
[ -n "$db_url" ] || wt_die "No SUPABASE_DB_URL in .env. Run: pnpm wt:setup --db"

# The pooler user is postgres.<ref>. Destroying a database is only acceptable
# when that ref is provably THIS worktree's own — anything else, including a
# URL we cannot parse, is refused.
url_ref=$(printf '%s' "$db_url" | sed -nE 's#^postgres(ql)?://postgres\.([a-z]{20}):.*#\2#p')
[ -n "$url_ref" ] || wt_die "Could not parse a project ref out of SUPABASE_DB_URL — refusing to reset."
[ "$url_ref" = "$branch_ref" ] || wt_die \
  "SUPABASE_DB_URL points at '$url_ref' but this worktree's branch is '$branch_ref'.
Refusing to reset a database that is not this worktree's. Re-run: pnpm wt:setup --db"
[ "$url_ref" != "$WT_PROJECT_REF" ] || wt_die "That is the production ref. Never."

wt_step "Resetting branch database $branch_ref"
(cd "$target" && echo y | supabase db reset --db-url "$db_url") || wt_die "Reset failed"

wt_step "Reseeding demo data"
supabase_url=$(wt_read_value "$target/.env" "SUPABASE_URL")
anon_key=$(wt_read_value "$target/.env" "SUPABASE_ANON_KEY")
service_key=$(wt_read_value "$target/.env" "SUPABASE_SERVICE_ROLE_KEY")
(cd "$target" && SUPABASE_URL="$supabase_url" SUPABASE_ANON_KEY="$anon_key" \
   SUPABASE_SERVICE_ROLE_KEY="$service_key" SEED_PRIMARY_EMAIL="$WT_SEED_PRIMARY_EMAIL" \
   node scripts/seed-demo-data.mjs) || wt_die "Seeding failed"

wt_step "Done"
wt_info "Every migration in this checkout is applied; the app needs a re-login"
wt_info "(fresh database, fresh JWTs). Restart Metro with --clear if it was up."
