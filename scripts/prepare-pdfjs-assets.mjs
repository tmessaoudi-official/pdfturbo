/**
 * prepare-pdfjs-assets — vendor pdf.js's packed CMap files into public/ so CJK text encoded with a
 * predefined Adobe CMap decodes, served from the app's own origin (the CSP is `connect-src 'self'`).
 *
 * Copies node_modules/pdfjs-dist/cmaps/* into public/pdfjs/cmaps/ (gitignored). `src/utils/pdfjsParams.ts`
 * points every getDocument call there. Always recopies every file (~1.7 MB, milliseconds), so a pdfjs-dist
 * upgrade that changes a CMap at the same size can never leave a stale copy. Fails loudly if the source
 * directory is missing or the copy count differs from the source count. Run via the predev / prebuild /
 * pretest:browser npm hooks.
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SRC = join(ROOT, 'node_modules', 'pdfjs-dist', 'cmaps');
const OUT = join(ROOT, 'public', 'pdfjs', 'cmaps');

if (!existsSync(SRC)) {
  console.error(`prepare-pdfjs-assets: ${SRC} not found — run npm install first`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter(f => statSync(join(SRC, f)).isFile());
for (const f of files) copyFileSync(join(SRC, f), join(OUT, f));
const present = files.filter(f => existsSync(join(OUT, f))).length;
if (present !== files.length) {
  console.error(`prepare-pdfjs-assets: ${present} of ${files.length} CMap files present in ${OUT}`);
  process.exit(1);
}
console.log(`prepare-pdfjs-assets: ${files.length} CMap files copied to public/pdfjs/cmaps/`);
