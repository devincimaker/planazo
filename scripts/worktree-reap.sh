#!/usr/bin/env bash
# Reclaim the worktree you are standing in, once its PR has merged.
#
#   scripts/worktree-reap.sh          # decide and act
#   pnpm wt:reap                      # same, by hand
#
# Wired to a PostToolUse hook on `gh pr merge` (.claude/settings.json), so the
# reclaim stops being something anyone has to remember. The branch database
# bills until it is deleted.
#
# It reclaims THIS worktree and no other. Every other worktree belongs to
# another session that may be mid-flight, and its branch database is live —
# "never touch another worktree's simulator, Metro port, or branch database"
# is the rule the whole wt:* family is built on, and a sweep would break it.
#
# The guards that matter already live in wt:rm: it refuses a dirty tree
# (printing what is uncommitted), refuses the primary checkout, refuses a
# detached worktree, and stops rather than orphaning a billing branch DB if the
# Supabase delete fails. So this script decides WHETHER to reclaim and delegates
# the reclaiming. What it adds is the one question wt:rm cannot answer: did the
# PR for this branch actually merge?
#
# Speaks JSON on stdout for the hook. Nothing else may be printed there.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=worktree-common.sh
source "$SCRIPT_DIR/worktree-common.sh"
# A hook that exits non-zero reads as a broken hook. Past this point every
# outcome is reported, not raised.
set +e

emit() { # emit <message-for-the-user> [context-for-claude]
  jq -nc --arg m "$1" --arg c "${2:-}" \
    '{systemMessage: $m} + (if $c == "" then {} else
      {hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $c}} end)'
  exit 0
}

command -v jq >/dev/null 2>&1 || exit 0

# Hook payload on stdin; empty when run by hand from a worktree.
payload=""
[ -t 0 ] || payload=$(cat 2>/dev/null)
if [ -n "$payload" ]; then
  cmd=$(jq -r '.tool_input.command // ""' <<<"$payload" 2>/dev/null)
  [[ "$cmd" == *"gh pr merge"* ]] || exit 0
  cwd=$(jq -r '.cwd // ""' <<<"$payload" 2>/dev/null)
fi
[ -n "${cwd:-}" ] && [ -d "$cwd" ] || cwd=$(pwd)
cd "$cwd" 2>/dev/null || exit 0

primary=$(wt_primary_path 2>/dev/null) || exit 0
here=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
# Standing in main: nothing of ours to reclaim.
[ "$here" != "$primary" ] || exit 0

branch=$(wt_branch_for_path "$here" 2>/dev/null)
[ -n "$branch" ] || exit 0

# The merge has to be THIS branch's. `gh pr merge 12` run from an unrelated
# worktree would otherwise reap a branch nobody merged.
state=$(gh pr view --json state -q .state 2>/dev/null)
[ "$state" = "MERGED" ] || emit "Worktree kept: the PR for '$branch' is ${state:-not found}, not MERGED."

out=$(cd "$primary" && pnpm wt:rm "$branch" 2>&1)
if [ $? -ne 0 ]; then
  # wt:rm explains itself through wt_die ("Error: ..."); anything else is a
  # surprise, and the full output goes to Claude either way.
  why=$(sed -n 's/^Error: //p' <<<"$out" | tail -1)
  emit "Could not reclaim '$branch' — worktree left in place.${why:+ $why}" \
       "pnpm wt:rm $branch did not complete. Show the user this output and let them decide:"$'\n'"$out"
fi

note="Reclaimed the '$branch' worktree, its simulator and its branch DB."

# A schema PR leaves main's local database behind the migrations now on main,
# which surfaces much later as a feed that will not load while Profile is fine.
# Idempotent, so it costs nothing to just do it.
cd "$primary" || emit "$note"
before=$(git rev-parse HEAD 2>/dev/null)
git pull --quiet --ff-only 2>/dev/null
after=$(git rev-parse HEAD 2>/dev/null)
if [ "$before" != "$after" ] &&
   git diff --name-only "$before" "$after" -- supabase/migrations/ 2>/dev/null | grep -q .; then
  if supabase migration up --local >/dev/null 2>&1; then
    note="$note Pulled main and applied its new migrations locally."
  else
    note="$note Pulled main, but its new migrations did not apply locally — run: supabase migration up --local"
  fi
fi

emit "$note" "The worktree at $here is gone. Work from $primary from here on. $note"
