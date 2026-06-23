# Persistence (IndexedDB) + PWA + Session-Restore — QA Review 2026-06-23

Domain: `src/infra/storage.ts`, `src/ui/documentLoader.ts`, `src/core/sessionManager.ts`,
`src/pwaUpdate.ts`, `src/main.ts`, `vite.config.ts`, `public/privacy.html`, `index.html`.

Overall: the schema-migration and PWA-update mechanics are **clean and well-reasoned**. The one
genuine security concern is **plaintext persistence of sensitive PDF content (including the original
pre-redaction source) in IndexedDB on a shared machine**, only partially mitigated by disclosure.

---

## P1 — Original unredacted source bytes persisted to IndexedDB in plaintext (redaction leak on shared machines)

**Category:** security / data-safety
**Files:** `src/core/sessionManager.ts:26-39`, `src/infra/storage.ts:71-87`, `src/elements/redactionElement.ts` (whole file)

**Evidence:**
- Redaction is an **overlay element only** — `RedactionElement.render()` draws a positioned `<div>` with a
  "⚠ Burn on export" label (`redactionElement.ts:29-32`, `element.burnLabel` locale). It is rasterized into
  the output **only at export** (`exportPipeline.ts:286` filters `e.type === 'redaction'` during the bake).
- Meanwhile autosave persists the **raw source PDF bytes** verbatim:
  ```ts
  // sessionManager.ts:26-28
  const sourcePdfs = Array.from(snap.documentModel.sourcePdfs.values()).map(s => ({
    id: s.id, name: s.name, bytes: s.bytes,
  }));
  ```
  stored unencrypted via `saveState` (`storage.ts:77` — plain `objectStore.put(stamped, KEY)`, no
  `crypto.subtle`/AES anywhere; grep for `encrypt|crypto.subtle|AES` in storage/sessionManager = 0 hits).
- Therefore a user who places black redaction boxes over sensitive data, then closes the tab **without
  exporting**, leaves the *fully recoverable original content* in `pdf-editor` IndexedDB. The next user of a
  shared/kiosk machine can open the app (auto-restore prompt) or read the DB directly and recover everything
  the redactions were meant to hide.
- The same plaintext store also holds **signature image data** (`signatureElement.ts:105` — `data: this.data`)
  and **form field values** (`sessionManager.ts:37`, `formValues`), which may contain names, account numbers, etc.

**Why P1 not P0:** intentional client-only design; data never leaves the device; a manual "Reset Session"
exists. But the redaction-leak vector is *undocumented* and counter-intuitive (a user reasonably assumes a
redaction box protects content even before export). The project CLAUDE.md documents redaction-rasterize as an
export concern but does not flag the *persistence* leak.

**Recommendation:** (a) at minimum, document this explicitly and surface it in the privacy notice; (b) consider
NOT persisting `sourcePdfs.bytes` when any `RedactionElement` is present on the document (persist a flag instead
and require re-open), or burn redactions into the persisted bytes; (c) offer a "clear session on tab close"
opt-in for shared-machine use. The cheapest correct fix is the documentation + privacy disclosure of the
recovery risk (see P2 below) plus a warning toast when a session with redactions is autosaved.

---

## P2 — Privacy notice omits the shared-machine recovery risk

**Category:** ux / data-safety / security
**Files:** `public/privacy.html:55,76,97`, `index.html:236` (`storageBanner.text`)

**Evidence:**
- `privacy.html:55`: "IndexedDB — Your working session (PDF content + annotations) is saved automatically so
  you can resume after closing the tab. You can clear this at any time via the 'Reset Session' button."
- The storage banner (`storageBanner.text`) says only "saves your working session in your browser's local
  storage. No data is sent to any server."
- Neither states that the stored content is **unencrypted**, **persists indefinitely until manually cleared**,
  and is **recoverable by anyone with access to the same OS user profile / browser** — the actual privacy
  exposure on shared/public machines. The "no data sent to a server" framing can give a false sense of safety.

**Recommendation:** add one sentence to privacy.html (all 3 languages) and ideally the banner:
"Saved sessions are stored unencrypted in this browser and remain until you reset them — do not use this on a
shared or public computer for confidential documents, or use Reset Session / private browsing." Trivial,
high-value honesty fix.

---

## P3 — Restore dialog has no focus trap (modal escape via Tab)

**Category:** a11y
**Files:** `src/ui/documentLoader.ts:77-92`, `index.html:253-259`

**Evidence:**
- `restoreDialog` is `role="dialog" aria-modal="true"` (`index.html:253`) but `_askRestoreSession()` only does
  `this._ctx.ui.restoreYesBtn.focus()` (`documentLoader.ts:90`) — there is no focus trap and no Esc handler.
  Keyboard focus can Tab out of the modal into the (inert-but-not-`inert`) background app while the
  `aria-modal="true"` promise says it cannot. Other modals in the app route Esc through `keyboardBinder` and
  use `trapFocus`; this one is on the bespoke yes/no path and was not given the same treatment.

**Recommendation:** wrap the two buttons in the existing `trapFocus` helper and add an Esc → "Start fresh"
branch, matching the rest of the modal inventory. Low impact (only two focusable controls, both inside the box),
hence P3.

---

## Verified-clean areas (no findings)

- **SCHEMA_VERSION migration safety** — `storage.ts:43-49` `migrateOrDiscard`: missing version → treated as v1
  (accept), `=== SCHEMA_VERSION` → accept, `<` → discard (no migration yet), `>` → discard (newer build). New
  optional fields restore via `??`/type-guards without discarding legacy blobs: `documentLoader.ts:114-115`
  (`watermark ?? default`, `bates ?? default`), `elementFactory.ts:36-45` (rich-text fields gated by
  `typeof === 'number'` / literal checks, NOT `|| fallback` — so a typed `0`/`false` survives). `DB_VERSION`
  vs `schemaVersion` separation (store-structure vs value-shape) is correctly distinguished. **Sound.**
- **PWA update flow** — `vite.config.ts:22` `registerType: 'prompt'`; `pwaUpdate.ts` never calls `updateSW`
  eagerly — only inside the user's Reload-button click (`main.ts:93`). No silent swap. Banner re-binds fresh
  listeners (`main.ts:90-99`) to avoid stale-offer double-apply. **Correct, matches documented intent.**
- **OCR globIgnores** — `vite.config.ts:30` `globIgnores: ['**/tesseract/**']` intact; the `ocr-assets`
  CacheFirst runtime route precedes the generic `.js` rule (`vite.config.ts:37` before `:46`) so the worker/
  cores land in the right cache. **Intact.**
- **SW scope = /pdfturbo/** — `base: '/pdfturbo/'` (`vite.config.ts:12`); manifest `start_url: './'` resolves
  under base. No scope override. **Correct.**
- **Restore failure handling** — `documentLoader.ts:159-169` resets to clean state on partial restore failure
  (BUG-19), guards empty pages (BUG-38, :143-146), copies bytes before pdf.js transfers the ArrayBuffer
  (`:105`, `:304`). **Robust.**
- **Untrusted-input caps** — `MAX_PDF_BYTES` (500MB) and `MAX_PDF_PAGES` (10k) enforced before allocation
  (`documentLoader.ts:295`, `:336`); worker released on over-page rejection (`:337`). **Good.**
- **CSP** — `index.html:5`: `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`,
  no `unsafe-eval` (only `wasm-unsafe-eval` for the OCR/pdf.js wasm). **Strong.**
- **Locale parity** — flattened key sets en=569 / fr=569 / ar=569, zero diff. **Clean.**
- **QuotaExceededError** — surfaced to the user (`storage.ts:82-83` re-throw → `sessionManager.ts:41-42` →
  `toast.storageFull`); IDB-unavailable (private browsing) silently skips. **Correct.**
- **Reset / close** — `closeDocument()` calls `clearState()` (`documentLoader.ts:197`); "Start fresh" on the
  restore prompt also clears (`:99`). **No stale-data leak through those paths.**
