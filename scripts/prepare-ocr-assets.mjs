/**
 * prepare-ocr-assets — vendor tesseract.js assets into public/ so OCR runs
 * entirely from 'self' (the app CSP `connect-src 'self' blob:` blocks the
 * tesseract CDN, which would otherwise break OCR in production).
 *
 * Copies the worker + LSTM core wasm variants out of node_modules and downloads
 * the "best" traineddata for the product's languages. Output lives in
 * public/tesseract/ (gitignored) and is served from the app origin at build/dev.
 *
 * Idempotent: existing, non-empty files are kept; pass --force to refetch.
 * Run automatically via the predev/prebuild npm hooks, and explicitly in CI
 * (`npm run ocr:assets`) before the browser tests that exercise OCR.
 */
import { existsSync, mkdirSync, copyFileSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FORCE = process.argv.includes('--force');

const OUT = join(ROOT, 'public', 'tesseract');
const OUT_CORE = join(OUT, 'core');
const OUT_LANG = join(OUT, 'lang');

// oem=1 (LSTM) → tesseract picks a *-lstm core by SIMD capability
// (relaxedsimd → simd → plain). Vendor all three pairs for full browser
// coverage; the .wasm.js emscripten glue loads its sibling .wasm by relative
// path, so the two must stay co-located.
const CORE_FILES = [
  'tesseract-core-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];

// "best" tier (4.0.0). MUST stay in sync with OCR_LANGUAGES in
// src/ocr/languages.ts — the OCR O1 blocker test fails if any advertised
// language is not vendored here (advertised ⊆ vendored invariant).
const TESSDATA_BASE = 'https://tessdata.projectnaptha.com/4.0.0';
export const LANGS = ['eng', 'fra', 'ara', 'deu', 'spa', 'ita', 'por', 'nld'];

// SHA-256 pins for every vendored traineddata file (4.0.0 "best" tier). The
// download is the ONLY unguarded remote-asset ingress (the worker + wasm core
// come from node_modules); pinning turns a tampered/MITM'd CDN response into a
// hard build failure instead of shipping a poisoned OCR model. To rotate the
// tessdata version: bump TESSDATA_BASE, re-run `npm run ocr:assets -- --force`
// once against a trusted network, and replace these digests with the printed
// values. Keys MUST cover every entry in LANGS (asserted by ocrAssets.test.ts).
export const TESSDATA_SHA256 = Object.freeze({
  eng: 'ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468',
  fra: '1c0916fac2dbd6f121ca8a57a92f08e4a119227602c7c984da986222eab6cd3b',
  ara: '400ab30fe4f4c4a03feeabe0779a7122cee6aa4fffb1629bb5b1671942859c9e',
  deu: 'f5618a8b8d07f6c7a633ce243bf075bb90f4145bb15c9264734c7cc63aa33205',
  spa: '6cd52c545bceeacb2e43fad64fc0703a711c482ba20d1ca4b6915c09de9973e6',
  ita: '21c1bfde62571d76b923e270bb2cde583ccc18fa8bfd83454c021b28d8b5cb5a',
  por: '3f5feea9dfc39106c92348089097a39bec66e9d6d09ca49befebb0bb60947374',
  nld: '86a28c7acdeedd80cfae16ed4be5b0c54795c21748302bdb35065b607396a008',
});

/** Lowercase hex SHA-256 of a buffer. */
export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Verify `buf` against the pinned digest for `lang`.
 * @throws {Error} if the language is unpinned or the digest does not match.
 */
export function verifyTraineddata(lang, buf) {
  const expected = TESSDATA_SHA256[lang];
  if (!expected) throw new Error(`no pinned SHA-256 for language '${lang}' — refusing unverified asset`);
  const actual = sha256Hex(buf);
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${lang}.traineddata.gz: expected ${expected}, got ${actual}`);
  }
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function present(path) {
  try {
    return existsSync(path) && statSync(path).size > 0;
  } catch {
    return false;
  }
}

function copyCore() {
  const srcDir = join(ROOT, 'node_modules', 'tesseract.js-core');
  for (const f of CORE_FILES) {
    const src = join(srcDir, f);
    const dst = join(OUT_CORE, f);
    if (!existsSync(src)) throw new Error(`missing core asset: ${src} (is tesseract.js-core installed?)`);
    if (!FORCE && present(dst)) continue;
    copyFileSync(src, dst);
    console.log(`  core   ${f}`);
  }
}

function copyWorker() {
  const src = join(ROOT, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');
  const dst = join(OUT, 'worker.min.js');
  if (!existsSync(src)) throw new Error(`missing worker: ${src} (is tesseract.js installed?)`);
  if (FORCE || !present(dst)) {
    copyFileSync(src, dst);
    console.log('  worker worker.min.js');
  }
}

async function downloadLangs() {
  for (const lang of LANGS) {
    const name = `${lang}.traineddata.gz`;
    const dst = join(OUT_LANG, name);
    // Re-verify the cached copy each run: a digest mismatch (tamper / partial
    // write / stale version) drops through to a fresh, verified download.
    if (!FORCE && present(dst)) {
      try {
        verifyTraineddata(lang, readFileSync(dst));
        console.log(`  lang   ${name} (cached, verified)`);
        continue;
      } catch (err) {
        console.warn(`  lang   ${name} cached copy failed verification (${err.message}); refetching`);
      }
    }
    const url = `${TESSDATA_BASE}/${name}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to download ${url}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0) throw new Error(`downloaded ${url} is empty`);
    verifyTraineddata(lang, buf); // reject a poisoned/MITM'd response before persisting
    writeFileSync(dst, buf);
    console.log(`  lang   ${name} (${(buf.length / 1_048_576).toFixed(1)}MB, verified)`);
  }
}

async function main() {
  ensureDir(OUT);
  ensureDir(OUT_CORE);
  ensureDir(OUT_LANG);
  console.log(`Preparing OCR assets → ${OUT}${FORCE ? ' (--force)' : ''}`);
  copyWorker();
  copyCore();
  await downloadLangs();
  console.log('OCR assets ready.');
}

// Run only when executed directly (`node prepare-ocr-assets.mjs`), not when
// imported by a test — importing must not trigger network downloads.
const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain) {
  main().catch((err) => {
    console.error(`prepare-ocr-assets failed: ${err.message}`);
    process.exit(1);
  });
}
