#!/usr/bin/env bash
# Fresh-context Codex (Sol) review with structured JSON output.
#
# Usage:
#   review.sh --mode code --round N [--base main] [--out .pipeline]
#   review.sh --mode plan --plan-file .pipeline/plan.md [--out .pipeline]
#
# Reads $OUT/issue.md (always) and $OUT/ledger.json (code mode, if present).
# Writes  $OUT/round-<N>-<mode>-findings.json  and prints its path on stdout.
# Effort: code round 1 = xhigh (broad hunt); later code rounds and plan = medium.
# cwd must be the checkout under review (the worktree).
set -euo pipefail

MODE=code ROUND=1 BASE=main PLAN_FILE="" OUT=".pipeline"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)      MODE=$2; shift 2 ;;
    --round)     ROUND=$2; shift 2 ;;
    --base)      BASE=$2; shift 2 ;;
    --plan-file) PLAN_FILE=$2; shift 2 ;;
    --out)       OUT=$2; shift 2 ;;
    *) echo "review.sh: unknown arg $1" >&2; exit 2 ;;
  esac
done

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUT"

# Keep pipeline artifacts out of git (idempotent; shared across worktrees).
EXCLUDE_FILE="$(git rev-parse --git-path info/exclude)"
grep -qxF '.pipeline/' "$EXCLUDE_FILE" 2>/dev/null || echo '.pipeline/' >> "$EXCLUDE_FILE"

if [[ "$MODE" == plan ]]; then
  [[ -n "$PLAN_FILE" ]] || { echo "review.sh: --plan-file required in plan mode" >&2; exit 2; }
  EFFORT=medium
  TEMPLATE="$SKILL_DIR/reviewer-plan.md"
else
  TEMPLATE="$SKILL_DIR/reviewer-code.md"
  if [[ "$ROUND" -eq 1 ]]; then EFFORT=xhigh; else EFFORT=medium; fi
fi

PROMPT="$OUT/round-$ROUND-$MODE-prompt.md"
{
  cat "$TEMPLATE"
  echo; echo "## The Linear issue"; echo
  cat "$OUT/issue.md"
  if [[ "$MODE" == plan ]]; then
    echo; echo "## The plan under review"; echo
    cat "$PLAN_FILE"
  else
    echo; echo "## Review scope"; echo
    echo "Review the full cumulative diff of this branch against \`$BASE\`:"
    echo "run \`git diff $BASE...HEAD\` and read any touched file in full when you need context."
    if [[ -s "$OUT/ledger.json" ]]; then
      echo; echo "## Prior findings ledger"; echo
      echo "Verify \`fixed-claimed\` entries; do not re-raise \`deferred\` ones."
      echo '```json'; cat "$OUT/ledger.json"; echo '```'
    fi
  fi
} > "$PROMPT"

FINDINGS="$OUT/round-$ROUND-$MODE-findings.json"
LOG="$OUT/round-$ROUND-$MODE-review.log"
echo "[pipeline] $MODE review, round $ROUND — codex (sol) effort=$EFFORT — log: $LOG" >&2

codex exec \
  --ephemeral --color never \
  --sandbox read-only \
  -c model_reasoning_effort="$EFFORT" \
  --output-schema "$SKILL_DIR/findings-schema.json" \
  --output-last-message "$FINDINGS" \
  - < "$PROMPT" > "$LOG" 2>&1 \
  || { echo "[pipeline] codex exec failed — see $LOG" >&2; exit 1; }

[[ -s "$FINDINGS" ]] || { echo "[pipeline] no findings file produced — see $LOG" >&2; exit 1; }
echo "$FINDINGS"
