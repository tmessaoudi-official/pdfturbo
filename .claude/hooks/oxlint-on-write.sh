#!/usr/bin/env bash
# PostToolUse hook: lint any .ts file Claude just wrote/edited with oxlint.
# Exit 2 feeds the lint output back to Claude so it fixes issues immediately.
# (Migrated from eslint → oxlint 2026-06-14; oxlint is the sole linter.)
set -uo pipefail

input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")

[[ -n "$file" && "$file" == *.ts ]] || exit 0
[[ "$file" == */node_modules/* ]] && exit 0
[[ -f "$file" ]] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# oxlint auto-discovers .oxlintrc.json; it exits non-zero only on errors
# (warnings do not block), matching the previous eslint behavior.
out=$(npx oxlint "$file" 2>&1)
status=$?

if [[ $status -ne 0 ]]; then
  echo "oxlint failed for $file:" >&2
  echo "$out" >&2
  exit 2
fi
exit 0
