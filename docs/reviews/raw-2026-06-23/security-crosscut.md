# Security cross-cut review — PDFturbo — 2026-06-23

Reviewer: skeptical senior code review. Read the actual source files. PDFturbo is a
100% client-side, no-backend PDF editor (TS/Vite/PWA). The threat model is dominated by
**malicious PDF / image input** and **XSS via untrusted data reaching the DOM**, since
there is no server to attack and no auth.

## Summary

The security posture is **strong and mostly clean**. CSP is tight, there is no `eval`/`new
Function` surface in app code, pdf.js scripting is never enabled (embedded PDF JavaScript is
not executed on load), every `innerHTML` write is an empty-string clear (not a data sink), all
download anchors use `blob:` URLs, OCR traineddata is SHA-256-pinned, and the only runtime remote
fetch is a same-origin vendored font. The two would-be XSS vectors (PDF Link-annotation URL and
pasted-from-Word `<a href>`) are each mitigated — the first by pdf.js's own scheme allowlist, the
second by ProseMirror's editable-mode click interception — but both rely on **upstream behavior
rather than an in-app check**, which I flag as low-severity defense-in-depth gaps. No P0/P1.

---

## Findings

### F1 — [P3] PDF Link-annotation URL assigned to `a.href` without an in-app scheme check (relies on pdf.js)
- **File**: `src/utils/textLayer.ts:123`
- **Category**: security (XSS / defense-in-depth)
- **Evidence**:
  ```ts
  for (const ann of annotations) {
    if (ann.subtype !== 'Link' || !ann.url) continue;
    ...
    const a = document.createElement('a');
    a.href = ann.url;            // ← raw URL from a malicious PDF
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  ```
  A `javascript:`/`data:` link annotation would be a classic stored-XSS vector here. **However**, I
  traced pdf.js's worker (`pdf.worker.mjs`): `parseDestDictionary` only sets `resultObj.url` when
  `createValidAbsoluteUrl(url, …)` returns truthy, which requires `_isValidProtocol` to pass — and
  that switch allows **only** `http:`/`https:`/`ftp:`/`mailto:`/`tel:`. A `javascript:`/`data:` URL
  fails the check and is stored in `resultObj.unsafeUrl` instead (`pdf.worker.mjs:41558-41566`,
  `_isValidProtocol` at `:350`). The app reads `ann.url`, never `ann.unsafeUrl`, so the dangerous
  scheme never reaches `a.href`. **Verdict: NOT exploitable today**, but the safety is entirely
  outsourced to pdf.js — a future pdf.js change or a code change that switches to `unsafeUrl` would
  silently reintroduce XSS.
- **Recommendation**: Add a one-line in-app guard before assigning — e.g. only set `a.href` when
  `/^https?:|^mailto:|^tel:/i.test(ann.url)`, else skip. Cheap belt-and-suspenders that makes the
  invariant local and self-documenting rather than implicit in a vendored worker.

### F2 — [P3] `cleanWordHtml` keeps `<a href>` from pasted Word HTML without sanitizing the scheme
- **File**: `src/docx/wordPaste.ts` (whole `cleanWordHtml`; the schema link mark at `prosemirror-schema-basic` `link.parseDOM` reads `href` verbatim)
- **Category**: security (XSS / defense-in-depth)
- **Evidence**: `cleanWordHtml` strips mso-cruft, drops `<script>/<style>/<meta>`, unwraps namespaced
  tags, and cleans `style`/`class`/`lang`. It deliberately **keeps `<a>`** (per its own doc comment:
  "leaves only the markup the schema can parse … a/h1-6/ul/ol/li"). It never inspects `href`. The
  ProseMirror link mark then ingests it verbatim:
  ```js
  // prosemirror-schema-basic link mark
  parseDOM: [{ tag: "a[href]", getAttrs(dom){ return { href: dom.getAttribute("href"), ... }; } }],
  toDOM(node){ let {href,title}=node.attrs; return ["a",{href,title},0]; }
  ```
  So a pasted `<a href="javascript:alert(1)">x</a>` becomes a live `<a href="javascript:…">` node in
  the editor DOM. **Mitigation**: this `<a>` lives inside a ProseMirror `contenteditable` EditorView,
  which intercepts link clicks in editable mode (no navigation), so the `javascript:` URL does not
  fire on click. Also, per CLAUDE.md, `DocRun` carries no `linkUrl`, so the href is **not persisted**
  to the saved `.docx` (it dies on save). **Verdict: not currently exploitable**, but it is an
  untrusted-data sink guarded only by editor behavior.
- **Recommendation**: In `cleanWordHtml` pass 2, drop or neutralize `href` attributes whose scheme is
  not `http:`/`https:`/`mailto:` (mirror `_imgIsUsable`, which already does exactly this for `img@src`:
  `/^(https?:|data:)/i.test(src)`). Apply the same allowlist to `<a>`.

### F3 — [P3] CSP allows `style-src 'unsafe-inline'`
- **File**: `index.html:5`
- **Category**: security (CSP completeness)
- **Evidence**:
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data: blob:;
  connect-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none';
  ```
  `script-src` correctly omits `'unsafe-eval'` (only `'wasm-unsafe-eval'`, needed for tesseract/pdf-lib
  WASM), `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` are all present — this is a
  genuinely good CSP. The one softness is `style-src 'unsafe-inline'`, which the app needs because it
  sets element styles inline throughout (`Object.assign(el.style, …)`, `style="..."` attributes). With
  `'unsafe-inline'` styles, a CSS-injection-capable XSS could exfiltrate via CSS, but since there is no
  confirmed HTML-injection sink (i18n is escaped, see F4; all the real `innerHTML` writes are `= ''`),
  the practical risk is low.
- **Recommendation**: Accept as a documented tradeoff, OR migrate inline styles to a stylesheet /
  CSS custom properties and drop `'unsafe-inline'` from `style-src`. Not urgent; document the rationale
  next to the CSP meta so a future reviewer doesn't assume it's an oversight.

---

## Verified-clean areas (no findings)

- **innerHTML / insertAdjacentHTML sinks**: full `grep -rn "innerHTML|insertAdjacentHTML|outerHTML|
  document.write"` across `src/` returns 7 hits. Six are `= ''` clears (`pageThumbnailPanel.ts:187`,
  `documentLoader.ts:214,357`, `exportPreviewPanel.ts:29,70`, `main.ts:30`) — not data sinks. The
  seventh (`wordPaste.ts:94`) is `body.innerHTML` **read** (serialization out), not an assignment;
  covered by F2. No untrusted/translation/PDF data is ever assigned to innerHTML.
- **i18n XSS**: `i18n.ts` applies translations via `el.textContent = t(...)` (`:23`), not innerHTML, and
  CLAUDE.md documents `escapeValue: true`. No HTML-injection surface from locale data.
- **Embedded PDF JavaScript / OpenAction NOT executed on load**: `documentLoader.ts:312-318` loads with
  `getDocument({ data })` and no `enableScripting`. pdf.js defaults `enableScripting:false`; the app
  never opts in and never loads `pdf.sandbox`. Embedded `/JavaScript`, `/OpenAction`, `/AA` are inert
  at view time. (The `pdfSanitizer.ts` export feature additionally *strips* them for downstream safety,
  but that is opt-in export hygiene, not load-time protection — correctly scoped.)
- **No eval surface**: `grep` for `eval(`, `new Function`, string `setTimeout`/`setInterval`,
  `Function(` across `src/` → zero hits. CSP omits `'unsafe-eval'`. pdf.js v6 removed its eval-based
  font/PS compiler (documented at `documentLoader.ts:312`).
- **Supply chain**: only two runtime/build remote fetches exist. (1) OCR traineddata
  (`scripts/prepare-ocr-assets.mjs:132`) is **SHA-256-pinned** per language (`TESSDATA_SHA256` frozen
  map `:53`, `verifyTraineddata` rejects a mismatch before persisting, re-verifies cached copies each
  run). (2) Arabic font (`arabicOverlay.ts:66`) is a **same-origin** vendored `?url` asset
  (`NotoNaskhArabic-Regular.ttf`) with a 15 s abort timeout and `r.ok` check — not a third-party CDN.
  `npm audit --audit-level=high` is deploy-blocking (CLAUDE.md). No unpinned CDN.
- **Download anchors**: every `a.href = url` outside textLayer uses an `URL.createObjectURL(blob)`
  result (`docxEditorController.ts:43`, `signingHandler.ts:225`, `exportService.ts:956`) — attacker
  cannot control these, and they're `download`-attributed.
- **FS-Access / clipboard**: `fileSystemAccess.ts` feature-detects `showSaveFilePicker`, handles
  AbortError as a silent no-op, falls back to anchor download. Clipboard writes
  (`exportService.ts:879-881`, `navigationBinder.ts:51`) are best-effort with `.catch(()=>{})` and
  feature-detection — reject in insecure contexts gracefully. No permission over-reach.
- **`cssColorToHex`** (`docxSchema.ts:77`) strictly validates `#rgb`/`#rrggbb`/`rgb()` and returns
  `null` otherwise — the color mark `toDOM` cannot be used for CSS injection.
- **Untrusted-input caps**: `documentLoader.ts:336` rejects PDFs claiming > MAX_PDF_PAGES and releases
  the worker; password-protected PDFs are handled with a retry loop, not a crash.

## IndexedDB note (informational, not a finding)

`SavedState` (`infra/storage.ts:6-25`) persists the **full source PDF bytes unencrypted**
(`sourcePdfs[].bytes`) to IndexedDB for session restore. This is inherent to a no-backend
session-persistence feature and there is a user-facing "Reset Session" / `clearState()`. Crucially,
signing **passwords and `.p12` material are NOT in `SavedState`** (CLAUDE.md documents they're zeroed
after use) — so the most sensitive secrets are not persisted. The unencrypted-PDF-at-rest property is
a documented design tradeoff for a local tool, not a defect; worth a one-line privacy note in user docs
but not a code change.
