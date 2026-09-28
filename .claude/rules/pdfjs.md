---
paths:
  - "src/utils/pdfjsParams.ts"
  - "src/utils/pointViewport.ts"
  - "src/utils/textLayer.ts"
  - "scripts/prepare-pdfjs-assets.mjs"
  - "vite.config.ts"
---

# pdfturbo gotchas — pdfjs

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: pdf.js assets (CMaps, JBIG2/JPX decoders, ICC), points viewports, the text layer. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### pdf.js's CMap files are served by the app — row 32 (2026-09-26)

A CID font whose encoding is a predefined Adobe CMap (common in Japanese, Chinese and Korean PDFs) decodes
only when `getDocument` is given `cMapUrl`, and `src/` never passed it: pdf.js's own `vertical.pdf` showed a
BLANK page (only its border rules drew) and extracted `""`, where with CMaps it reads `あいうえお日本語`
[measured 2026-09-26, `var/claude/qa-shots/row32/`]. So such a page was unreadable, unselectable,
unsearchable and absent from every export. Ruled fix: `scripts/prepare-pdfjs-assets.mjs` copies
`pdfjs-dist/cmaps/` (169 files — 168 packed CMaps and their `LICENSE` — ~1.7 MB) into gitignored `public/pdfjs/cmaps/` — hooked on `predev`,
`prebuild` and `pretest:browser`, so CI needs no workflow step — and every `getDocument` in `src/` goes
through `withPdfjsAssets` (`src/utils/pdfjsParams.ts`; named `withCMaps` when it landed, renamed by row 36),
which adds an ABSOLUTE same-origin `cMapUrl` and
`cMapPacked: true`. Absolute because pdf.js fetches CMaps from its worker when it can. The PWA caches them
at runtime (`pdfjs-cmaps`, `maxEntries` above the file count so a `usecmap` chain is never evicted) and never
precaches them; the offline bound is stated in `KNOWN_ISSUES.md`. **Use `withPdfjsAssets` for any new
`getDocument`** — `tests/infra/pdfjsParams.test.ts` bans a call that bypasses it.

Three traps, each found by a sabotage or a screenshot rather than by the first draft:

- **The dev server answers a missing file with `index.html` and a 200.** The first URL case checked status
  and size and stayed GREEN with `public/pdfjs/` deleted. It now checks the body's packed-CMap signature (a
  type byte, then `e0 52 43` — all 168 `.bcmap` files).
- **A whole-page ink count cannot see the missing text.** The page's border rules alone are 498 dark pixels,
  so "ink > 200" passed without CMaps. The case counts only the text area, which reads 0 without them and 78
  with them at scale 1.
- **`cMapPacked: false` did NOT blank the page in the harness** — the glyphs drew and the text extracted as
  garbage (`͍͋͏…`). Scope that: pdf.js then asks for the UNPACKED name, which does not exist, and the dev
  server answered it with `index.html` (trap one), so pdf.js parsed HTML as a CMap. On GitHub Pages that is a
  real 404, and what pdf.js does then is unmeasured. Either way the guarantee to pin is the EXTRACTED STRING.

Guards: `tests/browser/cjk-cmaps.browser.test.ts` (6: the URL serves a real CMap; `vertical.pdf`'s exact text,
its ink in the text area, the Word/Markdown/text export, and the WS8 viewer check accepting it; a LibreOffice
CONTROL with embedded glyphs), `tests/infra/pdfjsParams.test.ts` (4) and three cases in
`tests/infra/pwaOcrCaching.test.ts`. The browser file drives the helper; the static guard certifies that
the 12 open sites use it — no committed test boots `documentLoader.loadFiles`. The main open path WAS driven
once by hand on the built artifact (`vite preview`, Playwright `setInputFiles` on `#fileInput`): the text
layer read `あいうえお日本語`, `Adobe-Japan1-UCS2.bcmap` was fetched from `/pdfjs/cmaps/`, no console error,
precache unchanged at 24 entries with no `.bcmap`.
Sabotage, predicted first: no `cMapUrl` → 1 jsdom + 4 browser (text-area ink 0); `cMapPacked: false` →
1 + 3 (predicted 4 — the ink case stays green, see above); one open site unwrapped → exactly the static
guard; a wrong path segment → 1 + 4; the vendored folder removed → 4 browser (3 before the body check);
the cache's `maxEntries` below the file count → exactly that case.

**Found by this row and fixed by row 36:** the JBIG2 / JPEG 2000 decoders load from `wasmUrl` — next section.

### pdf.js's JBIG2 / JPEG 2000 decoders are served too — row 36 (2026-09-26)

pdf.js decodes JBIG2 and JPEG 2000 images with WebAssembly modules (plus a pure-JS fallback) that it loads
from `wasmUrl`, which `src/` never passed, so both decoders "failed to initialize" and every such image drew
NOTHING. Measured on four of pdf.js's own test files (`tests/fixtures/scan-codecs/`, provenance in its
README): 0 non-white pixels on every page, against 5067 / 5043 / 8192 / 600 with the modules served. JBIG2
is what bilevel document scanners write, so a scanned black-and-white PDF showed a blank page, blank
thumbnails, blank rasters (redaction page, lossy compress, page-as-image) and OCR read nothing. **The vector
PDF export was never affected** — pdf-lib copies the stream bytes and any other viewer decodes them — and
the WS8 viewer check passed throughout, since pdf.js was blank on both sides of its comparison.

Fix: `withPdfjsAssets` adds an absolute same-origin `wasmUrl`, and the asset script copies FOUR named files
(`jbig2.wasm`, `openjpeg.wasm` and their `*_nowasm_fallback.js`) into `public/pdfjs/wasm/`, failing the
build if an upgrade renames one. The folder also holds the ICC module and the QuickJS scripting sandbox,
deliberately NOT copied. [superseded 2026-09-28: row 37 copies the ICC module (`qcms_bg.wasm`) too — `WASM_FILES` in `scripts/prepare-pdfjs-assets.mjs` is the list; the QuickJS sandbox is still not copied] The PWA ignores `**/pdfjs/**` for the precache — the fallbacks are `.js` and would
otherwise match its glob — and caches the four at runtime (`pdfjs-wasm`, placed before the generic `.js`
rule).

**Row 36 shipped `useWorkerFetch` pinned `false`; row 37 turned it on.** pdf.js turns it on by itself only
when `cMapUrl`, `standardFontDataUrl` AND `wasmUrl` are all given (`pdf.mjs:15464`), and on also switches
ON its ICC colour management (`IccColorSpace.setOptions`). Row 36 kept that out of its own change so the
colour shift could be measured and ruled on its own — see the next section. With it false, pdf.js fetched
the decoders on the main thread and handed them to the worker.

Guards: `tests/browser/scan-codecs.browser.test.ts` (13: the modules are served — body checked, the row-32
SPA-fallback trap; each of the four images draws; the JS fallback draws a JBIG2 and a JPX image with
`useWasm: false`; the viewer check accepts all four; page-as-image carries the scan; a Flate CONTROL), two
cases in `tests/infra/pdfjsParams.test.ts` and three in `pwaOcrCaching.test.ts`. Sabotage, predicted first,
each landed and restored byte-identical: no `wasmUrl` → 1 jsdom + 8 browser (the viewer checks and the
control stay green, correctly); `useWorkerFetch: true` → exactly the pin (row 36's figure; row 37 inverted that pin); one open site unwrapped → exactly
the static guard; the precache ignore dropped → exactly that case; `openjpeg_nowasm_fallback.js` dropped
from the list → exactly the served-file case and the JPX fallback case. A harness note from the first try
of that last one: with ALL four files missing (vitest called directly, so the script never ran) every case
in the file failed, the control included, several in 0 ms — the dev server hands the worker's dynamic
`import()` an HTML page; a static host answers 404, as today's production did for `null…` URLs.

**Uncertified by execution:** a JBIG2 image whose `/DecodeParms` carries `/JBIG2Globals` (a second object
the viewer check's page copy must carry — no fixture has one); and the JS fallback in the BUILT app — the
worker is created with `type: "module"` and the built chunk keeps the `import()`, so it should run
[Inferred], but only the dev harness ran it. The WebAssembly path WAS driven once by hand on the built
artifact (`vite preview`, Playwright `setInputFiles` on `#fileInput`): `jbig2_symbol_offset.pdf` drew 17278
non-white pixels on `#pdfCanvas` and `bug_jpx.pdf` 27378, each fetching its module from `/pdfjs/wasm/`,
no console error.

### pdf.js colour management is on — row 37 (2026-09-26)

Without it pdf.js draws DeviceCMYK with a fitted formula and ignores ICC profiles. Measured against
Ghostscript renders at the same size: the Pub 17 cover's rich black came out slate-blue (44,46,53) where
Ghostscript draws (35,31,32) and colour-managed pdf.js (34,31,33); 6×6-block error 10.81 → 4.27. DeviceCMYK
is on nearly every page of the three government reports in the corpus. Developer ruling (18:00): full colour
management, i.e. what pdf.js's own viewer does — its `pdf_viewer.mjs` sets `cMapUrl`, `iccUrl`,
`standardFontDataUrl` and `wasmUrl`, so `useWorkerFetch` turns on there.

`withPdfjsAssets` adds an absolute `iccUrl` and sets `useWorkerFetch: true`; the asset script copies
`qcms_bg.wasm` into `public/pdfjs/wasm/` and `CGATS001Compat-v2-micro.icc` into `public/pdfjs/iccs/`, each vendored decoder / module / profile with its licence
file (`THIRD-PARTY-NOTICES.md` lists them — rows 32 and 36 had not); the `pdfjs-wasm` runtime cache also takes
`/pdfjs/iccs/`. **It is ONE switch with an optional half:** CMYK
management works only when the ICC module does (`CmykICCBasedCS.isUsable` requires `IccColorSpace.isUsable`),
and the ICC module works only with worker fetch. The ICC-tagged half alone measured no closer to Ghostscript
(block error within half a level either way on the three corpus pages it changes) — it rides along, it is not
the reason. **`standardFontDataUrl` stays unset**: it would change how non-embedded fonts are drawn, which is
a separate change; the unit test pins its absence.

Two consequences worth knowing. **Worker fetch moves the CMap fetch into the worker** — measured
pixel-identical on a CJK page, a base-14 page and a plain page, and the viewer check stays clean on the Census
and Pub 17 reports (+30% on Census at load ~13, +4% on Pub 17). **A missing colour module degrades, it does not
break**: with `qcms_bg.wasm` absent the page renders in exactly the old colours and the viewer check passes —
measured on the dev server, whose answer to a missing file is an HTML page; a real 404 reaches the same
`try/catch` in pdf.js [Inferred]. So offline before the module was cached, colours are the old approximation.
The rasters (redaction page, lossy compress, page-as-image), thumbnails and OCR now bake the managed colours;
the vector PDF export is unaffected (colour operators are copied).

Guards: `tests/browser/icc-colour.browser.test.ts` (3: the module and profile are served — body checked; five
patches of `tests/fixtures/icc/cmyk-patches.pdf` within 4 levels of Ghostscript — the ICC-tagged one against
its embedded profile, the DeviceCMYK ones against Ghostscript given pdf.js's own profile, a DeviceRGB CONTROL
exact; the viewer check accepts it), two cases in `tests/infra/pdfjsParams.test.ts` and one in
`pwaOcrCaching.test.ts`. Before the fix three patches were 9–11 levels off; after, 1 (rich black is 4 off both
ways — qcms and lcms differ near black, so that patch does not discriminate). Sabotage, predicted first, each
landed and restored with `cmp`: no `iccUrl` → the served case and the two DeviceCMYK patches, the ICC-tagged
one green (the halves are separable in that direction); `useWorkerFetch: false` → all three patches, served
case green; `qcms_bg.wasm` not copied → served case and all three patches, rendering intact; the profile not
copied → served case and the two DeviceCMYK patches; the cache rule without `/pdfjs/iccs/` → exactly its case.
Driven once by hand on the built artifact (`vite preview`, Playwright `setInputFiles`): the fixture's patches
read the same values as in the harness, the worker fetched `qcms_bg.wasm` and the profile, and `pdfjs-vertical.pdf`
still read `あいうえお日本語` with its CMap now fetched by the worker; no console error.
With the service worker in control, one use of each leaves `qcms_bg.wasm` and the profile in the `pdfjs-wasm`
cache and the worker-fetched CMap in `pdfjs-cmaps` — measured, although pdf.js loads the colour files with a
synchronous request from its worker.

### Every viewport is a POINTS viewport — `/UserUnit` (2026-09-26)

> **[Re-checked 2026-09-28]** the call count below has grown (`03c0914`); the guarantee holds — the only direct `.getViewport(` in `src/` is in `src/utils/pointViewport.ts`, and its test asserts that. Re-count, don't quote.

pdf.js multiplies every viewport by the page's `/UserUnit` (`pdf.mjs:826`), so the editor canvas of a
`/UserUnit 2` page was twice the page's size in points and every coordinate the user drew was doubled,
while pdf-lib — the export — works in plain points. A redaction drawn over a secret was therefore burned
at twice its position and the secret stayed VISIBLE, in the PDF and the Word/Markdown/text export alike
(measured). Ruled fix: **the editor measures in points.** `src/utils/pointViewport.ts` divides the
requested scale by the UserUnit, all 23 viewport requests in `src/` go through it, and
`tests/infra/pointViewport.test.ts` bans a direct `.getViewport(` anywhere else (comment lines stripped;
`xfdfMapping`'s interface signatures carry no dot and stay legal) with a floor of 20 helper calls and
exactly one call inside the helper. **Use `pointViewport` for any new viewport** — the guard will say so.

**The text layer was already wrong on such pages, independently.** `textLayer.ts` set
`--total-scale-factor` to `viewport.scale`, but pdf.js draws at `scale × userUnit` and sizes the layer as
that factor × `rawDims` (points, `pdf.mjs:1533`), so the selectable/searchable layer was 1/u the canvas.
It is now `scale × userUnit`, which is exactly pdf.js's own viewer convention — pdf.js keeps the two apart
on the viewport on purpose.

**A path that BUILDS a page from a render must copy the `/UserUnit` onto it.** The redaction rasterizer
and lossy compress size their new page from a (now points) viewport; without the key, a `/UserUnit 2` page
exports at half its physical size beside copied neighbours that keep it. Both set it from
`pageUserUnit(renderPage)`. Found at the crash-recovery review, not by the first draft: before the fix the
uncropped raster page was already points-without-key while the cropped one and compress were u× — three
different answers for one document.

Consequences of the ruling, stated in `KNOWN_ISSUES.md` rather than hidden: at 100% zoom such a page shows
at its size in points, not its physical size; and elements saved in a session before the fix were
measured at u× and restore scaled by 1/u. No `SCHEMA_VERSION` bump — they exported to the wrong place
anyway, and 0 of 360 corpus pages carry `/UserUnit`. A third, found at the recovery review, is FIXED (ruled 15:35): the
three rasters (redaction page, lossy compress, page-as-image) multiply only their RASTER scale by
`pageUserUnit`, so the chosen DPI is physical again while the page stays points + `/UserUnit`. In the
redaction rasterizer that factor lives in `SCALE` itself, because the crop clip and the link re-add both
divide pixels by `SCALE` — one number, one frame.

The test is honest about frames because it assumes none: the redaction is placed where the secret's INK
is on the canvas the real `PDFRenderer` draws — where a user would drag — so it reds whenever editor and
export disagree, in either direction. Guards: `tests/browser/userunit-frame.browser.test.ts` (16 — canvas
size and ink position, burn on the secret, Word export, the raster (plain and cropped), lossy-compress and
page-as-image outputs keeping size, `/UserUnit` and physical resolution, text layer on the ink at 150%,
each against a `/UserUnit 1` control) and `tests/infra/pointViewport.test.ts` (5). The text-layer case builds its
viewport through the helper, so it certifies `TextLayerManager` and the CSS factor, while the static
guard certifies that `pageRenderPipeline` wires the helper — a division of labour, not a gap. The test
must import `src/styles/pdf-layers.css`: without it pdf.js's spans are not positioned and even the
control is 61px off. Sabotage, predicted first and re-measured on the 16-case file: the helper ignoring UserUnit → the unit
case + 7 browser cases (canvas, burn, Word, raster, cropped raster, compress, page-as-image — every raster
now asserts its physical resolution) — the text-layer case stays GREEN, because canvas and layer are then both at
u× and aligned, which is correct: that case checks alignment, not frame; the editor renderer reverted to
a direct call → the static guard + all 4 UserUnit-2 browser cases (every case takes its cover from that
canvas, so the Word export reds too, which was predicted green); the text-layer factor reverted → exactly
the UserUnit-2 text-layer case; the rasterizer's `/UserUnit` copy removed → its plain and cropped cases
(2), the compress copy removed → exactly its case; raster
`SCALE` without u → the plain and cropped raster cases; the crop clip divided by 2 instead of `SCALE` →
exactly the cropped case; compress or page-as-image without u → exactly its own case.
