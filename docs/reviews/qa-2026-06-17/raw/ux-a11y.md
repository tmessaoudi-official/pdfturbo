# UX + Accessibility Audit — Interactive Surface Map (2026-06-17)

Read-only. Scope: `index.html`, `src/main.ts`, `src/ui/**`, `src/ui/binders/keyboardBinder.ts`,
`src/config/features.ts`, `vite.config.ts`. No source edited.

---

## A. Full interactive-surface inventory

### A1. Toolbar row 1 — file / history / edit / tools / shapes / actions
| Control | id | Label source |
|---|---|---|
| Language globe | `langGlobeBtn` + flyout `lang-btn[data-lang]` | `toolbar.langTitle` / 🌐 EN |
| File menu | `fileMenuBtn` → `fileMenuOpen`/`fileMenuClose`/`fileMenuClearAnnotations`/`fileMenuResetSession`/`fileMenuBlankPage`/`fileMenuLockPdf` | `toolbar.*` text keys |
| Undo / Redo / Copy / Paste | `undoBtn` `redoBtn` `copyBtn` `pasteBtn` | `toolbar.*Title` |
| Select / Eraser | `selectBtn` `eraserBtn` | `toolbar.selectTitle` / `eraserTitle` |
| Text split-button | `textModeBtn` + `textChevronBtn` → flyout `addTextBtn` `editTextBtn` | `toolbar.addText*` / `editText*` |
| Redact / Crop | `redactBtn` `cropBtn` (+`cropApplyAll` `cropRemoveBtn`) | `toolbar.redactTitle` / `cropTitle` |
| Highlight / Comment | `highlightBtn` `commentBtn` | `toolbar.highlightTitle` / `commentTitle` |
| Freehand / Fill bucket | `freehandBtn` `fillBucketBtn` | `toolbar.freehandTitle` / `fillBucketTitle` |
| Image / Code / OCR / e-Sign / Find | `addImageBtn` `addCodeBtn` `ocrBtn` `signBtn` `findBtn` | `toolbar.*Title` |
| Shapes flyout | `drawBtn` → `arrowBtn` `rectBtn` `circleBtn` `shapeWidth` `redactColor` `redactEyedropperBtn` | `toolbar.*Title` |
| Drawn-signature | `addSignatureBtn` | `toolbar.signTitle` (✍ Sign) |
| Export split-button | `downloadBtn` + `exportChevronBtn` → `previewExportBtn` `watermarkBtn` `exportDocxBtn` `exportMdBtn` `sanitizeBtn` `extractPagesBtn` `exportTableBtn` `flattenBtn` `exportXfdfBtn` `importXfdfBtn` `batesBtn` `compressBtn` | `toolbar.*Title` |
| Help / Settings | `helpBtn` `settingsBtn` | `toolbar.helpTitle` / `settingsTitle` |
| Mode badge | `modeBadge` | static text (SELECT) |

### A2. Toolbar row 2 — formatting / zoom / nav
`fontFamily` `boldBtn` `italicBtn` `fontSizeDownBtn` `fontSize` `fontSizeUpBtn` `color`
`colorEyedropperBtn` `fillNoneBtn` `fillColor` | `zoomOutBtn` `zoomDisplay` `zoomInBtn` `fitBtn` |
`firstPage` `prevPage` `pageInput` `pageTotal` `nextPage` `lastPage`. All carry `*Title` / `aria*` keys.

### A3. Find bar (`findBar`)
`findInput` `findCount` `findCaseSensitive` `findRegex` `findPrev` `findNext` `findHighlight` `findClose`.

### A4. Modals / dialogs (15)
restoreDialog, confirmDialog, helpModal, settingsPanel, watermarkModal, batesModal, compressModal,
codeModal, signModal, ocrModal, signatureModal, blankPageModal, extractPagesModal, pdfPasswordModal,
lockPdfModal. Plus banners: storageBanner, swUpdateBanner, exportPreviewOverlay, toast, progress-overlay.

### A5. Keyboard shortcuts (keyboardBinder)
T S I A R C B D/F E H N X K Q W ? Esc Del/Backspace arrows; Ctrl+Z/Y/Shift+Z/F/C/V/←/→.

---

## B. Findings table

| Area | Issue | Severity | Evidence (file:line) |
|---|---|---|---|
| Focus trap | **signModal is NOT focus-trapped.** `openSignModal` only does `classList.add('active')`; no `trapFocus` call. The largest form in the app (cert upload/generate, 10+ fields) lets keyboard/SR users Tab into the background toolbar. | P1 | pdfTurboApp.ts:642-654 (cf. trapped peers codeModalManager.ts:64, batesPanel.ts:56) |
| Focus trap | **ocrModal is NOT focus-trapped.** `openOcrModal` only adds `active`. | P1 | pdfTurboApp.ts:603-609 |
| Focus trap | blankPage / extractPages / pdfPassword / lockPdf modals are `display:flex` only — no `trapFocus`. Focus is set to first input for some (extractPages input.focus, password Enter) but Tab can escape to the page behind the `aria-modal="true"` backdrop. | P2 | modalBinder.ts:151-230, extractPagesBinder.ts:28-36 |
| Keyboard / ESC | **6 modals can't be closed with Esc.** keyboardBinder's Escape branch covers settings/help/signature/watermark/bates/compress/code/findBar but NOT signModal, ocrModal, blankPageModal, extractPagesModal, pdfPasswordModal, lockPdfModal. CLAUDE.md states "every modal needs its own branch in keyboardBinder". A user mid-OCR/sign must mouse to Cancel. | P2 | keyboardBinder.ts:6-18 |
| Keyboard | **Crop tool advertises shortcut "Crop page (P)" but no P handler exists.** Title promises a key that does nothing; help table also omits crop/P entirely. | P2 | index.html:74 (title) vs keyboardBinder.ts:33-103 (no `case 'p'`) |
| Docs/help | Help modal table is missing rows for: Crop (P, nonexistent — see above), Sign-cert / e-Sign, OCR, and the export sub-tools — discoverable only via the export-chevron flyout. Help understates the feature set. | P3 | index.html:265-293 |
| A11y — live region | **Tool-mode changes are not announced.** `modeBadge` updates visually but has no `aria-live`; SR users get no feedback when a hotkey switches modes (e.g. pressing H = highlight). | P2 | index.html:139 |
| A11y — live region | `progress-overlay` has an empty `aria-label=""` and `role="status"`; long operations (export/OCR/compress) announce nothing useful. The visible `progress-label` text is set dynamically but the empty aria-label may suppress it on some SRs. | P3 | index.html:648-652 |
| A11y — generated control | Toolbar-customizer submenu trigger created at runtime has NO accessible name — empty `<button class="btn toolbar-submenu-trigger">` with only `aria-haspopup`/`aria-expanded`, no text/aria-label. If a user merges groups, the resulting submenu button is an unlabeled control. | P2 | toolbarCustomizer.ts:259-262 |
| Discoverability | **Export flyout hides 12 actions** (preview, watermark, DOCX, MD, sanitize, extract, table-CSV, flatten, XFDF↓/↑, bates, compress) behind one `exportChevronBtn ▾`. Many are top-level features in CLAUDE.md (sanitize #53, table→CSV #56, flatten #62, XFDF #57, bates #61, compress #60). High feature density, low discoverability. | P3 | index.html:115-133 |
| Discoverability | Two distinct signing entry points with near-identical glyphs/labels: `addSignatureBtn` (✍ "Sign", draw a signature) and `signBtn` (🔏 "e-Sign", PKCS#12 cert). The drawn-Sign uses key `S`; the cert-Sign has no key. Easy to confuse (documented in MEMORY as a known trap). | P3 | index.html:89, 114 |
| Visual ambiguity | The 🖊 pen emoji labels FOUR different controls: highlight (`highlightBtn`), both eyedroppers (`colorEyedropperBtn`/`redactEyedropperBtn`), and find-keep (`findHighlight`). Freehand uses ✏. Distinct `title`s save a11y but visual scanning is ambiguous. | P3 | index.html:79, 102, 156, 188 |
| Non-intuitive flow | `editText` mode (X) edits EXISTING source text only; a blank-canvas click re-shows the hint and drops nothing — elements are `pointer-events:none` in this mode. Historically a stuck-mode trap (ISSUE-5); now mitigated but still a mode a new user can sit in wondering why clicks do nothing. Mitigation present, residual confusion. | P3 | CLAUDE.md ISSUE-5 note; keyboardBinder.ts:74-76 |
| RTL | `canvasContainer` is hardcoded `dir="ltr"` (intentional for canvas geometry) while `<html dir>` flips to rtl for Arabic. Toolbar/modals inherit rtl correctly; no broken-layout evidence found. Note only — verify modal text alignment live in `ar`. | P3 | index.html:191; i18n.ts:49 |

---

## C. Feature-flag (VITE_FEATURE_*) audit — ALL default-ON

`isEnabled()` returns true unless explicitly `false` (override > env > default-ON). features.ts:43-48.

| Flag | Env var | Default | main.ts removal when off | Status |
|---|---|---|---|---|
| trueEdit | VITE_FEATURE_TRUE_EDIT | ON | enforced at call site (no UI removal) | OK |
| searchableOcr | VITE_FEATURE_SEARCHABLE_OCR | ON | removes `option[value="searchable"]` | OK |
| eSign | VITE_FEATURE_E_SIGN | ON | hides `signBtn` | OK |
| flatten | VITE_FEATURE_FLATTEN | ON | hides `flattenBtn` | OK |
| xfdf | VITE_FEATURE_XFDF | ON | hides export+import XFDF btns | OK |
| bates | VITE_FEATURE_BATES | ON | hides `batesBtn` | OK |
| crop | VITE_FEATURE_CROP | ON | hides `cropBtn` + removes `#cropControls` | OK |
| compress | VITE_FEATURE_COMPRESS | ON | hides `compressBtn` + removes `compressModal` | OK |

All eight default-ON; vite.config.ts sets none → production ships all features. Removal logic is
consistent (entry point hidden/removed + behavioural gate at call site). No orphaned-flag issues.
Minor: when `searchableOcr` is off, the ocrModeSelect still shows "Editable text boxes" as the lone
option — acceptable.

---

## D. CLAUDE.md features WITH a discoverable button (cross-check — no orphans found)

All CLAUDE.md headline features map to a button: #53 sanitize→`sanitizeBtn`, #54 FS-save→`downloadBtn`
path, #56 table-CSV→`exportTableBtn`, #57 XFDF→`exportXfdfBtn`/`importXfdfBtn`, #60 compress→`compressBtn`,
#61 bates→`batesBtn`, #62 flatten→`flattenBtn`, OCR→`ocrBtn`, e-Sign→`signBtn`, crop→`cropBtn`, lock→
`fileMenuLockPdf`. **No documented feature lacks an entry point.** (Discoverability of the 12 export
sub-tools is the real issue — see B, not a missing-button issue.)

## E. Baseline items re-verified live-in-code
- **ISSUE-1 toolbar DnD = RESOLVED** (baseline flagged "uncertain / Reset orphaned"). `ToolbarCustomizer`
  uses SortableJS with `forceFallback:true`, and `enableDragDrop()` IS invoked (pdfTurboApp.ts:341);
  `_resetToolbarLayout`→`reset()` is wired (modalBinder.ts:239, pdfTurboApp.ts:542). Reset is NOT orphaned.
  Residual: the generated submenu trigger is unlabeled (finding B, toolbarCustomizer.ts:259).
