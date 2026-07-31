#!/usr/bin/env node
/**
 * qa-sweep — drives the real PDFturbo app in a real browser and reports what breaks.
 *
 * The engine behind `/qa-sweep` (.claude/skills/qa-sweep/SKILL.md). It exists because the app's
 * highest-value defects have all been things no unit test could see: OCR dead in production behind
 * a CSP, an invisible watermark, an Android keyboard loop. Those need the actual app, actually
 * rendered, actually clicked.
 *
 * WHY A SCRIPT AND NOT AN INLINE SNIPPET IN THE SKILL: this is versioned, lintable, and diffable —
 * a 200-line browser driver pasted into a markdown file rots silently.
 *
 * WHY NOT @vitest/browser: the browser suite mounts components in-page. This drives the whole app
 * through its real entry point, which is a different question ("does the product work?" vs "does
 * this unit work?").
 *
 * Usage:
 *   node scripts/qa-sweep.mjs [--url <url>] [--fixture <pdf>] [--allow-destructive]
 *                             [--only <substr>] [--depth N] [--max-clicks N]
 *                             [--no-a11y] [--no-scenarios] [--out <dir>]
 *
 * Exit codes: 0 = no failures; 1 = at least one FAIL; 2 = harness could not run (no browser, no
 * server, app never booted). A non-zero exit is the point — this is usable as a gate.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Browser resolution — must work in BOTH environments ──────────────────────────
// Returns Playwright launch options, because the two places this runs get a browser differently:
//
//   CI (GitHub runner): no Playwright browser binary is downloaded — deploy.yml installs only
//     `playwright install-deps chromium` and the browser suite uses `channel: 'chrome'` against the
//     runner's preinstalled Google Chrome. So that is the fallback here too, which keeps the sweep
//     and `npm run test:browser` on the same browser.
//   Claude cloud container: no Google Chrome at all, so `channel: 'chrome'` cannot work. It has
//     /opt/pw-browsers instead — but the PREINSTALLED chromium-1194 lacks
//     Map.prototype.getOrInsertComputed, which pdfjs-dist v6 calls on every page render, so every
//     render() throws and it reads as a product bug. Refuse 1194 rather than emit fake failures.
//
// Order: explicit override → a usable build under the browsers dir → system Chrome.
const PW_ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
function resolveBrowser() {
  if (process.env.QA_SWEEP_CHROME) return { executablePath: process.env.QA_SWEEP_CHROME };
  if (existsSync(PW_ROOT)) {
    const builds = readdirSync(PW_ROOT)
      .filter(d => /^chromium-\d+$/.test(d))
      .map(d => ({ dir: d, rev: Number(d.split('-')[1]) }))
      .sort((a, b) => b.rev - a.rev);
    for (const b of builds) {
      const exe = join(PW_ROOT, b.dir, 'chrome-linux64', 'chrome');
      if (!existsSync(exe)) continue;
      if (b.rev > 1194) return { executablePath: exe };
      console.error(
        `qa-sweep: chromium-${b.rev} lacks Map.prototype.getOrInsertComputed, which pdfjs-dist v6\n` +
        '          needs on every render — skipping it. `npx playwright install chromium` provides a\n' +
        '          usable build (~115 MB, not persisted in the container).',
      );
    }
  }
  // Fall back to the system Google Chrome, exactly as vitest.browser.config.ts does.
  return { channel: 'chrome' };
}

// ── args ─────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const has = n => argv.includes(n);

const URL_ = flag('--url', 'http://localhost:5173/pdfturbo/');
const FIXTURE = flag('--fixture', 'tests/fixtures/qa-imagetext.pdf');
const ONLY = flag('--only');
const ALLOW_DESTRUCTIVE = has('--allow-destructive');
const A11Y = !has('--no-a11y');
const SCENARIOS = !has('--no-scenarios');
const SCENARIO_ONLY = flag('--scenario');
const MAX_DEPTH = Number(flag('--depth', '3'));
const MAX_CLICKS = Number(flag('--max-clicks', '250'));
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = resolve(flag('--out', `var/claude/qa-sweep/${STAMP}`));

// Buttons that mutate or destroy user work, or open a native dialog Playwright cannot drive.
// Skipped unless --allow-destructive. Matched as substrings, case-insensitive.
const DESTRUCTIVE = [
  'delete', 'remove', 'reset', 'clear', 'eraser', 'redact', 'flatten', 'compress',
  'cancel', 'restoreNo', 'lockPdfApply',
];
// Byte-export buttons: they open the File System Access save dialog, which Playwright cannot
// drive. The browser tests work around this by deleting window.showSaveFilePicker to force the
// anchor-download fallback (CLAUDE.md § File System Access save) — we do the same below, so these
// are safe to click, but each produces a download we do not need to keep.
const EXPORTERS = ['downloadBtn', 'exportDocxBtn', 'exportMdBtn', 'exportTableBtn', 'exportXfdfBtn'];
// Disclosure panels and the toggle that opens each. The DFS cannot cover these on its own: unwinding
// child N also shuts the panel children N+1.. live in, so all but the first are recorded "became
// hidden before click" (measured: 12 of the export flyout's 13 items, including the flatten, sanitize,
// compress, Bates, watermark and DOCX/MD/XFDF export paths — some of the highest-consequence controls
// in the product). Fixing that inside the DFS was tried three ways and every one lost coverage
// overall (see exercise()). So instead: a bounded second pass that re-opens ONE known toggle per
// child. Explicit, ordered, and it cannot destabilize the crawl because it runs after it.
// WHY THE FLYOUT/MENU ITEMS ARE NEVER REACHED — and why that is the app's design, not a bug here.
// modalBinder.ts registers the export flyout with `closeWhen: 'any-click'`, and each file-menu item
// removes `.open` from its wrap in its own handler. So the app SHUTS the container as soon as one of
// its children is clicked; every later sibling is then legitimately hidden. Only re-opening the
// toggle once per child could reach them, and three shapes of that were built and measured on
// 2026-07-31 — all net-negative against 145 checks / 107 pass / 0 warn / 36 skip:
//   in-DFS, unwind only when something was revealed .... 143 /  81 / 30 WARN / 30 skip
//   in-DFS, re-click any parent ........................ 107 /  54 / 38 WARN / 13 skip (+1 FAIL)
//   in-DFS, re-click flyout/menu toggles only .......... 132 /  78 / 33 WARN / 21 skip
//   separate post-crawl container pass ................. 170 / 112 /  0 WARN / 55 skip (+1 FAIL:
//     it left state that broke the next scenario's precondition, and a variant hung for 15 minutes)
// The controls this costs are named in every report under "NOT exercised". Reaching them is real open
// work — most likely a per-container pass that resets the app between children — not a tweak.

// Accepted axe findings: a DELIBERATE product decision that this gate must not veto.
// Each entry is reported as ACCEPTED (never silently dropped) so it stays visible in every run, and
// carries the reason so a future reader can re-litigate it instead of guessing.
// Keep this list at zero entries wherever possible — it is a hole in the gate by construction.
// EMPTY, and worth keeping that way. It held exactly one entry — `scrollable-region-focusable` on
// #canvasContainer — from 2026-07-30 until 2026-07-31, when the fix it described as "open, not
// refused" was actually done: #pdfCanvas (the region's CONTENT) is now tabindex="0", so the rule
// passes with the main landmark's tabindex="-1" ruling fully intact. The gate now has zero accepted
// exceptions; every critical/serious axe finding blocks the deploy.
const A11Y_ACCEPTED = [];
const isAccepted = (ruleId, targets) => A11Y_ACCEPTED.some(a =>
  a.rule === ruleId && targets.some(t => String(t).includes(a.target)));

const results = [];
const record = (verdict, subject, detail, shot) => results.push({ verdict, subject, detail, shot });
const VERDICTS = ['PASS', 'FAIL', 'WARN'];

// Every button[id] present in the DOM at the end of the crawl. Used to name the coverage gap
// explicitly in the report: a run with 31 "became hidden" SKIP lines buried among 145 entries reads
// as thorough, and it is not. Best-effort by construction — a modal built on demand contributes its
// buttons only once it has been opened at least once, so this is a floor on the universe, not a
// census. Populated in main(); null means the crawl never got far enough to ask.
let domButtonIds = null;

async function main() {
  const launchOpts = resolveBrowser();

  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.error('qa-sweep: playwright is not installed.'); process.exit(2); }

  mkdirSync(OUT, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    console.error(`qa-sweep: could not launch a browser (${JSON.stringify(launchOpts)}): ` +
      `${String(e.message).split('\n')[0]}`);
    process.exit(2);
  }
  console.log(`qa-sweep: browser = ${launchOpts.executablePath ?? `channel:${launchOpts.channel}`}`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();

  // Force the anchor-download fallback so no un-driveable native Save dialog can hang the run.
  await page.addInitScript(() => { delete window.showSaveFilePicker; });

  const consoleErrors = [];
  const netFailures = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(`uncaught: ${e.message}`));
  page.on('response', r => { if (r.status() >= 400) netFailures.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', r => netFailures.push(`FAILED ${r.url()} (${r.failure()?.errorText})`));

  // ── boot ───────────────────────────────────────────────────────────────────────
  try {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {
    console.error(`qa-sweep: could not reach ${URL_} — is \`npm run dev\` running?`);
    await browser.close(); process.exit(2);
  }
  // A prior session's IndexedDB restore prompt blocks the UI; decline it to start clean.
  const restore = page.locator('#restoreNoBtn');
  if (await restore.isVisible().catch(() => false)) await restore.click();

  const bootErrors = consoleErrors.splice(0);
  record(bootErrors.length ? 'FAIL' : 'PASS', 'boot', bootErrors.join(' | ') || 'app booted, 0 console errors');

  // ── load a document (most tools are inert without one) ─────────────────────────
  const fixture = resolve(FIXTURE);
  if (!existsSync(fixture)) { console.error(`qa-sweep: fixture not found: ${fixture}`); await browser.close(); process.exit(2); }
  await page.setInputFiles('#fileInput', fixture);
  const canvasUp = await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true).catch(() => false);
  // #progress-overlay.active covers the whole toolbar and swallows pointer events. Measured
  // 2026-07-29: it stays active for ~342ms AFTER the canvas becomes visible, so starting to click at
  // canvas-visible lands inside that window and every click times out. Not a product defect — normal
  // loading feedback — but the driver has to wait it out.
  await page.waitForFunction(
    () => !document.getElementById('progress-overlay')?.classList.contains('active'),
    null, { timeout: 20_000 },
  ).catch(() => {});

  const loadErrors = consoleErrors.splice(0);
  await page.screenshot({ path: join(OUT, '000-loaded.png') });
  record(canvasUp && !loadErrors.length ? 'PASS' : 'FAIL', `load ${FIXTURE}`,
    canvasUp ? (loadErrors.join(' | ') || 'rendered, 0 console errors') : 'no canvas appeared within 30s',
    '000-loaded.png');
  if (!canvasUp) { await finish(browser); return; }

  // BOUND EVERY LATER ACTION. Playwright's default action timeout is 30s, and a covered control makes
  // each click wait it out in full. Measured 2026-07-31: the scenario reset loop (up to 40 undo
  // clicks) hit a covered #undoBtn and hung the run for 20 minutes with no output — in CI that is a
  // job timeout, i.e. an unactionable red instead of a diagnosable failure. Boot already used its own
  // explicit 30s/20s waits above, so lowering the default now costs nothing.
  page.setDefaultTimeout(6_000);

  // ── crawl the UI STATE SPACE (not the URL space) ────────────────────────────────
  // This app is ONE page. The original bundle skill crawled links with --depth/--max-urls, which
  // finds nothing here. The equivalent structure is progressive disclosure: measured 2026-07-29,
  // only 8 of 139 buttons are visible+enabled on a freshly loaded document — the rest live behind
  // the file menu, the export flyout, the text chevron, modals, and a user-customisable toolbar.
  //
  // Enumerated from the LIVE DOM, never a hardcoded list: feature flags remove buttons at runtime
  // (main.ts strips them when a VITE_FEATURE_* is off), so a fixed list would report phantom
  // failures for a legitimately disabled flag.
  // REACHABLE, not merely visible. `offsetParent !== null` stays true for a control COVERED by an
  // open modal, so enumerating on visibility alone made the crawl reach straight through a modal and
  // click the toolbar behind it — which surfaced as "blocked by DIV#helpModal" WARNs that read like a
  // product defect (measured: helpBtn opened the modal, and the very next descend target was a button
  // underneath it). So hit-test each candidate: the element at its centre must be the button itself or
  // inside it. `pointer-events: none` covers are ignored, because they do not intercept clicks —
  // several of this app's overlays are pass-through by design (#watermarkOverlay), and treating them
  // as blockers previously flagged ~10 perfectly clickable controls.
  //
  // Controls skipped here are NOT marked visited, so they get picked up later once the modal is
  // unwound and they become reachable again.
  const visible = () => page.$$eval('button[id]', els => els
    .filter(e => e.offsetParent !== null && !e.disabled)
    .filter(e => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false; // off-screen
      const top = document.elementFromPoint(cx, cy);
      if (!top || top === e || e.contains(top) || top.contains(e)) return true;
      return getComputedStyle(top).pointerEvents === 'none';
    })
    .map(e => e.id));

  // DEPTH-FIRST, not round-based. A round-based sweep leaves a modal open and every later click in
  // that round times out (measured: 15 spurious "click failed" WARNs) — and it can never reach a
  // menu's children, because by the time the next round enumerates, the menu is shut. So: click,
  // then descend into whatever that click revealed WHILE IT IS STILL OPEN, then unwind with Escape.
  // `--depth` is the bundle skill's flag, re-pointed from URL depth to disclosure depth.
  // Close whatever popup/menu/modal is covering the page centre. ONE Escape is not enough: a nested
  // popup consumes it, and some modals ignore Escape entirely, which would leave them covering the
  // toolbar for the rest of the run (observed: #helpModal blocking 12 later controls).
  const unwind = async () => {
    for (let k = 0; k < 3; k++) {
      const blocked = await page.evaluate(() => {
        const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        for (let el = top; el; el = el.parentElement) {
          if (el.className && /modal|overlay|popup|menu/i.test(String(el.className))) return true;
        }
        return false;
      }).catch(() => false);
      if (!blocked) break;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(120).catch(() => {});
    }
    await page.waitForTimeout(80).catch(() => {});
  };

  const visited = new Set();
  let n = 0, capped = false, reachedTop = 0, crashed = false;

  async function exercise(id, depth) {
    if (n >= MAX_CLICKS) { capped = true; return; }
    visited.add(id);
    n += 1;
    const tag = String(n).padStart(3, '0');
    const lower = id.toLowerCase();

    if (!ALLOW_DESTRUCTIVE && DESTRUCTIVE.some(d => lower.includes(d.toLowerCase()))) {
      record('SKIP', id, 'destructive by name (--allow-destructive to include)');
      return;
    }

    const el = page.locator(`#${id}`);
    if (!await el.isVisible().catch(() => false)) { record('SKIP', id, 'became hidden before click'); return; }

    // Re-check DISABLED at click time, not at enumeration time. Playwright's click waits for an
    // element to become enabled and then reports a bare TIMEOUT — it never says "disabled". Measured
    // 2026-07-29: that turned four legitimate states into "not clickable" WARNs that read as product
    // defects. A preceding click in this DFS routinely disables a sibling (navigate to the last page
    // → #lastPage disables itself), so this is the normal case, not an edge case.
    //
    // Deliberately NOT pre-checking for a covering element: `elementFromPoint` returns the topmost
    // node regardless of `pointer-events`, while Playwright's hit-testing respects it. This app has
    // several transparent pass-through overlays (#watermarkOverlay is pointer-events:none by design),
    // so a pre-check flagged ~10 perfectly clickable controls as covered. Diagnose AFTER a real
    // failure instead — see the timeout branch below.
    const disabledNow = await page.$eval(`#${id}`, e => e.disabled).catch(() => false);
    if (disabledNow) { record('SKIP', id, 'became disabled before click (state changed by an earlier click)'); return; }

    const before = `${tag}-${id}-before.png`;
    await page.screenshot({ path: join(OUT, before) }).catch(() => {});
    consoleErrors.splice(0); netFailures.splice(0);

    let clickErr = null;
    try { await el.click({ timeout: 4_000 }); await page.waitForTimeout(300); }
    catch (e) { clickErr = e.message.split('\n')[0]; }

    const after = `${tag}-${id}-after.png`;
    await page.screenshot({ path: join(OUT, after) }).catch(() => {});

    const errs = consoleErrors.splice(0);
    const nets = netFailures.splice(0);
    // A timeout is not self-explanatory — say WHY, and only blame a cover that can actually
    // intercept (pointer-events !== none). Anything else stays an honest bare WARN.
    if (clickErr) {
      const why = await page.$eval(`#${id}`, e => {
        const r = e.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!top || top === e || e.contains(top) || top.contains(e)) return null;
        if (getComputedStyle(top).pointerEvents === 'none') return null;
        return `${top.tagName}#${top.id || '(no id)'}`;
      }).catch(() => null);
      record('WARN', id, why ? `blocked by ${why} — an earlier control left it open` : `not clickable: ${clickErr}`, after);
    }
    else if (errs.length) record('FAIL', id, `console: ${errs.slice(0, 3).join(' | ')}`, after);
    else if (nets.length) record('FAIL', id, `network: ${nets.slice(0, 3).join(' | ')}`, after);
    else record('PASS', id, EXPORTERS.includes(id) ? 'no errors (export ran)' : 'no console/network errors', after);

    // Descend into what this click just revealed, while it is still on screen.
    if (!clickErr && depth < MAX_DEPTH) {
      const revealed = (await visible()).filter(i => !visited.has(i));
      for (const child of revealed) {
        if (n >= MAX_CLICKS) { capped = true; break; }
        await exercise(child, depth + 1);
      }
    }

    // Unwind this subtree so whatever comes next is reachable, whether or not this node revealed
    // anything. This is what turns a container in the way into a cheap honest SKIP instead of a
    // "blocked by" WARN, and it is why ~31 controls are recorded "became hidden before click": a
    // sibling's unwind also shuts the flyout they live in. THAT IS A KNOWN DRIVER LIMIT, listed
    // explicitly at the end of every report. Three fixes were tried and MEASURED, all net losses
    // against this baseline of 145 checks / 107 pass / 0 warn / 36 skip (--allow-destructive):
    //   - Unwind only when this node revealed something: a leaf whose modal's buttons are already
    //     visited never unwinds, so the modal blocks everything after it. #codeModal left open by
    //     addCodeBtn cost 16 controls, twice over — 143 / 81 / 30 WARN / 30 skip.
    //   - Also re-click the parent when a sibling went hidden: re-opens every modal and so drives
    //     its CONFIRM branch too (blankPageConfirmBtn actually adds a page), mutating the document
    //     under the rest of the run — 107 / 54 / 1 FAIL / 38 WARN / 13 skip.
    //   - Same, but only for flyout/menu toggles: still 132 / 78 / 33 WARN / 21 skip.
    // A hidden-SKIP and a blocked-WARN are the same phenomenon; trading the former for the latter
    // buys nothing and costs stability. Do not re-attempt without beating those numbers.
    await unwind();
  }

  let top = [...new Set(await visible())];
  reachedTop = top.length;
  if (ONLY) top = top.filter(i => i.toLowerCase().includes(ONLY.toLowerCase()));
  console.log(`qa-sweep: ${top.length} top-level button(s), max depth ${MAX_DEPTH}`);
  // A BROWSER CRASH MID-CRAWL MUST STILL PRODUCE A REPORT. This container's Chromium exits with
  // SIGSEGV non-deterministically (CLAUDE.md § test:browser in the container), and until 2026-07-31 a
  // crash here threw straight out of main() → exit 2, no report, and in CI no uploaded artifact
  // either: an unactionable red. The scenario phase already contained this; the crawl did not.
  for (const id of top) {
    if (visited.has(id)) continue;
    if (n >= MAX_CLICKS) { capped = true; break; }
    if (!browser.isConnected()) {
      record('FAIL', 'crawl', `browser CRASHED (SIGSEGV) after ${n} clicks — coverage is INCOMPLETE`);
      crashed = true;
      break;
    }
    try {
      await exercise(id, 0);
      await unwind(); // leave a clean state for the next top-level control
    } catch (e) {
      const why = String(e.message).split('\n')[0];
      record('FAIL', id, browser.isConnected() ? `crawl threw: ${why}`
        : `browser CRASHED (SIGSEGV) on this control — coverage is INCOMPLETE: ${why}`);
      if (!browser.isConnected()) { crashed = true; break; }
    }
  }

  // Snapshot the button universe while the page is still alive, for the coverage gap in the report.
  domButtonIds = await page.$$eval('button[id]', els => els.map(e => e.id)).catch(() => null);

  // Nothing below can run against a dead browser — report what was collected instead of throwing.
  if (crashed || !browser.isConnected()) { await finish(browser); return; }

  // NO SILENT CAPS: a sweep that exercised nothing must not report a green summary.
  if (n === 0) {
    console.error(`qa-sweep: exercised 0 buttons${ONLY ? ` — --only "${ONLY}" matched none of the ` +
      `${reachedTop} top-level ids` : ''}. Refusing to report a pass.`);
    await browser.close().catch(() => {});
    process.exit(2);
  }
  if (capped) record('WARN', 'crawl', `stopped at --max-clicks ${MAX_CLICKS} — coverage is INCOMPLETE`);

  // ── a11y ───────────────────────────────────────────────────────────────────────
  // The app's CSP is `script-src 'self'`, so page.addScriptTag({content}) is BLOCKED (inline
  // script). page.evaluate runs through CDP Runtime.evaluate, which is not subject to page CSP —
  // that is the only route in. Do not "fix" this by relaxing the CSP.
  if (A11Y) {
    const axePath = join('node_modules', 'axe-core', 'axe.min.js');
    if (!existsSync(axePath)) {
      record('WARN', 'a11y', 'axe-core not installed — skipped (npm i -D axe-core to enable)');
    } else {
      try {
        // SETTLE FIRST. axe reads COMPOSITED colour, so a control caught mid fade-in reports the
        // blend of its half-transparent background over the toolbar as a contrast failure. Measured
        // 2026-07-29: #textModeBtn at opacity 0.508 read as #6f787f (4.49, FAIL) when its real
        // background is #6c757d (4.69, PASS) — 8 phantom violations, and the count drifted run to run
        // with load timing. Waiting for every running animation removes them and leaves only the real
        // failures. Do NOT "fix" a contrast report without confirming opacity has reached 1.
        await page.waitForFunction(
          () => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))).then(() => true),
          null, { timeout: 15_000 },
        ).catch(() => {});
        await page.waitForTimeout(800);

        const src = readFileSync(axePath, 'utf8');
        await page.evaluate(src);
        const res = await page.evaluate(async () => await window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        }));
        const v = res.violations || [];
        // SEVERITY GATES THE EXIT CODE. Until 2026-07-29 every violation was recorded as 'A11Y',
        // which is not 'FAIL', so the process still exited 0 — this script advertised itself as a
        // gate while being incapable of failing on the three serious WCAG rules it had just found.
        // Policy matches the existing static gate (tests/browser/a11y-axe.browser.test.ts): zero
        // critical/serious is the hard line; moderate/minor are reported, not enforced.
        const severe = v.filter(x => x.impact === 'critical' || x.impact === 'serious');
        // Split accepted findings out of the blocking set, and REPORT them either way.
        const accepted = severe.filter(x => isAccepted(x.id, x.nodes.flatMap(node => node.target)));
        const blocking = severe.filter(x => !accepted.includes(x));
        const detail = v.length
          ? v.map(x => `${x.id}:${x.impact}(${x.nodes.length})`).join(', ')
          : '0 violations';
        for (const a of accepted) {
          const why = A11Y_ACCEPTED.find(e => e.rule === a.id)?.why ?? '';
          record('ACCEPT', `a11y ${a.id}`, `${a.impact}, accepted by decision — ${why.slice(0, 120)}…`);
        }
        if (blocking.length) {
          record('FAIL', 'a11y (WCAG 2.1 AA)', `${blocking.length} critical/serious — ${detail}`);
        } else {
          record(v.length ? 'A11Y' : 'PASS', 'a11y (WCAG 2.1 AA)',
            accepted.length ? `${detail} (${accepted.length} accepted by decision)` : detail);
        }
      } catch (e) {
        record('WARN', 'a11y', `axe injection failed: ${String(e.message).split('\n')[0]}`);
      }
    }
  }

  // ── mobile pass ────────────────────────────────────────────────────────────────
  // 375px is where this app has actually shipped bugs (the F2b thumbnail controls could not fit
  // five 44px touch targets on a 50x74 tile), so it is a first-class check, not a nicety.
  if (browser.isConnected()) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'zzz-mobile-375.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  record(overflow ? 'WARN' : 'PASS', 'mobile 375px',
    overflow ? 'horizontal overflow at 375px' : 'no horizontal overflow', 'zzz-mobile-375.png');
  }
  // Back to desktop for the scenario phase.
  if (browser.isConnected()) await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

  // ── WORKFLOW SCENARIOS ─────────────────────────────────────────────────────────
  // The crawl above clicks each control ONCE, in whatever state it happened to be in. That is
  // reachability, not use. Nearly every severe defect in this repo's history was an INTERACTION bug
  // that a single click could never surface: the sequential-edit ghost (two edits sharing an origin),
  // the destroyed `w:drawing` on DOCX save, the redaction burn misplaced on a cropped page, an
  // invisible watermark. So: run a handful of real workflows end to end.
  //
  // Deliberately shallow assertions. This is a smoke driver, not a unit test — it checks "no console
  // error, no failed request, and the app's own state changed as expected". Pixel-level proof belongs
  // in tests/browser/**, which can assert on rasterised output. Keeping the bar here low is also what
  // keeps it non-flaky, and a flaky gate blocks deploys at random (see CLAUDE.md § A flaky gate).
  //
  // Each scenario starts from a FRESH page + freshly loaded fixture, so one cannot contaminate the
  // next. A scenario that throws is recorded FAIL — never skipped silently.
  if (SCENARIOS) {
    const enabled = (pg, id) => pg.$eval(`#${id}`, e => !e.disabled).catch(() => null);

    // RESET IN-PAGE, NEVER BY NAVIGATION. Two container facts forced this, both measured 2026-07-30:
    //   - `ctx.newPage()` crashes the browser (isConnected() true immediately before, false after) —
    //     a second concurrent app instance is one pdf.js worker too many.
    //   - `page.goto()` to reload the app while a PDF is loaded ALSO crashes it, with SIGSEGV
    //     (signal 11, SEGV_MAPERR) — the trigger is navigating away from a live pdf.js document.
    // Undoing back to an empty history restores the document to its just-loaded state without either,
    // which is what the scenarios actually need. If a scenario leaves un-undoable state, the next one
    // starts dirty — so scenarios are written to be order-independent.
    const resetPage = async () => {
      for (let i = 0; i < 40; i++) {
        if (!await enabled(page, 'undoBtn')) break;
        // A failed undo click means the button is unreachable, not that one more attempt will land —
        // keep going and 40 unreachable clicks become 40 timeouts.
        let ok = true;
        await page.click('#undoBtn', { timeout: 2_000 }).catch(() => { ok = false; });
        if (!ok) break;
        await page.waitForTimeout(90);
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.click('#selectBtn', { timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(200);
      // Load-time noise is already covered by the boot/load checks; scenarios own only what they do.
      consoleErrors.length = 0;
      netFailures.length = 0;
    };

    // Drag inside the VISIBLE part of the page canvas. The canvas is taller than the viewport, so
    // clamping to innerHeight matters — a drag below the fold lands on nothing.
    const dragOnCanvas = async (pg, fromFrac = 0.25, toFrac = 0.55) => {
      const box = await pg.evaluate(() => {
        const c = document.querySelector('#canvasContainer canvas');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: Math.min(r.height, innerHeight - r.y - 20) };
      });
      if (!box || box.h < 60) throw new Error('canvas not usably visible for a drag');
      const y = box.y + box.h * 0.4;
      await pg.mouse.move(box.x + box.w * fromFrac, y);
      await pg.mouse.down();
      await pg.mouse.move(box.x + box.w * (fromFrac + toFrac) / 2, y + 30, { steps: 6 });
      await pg.mouse.move(box.x + box.w * toFrac, y + 60, { steps: 6 });
      await pg.mouse.up();
      await pg.waitForTimeout(350);
    };


    const scenarios = [
      {
        name: 'draw → undo → redo',
        // Guards the core invariant in CLAUDE.md § Architecture: every mutation goes through a
        // Command pushed to historyManager. undoBtn starts DISABLED, so it turning enabled is direct
        // evidence a command was recorded — a mutation that bypassed history would leave it disabled.
        run: async (pg) => {
          if (await enabled(pg, 'undoBtn')) throw new Error('undoBtn was already enabled before any edit');
          await pg.click('#freehandBtn');
          await dragOnCanvas(pg);
          if (!await enabled(pg, 'undoBtn')) throw new Error('drew a stroke but undo stayed disabled — no Command recorded?');
          await pg.click('#undoBtn');
          await pg.waitForTimeout(300);
          if (!await enabled(pg, 'redoBtn')) throw new Error('undid a stroke but redo stayed disabled');
          await pg.click('#redoBtn');
          await pg.waitForTimeout(300);
        },
      },
      {
        name: 'draw → export PDF',
        // The export bake with an overlay element present (pdfElementRenderer path).
        run: async (pg) => {
          await pg.click('#freehandBtn');
          await dragOnCanvas(pg);
          await pg.click('#downloadBtn');
          await pg.waitForTimeout(2500);
        },
      },
      {
        name: 'redact → export PDF',
        // Highest-consequence path in the product: a bug here means a user's secret stays readable.
        // Exercises the RASTER export branch, which CLAUDE.md flags as code-reviewed but not
        // pixel-guarded. Unextractability itself is asserted in tests/browser/blockers-redaction.
        run: async (pg) => {
          await pg.click('#redactBtn');
          await dragOnCanvas(pg, 0.3, 0.6);
          await pg.click('#downloadBtn');
          await pg.waitForTimeout(3000);
        },
      },
      {
        name: 'crop → export PDF',
        // The crop + export combination is exactly the shape of the redaction-burn-on-a-cropped-page
        // leak (CLAUDE.md § Per-page crop): two coordinate spaces that must agree.
        run: async (pg) => {
          await pg.click('#cropBtn');
          await dragOnCanvas(pg, 0.2, 0.7);
          await pg.click('#downloadBtn');
          await pg.waitForTimeout(3000);
        },
      },
      {
        name: 'rotate page → export PDF',
        run: async (pg) => {
          const rot = pg.locator('.thumb-item .thumb-rotate').first();
          if (!await rot.count()) throw new Error('no thumbnail rotate control found');
          await rot.click({ force: true });
          await pg.waitForTimeout(700);
          await pg.click('#downloadBtn');
          await pg.waitForTimeout(3000);
        },
      },
    ];

    const picked = SCENARIO_ONLY
      ? scenarios.filter(s => s.name.toLowerCase().includes(SCENARIO_ONLY.toLowerCase()))
      : scenarios;
    console.log(`qa-sweep: ${picked.length} workflow scenario(s)`);
    for (const s of picked) {
      const tag = `sc-${s.name.replace(/[^a-z]+/gi, '-').toLowerCase()}`;
      // A scenario CRASHING the browser must not abort the sweep. Measured 2026-07-30: this
      // container's Chromium exits with SIGSEGV (signal 11, SEGV_MAPERR) partway through the
      // scenario phase, which previously took down the whole run before any report was written —
      // turning a partial result into no result at all. Now: detect the dead browser, record the
      // remainder as FAIL with the reason, and let finish() still print.
      if (!browser.isConnected()) {
        record('FAIL', `scenario: ${s.name}`, 'browser had already crashed (SIGSEGV) — not run');
        continue;
      }
      let failure = null;
      try {
        await resetPage();
        await s.run(page);
      } catch (e) {
        failure = String(e.message).split('\n')[0];
        if (!browser.isConnected()) failure = `browser CRASHED during this scenario (SIGSEGV): ${failure}`;
      }
      const shot = `${tag}.png`;
      await page.screenshot({ path: join(OUT, shot) }).catch(() => {});
      const errs = consoleErrors.splice(0).concat(netFailures.splice(0));
      if (failure) record('FAIL', `scenario: ${s.name}`, failure, shot);
      else if (errs.length) record('FAIL', `scenario: ${s.name}`, `console/network: ${errs.slice(0, 3).join(' | ')}`, shot);
      else record('PASS', `scenario: ${s.name}`, 'completed, 0 console/network errors', shot);
    }
  }

  await finish(browser);
}

async function finish(browser) {
  await browser.close().catch(() => {});
  const count = v => results.filter(r => r.verdict === v).length;
  const pad = s => s.padEnd(5);
  const lines = [
    'QA-SWEEP REPORT',
    `Target: ${URL_} | Fixture: ${FIXTURE} | ${new Date().toISOString()}`,
    '─'.repeat(78),
    ...results.map(r => `${pad(r.verdict)} ${r.subject.padEnd(24)} — ${r.detail}${r.shot ? `  [${r.shot}]` : ''}`),
    '─'.repeat(78),
    `Summary: ${results.length} checks | ${count('PASS')} pass | ${count('FAIL')} fail | ` +
      `${count('WARN')} warn | ${count('SKIP')} skipped | ${count('A11Y')} a11y` +
      (count('ACCEPT') ? ` | ${count('ACCEPT')} a11y-accepted-by-decision` : ''),
  ];
  // COVERAGE GAP, NAMED. `SKIP` is coverage you did not get (SKILL.md § interpret it), and the only
  // honest way to present it is as a list of controls, not a count.
  const exercised = new Set(results.filter(r => VERDICTS.includes(r.verdict)).map(r => r.subject));
  if (domButtonIds) {
    const missed = [...new Set(domButtonIds)].filter(id => id && !exercised.has(id));
    const destructive = id => !ALLOW_DESTRUCTIVE
      && DESTRUCTIVE.some(d => id.toLowerCase().includes(d.toLowerCase()));
    const byName = missed.filter(destructive);
    const unreached = missed.filter(id => !destructive(id));
    lines.push('', `Exercised ${exercised.size} distinct control(s) of ${new Set(domButtonIds).size} in the DOM.`);
    if (byName.length) lines.push(`NOT exercised — destructive by name (--allow-destructive): ${byName.join(', ')}`);
    if (unreached.length) {
      lines.push(
        `NOT exercised — never reachable in this run (${unreached.length}): ${unreached.join(', ')}`,
        'NOT evidence of health. Most are a container\'s 2nd..Nth item: the APP shuts a flyout/menu on',
        'any click (modalBinder.ts), so only the first is ever reachable. Four ways of re-opening it per',
        'child were measured and all lost coverage overall — the numbers are in exercise().',
      );
    }
    if (!byName.length && !unreached.length) lines.push('Every button[id] in the DOM was exercised.');
  } else {
    lines.push('', 'Coverage gap: UNKNOWN — the crawl ended before the button universe could be read.');
  }

  lines.push('',
    'Screenshots are in this directory. var/claude/ is gitignored and the container is',
    'reclaimed — deliver anything that matters with SendUserFile in the same turn.');

  const report = lines.join('\n');
  writeFileSync(join(OUT, 'report.md'), `${report}\n`);
  console.log(`\n${report}\n\nreport: ${join(OUT, 'report.md')}`);
  process.exit(count('FAIL') > 0 ? 1 : 0);
}

main().catch(e => { console.error('qa-sweep: harness error:', e); process.exit(2); });
