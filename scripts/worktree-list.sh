#!/usr/bin/env bash
# Show every worktree, its slot, and any leaked Supabase branch databases.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=worktree-common.sh
source "$SCRIPT_DIR/worktree-common.sh"

primary=$(wt_primary_path)

printf '%-26s %-8s %-7s %-22s %s\n' "BRANCH" "DB" "METRO" "SIMULATOR" "PATH"

git worktree list --porcelain | awk '
  function emit() { if (path != "") print path "\t" branch }
  $1 == "worktree" { emit(); path = substr($0, 10); branch = "(detached)" }
  $1 == "branch"   { branch = $2; sub("refs/heads/", "", branch) }
  END { emit() }
' | while IFS=$'\t' read -r path branch; do
  if [ "$path" = "$primary" ]; then
    port=$(wt_read_value "$path/apps/mobile/.env" "EXPO_PORT" 2>/dev/null || echo "-")
    printf '%-26s %-8s %-7s %-22s %s\n' "$branch" "local*" "$port" "iPhone 16 Pro*" "$path"
    continue
  fi
  meta="$path/.env.worktree"
  mode=$(wt_read_value "$meta" "PLANAZO_DB_MODE" 2>/dev/null || echo "-")
  port=$(wt_read_value "$meta" "PLANAZO_METRO_PORT" 2>/dev/null || echo "-")
  sim=$(wt_read_value "$meta" "PLANAZO_SIM_NAME" 2>/dev/null || echo "-")
  udid=$(wt_read_value "$meta" "PLANAZO_SIM_UDID" 2>/dev/null || echo "")

  running=""
  [ "$port" != "-" ] && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && running=" (metro up)"
  booted=""
  [ -n "$udid" ] && wt_sim_is_booted "$udid" && booted=" [booted]"

  printf '%-26s %-8s %-7s %-22s %s\n' "$branch" "$mode" "${port}${running}" "${sim}${booted}" "$path"
done

echo
echo "* main is intentionally unmanaged by wt:* — its own local stack and simulator."

# --- leaked branch databases -------------------------------------------------
# A branch DB with no worktree behind it is billed and forgotten. This is the
# safety net for a wt:rm that died halfway, not a comment on your discipline.

branches=$(supabase branches list --project-ref "$WT_PROJECT_REF" -o json 2>/dev/null || true)
if [ -n "$branches" ]; then
  known=$(mktemp)
  while IFS= read -r p; do
    wt_read_value "$p/.env.worktree" "PLANAZO_BRANCH_NAME" 2>/dev/null || true
  done < <(wt_linked_paths) | grep -v '^$' > "$known" || true

  # Heredoc, not python3 -c '...': bash strips inner single quotes, which
  # silently turned b.get('status','?') into a syntax error and made this check
  # a no-op. Errors are shown rather than swallowed, for the same reason.
  orphan_script=$(mktemp)
  cat > "$orphan_script" <<'PY'
import json, sys
known = set(l.strip() for l in open(sys.argv[1]) if l.strip())
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if isinstance(data, dict):
    data = data.get("branches", [])
for b in data:
    name = b.get("name") or b.get("git_branch") or ""
    if name and not b.get("is_default") and name not in known:
        print("  {}  ({})".format(name, b.get("status", "?")))
PY
  orphans=$(printf '%s' "$branches" | python3 "$orphan_script" "$known" || true)
  rm -f "$known" "$orphan_script"

  if [ -n "$orphans" ]; then
    echo
    echo "ORPHANED BRANCH DATABASES (billed hourly, no worktree using them):"
    echo "$orphans"
    echo "  Delete with: supabase branches delete <name> --project-ref $WT_PROJECT_REF"
  fi
fi
