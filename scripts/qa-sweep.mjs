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
 *                             [--no-a11y] [--out <dir>]
 *
 * Exit codes: 0 = no failures; 1 = at least one FAIL; 2 = harness could not run (no browser, no
 * server, app never booted). A non-zero exit is the point — this is usable as a gate.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Chromium resolution ──────────────────────────────────────────────────────────
// The container has no Google Chrome, so `channel: 'chrome'` (what vitest.browser.config.ts uses)
// is unavailable here. Worse, the PREINSTALLED chromium-1194 lacks
// Map.prototype.getOrInsertComputed, which pdfjs-dist v6 calls on every page render — every
// render() throws and it looks like a product bug. So: pick the HIGHEST installed build, and
// refuse to run on 1194 rather than emit 7 fake failures. See CLAUDE.md § Commands.
const PW_ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
function resolveChromium() {
  if (process.env.QA_SWEEP_CHROME) return process.env.QA_SWEEP_CHROME;
  if (!existsSync(PW_ROOT)) return null;
  const builds = readdirSync(PW_ROOT)
    .filter(d => /^chromium-\d+$/.test(d))
    .map(d => ({ dir: d, rev: Number(d.split('-')[1]) }))
    .sort((a, b) => b.rev - a.rev);
  for (const b of builds) {
    const exe = join(PW_ROOT, b.dir, 'chrome-linux64', 'chrome');
    if (existsSync(exe)) {
      if (b.rev <= 1194) {
        console.error(
          `qa-sweep: only chromium-${b.rev} is installed, which lacks ` +
          'Map.prototype.getOrInsertComputed — pdfjs-dist v6 throws on every render.\n' +
          '          Run `npx playwright install chromium` first (~115 MB, not persisted).',
        );
        return null;
      }
      return exe;
    }
  }
  return null;
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

const results = [];
const record = (verdict, subject, detail, shot) => results.push({ verdict, subject, detail, shot });

async function main() {
  const exe = resolveChromium();
  if (!exe) { console.error('qa-sweep: no usable Chromium — aborting.'); process.exit(2); }

  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.error('qa-sweep: playwright is not installed.'); process.exit(2); }

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe });
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
  const loadErrors = consoleErrors.splice(0);
  await page.screenshot({ path: join(OUT, '000-loaded.png') });
  record(canvasUp && !loadErrors.length ? 'PASS' : 'FAIL', `load ${FIXTURE}`,
    canvasUp ? (loadErrors.join(' | ') || 'rendered, 0 console errors') : 'no canvas appeared within 30s',
    '000-loaded.png');
  if (!canvasUp) { await finish(browser); return; }

  // ── crawl the UI STATE SPACE (not the URL space) ────────────────────────────────
  // This app is ONE page. The original bundle skill crawled links with --depth/--max-urls, which
  // finds nothing here. The equivalent structure is progressive disclosure: measured 2026-07-29,
  // only 8 of 139 buttons are visible+enabled on a freshly loaded document — the rest live behind
  // the file menu, the export flyout, the text chevron, modals, and a user-customisable toolbar.
  //
  // Enumerated from the LIVE DOM, never a hardcoded list: feature flags remove buttons at runtime
  // (main.ts strips them when a VITE_FEATURE_* is off), so a fixed list would report phantom
  // failures for a legitimately disabled flag.
  const visible = () => page.$$eval('button[id]', els =>
    els.filter(e => e.offsetParent !== null && !e.disabled).map(e => e.id));

  // DEPTH-FIRST, not round-based. A round-based sweep leaves a modal open and every later click in
  // that round times out (measured: 15 spurious "click failed" WARNs) — and it can never reach a
  // menu's children, because by the time the next round enumerates, the menu is shut. So: click,
  // then descend into whatever that click revealed WHILE IT IS STILL OPEN, then unwind with Escape.
  // `--depth` is the bundle skill's flag, re-pointed from URL depth to disclosure depth.
  const visited = new Set();
  let n = 0, capped = false, reachedTop = 0;

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
    if (clickErr) record('WARN', id, `not clickable: ${clickErr}`, after);
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

    // Unwind this subtree so a sibling is reachable.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(120);
  }

  let top = [...new Set(await visible())];
  reachedTop = top.length;
  if (ONLY) top = top.filter(i => i.toLowerCase().includes(ONLY.toLowerCase()));
  console.log(`qa-sweep: ${top.length} top-level button(s), max depth ${MAX_DEPTH}`);
  for (const id of top) {
    if (visited.has(id)) continue;
    if (n >= MAX_CLICKS) { capped = true; break; }
    await exercise(id, 0);
  }

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
        const src = readFileSync(axePath, 'utf8');
        await page.evaluate(src);
        const res = await page.evaluate(async () => await window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        }));
        const v = res.violations || [];
        record(v.length ? 'A11Y' : 'PASS', 'a11y (WCAG 2.1 AA)',
          v.length ? v.map(x => `${x.id}:${x.impact}(${x.nodes.length})`).join(', ') : '0 violations');
      } catch (e) {
        record('WARN', 'a11y', `axe injection failed: ${String(e.message).split('\n')[0]}`);
      }
    }
  }

  // ── mobile pass ────────────────────────────────────────────────────────────────
  // 375px is where this app has actually shipped bugs (the F2b thumbnail controls could not fit
  // five 44px touch targets on a 50x74 tile), so it is a first-class check, not a nicety.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'zzz-mobile-375.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  record(overflow ? 'WARN' : 'PASS', 'mobile 375px',
    overflow ? 'horizontal overflow at 375px' : 'no horizontal overflow', 'zzz-mobile-375.png');

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
      `${count('WARN')} warn | ${count('SKIP')} skipped | ${count('A11Y')} a11y`,
    '',
    'Screenshots are in this directory. var/claude/ is gitignored and the container is',
    'reclaimed — deliver anything that matters with SendUserFile in the same turn.',
  ];
  const report = lines.join('\n');
  writeFileSync(join(OUT, 'report.md'), `${report}\n`);
  console.log(`\n${report}\n\nreport: ${join(OUT, 'report.md')}`);
  process.exit(count('FAIL') > 0 ? 1 : 0);
}

main().catch(e => { console.error('qa-sweep: harness error:', e); process.exit(2); });
