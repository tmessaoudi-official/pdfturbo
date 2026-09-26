/**
 * prepare-pdfjs-assets — vendor pdf.js's data files into public/ so they are served from the app's own
 * origin (the CSP is `connect-src 'self'`). `src/utils/pdfjsParams.ts` points every getDocument call there.
 *
 * - node_modules/pdfjs-dist/cmaps/*  → public/pdfjs/cmaps/  (every file): the packed CMaps that CJK text
 *   encoded with a predefined Adobe CMap needs (row 32).
 * - node_modules/pdfjs-dist/wasm/<WASM_FILES> → public/pdfjs/wasm/: the JBIG2 and JPEG 2000 decoders and
 *   their pure-JS fallbacks (row 36). An explicit list, not the directory: it also holds the ICC module
 *   (unused while `useWorkerFetch` is false) and the QuickJS scripting sandbox (never enabled here), and a
 *   pdfjs-dist upgrade that renames one of these four must fail the build, not drop a decoder silently.
 *
 * Always recopies every file (~2.7 MB, milliseconds), so an upgrade that changes a file at the same size
 * can never leave a stale copy. public/pdfjs/ is gitignored. Fails loudly on a missing source or a short
 * copy. Run via the predev / prebuild / pretest:browser npm hooks.
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PDFJS = join(ROOT, 'node_modules', 'pdfjs-dist');
const PUBLIC = join(ROOT, 'public', 'pdfjs');

const WASM_FILES = [
  'jbig2.wasm',
  'jbig2_nowasm_fallback.js',
  'openjpeg.wasm',
  'openjpeg_nowasm_fallback.js',
];

function fail(msg) {
  console.error(`prepare-pdfjs-assets: ${msg}`);
  process.exit(1);
}

function copyAll(dir, files) {
  const src = join(PDFJS, dir), out = join(PUBLIC, dir);
  if (!existsSync(src)) fail(`${src} not found — run npm install first`);
  mkdirSync(out, { recursive: true });
  const missing = files.filter(f => !existsSync(join(src, f)));
  if (missing.length) fail(`missing in ${src}: ${missing.join(', ')} (did a pdfjs-dist upgrade rename them?)`);
  for (const f of files) copyFileSync(join(src, f), join(out, f));
  const present = files.filter(f => existsSync(join(out, f))).length;
  if (present !== files.length) fail(`${present} of ${files.length} files present in ${out}`);
  return files.length;
}

const cmapSrc = join(PDFJS, 'cmaps');
const cmaps = existsSync(cmapSrc) ? readdirSync(cmapSrc).filter(f => statSync(join(cmapSrc, f)).isFile()) : [];
const nCmaps = copyAll('cmaps', cmaps);
if (nCmaps === 0) fail(`no CMap files in ${cmapSrc}`);
const nWasm = copyAll('wasm', WASM_FILES);
console.log(`prepare-pdfjs-assets: ${nCmaps} CMap files → public/pdfjs/cmaps/, ${nWasm} decoder files → public/pdfjs/wasm/`);
