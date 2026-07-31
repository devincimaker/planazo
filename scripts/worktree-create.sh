#!/usr/bin/env bash
# Create an isolated worktree and set it up end to end.
#
#   pnpm wt:new pla-17                # shares main's local DB (UI/JS work)
#   pnpm wt:new pla-17 --db           # gets its own Supabase branch database
#   pnpm wt:new pla-17 --base main    # branch off something other than origin/main

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=worktree-common.sh
source "$SCRIPT_DIR/worktree-common.sh"

branch=""
base=""
db_flag=""
while [ $# -gt 0 ]; do
  case "$1" in
    --db)     db_flag="--db" ;;
    --no-db)  db_flag="--no-db" ;;
    --base)   shift; base=${1:-} ;;
    -*)       wt_die "Unknown flag: $1" ;;
    *)        [ -n "$branch" ] && wt_die "Unexpected argument: $1"; branch=$1 ;;
  esac
  shift
done

[ -n "$branch" ] || {
  echo "Usage: pnpm wt:new <branch> [--db] [--base <ref>]" >&2
  exit 1
}
git check-ref-format --branch "$branch" >/dev/null 2>&1 || wt_die "Invalid branch name: $branch"

primary=$(wt_primary_path)
slug=$(wt_slug "$branch")
[ -n "$slug" ] || wt_die "Branch name does not produce a usable directory name"

root=$(wt_worktree_root)
target="$root/$slug"
[ ! -e "$target" ] || wt_die "Already exists: $target"

# Default to origin/main, not local main — local main can hold unpushed commits
# that would silently ride along into the new branch.
if [ -z "$base" ]; then
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    base="origin/main"
    ahead=$(git rev-list --count origin/main..main 2>/dev/null || echo 0)
    if [ "$ahead" != "0" ]; then
      wt_info "note: local main is $ahead commit(s) ahead of origin/main; branching from origin/main"
    fi
  else
    base="HEAD"
  fi
fi

mkdir -p "$root"

if git show-ref --verify --quiet "refs/heads/$branch"; then
  [ -z "$(wt_path_for_branch "$branch")" ] || wt_die "Branch already checked out: $branch"
  git worktree add "$target" "$branch"
else
  git rev-parse --verify "$base^{commit}" >/dev/null 2>&1 || wt_die "Unknown base ref: $base"
  git worktree add -b "$branch" "$target" "$base"
fi

if ! "$SCRIPT_DIR/worktree-setup.sh" "$target" ${db_flag:+"$db_flag"}; then
  echo >&2
  echo "The worktree was created but setup did not finish." >&2
  echo "Fix the problem above, then re-run:  pnpm wt:setup $target" >&2
  exit 1
fi
