# Cloud readiness — kit plan row 33 (W2)

Brief: `/stack/projects/claude-code-setup/var/claude/prompts/pdfturbo-row33.md` (the kit's session, 2026-11-16).
Check report: `var/claude/row33/cloud-ready-check.md` (`/cloud-ready --check`, 2026-11-16). Size: Large (a CLAUDE.md
ruling, CI, a setup hook, the browser choice, tests). Tier: `advisor()` at 3C and 6C (asked 2026-11-16).

## Status

- State: built 2026-11-16 — steps 1, 2, 4, 6 done test-first (step 3 report-only, step 5 doc-only); committing.
- Evidence: red first (cloudReadiness 5 of 8, cloudEnv missing module then 2 wiring pins, cloudSetup 8 of 8); 25
  cases green; sabotage 11 mutants, each landed, red on its own case(s), restored byte-exact
  (`var/claude/row33/sabotage.log`); a real-download probe of the hook (63 MB, sha256 checked, `node` v26.13.1 through
  the `/usr/local/bin` links, the hook back in 1 s, the chain detached); a simulated cloud env made the browser
  suite look for `/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome` (the PC run stayed on Chrome, 4/4);
  full gate `var/claude/row33/gate.log` (r1 red on tsc + lint in the new hook test, fixed, `gate-r1-tsc-red.log`):
  audit, ocr, tsc, lint, jsdom 300 files, coverage 9, build, QA 169 / 125 / 0 fail / 44 skip with
  `browser = channel:chrome`; browser 133 passed + 1 import-fetch flake at load 22.5 (`docx-image-move`), 1/1 alone,
  cold full re-run `var/claude/row33/br-cold.log`.
- Follow-ups (not done, named): the `pages: write` / `id-token: write` move to the `deploy` job (ruled not now);
  the cloud proof session (the kit's `cloud/FIRST-SESSION.md`).
- Before it: row 11's PC half committed `22af3c5` (gate `var/claude/pp-row11pc/gate2.log` 10/10), unpushed (push batch).

## Steps (the skill's order: CR1, CR2, CR5, CR6, CR4, CR3)

0. **Baseline**: `var/claude/pp-row11pc/gate2.log` is the local gate on the tree these steps start from (only docs
   changed after it, re-checked by the 13 doc-reading test files). `/cloud-ready --apply` wants a clean tree; the only
   dirty path is the developer's own `.claude/settings.json` (the plan gate decides it).
1. **CR1 / I1 + the deny-list sentences** — test first, `tests/tools/cloudReadiness.test.ts` § CLAUDE.md: fails while
   « **`master` is the only branch.** » is not scoped to the developer's machine, while « re-signs its commits and
   force-pushes » or « In a cloud session there is no `deny` list at all » or « In a cloud session only the last two
   remain » survive, and until a « **A cloud session** » paragraph names `CLAUDE_CODE_REMOTE`, `claude/`, `ccr-`,
   `land.sh`, unsigned commits, no trailer, `NODE_EXTRA_CA_CERTS`, `.claude/cloud-setup.sh` and the setup log. Then the
   rewrite at every claim surface found by the inventory (3C): `CLAUDE.md` § Git autonomy, § « SHAs from a CLOUD
   session » (land.sh replaces re-sign + force-push; rule 1 becomes « after a landing, fetch first »; rule 2 stays),
   § Commands (the recipe pointer), § Git & CI (« Single branch `master` »: cloud branches run the checks, never the
   deploy), § Claude config (« only the last two remain », « that environment is dead »); `toolchain.md` § 5 and the
   HISTORICAL recipe get a one-line pointer; the `qa-sweep.mjs` browser comment. The ruling: this plan's Decisions Log
   and a `conventions.md` entry quoting the old wording (the `CLAUDE.md` § Gotchas index line « conventions … (6) »
   becomes (7) in the same commit).
2. **CR2 / I13** (`.github/workflows/deploy.yml`) — test first, same file § deploy.yml (text-level, no YAML dependency):
   push branches `master`, `claude/**`, `ccr-*`, `cloud/**`; `pull_request` still `[master]`; the `deploy` job's and
   the Pages-upload step's `if:` require `refs/heads/master`; `deploy` keeps environment `github-pages`;
   concurrency per ref
   (`group: pages-${{ github.ref }}` — today one shared `pages` group would let a cloud push cancel a running master
   deploy). The real guard is the environment's master-only branch policy [Verified: `gh api`], stated in the report.
   Its own commit, so it reverts alone. OPTIONAL (plan gate): `pages: write` / `id-token: write` moved to `deploy`
   only — not in the brief; its failure mode is « master stops deploying », proven only by the next master run
   (`deploy` job `success`, not `skipped`, `/ci-watch`).
3. **CR5**: report only — `prepare` sets `core.hooksPath .githooks`, replacing the kit's pre-push hook; the
   `master-signed` ruleset (signatures, no force-push, no deletion, no bypass) is the guarantee. One line in the
   paragraph.
4. **CR6** — one chooser for both browser users: `scripts/cloud-env.mjs` exports `isClaudeCloud(env)` (the kit's test:
   `CLAUDE_CODE_REMOTE === 'true'` and `HOME` resolving to `/root`) and `browserLaunchOptions(env)` (`{ channel:
   'chromium' }` in the cloud = Playwright's FULL pinned Chromium, revision 1255 from playwright-core 1.65.1, wherever
   `PLAYWRIGHT_BROWSERS_PATH` or `~/.cache/ms-playwright` holds it — no channel would launch `chromium-headless-shell`
   instead [Verified: `getExecutableName` in playwright-core's bundle]; `{ channel: 'chrome' }` everywhere else).
   `vitest.browser.config.ts` and `qa-sweep.mjs`'s fallback use it (its `browser =` log line fixed for a channel);
   PC and CI unchanged. Test first (pure function; `CLAUDE_CODE_REMOTE=true` with a non-root HOME stays `chrome`) plus
   a text pin that both files call the chooser.
5. **CR4**: no code — the downloads happen in the setup hook; the paragraph says
   `export NODE_EXTRA_CA_CERTS="$CCS_EXTRA_CA_FILE"` before any in-session npm / node / playwright download.
6. **CR3** `.claude/cloud-setup.sh`: exit 0 off the cloud (inline contract test); foreground: Node 26.13.1 into
   `/usr/local` when `node` is not v26 (nodejs.org tar.gz, sha256 `518674de…9778` from `SHASUMS256.txt`, curl
   `--max-time`), then `command -v node` + its version logged, ERROR when not v26; detached with `setsid`, all fds to its
   own log, started whatever the Node step did, `/usr/local/bin` first on its PATH, one chain with its log and
   done-marker (`/tmp/pdfturbo-cloud-setup.{log,done}`; the marker holds the status, the failed step and
   `package-lock.json`'s sha256): `npm ci` → `npm run ocr:assets` → `npx playwright install --with-deps --no-shell
   chromium`; one log line per step; `exit 0`; safe to re-run by hand (the paragraph: marker absent, failed or a
   different lock hash → run it again). Committed as mode 100755, pinned by the test. Test (bash, run by vitest so
   the gate runs it): a temp copy, a fakes-first PATH (`node`, `npm`, `npx`, `curl` recorders), prefix and log dir
   relocated — off-cloud does nothing; cloud runs the steps in order and writes the marker; a slow fake `npm` → the
   hook returns at once while the chain runs; a failing step still exits 0 and the marker names it; a second run is
   idempotent. Never run against the real repo. The kit runs the hook as `timeout -k 5 <left> <hook>` with output
   appended to its log [Verified: `cloud/setup.sh` `run_project_hooks`].
7. Gate, sabotage per guard, 6C advisor, commits by pathspec, push at the milestone end, CI watched, the report
   `var/claude/row33-pdfturbo-report.md`.

NOT certifiable here: the hook's real time in the 120 s budget, the cloud image's contents, the proxy CA, the
environment cache catching a detached chain mid-run, CI on a real cloud branch — only a cloud proof session
(`<kit>/cloud/FIRST-SESSION.md`) proves them.

## Decisions Log
- [2026-11-16 13:16] AGREED: I1: on the PC master stays the only branch; a cloud session (CLAUDE_CODE_REMOTE=true) commits and pushes only its harness branch (claude/*, ccr-*), never master, no pull request unless asked; the developer lands it with land.sh /stack/projects/pdfturbo <branch>, which replaces the re-sign + force-push of CLAUDE.md § SHAs from a CLOUD session (old wording: « master is the only branch … commit and push to master »)
- [2026-11-16 13:16] AGREED: Cloud browser: Playwright's own Chromium (lockfile-pinned, revision 1255) only when the kit's cloud test is true; PC and CI stay on channel chrome
- [2026-11-16 13:16] AGREED: Tier for row 33: advisor() at 3C and 6C; row 11's 6C: advisor()
- [2026-11-16 13:20] AGREED: Plan approved as written (go, 2026-11-16)
- [2026-11-16 13:20] AGREED: Clean-tree exception: the developer's own .claude/settings.json edit stays dirty and untouched; every commit is by pathspec
- [2026-11-16 13:20] AGREED: deploy.yml: only the cloud-branch triggers and a per-ref concurrency group; the pages/id-token permission move is a named follow-up, not done now
