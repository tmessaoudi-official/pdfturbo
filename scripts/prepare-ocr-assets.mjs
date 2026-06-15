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
import { existsSync, mkdirSync, copyFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// "best" tier (4.0.0). The 3 UI languages.
const TESSDATA_BASE = 'https://tessdata.projectnaptha.com/4.0.0';
const LANGS = ['eng', 'fra', 'ara'];

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
    if (!FORCE && present(dst)) {
      console.log(`  lang   ${name} (cached)`);
      continue;
    }
    const url = `${TESSDATA_BASE}/${name}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to download ${url}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0) throw new Error(`downloaded ${url} is empty`);
    writeFileSync(dst, buf);
    console.log(`  lang   ${name} (${(buf.length / 1_048_576).toFixed(1)}MB)`);
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

main().catch((err) => {
  console.error(`prepare-ocr-assets failed: ${err.message}`);
  process.exit(1);
});
