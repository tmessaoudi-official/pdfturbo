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

### CORE-P0-1 — Redaction on ROTATED pages leaves the secret pixels visible  ⚠️ top fix
- **REACHABLE.** `src/export/exportPipeline.ts:225-233` [Verified by source read]. The page is rasterized
  at the **rotated** viewport, but the redaction `ctx.fillRect` uses raw, **unrotated** editor coords
  `el.x*SCALE, el.y*SCALE` with no rotation transform. On a 90/270 page the burn box lands in the wrong
  quadrant → the sensitive text is *rasterized but uncovered* (the text bytes ARE flattened, so there is
  no copy-paste leak, but the pixels render in the clear). Acknowledged-unfixed (`KNOWN_ISSUES.md`).
- **Fix:** rotate the rect corners by the same `totalRot` (`exportPipeline.ts:207`) before `fillRect`.
- **Test (designed, deferred — heavy harness):** two-tier — jsdom asserts text-byte absence (passes,
  bytes gone); **browser** rasterizes a rotated page + a redaction over known text and pixel-samples the
  rotated location → asserts fill color, not glyph ink (fails today). Lands with the fix.
- *Positive bound:* on NON-rotated pages redaction genuinely flattens the page (no leak); DOCX/MD leak
  already fixed.

### CORE-P0-2 — "Lock PDF" is AES-128 and silently denies all permissions  ✅ confirmed by test
- AES-128 part proven (`core-security.blockers`). Additional: `encrypt()` passes no `permissions` object
  → `getPermissionsR3({})` clears every allow-bit (print/copy/a11y denied); owner password defaults to
  user password (`modalBinder.ts:189`) → restrictions are strippable = security theater.
- **Fix:** set the `1.7ext3` header for AES-256, pass an explicit `permissions` object, stop owner==user.

---

## Per-domain blocker index (full)
Detail + file:line + per-item test design in `./raw/{docx,trueedit,arabic,ocr-signing,core}.md`.

### DOCX / Markdown / TXT  (`raw/docx.md`)
- **REACHABLE (tested):** MD-1/TX-1 ordinals, MD-2 nesting, MD-3 image loss.
- **REACHABLE (designed):** MD-4 GFM strikethrough/sup/sub, G5 heading bold/caps promotion, G7 colorMap
  ±2pt tolerance (intermittent black text), G6 spot-color (narrowed — v6 pre-resolves most spaces).
- **CEILING:** lattice/borderless tables, vector→DrawingML, 3+col recursive XY-cut, tagged-PDF struct
  fast-path, header/footer routing, mixed-bidi reorder, exact subset-font face.

### True text-edit  (`raw/trueedit.md`)
- **REACHABLE (tested):** B-1 exponent tokenizer.
- **REACHABLE (designed):** B-3 non-WinAnsi ligature should refuse→overlay (currently paints a wrong
  glyph, violating the "never paint garbage" contract — *highest-ROI correctness fix, ~1 line*); B-2
  Path-3 Separation→black on the direct/bad-sample path (half-mitigated via handler canvas sample);
  C-1/C-7 CID/empty-segment kerning edges; C-2 `/Differences`-only fonts needlessly degrade.
- **CEILING:** A6 cm scale/rotation in Path-3 redraw, rotated-page inline-input placement, RTL/Arabic
  Path-3, Type3, in-place reflow/overflow.

### Arabic / RTL  (`raw/arabic.md`) — most of the prior arabic research already shipped
- **REACHABLE (designed):** AR-1 route DOCX reorder through the already-installed-but-unused `bidi-js`
  (biggest correctness win, zero new dep); AR-2 overlay logical-order line-wrapping (silent overflow);
  AR-3 thread rotation into `drawArabicLine` (Latin rotates, Arabic doesn't); AR-5/AR-10 detect-and-warn
  (notdef coverage / PUA fraction); AR-8 RTL list-marker side; AR-9 presentation-form→base table.
- **CEILING:** mixed LTR+RTL single-line bidi reorder, tashkeel GPOS (needs harfbuzz, 1MB wasm),
  in-place true-edit Arabic on subset CID fonts.

### OCR  (`raw/ocr-signing.md`)
- **REACHABLE (tested):** O1 language parity.
- **REACHABLE (designed):** O6 confidence thresholding (every word inserted, even conf=5), O7
  born-digital-page guard (avoids duplicate text layers), O3 configurable render scale, O9 min-size floor.
- **CEILING / evidence-only:** O4 preprocessing (binarize/deskew/denoise), O5 cross-column reading order,
  recognition accuracy (non-deterministic).

### E-signing  (`raw/ocr-signing.md`)
- **REACHABLE (tested):** S6 PAdES SubFilter, S3 clean re-sign refusal.
- **REACHABLE (designed):** S5 SHA-384/512 + ECDSA, S7 widget `/AP` appearance stream, S8 size the
  `/Contents` slot to the real CMS (8 KiB fixed → overflows on big chains/RSA-4096), S9 select the leaf
  by key/CA test (P12 bag-order assumption), S12 `findContentsSlot` decoy-hex robustness.
- **CEILING (no-backend):** S1 TSA timestamp, S2 LTV/DSS (tested as absence), S10 OCSP/CRL revocation,
  S11 trusted time, B-LT/B-LTA tiers.

### Core  (`raw/core.md`)
- **P0:** CORE-P0-1 rotated redaction (above), CORE-P0-2 encryption (tested, above).
- **REACHABLE (designed):** CORE-2 non-text form fields (checkbox/radio/choice/sig) lost on fill/flatten;
  CORE-3 `/Ch` field fill throws-and-drops; CORE-4 `cleanEmptyTextElements` mutates model outside a
  history Command; CORE-5 IndexedDB `QuotaExceededError` = silent total-session-loss window; CORE-6
  renderer ignores `devicePixelRatio` (blurry HiDPI); CORE-7 owner==user password.
- **CEILING:** surgical (non-rasterizing) redaction that keeps the rest of the page selectable.

---

## Highest-ROI reachable (ranked, value/effort)
1. **CORE-P0-1** rotated-redaction geometry — true security exposure, bounded fix, already acknowledged.
2. **CORE-P0-2 + CORE-7** encryption — explicit permissions, AES-256 header, stop owner==user.
3. **True-edit B-3** non-WinAnsi ligature refusal — ~1-line guard, closes the "never paint garbage" hole.
4. **OCR O1** language parity — single-source-of-truth, 5 advertised languages broken today under CSP.
5. **MD-1/TX-1 + MD-2 + MD-3** — the most visible MD/TXT defects; all data already exists from the DOCX path.
6. **Arabic AR-1** — route DOCX reorder through the installed `bidi-js`; biggest Arabic correctness win, zero new dep.
7. **Signing S3 + S8 + S9** — clean re-sign refusal, right-size the `/Contents` slot, pick the real leaf.

## Scorecard hygiene (Phase 7, done)
`scorecard-docx.md` rows 13/21/23/24 → ✅, row 26 → ✅-partial; `KNOWN_ISSUES.md` cross-links the
confirming tests. No code behavior changed by this research pass — it is research + tests only.
