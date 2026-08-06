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

# Delete the branch DB before the worktree, and STOP if it does not work.
# .env.worktree is the only record of which branch belongs to this worktree, and
# `git worktree remove` deletes it — so carrying on past a failed delete destroys
# the retry information and leaves a branch billing that nothing points at any
# more. Printing the manual command is not enough when the next line removes the
# evidence.
# Keyed on the branch NAME, not the mode: a setup interrupted mid-downgrade can
# leave mode=shared while the branch still exists and bills.
if [ -n "$branch_name" ]; then
  wt_step "Deleting Supabase branch '$branch_name'"
  deleted=""
  doubt=""
  if supabase branches delete "$branch_name" --project-ref "$WT_PROJECT_REF" --yes 2>/dev/null; then
    deleted=1
    wt_info "deleted (billing stops)"
  else
    # The delete failed. Only a listing that actually came back, parsed, and did
    # not contain the branch proves it is gone — deleted by hand, or by an
    # earlier wt:rm that died later on. If Supabase is simply unreachable the
    # listing is empty for that reason too, and accepting it would clear the
    # ledger on a branch that is still billing.
    presence=0; wt_branch_presence "$branch_name" || presence=$?
    case $presence in
      1) deleted=1
         wt_info "already gone — nothing is billing" ;;
      0) doubt="It still exists." ;;
      *) doubt="Supabase did not answer, so it may still exist and still bill." ;;
    esac
  fi

  if [ -n "$deleted" ]; then
    # Clear the ledger before anything destructive, so a failure further down
    # cannot send the next run chasing a branch that no longer exists.
    wt_upsert_env "$metadata" "PLANAZO_BRANCH_NAME" ""
    wt_upsert_env "$metadata" "PLANAZO_BRANCH_REF" ""
  else
    wt_die "Could not delete branch '$branch_name'. $doubt

Stopping before the worktree is removed — $metadata is the only
record of this branch, and removing the worktree would take it with it.

  supabase branches delete $branch_name --project-ref $WT_PROJECT_REF

Then re-run wt:rm. If you are certain the branch is gone, clear
PLANAZO_BRANCH_NAME in that file first."
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

# Is deleting this ref safe — would anything be lost? Two different things make
# it safe, and both are asked, because each is blind where the other sees.
# Ancestry catches a branch whose commits are already in main, including one
# that never had a PR at all. wt_branch_has_merged_pr catches the squash merge,
# where the branch's commit is in main's history nowhere but the work has
# unquestionably landed. That second question is why this is a shared helper:
# wt:list has to ask it too, and the two answering differently is the bug that
# left three branch databases billing.
merged=""
if git merge-base --is-ancestor "$branch" main 2>/dev/null; then
  merged="already merged into main"
else
  merged_pr=0
  wt_branch_has_merged_pr "$branch" || merged_pr=$?
  if [ "$merged_pr" -eq 0 ]; then
    merged="squash-merged via PR"
  fi
fi

# -D rather than -d precisely because the squash case cannot pass -d's ancestry
# check. Forcing is only safe because the branch above is *proven* merged; the
# else arm keeps anything unproven, including when gh is missing or offline.
if [ -n "$merged" ]; then
  git branch -D "$branch" >/dev/null 2>&1 && wt_info "branch $branch deleted ($merged)"
else
  wt_info "branch $branch kept (no merge found — delete by hand once you are sure)"
fi
