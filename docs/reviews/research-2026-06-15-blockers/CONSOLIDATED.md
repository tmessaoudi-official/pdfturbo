# Blockers to 100% — Consolidated, Test-Backed (2026-06-15)

**Question answered:** *"What is blocking us from reaching 100% on everything?"* — across all six
feature domains (DOCX/MD export, true text-edit, Arabic/RTL, OCR, e-signing, core editing/export),
with each deterministic blocker **proven by a committed test**, not asserted.

## Method
- 5 read-only research agents (one per domain group) → raw findings in `./raw/*.md` (file:line each).
- Parent verified every headline claim against source, then wrote confirming tests in
  `tests/blockers/*.blockers.test.ts`.
- **Convention** (see `tests/blockers/README.md`): a REACHABLE blocker is a vitest `it.fails()`
  asserting the *correct* behavior — GREEN today because the behavior is broken, flips RED when fixed.
  CEILING / current-behavior is a passing `it` **pin**. Non-deterministic items (OCR accuracy, timing,
  network) are evidence-only — never encoded as tests.
- Result: **11 blockers confirmed by `it.fails` + 2 behavior pins**, all green; full gate green.

## Two corrections this pass produced (verify-why caught both)
1. **DOCX scorecard was STALE.** `scorecard-docx.md` lists rows 13 (roman lists), 21 (rotated images),
   23 (underline/strike), 24 (super/subscript) as 🟡 reachable/queued — **all four already shipped**
   (Sprint 4). Row 26 (RTL) is partially done (single-RTL-line reorder works). *5 of 7 "reachable" rows
   already ship.* Fixed in Phase 7 (scorecard rows flipped).
2. **Signing S3 agent-claim was WRONG.** The research said re-signing "silently invalidates the first
   signature." Empirically [Verified via diag] it does **not** silently corrupt — it throws an **opaque**
   `"Real /ByteRange (33B) longer than reserved span (31B)"` crash with no error code. The real blocker
   is the *absence of a clean refusal*, not silent corruption. Test asserts the correct typed refusal.

---

## The honest definition of "100%"
For a **100%-client-side, no-backend PWA**, several targets are *structurally* unreachable and a number
like "100%" is dishonest there: anything needing a network authority (TSA timestamps, OCSP/CRL
revocation, LTV/DSS), a full typesetting/layout engine (in-place reflow, lattice-table reconstruction,
recursive multi-column), a font we don't have (exact subset-font faces, Arabic shaping beyond fontkit),
or true bidi (mixed LTR+RTL single-line reorder, tashkeel GPOS). These are **CEILING** below and are
documented, not promised. Everything marked **REACHABLE** is a real, bounded client-side fix.

---

## Confirmed-by-test blockers (the empirical core)

| Test | Domain | Blocker | Class | Proof |
|------|--------|---------|-------|-------|
| `ocr.blockers` O1 | OCR | UI advertises 8 OCR languages, asset vendor ships only eng/fra/ara → deu/spa/ita/por/nld throw under CSP | REACHABLE | `it.fails` advertised⊆vendored + pin (vendored = ara/eng/fra) |
| `trueedit.blockers` B-1 | True-edit | number tokenizer mangles `1e-3` → `1` + bogus `e-3` operator | REACHABLE | `it.fails` value≈0.001 + round-trip |
| `docx-md.blockers` MD-1 | DOCX/MD | Markdown ordered lists render `1.` for every item | REACHABLE | `it.fails` 2nd item ≠ `1.` |
| `docx-md.blockers` TX-1 | DOCX/TXT | TXT ordered lists render `1.` for every item | REACHABLE | `it.fails` |
| `docx-md.blockers` MD-2 | DOCX/MD | Markdown ignores list nesting depth (flush-left) | REACHABLE | `it.fails` indent present |
| `docx-md.blockers` MD-3 | DOCX/MD | Markdown silently drops images (image-only page → empty `.md`) | REACHABLE | `it.fails` `![` present |
| `signing.blockers` S6 | Signing | legacy `adbe.pkcs7.detached`, not PAdES `ETSI.CAdES.detached` | REACHABLE | `it.fails` |
| `signing.blockers` S2 | Signing | no `/DSS` → not long-term-validatable | CEILING (full LTV) | `it.fails` absence |
| `signing.blockers` S3 | Signing | re-signing throws an opaque ByteRange crash, no clean refusal | REACHABLE (refuse) | `it.fails` typed `ALREADY_SIGNED` |
| `core-security.blockers` CORE-P0-2 | Core | "Lock PDF" is AES-128 (V4/AESV2), not AES-256 | REACHABLE | `it.fails` AESV3 + pin AESV2/V4 |

---

## P0 / security (highest priority)

### CORE-P0-1 — Redaction on ROTATED pages ✅ FIXED (2026-06-15) — RE-SCOPED by empirical test
- **CORRECTION (the source-read claim was wrong about the location).** The original claim —
  `exportPipeline.ts:225-233` raster `fillRect` lands in the wrong quadrant on 90/270 pages — was
  **refuted empirically** [Verified: `tests/browser/blockers-redaction.browser.test.ts`, raster
  redaction over a known secret renders **0 leaked pixels at all four rotations** + a control proves
  the secret IS visible without redaction]. The raster path is correct because element coords are
  stored in DISPLAYED space and the export viewport renders that same displayed orientation
  (`el.x*SCALE` is already right). This was the **3rd source-read false positive this session** — the
  raster claim never had a running test (the agent's was "designed, deferred").
- **The REAL leak (now fixed):** the **flow-export** path (DOCX/MD/TXT). `_extractFlowDoc` passed
  redaction rects in editor DISPLAYED space, but `reconstructPage`/`isItemRedacted` compare them
  against pdf.js text items in **UNROTATED content space** — on 90/180/270 pages the mismatch let
  redacted text leak into the exported document [Verified: same test, flow cases were RED @ 90°/180°].
- **Fix:** `reconstructPage` gained a `pageRotation` param; it un-rotates each rect once via the new
  pure `geometry.redactionRectToContent` (identity at 0°). `exportService._extractFlowDoc` passes
  `totalRot = (page.rotate + docPage.rotation) % 360`. Guards: `blockers-redaction.browser.test.ts`
  (12 cases, all green) + `tests/core/exportCoords.test.ts` (helper, jsdom).
- *Residual (honest):* a source page with an **intrinsic `/Rotate`** combined with redaction may still
  be approximate in flow-export (dims derived from the export viewport). Common case (user rotation on
  un-rotated source) is exact. Raster path exact at all rotations.

### CORE-P0-2 — "Lock PDF" AES-128 + crippled permissions  ✅ FIXED (2026-06-15)
- Was: `encrypt({user,owner})` with no header bump → V4/AESV2 (128-bit); no `permissions` object
  → `getPermissionsR3({})` cleared every allow-bit (print/copy/a11y denied); owner defaulted to user
  (`modalBinder.ts:189`) → restrictions trivially strippable = security theater.
- **Fix:** new `src/export/encryption.ts` — `encryptPdf` bumps the header to `1.7ext3` (→ V5/R6/AESV3
  256-bit), passes `FULL_PERMISSIONS` (confidentiality lock that still permits printing/copying/a11y),
  and `modalBinder` now generates a strong `randomOwnerPassword()` when the owner field is blank (≠ user).
  `_applyExportPassword` delegates to it. Guard: `tests/blockers/core-security.blockers.test.ts` (3 — AES-256,
  permission bits set, decryptable round-trip). [Verified: header lever confirmed in `PDFSecurity.js:25-40`.]
- *Note:* the literal header becomes `%PDF-1.7ext3` (Adobe Extension Level 3 convention — modern readers
  fine; round-trip load with the user password is asserted). Encryption stays OFF the signing path by design.

---

## Per-domain blocker index (full)
Detail + file:line + per-item test design in `./raw/{docx,trueedit,arabic,ocr-signing,core}.md`.

### DOCX / Markdown / TXT  (`raw/docx.md`)
- ✅ **FIXED (2026-06-15):** MD-1/TX-1 ordinals (`orderedMarker` + `computeOrderedOrdinals`, shared
  instance logic with DOCX), MD-2 nesting (`'  '.repeat(listDepth)`), MD-3 image loss (data-URI `![]`
  in MD, `[image]` in TXT). `flowDocWriters.ts`.
- **REACHABLE (designed):** MD-4 GFM strikethrough/sup/sub, G5 heading bold/caps promotion, G7 colorMap
  ±2pt tolerance (intermittent black text), G6 spot-color (narrowed — v6 pre-resolves most spaces).
- **CEILING:** lattice/borderless tables, vector→DrawingML, 3+col recursive XY-cut, tagged-PDF struct
  fast-path, header/footer routing, mixed-bidi reorder, exact subset-font face.

### True text-edit  (`raw/trueedit.md`)
- ✅ **FIXED (2026-06-15):** B-1 exponent tokenizer (`consumeNumberBody` keeps `1e-3` one token) and
  B-3 non-WinAnsi refusal (`hasNonWinAnsi` → overlay, never paints '?'). Guards in `trueedit.blockers.test.ts`.
- **REACHABLE (designed):** B-2
  Path-3 Separation→black on the direct/bad-sample path (half-mitigated via handler canvas sample);
  C-1/C-7 CID/empty-segment kerning edges; C-2 `/Differences`-only fonts needlessly degrade.
- **CEILING:** A6 cm scale/rotation in Path-3 redraw, rotated-page inline-input placement, RTL/Arabic
  Path-3, Type3, in-place reflow/overflow.

### Arabic / RTL  (`raw/arabic.md`) — most of the prior arabic research already shipped
- ✅ **FIXED (2026-06-15):** AR-1 — `orderLineWords` now applies the UAX#9 L2 run-reversal at WORD level
  (segment a visual line into same-direction runs, emit RTL-base right→left, keep embedded LTR runs
  forward). Fixes the embedded Latin/number run that the old blanket descending-x sort reversed. Note: a
  dedicated bidi lib wasn't needed for word-level (the run-reversal IS the L2 rule); `bidi-js` stays
  unused/available for any future char-level pass. Guard: `arabic.blockers.test.ts`. Deeper char-level
  bidi (digits nested in RTL, multi-level, single mixed-script token) remains a documented partial.
- **REACHABLE (designed):** AR-2 overlay logical-order line-wrapping (silent overflow);
  AR-3 thread rotation into `drawArabicLine` (Latin rotates, Arabic doesn't); AR-5/AR-10 detect-and-warn
  (notdef coverage / PUA fraction); AR-8 RTL list-marker side; AR-9 presentation-form→base table.
- **CEILING:** mixed LTR+RTL single-line bidi reorder, tashkeel GPOS (needs harfbuzz, 1MB wasm),
  in-place true-edit Arabic on subset CID fonts.

### OCR  (`raw/ocr-signing.md`)
- ✅ **FIXED (2026-06-15):** O1 language parity — vendor all 8 advertised langs (decision); the blocker
  test is now the advertised⊆vendored drift guard.
- **REACHABLE (designed):** O6 confidence thresholding (every word inserted, even conf=5), O7
  born-digital-page guard (avoids duplicate text layers), O3 configurable render scale, O9 min-size floor.
- **CEILING / evidence-only:** O4 preprocessing (binarize/deskew/denoise), O5 cross-column reading order,
  recognition accuracy (non-deterministic).

### E-signing  (`raw/ocr-signing.md`)
- ✅ **FIXED (2026-06-15):** S3 — re-signing an already-signed PDF now refuses with a typed
  `ALREADY_SIGNED` SignError (`_assertNotAlreadySigned` detects `/ByteRange` + a sig SubFilter) instead of
  the opaque pdf-lib ByteRange crash.
- ⛔ **RE-SCOPED to CEILING (2026-06-15):** S6 PAdES. Investigation showed node-forge's pkcs7
  `_attributeToAsn1` only encodes contentType/messageDigest/signingTime — it CANNOT add the ESS
  signing-certificate-v2 signed attribute that PAdES-BES requires. Emitting only the `ETSI.CAdES.detached`
  SubFilter without it = malformed PAdES (worse than the valid `adbe.pkcs7.detached` today). A real fix
  needs hand-rolled CAdES SignedData ASN.1 or a different crypto lib — not done (would not be test-gamed).
- **REACHABLE (designed):** S5 SHA-384/512 + ECDSA, S7 widget `/AP` appearance stream, S8 size the
  `/Contents` slot to the real CMS (8 KiB fixed → overflows on big chains/RSA-4096), S9 select the leaf
  by key/CA test (P12 bag-order assumption), S12 `findContentsSlot` decoy-hex robustness.
- **CEILING (no-backend):** S1 TSA timestamp, S2 LTV/DSS (tested as absence), S10 OCSP/CRL revocation,
  S11 trusted time, B-LT/B-LTA tiers.

### Core  (`raw/core.md`)
- **P0:** CORE-P0-1 rotated redaction ✅ FIXED + re-scoped (raster correct; flow-export was the real leak — above), CORE-P0-2 encryption (tested, above — next).
- **REACHABLE (designed):** CORE-2 non-text form fields (checkbox/radio/choice/sig) lost on fill/flatten;
  CORE-3 `/Ch` field fill throws-and-drops; CORE-4 `cleanEmptyTextElements` mutates model outside a
  history Command; CORE-5 IndexedDB `QuotaExceededError` = silent total-session-loss window; CORE-6
  renderer ignores `devicePixelRatio` (blurry HiDPI); CORE-7 owner==user password.
- **CEILING:** surgical (non-rasterizing) redaction that keeps the rest of the page selectable.

---

## Highest-ROI reachable (ranked, value/effort)
1. ~~**CORE-P0-1** rotated-redaction geometry~~ ✅ **DONE (2026-06-15)** — re-scoped: raster path was already correct (false-positive source claim); the real DOCX/MD/TXT flow-export leak is fixed via `reconstructPage(pageRotation)` + `redactionRectToContent`.
2. ~~**CORE-P0-2 + CORE-7** encryption~~ ✅ **DONE (2026-06-15)** — AES-256 header, explicit permissions, random owner≠user. _(original below)_
   <!-- original --> explicit permissions, AES-256 header, stop owner==user.
3. ~~**True-edit B-3** non-WinAnsi refusal + B-1 exponent~~ ✅ **DONE (2026-06-15)** — `hasNonWinAnsi`→overlay, `consumeNumberBody` keeps `1e-3` one token.
4. ~~**OCR O1** language parity~~ ✅ **DONE (2026-06-15)** — vendor all 8 (deu/spa/ita/por/nld added; URLs verified 200). _(orig)_ single-source-of-truth, 5 advertised languages broken today under CSP.
5. ~~**MD-1/TX-1 + MD-2 + MD-3**~~ ✅ **DONE (2026-06-15)** — MD/TXT ordinals, nesting, images. _(orig)_ the most visible MD/TXT defects; all data already exists from the DOCX path.
6. ~~**Arabic AR-1**~~ ✅ **DONE (2026-06-15)** — word-level UAX#9 L2 run-reversal (embedded LTR runs kept forward). _(orig)_ route DOCX reorder through the installed `bidi-js`; biggest Arabic correctness win, zero new dep.
7. **Signing S3** ✅ **DONE (2026-06-15)** (clean re-sign refusal); S6 ⛔ re-scoped to ceiling (forge can't add ESS attr); S8 + S9 still designed — right-size the `/Contents` slot, pick the real leaf.

## Scorecard hygiene (Phase 7, done)
`scorecard-docx.md` rows 13/21/23/24 → ✅, row 26 → ✅-partial; `KNOWN_ISSUES.md` cross-links the
confirming tests. No code behavior changed by this research pass — it is research + tests only.
