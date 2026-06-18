# Verdict — Incremental-update multi-signature spike (F-D D3)

**Date:** 2026-06-18
**Author:** spike under `src/signing/incrementalSigner.ts` + `tests/signing/incrementalSigner.test.ts`
**Question:** Can a *second independent* cryptographic signature be added to an already-signed
PDF **client-side**, such that **both** signatures' `/ByteRange` digests stay valid and the
original bytes are preserved — without a backend?

## TL;DR — **FEASIBLE. The POC succeeds.**

True N-party cryptographic co-signing **is reachable client-side** via an append-only PDF
incremental update. The 7-test spike signs a PDF, adds a second signature incrementally, and
proves all of the following in jsdom (`npm run test`, `tests/signing/incrementalSigner.test.ts`):

1. **Append-only** — the first `origLen` bytes of the doubly-signed file are **byte-for-byte
   identical** to the singly-signed input (`Array.from(twice.subarray(0,origLen)) === once`).
2. **Two signatures** — `countSignatures` returns 2; two distinct `/Contents` hex slots and two
   distinct `/ByteRange` arrays exist.
3. **Sig-1 still validates** — its *stored* `/ByteRange` numbers are unchanged, and the bytes
   they cover (which end at the original EOF) are byte-identical → its SHA-256 digest is
   unchanged (`sig1DigestAfter === sig1DigestBefore`).
4. **Sig-2 covers the right bytes** — the `/ByteRange` parsed back **from the final file**
   selects a span whose SHA-256 equals the digest the signer actually hashed
   (`sig2DigestFromFile === signedSpanSha256`). This catches any xref/offset error that would
   shift bytes.
5. **Valid PDF** — `@cantoo/pdf-lib` re-parses the doubly-signed result (`getPageCount() === 1`),
   `/Prev` lives in the appended trailer, and the appended `/ByteRange` token is well-formed.

## Why the prior "structural ceiling" label was wrong

The plan and `CLAUDE.md` recorded true N-party crypto co-signing as a **structural ceiling**,
attributed to: *"`@cantoo/pdf-lib` does a FULL re-save (`pdfSigner.ts:96`), not an incremental
update → a 2nd signature rewrites byte offsets and invalidates the 1st."*

That diagnosis is correct **about pdf-lib's `save()` API** but the conclusion over-generalised.
The ceiling is in the *tool's serialiser*, **not** in the PDF format or in what a browser can do.
The PDF spec's incremental-update mechanism (ISO 32000-1 §7.5.6) is *designed* exactly for this:
append new/overriding objects + a new xref section with `/Prev`, leaving every prior byte
untouched. The fix is a **hybrid**: use pdf-lib only to *read* structure (object numbers,
Root/AcroForm/page refs), then hand-build the append-only bytes. pdf-lib never re-saves, so the
first signature's covered span never moves.

→ **Re-classify D3 from "structural ceiling" to "reachable (high-effort)".**

## How it works (design)

`addIncrementalSignature(signedBytes, opts, material)`:

1. `PDFDocument.load(signedBytes, {updateMetadata:false})` — **read only** (Root/AcroForm/page
   refs, largest object number, original trailer `/ID`, last `startxref`).
2. Register a new **sig dict** (ByteRange sentinel + fixed `/Contents <0…0>` slot) and a merged
   **sig field/widget**; mutate the in-memory page `/Annots` and AcroForm `/Fields` (+ `SigFlags`).
3. Serialise **only** the new + changed objects (sig dict, widget, new-revision page, new-revision
   AcroForm-owner) via pdf-lib's per-object `toString()`, tracking absolute byte offsets.
4. Append a classic incremental **`xref`** (multi-subsection, 20-byte entries) + `trailer
   << /Size /Root /Prev origStartxref /ID >>` + `startxref` + `%%EOF`.
5. Locate sig-2's placeholders by searching **only the appended region** (`findContentsSlot` on
   `draft.subarray(origLen)`) — never sig-1's already-filled slot. Compute the ByteRange over the
   whole extended file minus sig-2's hex, overwrite the placeholder (same length → no offset
   shift), CMS-sign the span (reusing `buildDetachedCms`), splice the hex.

The byte-surgery primitives (`computeByteRange`, `collectSignedBytes`, `signatureToPaddedHex`,
`findContentsSlot`, `findByteRangeToken`) are **reused verbatim** from the shipped `byteRange.ts`.

## What is NOT proven (honest caveats)

- **Third-party validator acceptance (Adobe Acrobat, EU DSS) is UNVERIFIED in-repo** — there is
  no Acrobat in CI. The spike proves *ByteRange-digest correctness + append-only preservation*;
  it does NOT prove a specific reader renders "2 valid signatures" with green checks. This is the
  same honest caveat the shipped single-signature path carries. **Manual Acrobat verification is
  required before shipping.**
- **CMS-internal RSA re-verification** is not performed in the test (node-forge's detached-CMS
  verify path is version-brittle — flagged in the 3C gate). The proof rests on (a) the ByteRange
  selecting exactly the signed bytes and (b) `buildDetachedCms` being the already-trusted shipped
  signer. Adding a standalone forge verifier is a follow-up if D3 is productionised.
- **ASCII-only object assumption** — offsets are computed as string indices, valid because the
  objects this engine emits (sig dict, widget, page, catalog/AcroForm) serialise to ASCII. A PDF
  whose page/catalog dict contains a *binary literal string* would need byte-accurate offsets.
- **Classic xref only** — assumes the input's last revision uses a classic `xref` table (true for
  this app's `useObjectStreams:false` output). A cross-reference-**stream** PDF (PDF 1.5+) would
  need an incremental xref-stream section instead.
- **Same keypair reused for both test signatures** — the POC proves the byte/xref *structure*,
  not distinct certs. Two different certs change nothing structurally (the byte surgery is
  cert-agnostic).
- **No rotated-page / encrypted-source handling** — out of spike scope.
- **Inputs are not validated** — unlike the shipped `PdfSigner.preflight`, the spike does not
  bounds-check `opts.page`/`opts.rect`; an out-of-range page throws a raw (non-`SignError`) error.
  Productionising D3 would reuse the existing preflight (minus the `ALREADY_SIGNED` branch).

## Recommendation

- **Keep the shipped `ALREADY_SIGNED` guard.** The spike proves feasibility, not production
  readiness. Shipping requires: (1) manual Adobe/DSS acceptance verification, (2) a real CMS
  re-verifier, (3) xref-stream support + byte-accurate (non-ASCII) offsets, (4) UI for round 2+.
- **Approval model B (N visible drawn sigs + 1 crypto seal, F-D D1/D2) remains the right default**
  for the no-backend privacy tool — it needs no crypto co-signing and is already shipped.
- **D3 is now an opt-in productionisation candidate, not a ceiling.** The module stays
  experimental + unwired; this verdict + the green test are the deliverable.

## Status

`STATUS: Spike complete — POC proves feasibility. Module unwired/experimental;
ALREADY_SIGNED guard untouched. Adobe acceptance pending manual verification.`
