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
