#!/usr/bin/env bash
# Tail a pipeline dev agent's transcript as readable lines.
#
# Usage:
#   watch-dev.sh                 # auto-find the most recent agent transcript
#   watch-dev.sh <agent-id>      # a specific agent
#   watch-dev.sh -n 200          # replay the last 200 events, then follow
#
# Each line is: HH:MM:SS  KIND  detail
#   SAY   the agent's own reasoning/narration
#   TOOL  a tool call (command / description / file)
#   RES   the result it got back (truncated)
set -euo pipefail

TAIL_N=40 AGENT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n) TAIL_N=$2; shift 2 ;;
    -*) echo "watch-dev.sh: unknown flag $1" >&2; exit 2 ;;
    *)  AGENT=$1; shift ;;
  esac
done

TASKS_GLOB="/private/tmp/claude-501/-Users-devinci-Solopreneur-planazo/*/tasks"

if [[ -n "$AGENT" ]]; then
  FILE=$(ls -t $TASKS_GLOB/"$AGENT".output 2>/dev/null | head -1 || true)
else
  FILE=$(ls -t $TASKS_GLOB/*.output 2>/dev/null | head -1 || true)
fi

[[ -n "$FILE" && -e "$FILE" ]] || { echo "watch-dev.sh: no agent transcript found" >&2; exit 1; }
echo "==> $(basename "$FILE" .output)  ($(ls -lL "$FILE" | awk '{print $5}') bytes)" >&2
echo "==> Ctrl-C to stop watching (the agent keeps running)" >&2
echo >&2

FILTER='
  .timestamp as $t | (.message.content // []) |
  if type=="array" then .[] else . end |
  if .type=="text" then
    "\($t[11:19])  [36mSAY [0m  \(.text | gsub("\n";" ") | .[0:220])"
  elif .type=="tool_use" then
    "\($t[11:19])  [33mTOOL[0m  \(.name): \((.input.command // .input.description // .input.file_path // (.input|tostring)) | gsub("\n";" ") | .[0:220])"
  elif .type=="tool_result" then
    "\($t[11:19])  [90mRES [0m  \(((.content // "") | if type=="array" then (map(.text // "") | join(" ")) else tostring end) | gsub("\n";" ") | .[0:220])"
  else empty end'

# Replay recent history, then follow.
tail -n "$TAIL_N" "$FILE" | jq -r --unbuffered "$FILTER" 2>/dev/null || true
tail -n 0 -f "$FILE" | jq -r --unbuffered "$FILTER" 2>/dev/null
