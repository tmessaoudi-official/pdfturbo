#!/usr/bin/env bash
# pdfturbo's toolchain hook for claude.ai cloud environments (kit plan row 33, CR3; CLAUDE.md § "A cloud session").
# The developer's claude-code-setup kit (its cloud/setup.sh is the environment's setup script) runs this file as root,
# from the workspace root, before Claude starts, as `timeout -k 5 <seconds left> .claude/cloud-setup.sh` with its output
# appended to /tmp/ccs-setup.log, inside ONE time budget shared by every workspace's hook (CCS_HOOK_BUDGET, 120 s).
#
#   1. Node 26.13.1 (the gate needs >= 26: package.json engines, .nvmrc), only when `node` is not v26: the nodejs.org
#      tarball, sha256-pinned, unpacked under /usr/local/lib/nodejs and linked into /usr/local/bin. Foreground (~63 MB).
#   2. ONE detached chain (setsid, its own log, a done-marker), started whatever step 1 did, because together it is
#      far over the budget: npm ci -> npm run ocr:assets -> npx playwright install --with-deps --no-shell chromium (the
#      full Chromium build pinned by the lockfile's playwright-core; scripts/cloud-env.mjs launches it).
#      Marker /tmp/pdfturbo-cloud-setup.done: `ok` or `failed` + `step=`, then `lock=<sha256 of package-lock.json>`.
#
# Rules: a no-op off the cloud (the kit's own test, inline: this runs even when the kit's install failed); safe to run
# again by hand (a chain already running only says so; an `ok` marker for the same lockfile skips the chain); one log
# line per step; never fails the environment (exit 0). Downloads happen here because the agent proxy's CA
# ($CCS_EXTRA_CA_FILE) is written only after setup; a session re-running this by hand exports
# NODE_EXTRA_CA_CERTS="$CCS_EXTRA_CA_FILE" first. PDFTURBO_CLOUD_SETUP_PREFIX / _LOGDIR only relocate the root-owned
# paths for tests/tools/cloudSetup.test.ts; the Node pin has no override.
set -u
[[ "${CLAUDE_CODE_REMOTE:-}" == true && "$(realpath -m -- "${HOME:-}")" == /root ]] || exit 0

P="${PDFTURBO_CLOUD_SETUP_PREFIX:-}"
LOGDIR="${PDFTURBO_CLOUD_SETUP_LOGDIR:-/tmp}"
LOG="$LOGDIR/pdfturbo-cloud-setup.log"
DONE="$LOGDIR/pdfturbo-cloud-setup.done"
LOCK="$LOGDIR/pdfturbo-cloud-setup.lock"
NODE_VER=26.13.1
NODE_DIR="node-v$NODE_VER-linux-x64"
NODE_URL="https://nodejs.org/dist/v$NODE_VER/$NODE_DIR.tar.gz"
NODE_SHA=518674de2b621728a5e4486f5fb3b7d2900bb3cc4aa97969edaa463db99f9778   # SHASUMS256.txt, read 2026-11-16
CHAIN=("npm ci" "npm run ocr:assets" "npx playwright install --with-deps --no-shell chromium")

say() { printf '%s | pdfturbo-cloud-setup | %s | %s\n' "$(date -u +%FT%TZ)" "$1" "$2"; }
node_version() { node --version 2>/dev/null; }
lock_hash() { sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1; }
export PATH="$P/usr/local/bin:$PATH"

# ── the detached chain (this file re-run with --chain, in its own session) ─────────────────────────────────────────
if [[ "${1:-}" == --chain ]]; then
  exec 9>"$LOCK"
  if ! flock -n 9; then say INFO "chain: already running (another run holds $LOCK)"; exit 0; fi
  lock="$(lock_hash)"
  for step in "${CHAIN[@]}"; do
    t0=$SECONDS
    say INFO "chain: $step"
    # shellcheck disable=SC2086  # each step is a plain command line, split on purpose
    if ! $step; then
      say ERROR "chain: '$step' failed after $((SECONDS - t0))s (output above)"
      printf 'failed\nstep=%s\nlock=%s\n' "$step" "$lock" >"$DONE.tmp" && mv -f "$DONE.tmp" "$DONE"
      exit 0
    fi
    say INFO "chain: '$step' took $((SECONDS - t0))s"
  done
  printf 'ok\nlock=%s\n' "$lock" >"$DONE.tmp" && mv -f "$DONE.tmp" "$DONE"
  say INFO "chain: done"
  exit 0
fi

# ── 1. Node 26 ──────────────────────────────────────────────────────────────────────────────────────────────────────
install_node() {
  local t
  if [[ "$(node_version)" == v26.* ]]; then say INFO "node: $(command -v node) $(node_version) already"; return 0; fi
  t="$(mktemp -d)"
  if ! curl -fsSL --max-time 60 -o "$t/node.tgz" "$NODE_URL"; then
    say ERROR "node: download failed ($NODE_URL)"
  elif ! printf '%s  %s\n' "$NODE_SHA" "$t/node.tgz" | sha256sum -c --status; then
    say ERROR "node: the download's sha256 is not the pinned $NODE_SHA: not installed"
  elif ! { mkdir -p "$P/usr/local/lib/nodejs" "$P/usr/local/bin" \
           && tar -xzf "$t/node.tgz" -C "$P/usr/local/lib/nodejs" --no-same-owner \
           && ( for b in node npm npx corepack; do ln -sfn "../lib/nodejs/$NODE_DIR/bin/$b" "$P/usr/local/bin/$b" || exit 1; done ); }; then
    say ERROR "node: unpacking into $P/usr/local failed"
  else
    say INFO "node: $NODE_VER installed from $NODE_URL (sha256 checked)"
  fi
  rm -rf -- "$t"
  hash -r
  if [[ "$(node_version)" == v26.* ]]; then
    say INFO "node: $(command -v node) $(node_version)"
  else
    say ERROR "node: $(command -v node || echo 'no node') $(node_version) is not v26: the gate will refuse to run"
  fi
}

# ── 2. start the chain ──────────────────────────────────────────────────────────────────────────────────────────────
start_chain() {
  local lock
  lock="$(lock_hash)"
  if [[ -f "$DONE" && "$(cat "$DONE")" == "ok"$'\n'"lock=$lock" && -d node_modules ]]; then
    say INFO "chain: already done for this package-lock.json ($DONE)"
    return 0
  fi
  rm -f -- "$DONE"   # a stale marker must not answer for this run
  setsid "${BASH_SOURCE[0]}" --chain </dev/null >>"$LOG" 2>&1 &
  say INFO "chain: started (pid $!), log $LOG, marker $DONE"
}

{
  say INFO "start in $(pwd)"
  install_node
  start_chain
} >>"$LOG" 2>&1
exit 0
