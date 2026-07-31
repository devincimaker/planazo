#!/usr/bin/env bash
# Tear a worktree down: its branch database, its simulator, its Metro, the
# worktree itself, and the git branch if it has already merged.
#
#   pnpm wt:rm pla-17
#   pnpm wt:rm ../planazo-worktrees/pla-17
#   pnpm wt:rm pla-17 --force     # discard uncommitted changes

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=worktree-common.sh
source "$SCRIPT_DIR/worktree-common.sh"

arg=""
force=""
for a in "$@"; do
  case "$a" in
    --force) force=1 ;;
    -*)      wt_die "Unknown flag: $a" ;;
    *)       arg=$a ;;
  esac
done
[ -n "$arg" ] || { echo "Usage: pnpm wt:rm <branch|path> [--force]" >&2; exit 1; }

primary=$(wt_primary_path)

# Accept a path, a branch name, or a slug.
if [ -d "$arg" ]; then
  target=$(cd "$arg" && pwd)
else
  target=$(wt_path_for_branch "$arg" || true)
  if [ -z "$target" ]; then
    candidate="$(wt_worktree_root)/$(wt_slug "$arg")"
    [ -d "$candidate" ] && target=$candidate
  fi
fi
[ -n "${target:-}" ] || wt_die "No worktree found for: $arg"
[ "$target" != "$primary" ] || wt_die "The primary checkout cannot be removed by wt:rm."

branch=$(wt_branch_for_path "$target")
[ -n "$branch" ] || wt_die "Refusing to remove a detached worktree"

if [ -z "$force" ] && [ -n "$(git -C "$target" status --porcelain)" ]; then
  git -C "$target" status --short
  wt_die "Worktree has uncommitted changes. Commit them, or re-run with --force."
fi

metadata="$target/.env.worktree"
port=$(wt_read_value "$metadata" "PLANAZO_METRO_PORT" 2>/dev/null || true)
udid=$(wt_read_value "$metadata" "PLANAZO_SIM_UDID" 2>/dev/null || true)
sim_name=$(wt_read_value "$metadata" "PLANAZO_SIM_NAME" 2>/dev/null || true)
branch_name=$(wt_read_value "$metadata" "PLANAZO_BRANCH_NAME" 2>/dev/null || true)
db_mode=$(wt_read_value "$metadata" "PLANAZO_DB_MODE" 2>/dev/null || true)

metro_pid=$(wt_read_value "$metadata" "PLANAZO_METRO_PID" 2>/dev/null || true)
if [ -n "$port" ]; then
  # `|| own=$?` keeps set -e from killing the script: a bare call whose status
  # is only read afterwards via $? still counts as an untested failure.
  own=0; wt_port_ownership "$port" "$metro_pid" || own=$?
  case $own in
    0) wt_step "Stopping our Metro on $port (pid $metro_pid)"
       kill "$metro_pid" 2>/dev/null || true
       wt_info "stopped" ;;
    2) wt_step "Leaving port $port alone"
       # Our Metro is gone and something else took the port. Killing by port
       # here would take out an unrelated project.
       wt_info "held by pid $(wt_pid_on_port "$port"), which we did not start" ;;
  esac
fi

# Delete the branch DB before the worktree, so a failure here still leaves the
# ledger on disk to retry from.
if [ "$db_mode" = "branch" ] && [ -n "$branch_name" ]; then
  wt_step "Deleting Supabase branch '$branch_name'"
  if supabase branches delete "$branch_name" --project-ref "$WT_PROJECT_REF" --yes 2>/dev/null; then
    wt_info "deleted (billing stops)"
  else
    wt_info "FAILED — delete it yourself or it keeps billing:"
    wt_info "  supabase branches delete $branch_name --project-ref $WT_PROJECT_REF"
  fi
fi

if [ -n "$udid" ]; then
  wt_step "Deleting simulator $sim_name"
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  xcrun simctl delete "$udid" >/dev/null 2>&1 && wt_info "deleted" || wt_info "already gone"
fi

wt_step "Removing the worktree"
cd "$primary"
if [ -n "$force" ]; then
  git worktree remove --force "$target"
else
  git worktree remove "$target"
fi
git worktree prune
wt_info "$target"

if git merge-base --is-ancestor "$branch" main 2>/dev/null; then
  git branch -d "$branch" >/dev/null 2>&1 && wt_info "branch $branch deleted (already merged into main)"
else
  wt_info "branch $branch kept (not merged into main)"
fi
