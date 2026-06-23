# Signing domain — deep QA review (2026-06-23)

Reviewer: skeptical senior code review. Files read:
`src/signing/{pdfSigner,certGen,byteRange,cms,cmsVerify,incrementalSigner,multiSign,p12,appearance,types,index}.ts`,
`src/handlers/signingHandler.ts`, `src/ui/signersPanel.ts`, `src/core/signatureManager.ts`,
`src/ui/placementManager.ts`, `src/elements/signatureElement.ts`, `src/ui/binders/{toolBinder,keyboardBinder}.ts`,
locale parity for `sign.error.*`.

## Health summary

The signing domain is **in good shape and matches its documented design**. The core data-safety
and trust invariants the prompt asks about all hold:

- **`.p12` zeroed after use** — `signingHandler.sign()` has `finally { form.p12.fill(0); }` (line 253);
  `PdfSigner.sign()` has `finally { scrubP12Material(material); }` (line 105) which `.data.fill(0)`s every
  RSA component (p12.ts:134-142); `generateSelfSignedP12` scrubs the generated key before returning
  (certGen.ts:166).
- **Re-signing refused** — `PdfSigner.preflight` throws `ALREADY_SIGNED` (pdfSigner.ts:123) requiring
  BOTH a `/ByteRange [` and a sig SubFilter/`/Type /Sig` (isPdfSigned, lines 56-65) — defends against
  incidental byte sequences.
- **Preflight runs BEFORE cert generation** — `runSignFlow()` assembles + preflights (signingHandler.ts:139-145)
  and only then generates/downloads the `.p12`/`.pem` (lines 154-167). An off-page rect / already-signed
  PDF bails with NO orphan cert download. Verified.
- **No caption leak** — the plain ✍ click (`toolBinder.ts:13 app.clearPendingSignatureCaption()`), the `S`
  shortcut (`keyboardBinder.ts:78`), and pad-cancel (`signatureManager.closeModal` line 54) ALL clear
  `pendingCaption`; placement consumes-then-clears it (placementManager.ts:193-194). The leak guard the
  CLAUDE.md claims is genuinely present in all three sites.
- **Experimental modules truly unwired** — `grep` for `incrementalSigner|multiSign|cmsVerify|
  addIncrementalSignature|signMultiple|verifyAllSignatures` outside their own files + tests returns
  ZERO hits in `src/`. The only wired path is `PdfSigner` (via `signingHandler`), whose `ALREADY_SIGNED`
  guard is intact. The incremental engine that deliberately skips the guard is unreachable from the UI.
- **No silent re-sign after edits** — output is download-only, no auto-resign (signingHandler.ts:7-9).
- **Locale parity clean** — all 11 `sign.error.*` codes present in en/fr/ar.
- **Caption rendered via `textContent`** (signatureElement.ts:81) — no XSS surface.
- **PDF string fields use `PDFString.of`** (pdf-lib escaping) — no PDF-syntax injection via reason/location/name.

Findings below are minor/correctness-edge, not core defects.

---

## P2 — `findContentsSlot` accepts the FIRST hex `/Contents`, can mis-target on an opened PDF that already contains a hex `/Contents` string

**File:** `src/signing/byteRange.ts:60-94`, used by `pdfSigner.ts:338`
**Category:** bug / data-safety (signature validity)

`findContentsSlot` scans every `/Contents` token and returns the FIRST whose value is a hex string
(`<...>`). The doc comment justifies this by asserting that a page `/Contents` is always an indirect ref
or array (true), so the first hex `/Contents` must be the signature dict. That assumption holds for PDFs
this app *produces*, but the signer runs over `assemblePdfBytes()` of an **arbitrary opened PDF**. A source
document can legitimately carry a `/Contents <hexstring>` elsewhere — e.g. a signature-reference dict, a
`/Contents` key inside an embedded-file or rich-media dict, or any third-party object that pdf-lib copies
through verbatim. If such a hex `/Contents` serialises *before* the new sig dict, the ByteRange is computed
against the wrong slot → the produced signature is silently invalid (the `/Contents` it filled isn't the one
whose ByteRange it computed, OR vice-versa).

**Evidence:**
```ts
// Only a hex-string value (`<...>`) is the signature slot. Anything else
// (ref digit, array `[`) belongs to a page content stream — skip it.
if (i >= bytes.length || bytes[i] !== ASCII_LT) continue;
...
return { open, close, hexLength: close - open - 1 };
```
There is no check that the matched slot is the one with `hexLength === HEX_SLOT_CAPACITY` *before* returning —
the capacity check happens later in `_spliceSignature` (pdfSigner.ts:350) and would THROW
`PLACEHOLDER_NOT_FOUND` if the wrong slot were a different size, but a coincidental 16384-char hex slot
elsewhere would pass. Realistically rare, but the failure mode is a corrupt/invalid signature, not a clean error.

**Recommendation:** Make `findContentsSlot` (or the signer) prefer the slot whose `hexLength` equals the
reserved `HEX_SLOT_CAPACITY`, or scan from the END of the file backward (the just-appended sig dict is last),
or match `/Contents` only when immediately preceded within the same dict by the `adbe.pkcs7.detached`
SubFilter. Document the current first-hex-match as a known ceiling at minimum.

---

## P2 — Signature field name uses `Date.now()` only; two signatures placed in the same millisecond collide on `/T`

**File:** `src/signing/pdfSigner.ts:266` (`T: PDFString.of(\`Signature_${Date.now()}\`)`), and incrementalSigner.ts:261
**Category:** bug (low likelihood)

The AcroForm signature field's fully-qualified name `/T` is `Signature_<ms>`. PDF requires field names to be
unique within their hierarchy. The shipped single-signature path can't collide with itself, but `multiSign`
(experimental) and any future flow signing twice fast would produce two `Signature_<sameMs>` fields. The
incremental engine uses `Signature2_<ms>` so it won't clash with sig-1, but two incremental rounds in the
same ms would. Not user-facing today (experimental), but a latent trap if/when multi-sign is wired.

**Recommendation:** Append a random suffix (`crypto.getRandomValues`) or a monotonic counter to the field name.

---

## P3 — `appearanceImage` PNG is embedded but the appearance band math can produce a near-zero text band, silently dropping the signer/date text

**File:** `src/signing/pdfSigner.ts:182-219`
**Category:** ux / fidelity

When an `appearanceImage` is present, the image takes 60% of the rect height (`imgBandH = rect.height * 0.6`)
and the text band gets the remaining 40% minus padding. For a short rect (e.g. height 40pt), the text band is
~16pt; `fontSize = max(6, min(11, textBandH/(lines+1)))` floors at 6, and the `if (cursorY < rect.y + padding)
break;` loop silently drops lines that don't fit. A signer could end up with an image-only appearance and NO
visible "Signed by / Date" text without any warning. Cosmetic (the cryptographic signature is unaffected) but
the visible appearance is the whole point of a *visible* signature.

**Recommendation:** When the text band can't fit even the signer line, either shrink the image band or surface
a toast. Low priority — documented appearance is best-effort.

---

## P3 — `dataUrlToBytes` silently drops a non-PNG drawn signature; pad output relies on default `toDataURL()` being PNG

**File:** `src/handlers/signingHandler.ts:88-96`, `src/utils/signaturePad.ts:54`
**Category:** ux / correctness (defensive)

`dataUrlToBytes` only matches `data:image/png;base64,...` and returns `undefined` otherwise — a deliberate
guard (pdf-lib appearance embeds PNG only). The signature pad's `getDataURL()` calls `canvas.toDataURL()` with
no mime arg, which defaults to PNG, so this works today. But the coupling is implicit: if the pad ever switched
to `toDataURL('image/jpeg')` or SVG, the drawn signature would silently vanish from the appearance with no
error. Not a current bug — flagging the implicit contract.

**Recommendation:** Either assert/document the PNG dependency at the pad, or broaden `dataUrlToBytes` to handle
JPEG via `doc.embedJpg`.

---

## Non-findings (verified clean, called out because the prompt asked)

- **Password handling:** generate-mode password deliberately NOT wiped in `finally` (signingHandler.ts:207-211)
  — documented S-FLOW retry fix; it is scrubbed in `closeSignModal()`. Uploaded-cert passphrase input cleared
  in `finally` (line 211). JS strings are immutable so the passphrase string itself can't be zeroed — correctly
  documented (p12.ts:79-81). Acceptable, not a finding.
- **Generated `.p12`/`.pem` download:** the private key is written to disk by the user's explicit "generate"
  choice — expected, surfaced in UI; not a leak.
- **cmsVerify SET-tag correctness:** re-DERs authenticated attributes in a UNIVERSAL SET (0x31), not the `[0]`
  IMPLICIT tag (cmsVerify.ts:203-205) — the classic forge-verify trap, correctly avoided. Verifies against the
  CMS-embedded cert. Sound (and unwired).
- **`isPdfSigned` chunked latin1 scan** (pdfSigner.ts:56-65) — correct, requires BOTH markers, no false positive.
- **Input never mutated:** `_spliceSignature` works on `new Uint8Array(draft)` (pdfSigner.ts:336); `sign()` copies.
- **No undo/redo concern:** signing is download-only and does not mutate `documentModel` — nothing to undo. Correct.
- **a11y:** SignersPanel uses `trapFocus` with a return-focus anchor (signersPanel.ts:73-77), matching BatesPanel.
