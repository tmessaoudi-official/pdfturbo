# Claude bundle integration Plan

Bring the developer's machine-level Claude Code setup (`claude-setup-global-20260722`, 199 files) into
this repo in the form that actually works in a **cloud container**, modelled on the already-adapted
[`phorj`](https://github.com/tmessaoudi-official/phorj) port.

## Decisions Log

- [2026-07-27 20:30] AGREED: Integration targets the **repo**, not `~/.claude`. Cloud sessions load the repo's `CLAUDE.md`, `.claude/{settings.json hooks,skills,agents,commands}` and `.mcp.json`, and load **none** of `~/.claude/`. `~/.claude/` is ephemeral (fresh VM per session).
- [2026-07-27 20:45] AGREED: **Zero hooks** from the bundle are registered. All 39 are one of: an interrupt (the 3 ask-human-gate scripts, the question guard), a hard deadlock (`advisor-completion-guard` requires a tool that does not exist), terminal-only output nobody can see in a web session (statusline, banner, context-bar, git-status, subagent-status — ~88 KB writing to stderr), or writes to a filesystem that evaporates (`edit-log`, `session-remember` × 20 files).
- [2026-07-27 20:45] AGREED: `settings.json.template` is rejected **wholesale**, not cherry-picked. Its `PreToolUse: rtk hook claude` would block *every* Bash call (`rtk` is absent, and a non-zero PreToolUse exit blocks before permission rules are evaluated); its `deny: Bash(git push *)` would revoke the push authorisation; its `"model": "opus"` would override the session model; its 16 `enabledPlugins` are user-scoped and do not transfer.
- [2026-07-27 21:00] AGREED: `AskUserQuestion` is **forbidden project-wide** — it times out in this container. Every question is plain text: context + minimal example + numbered options + recommended first + a visible escape, then STOP. This *inverts* the upstream framework rule (which mandated the tool) and matches phorj's Invariant 15.
- [2026-07-27 21:00] AGREED: the upstream `askUserQuestionTimeout: "never"` fix is user-scoped, which is *why* the origin machine never saw the hang and this container does.
- [2026-07-27 22:10] AGREED: skills are based on **phorj's already-container-adapted versions**, not the raw bundle — they already carry the plain-text-questions, no-`advisor()`, `var/claude/` report-path and no-`--scope=global` adaptations.
- [2026-07-27 22:10] AGREED: 12 skills. phorj's 13 minus `cross-check` (validates formal specs against Jira; `ac4ef68` removed this repo's specs and there is no Jira), plus `forge` which phorj lacks.
- [2026-07-27 22:15] AGREED: every skill declares `disallowed-tools: AskUserQuestion` — a mechanical guarantee phorj lacks (its own framework header admits "nothing enforces this mechanically"). Honest limit: it binds only while a skill is active and clears on the next user message.
- [2026-07-27 22:20] AGREED: `install.sh` is ported **one-directional only** (`cp -u` three docs into `~/.claude`). phorj's copy also ran `cp -R /root/.claude /root/.claude.json` into its working tree at every SessionStart, with a commented-out `git push --force-with-lease` beneath it, and `claude-bundle` was not gitignored there. Not reproduced here; `/claude-bundle/` is gitignored as a belt-and-braces guard.
- [2026-07-27 22:40] AGREED (developer, overruling the recommendation): **zero `deny` rules.** The recommendation was to keep `git push --force` / `npm publish` denied since push is autonomous here; the developer ruled all four out, on the grounds that in a cloud session a `deny` rule is an unrecoverable dead end — there is no terminal in which to run the command by hand. `rm -rf` was blocked twice during this very session, once on the `phorj` clone command. The control is now discipline, recorded in § "Git autonomy".
- [2026-07-27 22:40] AGREED (developer, overruling the recommendation): **plans live in the repo** at `docs/plans/<topic>.plan.md`, adopting phorj's Invariant 19. The recommendation was gitignored `var/claude/plans/` to respect `ac4ef68` (which deleted `docs/plans` as "inappropriate for a proprietary product"); the developer ruled for in-repo persistence. `docs/plans/` therefore returns, scoped to plans only — no `docs/reviews`, no `docs/superpowers`.
- [2026-07-27 22:40] AGREED: certification tier is **MAXIMAL by default** (3 lenses, two consecutive clean rounds, cap 5), with one mechanical carve-out: no `src/` in `git diff --name-only` → STANDARD. This reverses an earlier tiered-by-path recommendation — the evidence against it is that this repo's severe bugs span `src/docx/`, `src/ui/binders/`, `src/ocr/` and `core/`, so a path allowlist would cover nearly everything.
- [2026-07-27 22:55] AGREED: **three** reviewer agents, not two. The ladder mandates three lenses, and two agents cannot staff a three-lens panel without an unnamed generic reviewer.
- [2026-07-27 23:05] AGREED: `.claude/settings.json` is **classifier-blocked** for Claude (verified: `Write`/`Edit` succeed on `CLAUDE.md`, `.claude/skills/**`, `.claude/agents/**`, `scripts/**`; denied on `settings.json`). It travels as `scripts/claude-bootstrap/settings.json.pending` + `apply-pending-settings.sh`, run by the developer locally. This is the only file in the integration needing the relay.

## Formal Plan

| Phase | Deliverable | Status |
|---|---|---|
| 1 | `scripts/claude-bootstrap/` — `install.sh` (one-directional), `README.md`, `apply-pending-settings.sh`, `CLAUDE-global.md`, `THINKING.md`, `BLAST-RADIUS.md`, `hooks/{log-helpers,precompact-handoff}.sh` | built |
| 2 | `.claude/skills/` × 12, each container-adapted + `disallowed-tools: AskUserQuestion` | built |
| 3 | `.claude/agents/` × 3 — one per certification lens | built |
| 4 | `CLAUDE.md` § Routing / § Questions are plain text / § Certification ladder / § Git autonomy / § Plans live in the repo; `.gitignore` (+`/var`, +`/claude-bundle/`, + settings backups; fixed the dangling `docs/plans/ocr-csp-fix.plan.md` reference left by `ac4ef68`/`532a64f`) | built |
| 5 | `scripts/claude-bootstrap/settings.json.pending` — `defaultMode: auto`, `deny: []`, + the two bootstrap hooks | built |
| 6 | Developer applies the pending settings locally, commits, pushes | **awaiting developer** |
| 7 | Claude pulls to re-sync | pending |

### Rejected, with reasons

- **31 of the bundle's 48 skills** — all operate on a persistent `~/.claude/` (`audit` 28 refs, `cleanup` 43, `bundle` 38, `install` 27, the 7 `memory-*`, `lean*`, `model-audit`, `repair`, `sr-health`, `pre-session-health`, `skill-extractor`, `templatize`, `consolidate`, `bootstrap`, `adapt-project`, `command-audit`), or depend on absent tooling (`validate-infra` — `shellcheck`/`yamllint`/`hadolint` all missing), or orchestrate skills that are themselves out (`mega-analysis`), or would **shadow a working built-in** (`loop`).
- **`bin/` — 34 files, ~190 KB** — bundle authoring/installing/pruning/lean-swapping for a persistent `~/.claude/`. Zero applicability to an ephemeral container.
- **`mcp/` — 48 files, ~420 KB** — a Python X11/Wayland/Windows GUI driver (no display in the container) and Jira/Confluence/GitLab/Trivy topology (irrelevant to a client-side PDF editor, and internal service names/ports do not belong in a personal repo). The bundled `.env` files were deliberately not read.
- **`refs/MODELS.md`** — lists `opus-4-8`/`sonnet-4-6` as CURRENT with no Opus 5; importing it would make model advice propose downgrades.
- **`recent` / `expand`** — phorj skipped both; `expanding-context` already runs `expand`'s framework internally.
- **`qa-sweep`** — deferred, not rejected. Highest-value remaining item (this repo's `CLAUDE.md` credits it with finding the OCR CSP breakage) but it assumes Playwright MCP and needs rewiring onto the repo's own Playwright + `/opt/pw-browsers/chromium`. Deserves its own change.

### Known limits carried into the result

- **New skills need one session restart.** Claude Code watches an existing `.claude/skills/` live, but a newly created top-level skills directory is not watched until the CLI restarts. The `CLAUDE.md` sections bind immediately; the slash commands appear next session.
- **`allow` rules are inert in cloud sessions** — they require an accepted workspace-trust dialog a cloud session never shows (`Ignoring N permissions.allow entries … this workspace has not been trusted`; `hasTrustDialogAccepted=unset`). They still work locally. `defaultMode` is what takes effect.
- **`disallowed-tools` binds per-turn**, not per-session.
- **No `deny` rules at all**, by developer ruling — nothing mechanically prevents a force-push.
