# `scripts/claude-bootstrap/` — Claude Code container bootstrap

Everything here exists because **a Claude Code cloud session gets a fresh `~/.claude/` every time**
and never reads the developer's own. Anything the reasoning framework needs at `~/.claude/` has to
travel *in the repo* and be reinstalled at session start.

Adapted 2026-07-27 from the developer's machine bundle `claude-setup-global-20260722`, by way of the
already-container-adapted [`phorj`](https://github.com/tmessaoudi-official/phorj) port.

## What's here

| File | Role |
|---|---|
| `install.sh` | **SessionStart hook.** `cp -u` the three docs below into `~/.claude/`. Nothing else. |
| `CLAUDE-global.md` | The global reasoning framework → installed as `~/.claude/CLAUDE.md`. Edited (not just disclaimed) for this container. |
| `THINKING.md` | 33 named mental models → `~/.claude/THINKING.md`. Reference only, not auto-loaded. |
| `BLAST-RADIUS.md` | State-dependent destructive-command reference → `~/.claude/BLAST-RADIUS.md`. |
| `hooks/precompact-handoff.sh` | **PreCompact hook.** Writes `var/claude/handoff/{latest,handoff-<stamp>}.md` before compaction. Deterministic — no LLM call. |
| `hooks/log-helpers.sh` | `log_obs()` shared by the hooks. |
| `apply-pending-settings.sh` | **You run this one, on your machine.** See below. |

The repo-native skills (`.claude/skills/`) and reviewer agents (`.claude/agents/`) need **no**
install — Claude Code reads them in place from the clone.

## Why `install.sh` is deliberately one-directional

It copies three files **into** `~/.claude/` and never copies anything **out**. `~/.claude.json`
holds the OAuth account, `userID` and `machineID`, and the working tree is one `git add -A` away from
git history. The upstream port this was adapted from did copy `/root/.claude` and `/root/.claude.json`
into the repo on every session start (with a commented-out `git push --force-with-lease` beneath it);
that block was removed here on purpose. **Do not reintroduce it.**

## What was rejected from the bundle, and why

The machine bundle held 48 skills, 39 hooks, 34 `bin/` scripts, 48 `mcp/` files and a
`settings.json.template`. Almost none of it travels. This list exists so none of it is re-imported by
mistake — each entry is a landmine that was tested, not a matter of taste.

- **All 39 hooks — zero registered.** Every one is an interrupt (the three ask-human gates, the
  question guard), a hard deadlock (`advisor-completion-guard` waits on a tool that does not exist in
  this environment), terminal-only output nobody can see in a web session (statusline, banner,
  context-bar, git-status, subagent-status — ~88 KB writing to stderr), or a write to a filesystem
  that evaporates (`edit-log`, `session-remember` × 20 files).
- **`settings.json.template` — rejected wholesale, not cherry-picked.** Its
  `PreToolUse: rtk hook claude` would block *every* Bash call (`rtk` is absent here, and a non-zero
  PreToolUse exit blocks before permission rules are even evaluated); its `deny: Bash(git push *)`
  would revoke this repo's push authorisation; its `"model": "opus"` would override the session model;
  its 16 `enabledPlugins` are user-scoped and do not transfer.
- **31 of the 48 skills.** They operate on a *persistent* `~/.claude/` (`audit`, `cleanup`, `bundle`,
  `install`, the seven `memory-*`, `lean*`, `model-audit`, `repair`, `sr-health`,
  `pre-session-health`, `skill-extractor`, `templatize`, `consolidate`, `bootstrap`, `adapt-project`,
  `command-audit`), or need absent tooling (`validate-infra` — no `shellcheck`/`yamllint`/`hadolint`),
  or orchestrate skills that are themselves out (`mega-analysis`), or would **shadow a working
  built-in** (`loop`).
- **`bin/` — 34 files, ~190 KB.** Authoring/installing/pruning a persistent `~/.claude/`. Zero
  applicability to an ephemeral container.
- **`mcp/` — 48 files, ~420 KB.** A Python X11/Wayland GUI driver (no display here) plus
  Jira/Confluence/GitLab/Trivy topology — irrelevant to a client-side PDF editor, and internal
  service names/ports do not belong in this repo. The bundled `.env` files were deliberately not read.
- **`refs/MODELS.md`.** Lists `opus-4-8`/`sonnet-4-6` as current with no Opus 5; importing it would
  make model advice propose downgrades.

**`/qa-sweep` — PORTED 2026-07-29** (it was the one deferred, not rejected, item). It assumed the
Playwright **MCP** server and a link crawl, neither of which applies here; it now drives the repo's own
Playwright via `scripts/qa-sweep.mjs` and crawls the **UI state space** instead of URLs. The
`--target=cli` mode, the auth step and the GIF recorder were dropped as having no subject in this repo.
Full adaptation table in `.claude/skills/qa-sweep/SKILL.md`.

**Nothing from the bundle is now pending.** Every remaining item above is a deliberate rejection.

## The one file Claude cannot write: `.claude/settings.json`

Claude Code's safety classifier blocks Claude from editing its own permission surface. Verified in
this container: `Write`/`Edit` succeed on `CLAUDE.md`, `.claude/skills/**`, `.claude/agents/**` and
`scripts/**`, and are **denied** on `.claude/settings.json`. In a cloud session the developer has no
terminal either, so the hand-over travels through the repo:

1. Claude writes `scripts/claude-bootstrap/settings.json.pending` and pushes.
2. You pull, then run:

   ```bash
   bash scripts/claude-bootstrap/apply-pending-settings.sh
   ```

   It validates the JSON *before* touching the live file, backs the old one up, copies it into place,
   re-validates, and **deletes the pending copy** so the repo never carries two settings files. It
   stages, commits and pushes nothing — it prints the commands and leaves them to you.
3. You commit + push. Claude pulls to re-sync.

`.claude/settings.json.bak.*` is gitignored — never commit a backup.

## Verifying the bootstrap by hand

```bash
bash scripts/claude-bootstrap/install.sh
ls -l ~/.claude/{CLAUDE.md,THINKING.md,BLAST-RADIUS.md}
head -40 ~/.claude/CLAUDE.md          # should open with the pdfturbo adaptation header
bash -n scripts/claude-bootstrap/*.sh scripts/claude-bootstrap/hooks/*.sh
```

`install.sh` is idempotent: `cp -u` only copies when the repo copy is newer, so running it twice is a
no-op and a hand-edited newer `~/.claude/CLAUDE.md` on a real workstation is never clobbered.

## Known limits

- **New skills need a session restart to appear.** Claude Code watches an existing
  `.claude/skills/` directory live, but a *newly created* top-level skills directory is not watched
  until the CLI restarts. First session after this landed: `/sweep` and friends won't autocomplete.
- **`allow` rules in `.claude/settings.json` are inert in cloud sessions.** They require an accepted
  workspace-trust dialog, which a cloud session never shows; the CLI logs
  `Ignoring N permissions.allow entries … this workspace has not been trusted`. They still work
  locally. `defaultMode` is the key that actually takes effect. Don't grow the allow list expecting
  cloud effect.
- **`PDFTURBO_HANDOFF_LLM=1`** makes the PreCompact hook shell out to `claude -p` for a narrative
  summary. Measured cost in this container: **~$0.14 per invocation** (a nested CLI re-primes the full
  system prompt — ~70k cache-creation tokens for a 3-word prompt). Off by default for that reason.
