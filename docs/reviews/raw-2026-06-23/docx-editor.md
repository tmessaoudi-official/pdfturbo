# DOCX editor — deep QA review (2026-06-23)

Domain: `src/docx/*` — read/edit/toolbar/find-replace/tables/paste-from-Word + DOCX→PDF export.

Files read: opcEdit.ts, docModel.ts, docxMapping(=in docModel), docxProseMirror.ts, docxToolbar.ts,
opcParts.ts, findReplace.ts, findReplacePlugin.ts, findReplaceBar.ts, wordPaste.ts, docxToPdf.ts,
docxSchema.ts, docxEditorController.ts; plus main.ts wiring, modals.css, locale parity (en/fr/ar).

## Cardinal rule — UPHELD
`applyBlocks`/`applyParagraphRuns` (docModel.ts:449-466) edit `word/document.xml` in place via DOMParser +
XMLSerializer; `opcEdit.packOpc` re-zips all original parts verbatim. No `docx`-writer rebuild anywhere.
`reconcileContainer` keeps `w:tblPr`/`w:tblGrid`/`w:tcPr` verbatim and only rewrites cell paragraph runs.
Secondary parts (styles/numbering) are reused-if-present, injected-if-absent (opcParts.ts). This is the
correct, fidelity-preserving design and is well implemented.

## Locale parity — CLEAN
en/fr/ar all carry the identical 35 docxEditor/docxToolbar/findReplace keys. Arabic values flagged
[Unverified] in CLAUDE.md (native review pending) — consistent with project policy, not a defect.

## XSS / paste sanitisation — adequately defended
`cleanWordHtml` is the `transformPastedHTML` hook; its output is RE-PARSED by ProseMirror through the
schema's `parseDOM` rules (never injected via innerHTML — the one `body.innerHTML` is a READ). PM builds
typed nodes, so surviving `style`/`data:`-img attributes cannot execute. `_DROP_TAGS` covers
script/style/meta/link/title/xml; office-namespaced tags are unwrapped to text. No XSS surface found.

---

## FINDINGS

### P1 — Silent loss of structural table edits on save (no user feedback)
- file: src/docx/docModel.ts:373-382 (`reconcileContainer` divergence fallback) + docxSchema.ts:13-23 / docxProseMirror.ts:21 (`tableEditing()` enabled)
- category: bug / data-loss-perception (UX)
- EVIDENCE: The PM schema enables `tableEditing()` and full table nodes. The toolbar binds no add/remove-row
  commands, but ProseMirror's base keymap still lets a user delete a whole table, a row, or a cell's content
  by selection+Backspace. On save, `reconcileContainer` checks `if (domTables.length !== modelTables.length)`
  and silently routes to `reconcileParagraphsOnly(... blocks.filter(paragraph) ...)`, which leaves the ORIGINAL
  DOM tables **verbatim** and reconciles only paragraphs. Net effect: a table the user deleted in the editor
  is STILL PRESENT in the downloaded file, with zero warning. CLAUDE.md documents "structure read-only in 3a"
  as a ceiling, but the editor presents tables as fully editable and the save path gives no `notify(...)`/toast
  when it discards a structural change — the saved document silently diverges from what the user sees.
- recommendation: Either (a) make table structure genuinely read-only in the UI (a plugin filtering
  transactions that change table row/cell count), or (b) detect the divergence in `save()` and surface a
  `notify('docxEditor.tableStructureUnsupported', 'warn')` so the user knows the structural edit was dropped.

### P1 — DOCX editor modal has no focus trap, no Esc-to-close, no backdrop dismiss
- file: src/docx/docxEditorController.ts:81-86, 184-187 (modal create + close)
- category: a11y / ux
- EVIDENCE: The modal sets `role="dialog"` + `aria-modal="true"` (lines 83-84) but the only close affordance is
  the ✕ button (`closeBtn`); there is no keydown handler for `Escape` on the modal, no focus trap keeping Tab
  inside the dialog, and no backdrop click-to-close. CLAUDE.md states every modal "needs its own branch" for
  Esc (keyboardBinder) and the bates/signers panels each ship their own focus-trap/Esc/backdrop. This dialog
  ships none. A keyboard/AT user who opens it can Tab out into the (inert, visually-hidden) PDF app behind it,
  and cannot dismiss with Esc. (The find/replace BAR has Esc, but that only closes the bar, not the modal.)
- recommendation: Add an `Escape` keydown handler on `modal` calling `close()`, a focus trap (reuse
  `src/utils/focusTrap.ts`), initial focus to the panel/first control on open, and focus restoration on close.

### P2 — Exported PDF blob carries the Word MIME type
- file: src/docx/docxEditorController.ts:39-49 (`anchorDownload`) + 164-175 (`onExportPdf`) + src/main.ts:152-159
- category: bug / export
- EVIDENCE: `anchorDownload` hardcodes `new Blob([...], { type: DOCX_MIME })` where `DOCX_MIME` is the
  wordprocessingml document type. The SAME `download` seam is used for both `onSave` (correct) and
  `onExportPdf` (line 170 `download(bytes, pdfName(currentName))`). main.ts wires only `notify`, so the default
  `anchorDownload` is used → the exported PDF's blob `type` is `application/vnd...wordprocessingml.document`.
  The filename ends `.pdf` so most browsers save it correctly, but the blob's Content-Type is wrong, which can
  mislead preview/upload targets and any `window.open(url)` consumer.
- recommendation: Pass the MIME type into `download(bytes, filename, mime)` (or split into `downloadDocx`/
  `downloadPdf`), using `application/pdf` for the export path.

### P2 — `wordPaste` allows `data:` image URLs unconditionally (SVG/oversized-payload vector)
- file: src/docx/wordPaste.ts:49-52 (`_imgIsUsable`)
- category: security / ux
- EVIDENCE: `_imgIsUsable` returns true for any `^(https?:|data:)` src. A pasted `data:image/svg+xml,...`
  survives the sanitiser. As noted above, ProseMirror renders the image node as `<img src>`, where SVG is
  script-inert, so this is NOT an active XSS — but a paste can smuggle an arbitrarily large base64 `data:`
  payload (or an `<img>` that triggers an outbound `https:` request for tracking) straight into the document
  model and the saved file. There is no size cap and no restriction to raster MIME types.
- recommendation: Restrict `data:` to a raster allowlist (`data:image/(png|jpe?g|gif|webp)`) and consider a
  size ceiling on base64 image payloads; reject `https:` images or document that pasting can fetch remote URLs.

### P3 — `editedName` mangles non-.docx filenames
- file: src/docx/docxEditorController.ts:56-59
- category: ux
- EVIDENCE: `'foo.txt'.replace(/(\.docx)?$/i,'') + '-edited.docx'` → `foo.txt-edited.docx` (the `.docx?` group
  only matches a trailing `.docx`, leaving `.txt` in the stem). The file input `accept` is `.docx,<mime>` so
  this is reachable only via drag-drop/programmatic `loadBytes`, but the resulting name is ugly.
- recommendation: Strip any trailing extension: `filename.replace(/\.[^.]+$/,'') + '-edited.docx'`.

### P3 — `findReplace` regex whole-word wrap can change capture-group numbering
- file: src/docx/findReplace.ts:61 (`\\b(?:${query})\\b`)
- category: bug (minor)
- EVIDENCE: Whole-word mode wraps the user pattern in `\b(?:...)\b`. The non-capturing group is correct and
  preserves `$1` numbering, so this is fine — BUT a user pattern containing a top-level alternation already
  inside, e.g. `a|b`, becomes `\b(?:a|b)\b` (correct). No bug in numbering. The only real edge: an invalid
  user regex is caught and surfaced as `invalid-regex` (good). Downgrading to "no defect" — noting the
  catastrophic-backtracking ceiling (findReplace.ts:36-38) is honestly documented and undefended by design.
- recommendation: None required; documented ceiling. (Listed for completeness; not a true defect.)

## Notes (verified NON-issues)
- `replaceAll` right-to-left single-transaction (findReplacePlugin.ts:183-196) is correct — earlier positions
  stay valid; one undo step. Marks inherited from match start (line 159-162) is the documented contract.
- `MAX_MATCHES=1000` cap (findReplace.ts:40) bounds decoration/transaction size; `truncated` surfaces "n of
  1000+" in the bar. Sound.
- Undo/redo: every editor mutation is a ProseMirror transaction through the single view; the DOCX editor is an
  isolated PM instance (NOT the PDF historyManager) — no command-pattern bypass applies here.
- `sanitizeWinAnsi` (docxToPdf.ts:416) correctly flags `hadUnsupportedChars`, and `onExportPdf` surfaces
  `docxEditor.pdfUnsupportedChars` warn (controller:172). The CP1252 ceiling is documented.
- `buildRun` (docModel.ts:247) clones the base `w:rPr`, strips only MANAGED_RPR, re-adds, and `sortRPrChildren`
  restores canonical CT_RPr order — unmodeled run props (highlight, spacing, vertAlign) survive. Good.
- `applyParagraphProps` (docModel.ts:308) leaves a foreign (non-heading) `w:pStyle` intact when heading is
  cleared. Correct Chesterton's-fence behavior.
