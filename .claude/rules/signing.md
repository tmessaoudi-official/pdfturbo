---
paths:
  - "src/signing/**"
  - "src/handlers/signingHandler.ts"
  - "src/ui/signersPanel.ts"
  - "src/ui/placementManager.ts"
  - "tests/signing/**"
---

# pdfturbo gotchas — signing

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: e-signing, PAdES and the ByteRange, signature placement, the Signers panel. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### The RSA signature check is WebCrypto's, not node-forge's — GHSA-86w9-cpqp-85rv (2026-10-02)

node-forge <= 1.4.0 (the latest release; no patched one exists) never checks the element count inside the DigestInfo's
DigestAlgorithm sequence when it verifies an RSASSA-PKCS1-v1_5 signature, so a signature carrying garbage there is ACCEPTED, which
lets an attacker forge one for a low-exponent key. **Measured on the installed 1.4.0, not read:** a signature built with a real
1024-bit private key over `SEQ{ SEQ{ OID sha256, NULL, OCTET 'garbage-element' }, OCTET digest }` with correct padding verified `true`
through forge (`tests/signing/rsaVerify.test.ts`, red first: `expected true to be false`), and the same signature through WebCrypto is
`false`. `src/signing/cmsVerify.ts` now exports `verifyRsaSha256`, which DER-encodes the forge key as an SPKI and calls
`crypto.subtle.verify('RSASSA-PKCS1-v1_5', …)` (SHA-256, as before); forge still PARSES the CMS and the certificate, and still
CREATES every signature (`cms.ts`, `p12.ts`, `certGen.ts` — the advisory is about verification only). It returns false and never throws.

**Scope, so this is not read as more than it is:** `verifyAllSignatures` has no production caller — `multiSign.ts` and the tests only,
kept out of the barrel — so the shipped app never verifies a signature with forge; the swap is hardening for the day someone wires
it. The advisory itself stays in `npm audit`, which is why `scripts/audit-gate.mjs` exempts that one id until a patched release
(CLAUDE.md § Git & CI, fifth occurrence). Guards: `tests/signing/rsaVerify.test.ts` (8) — correct signature, the hand-built
DigestInfo without the extra element (the builder is sound), different data, the advisory shape, garbage input, and a source-level
guard that allows no `.verify(` call except WebCrypto's in what ships: every code file under `src/` at any depth plus `index.html` and
`public/*.html` (it scanned `src/signing`, flat, until the 2026-10-06 audit), with a fixture control that plants a forge verify in
`src/handlers/`, in `src/signing/<sub>/` and in a page script and requires all three caught. Sabotage, each restored with `cmp`: helper always
true → 4; hash SHA-1 → 4 (with the two `verifyAllSignatures` cases); wired back to forge's `verify` with a correct digest → exactly the
source guard (the behavioural suite stays green with either, so the guard is the only thing that notices). Real Chrome:
`tests/browser/signing.browser.test.ts` still passes (`crypto.subtle` needs a secure context; localhost is one).
**Bound:** a 1024-bit key was used for speed; 2048 is what the app generates and the existing signing tests cover.

### The drag-placed signature rect was crop-relative while `/Rect` is absolute (2026-08-29)

> **[Re-checked 2026-09-28]** the `exportPipeline.ts` line citations below have drifted — the render viewport is the `pointViewport(renderPage, …)` call and the page add is `targetPdfDoc.addPage(`.

The 4th instance of the CropBox frame mismatch, and the only one that is not a leak — it MISPLACES a
signature. The sign modal's X/Y/W/H go verbatim into the signature annotation's `/Rect`, which PDF
defines in ABSOLUTE user space, and `PdfSigner` bounds-checks them against pdf-lib's `getSize()` (the
MEDIA box). The prefill mapped the drawn rect through the pdf.js viewport's dimensions alone, i.e.
relative to the CROP box. On a page with an inset CropBox the visible signature landed displaced by
exactly the origin; with a deep enough inset, outside the visible area entirely.

Fixed as the redaction fix's sibling: `displayRectToPageUserSpaceRect` is to
`displayRectToUserSpaceRect` what `redactionRectToPageSpace` is to `redactionRectToContent`, and
`_pageGeomForSign` now returns the page's `viewBox` instead of bare `W`/`H` — the viewBox is what
carries the origin, and it is rotation-invariant so it stays correct under `rotation: 0`.
`validateRect` was initially left alone on the reasoning that its MediaBox-from-(0,0) check was
already the right frame for absolute coordinates. **That was wrong and it HAS since changed** — see
the paragraph below; this sentence is kept only because a reader who remembers the original ruling
needs to see it superseded rather than silently gone.

**Two consequences of moving to absolute coordinates, both found by the panel.** `validateRect`
bounded them against `getSize()` — a *dimension*, not an extent — so on a page whose MediaBox origin
is non-zero a legitimate placement near the far edge was refused with `INVALID_RECT`. `PageSize` now
carries an optional origin (defaulting to 0, so every existing caller is unchanged) and both signers
pass `getMediaBox()`. Second, and NOT fixed: the signer signs `assemblePdfBytes()`, and in that
assembly a redaction-bearing page is replaced by a fresh raster page at origin (0,0) sized to the
crop box — so for that one page the absolute prefill is off by the crop origin, where the old
crop-relative number happened to be right. Left alone deliberately: making the prefill depend on
which assembly branch a page will take couples the UI to export internals, which is how this family
of bug breeds. Recorded as a bound rather than papered over. **Superseded — closed by limits row 16; see the
**CLOSED by limits row 16** paragraph below the WS4-E measurement.**

**WS4-E re-examined it on 2026-09-04, and the sentence above UNDERSTATED it — "off by the crop
origin" is true only at rotation 0.** Measured from the real assembly: at `/Rotate 0` the assembled
page is the crop box (300×240) at origin (0,0), so the error is exactly the origin, as recorded. At
`/Rotate 90` it is **240×300 — the dimensions SWAP**, because `rasterizePageWithRedactions` bakes
the rotation into the pixels and adds a page carrying no `/Rotate` of its own
(`exportPipeline.ts:511-512` renders the rotated viewport, `:559` adds the page from its pixel size). `_pageGeomForSign` reports the unswapped `viewBox` and lets the
caller apply `totalRot`, so the two mappings differ in SHAPE and no origin translation can reconcile
them. A bound stated smaller than it is, is the thing that stops the next person looking.

**Still refused, and now for a measured reason rather than a stylistic one.** The correct frame for
a redacted page is `displayRectToUserSpaceRect(rect, w_eff, h_eff, 0)`, which is easy — *until the
page is also cropped*, where the assembled dimensions are the crop WINDOW derived from
`convertToViewportPoint` and `Math.round` at `SCALE = 2` inside the rasteriser. Reproducing that at
sign time means replicating the rasteriser's pixel rounding in the UI path, and NOT reproducing it
buys a fix that is right for redacted-uncropped and wrong for redacted-cropped — a
combination-dependent failure, strictly worse than one uniform bound. Guard:
`tests/browser/sign-assembled-frame.browser.test.ts` (2), which pins the assembled FRAME rather than
a fix, so a future attempt starts from the measurement instead of from this prose.

**CLOSED by limits row 16 (2026-09-26, C9) — by reading the box, not reproducing the rounding.** The objection
above was to REPRODUCING the rasteriser's rounding in the UI. The ruling was to read the box instead: on a page
`pageIsRasterised` (exportPipeline — the one predicate the assembly, `downloadPage` and the prefill all ask)
`onSignRectPicked` calls `ExportService.assembledPageBox(i)`, which assembles THAT PAGE ALONE through the same
`_assemblePdfDoc` and reads its box, then maps the drawn rect onto it PROPORTIONALLY from the window the page shows
(`displayRectOntoBox` — the crop window via `contentRectToDisplay` when cropped, gated like the export, else the whole
rotated view). Proportional absorbs the rounding, so cropped and uncropped get the same treatment. Every other page
keeps the exact absolute mapping. An assembly failure leaves the fields and reopens the modal; pressing Sign runs the
same assembly and reports it. **One page, not `assemblePdfBytes()`**: the first version read the whole assembled
document, which rasterises every redaction-bearing page and saves — measured at load 31, 0.5–1.8 s per raster page
warm (13 s cold) plus 7 s to save ten of them — and runs `cleanEmptyTextElements`, a model mutation a sign pick has
no business making. A page's frame depends only on that page, so the one-page assembly is the same box. The one side
effect left is the one any assembly has: a form value that cannot be applied still raises `toast.formValueDropped`.
Guards: 6 cases in `tests/core/signRectPrefill.test.ts` (whose harness rejects any `assemblePdfBytes` call) and
`tests/browser/sign-assembled-prefill.browser.test.ts` (7), whose oracle assumes no frame — a green square drawn
over, the REAL `assemblePdfBytes()` rendered through a real `ExportService`, green sampled at five points inside the
prefilled `/Rect` — at /Rotate 0/90/180/270 with an inset CropBox, user rotation 90, and a #G23 crop, plus a
copied-page control; its `cleanEmptyTextElements` throws until the oracle's own assembly runs. Sabotage, re-measured
on the reworked harness: the old mapping forced → the 6 raster cases in Chrome and 5 in jsdom; the crop window ignored
→ exactly the crop case in each; `assembledPageBox` returning the SOURCE page's box → the 6 raster cases, control
green; the prefill calling `assemblePdfBytes()` first → the 6 raster cases in Chrome and 4 in jsdom (the failure case
stays green — its fields are untouched either way). Cost: one single-page assembly per pick, on redaction-bearing
pages only.

**Do not cite a count here** — it has been wrong at three surfaces simultaneously. Enumerate the instances from this section instead (`pdfElementRenderer`'s `cropOriginX/Y`, the OCR burn, the redaction text
filter, this, and the flow-export LAYOUT closed as C22 on 2026-09-02) — so when touching anything that
converts between what is DRAWN and what is STORED, `grep -rn "cropOrigin\|viewBox\[0\]\|cropOriginX" src/`
first and assume the frame is wrong until checked.

Guards: `tests/utils/signRectPageSpace.test.ts` (8 — 5 pure mapping cases with a non-square crop and
an asymmetric origin on both axes, plus 3 for the `validateRect` origin below) and, since
2026-09-02, `tests/core/signRectPrefill.test.ts` (7 — the WIRING).
Sabotage-verified: dropping the origin term fails 4 of the 5 mapping cases — the survivor being the zero-origin
case where both mappings agree by construction, which is exactly why this shipped undetected.

**The wiring was UNCERTIFIED-BY-EXECUTION until 2026-09-02 and no longer is.** The mapping had only
ever been pinned as a pure function, so reverting the fix's *effect* in `onSignRectPicked` — its
only production caller — left the whole jsdom suite green; the sole test touching that path stubs
the method with `vi.fn()`. The harness that was said not to exist turned out not to need building:
`src/core/pdfTurboApp.ts` **imports cleanly under jsdom**, so
`Object.create(PDFTurboApp.prototype)` plus own-property stubs shadowing `setMode` and
`_reopenSignModal` drives the real method and the real `_pageGeomForSign`. **Check whether the
untouched code can be driven before reshaping it for testability** — the plan's fallback was to
extract a seam, and that would have been the worse trade. One trap: `ui` is a prototype GETTER, so
it needs `Object.defineProperty`, not assignment. Sabotage-verified three ways, each landing
exactly where predicted: the crop-relative mapper fails only the origin case; dropping
`page.rotation` from `totalRot` fails only the rotation-composition case; returning
`[0, 0, vp.width, vp.height]` fails the `_pageGeomForSign` contract case *and* the origin case.

**`_pageGeomForSign`'s `rotation: 0` is pinned as a CONTRACT, not as a call.** It reads only
`vp.viewBox`, and pdf.js stores `viewBox` verbatim whatever the rotation — so no input makes
`rotation: 0` change today's result, and an assertion on the call arguments alone would be a guard
that fails on a harmless edit and passes on a harmful one (the "two guards that could not fail"
shape this repo has already had to correct once). What the caller actually depends on is that the
returned box is the UNROTATED content box *carrying its origin*, and that is what is asserted, at
`/Rotate 90` where both wrong answers are distinguishable. The call-argument assertion is kept
beside it and **labelled in the test as intent documentation** — it exists so that a refactor to
`vp.width`/`vp.height`, the only way `rotation: 0` ever becomes load-bearing, has to change that
line deliberately.

### E-signing (Sprint 4, 2026-06-15)

`src/signing/*` produces a single visible PKCS#12/CMS signature
via **node-forge@1.3.1** [2026-09-28: `package.json` pins `^1.4.0`, and has since the first commit] (dynamically imported; pure-JS, runs in jsdom AND browser). `PdfSigner.sign`
reserves a fixed `/Contents` hex slot + `/ByteRange`, serialises without object streams, then splices the
detached CMS. **"Sign WITH edits"**: `signingHandler.ts` signs `app.assemblePdfBytes()` (the shared
downloadPDF assembly — edits/annotations/redactions/form-fills baked in — exposed on `exportService`),
NOT the raw source. Encryption is intentionally NOT applied to the assembled bytes (the signer needs a
plain stream for its ByteRange; encrypt-then-sign is out of v1 scope). Output is **download-only**
(`<base>-signed.pdf`) — NO auto-resign (rejected as a security/trust anti-pattern: re-editing a signed
PDF must visibly invalidate the signature, never silently re-sign). **Re-signing an already-signed PDF
is refused (S3, 2026-06-15)**: the exported `isPdfSigned(bytes)` detects a `/ByteRange` + sig SubFilter and
`PdfSigner.preflight` throws a typed `ALREADY_SIGNED` SignError (pdf-lib's full re-save would otherwise
corrupt the existing ByteRange with an opaque crash). `.p12` bytes are zeroed after signing;
the password field is cleared on close. `buildSignOptions` is the pure 1-based-UI→0-based-signer map.
**S-FLOW cert-free pre-flight (2026-06-15)**: `PdfSigner.preflight(bytes, page, rect)` runs the
cert-INDEPENDENT checks (already-signed + page-index + rect-bounds) and is called by `pdfTurboApp.signPdf` [2026-09-28: now by `SigningHandler.runSignFlow`, since `dfbe86b`]
**BEFORE** any certificate is generated/loaded — so an off-page rect or already-signed PDF shows the error
and bails WITHOUT downloading an orphan generated `.p12`/`.pem` (the prior bug). `sign()` reuses `preflight`
internally (DRY; standalone API stays safe). The generate-mode password is **no longer wiped in the
`finally`** (only on `closeSignModal`) — wiping it made a naive retry silently bail at the `if (!genPw)`
guard while a stale error stayed on screen. `signingHandler.sign(form, preassembled?)` accepts the
already-assembled bytes so the app preflights and signs the SAME bytes (one assembly). Guard:
`tests/signing/preflight.test.ts`.
Wired: `signBtn` + `signModal`; `SignErrorCode`→`sign.error.<CODE>` i18n.
**Generate-a-cert-on-the-spot (2026-06-15)**: the sign modal has a source toggle —
"Use my .p12" vs "Generate one now". `src/signing/certGen.ts` `generateSelfSignedP12`
(node-forge, lazy) makes an RSA-2048 key + self-signed X.509 (full subject: CN/O/email/C)
packaged as PKCS#12, feeds the SAME `PdfSigner` (no signer change — it only wants
`{p12,passphrase}`), and the app downloads the `.p12` + `.pem` for reuse/sharing. Self-signed
⇒ readers show "validity unknown" until trusted (surfaced via `modal.sign.genTrustNote`).
Guards: `tests/signing/certGen.test.ts` (round-trip: generated p12 actually signs) +
`tests/browser/cert-gen.browser.test.ts` (real-Chrome keygen+sign).
**NOT yet supported**: TSA timestamp, LTV/DSS, multi-signature rounds. A CA-trusted signature needs no
code: it comes from a CA-issued `.p12` on the "Use my .p12" path; only a GENERATED cert is self-signed.
PAdES-B-B exists since limits row 24 — see § "PAdES-B-B, and the ByteRange hole that failed every signature".

### PAdES-B-B, and the ByteRange hole that failed every signature — limits row 24 (2026-09-27)

`SignOptions.profile: 'pades'` writes `ETSI.CAdES.detached`; the default stays `adbe.pkcs7.detached` until the
developer's Adobe Reader check (limits row 29 — both samples are in `var/claude/acrobat-pack/row24/`). node-forge's
`_attributeToAsn1` encodes only contentType, messageDigest and signingTime, so `cms.ts` `buildPadesDer` builds the
SignedData from forge's ASN.1 primitives: signed attributes contentType, messageDigest and ESS signing-certificate-v2
(RFC 5035: the SHA-256 of the embedded certificate, `hashAlgorithm` OMITTED because DER forbids encoding its DEFAULT,
and `issuerSerial` with the issuer as `[4] EXPLICIT` Name), DER-sorted, and NO signingTime (ETSI EN 319 142-1 — the
claimed time is `/M`, which the dictionary already carries). Issuer and serial are copied from the certificate's own
ASN.1, never rebuilt. `cmsVerify` and forge's `messageFromAsn1` still parse the result.

**Measuring it found a defect in EVERY signature this app had ever produced.** `computeByteRange` covered the
`/Contents` string's `<` and `>`, so the hole was the hex digits only. pyHanko sizes the hole as the whole string
(`len(contents) * 2 + 2`) and judged both profiles "does not cover the entire file" → INVALID, while calling them
cryptographically sound [Verified: its `evaluate_signature_coverage` and the measured verdict]. That the spec and
other signers leave the delimiters out is [Unverified: recalled, not read here]. Fixed at the origin, so the default
profile, PAdES and the unwired incremental signer all changed; both profiles now read `ENTIRE_FILE`, bottom line valid,
and an incremental double-sign reads signature 1 `ENTIRE_REVISION` (form filling — the second field) and signature 2
`ENTIRE_FILE`, both valid [Verified 2026-09-27, one probe run, not a committed test]. The old hole signed MORE bytes
than required, never fewer, so it was a conformance failure, not a tamper gap; `SECURITY.md` discloses it for files
already signed. [Unverified: whether Adobe Reader accepted the old hole — no Reader here; row 29 checks the new one.]

Evidence, and what each piece can see. `tests/signing/pades.test.ts` (6) reads the structure back from the signed
bytes. `tests/tools/padesPyhanko.test.ts` runs pyHanko and `openssl cms -verify -cades` and is inert unless
`PYHANKO_PYTHON` names a Python with pyHanko (not in CI; its header has the two-line setup). `-cades` matters: plain
`openssl cms -verify` never reads the ESS attribute — the default profile fails `-cades` with "missing signing
certificate attribute", which is the proof the check exists. `cmsVerify` reads only messageDigest and the RSA
signature, so it is not a check of the ESS half. A real-browser case in `signing.browser.test.ts` covers the bundle.
Sabotage, predicted first, each landed and restored with `cmp`: ESS hash over wrong bytes → the ESS case + the gated
test; signingTime kept → the attribute case only (neither validator checks the PAdES baseline); attributes unsorted
AND reversed → the attribute case only (openssl and pyHanko both accept an unsorted SET — only the byte pin sees it);
explicit `hashAlgorithm` → the ESS case only; `[4]` implicit → the ESS case + the gated test (pyHanko throws matching
issuer and serial); the old hole → 2 jsdom + the browser case + the gated test; SubFilter ignoring the profile → the
SubFilter case only; the profile not reaching the CMS → 2 + the gated test (`-cades`). Removing the sort alone is
EQUIVALENT: the builder already lists the attributes in DER order, so no byte changes — keeping the sort with the
ESS attribute listed first stays green, which is what shows the sort works.

**TSA, probed and not wired.** 12 public RFC 3161 servers, POSTed a real `application/timestamp-query` with the
production `Origin` [Verified 2026-09-27, curl]: 9 answered with a token and NO `Access-Control-Allow-Origin`, so a
browser cannot read the reply; two did not answer. The tenth, the only one with CORS, `rfc3161.ai.moda` — an aggregator proxy, not a CA's TSA —
echoes ANY origin. 8 of the 12 are `http://`, which an `https` page may not fetch anyway [Inferred: mixed-content
policy, not run in a browser]. Wiring any TSA needs two rulings: the CSP `connect-src 'self'` and a document HASH
leaving the device (the nothing-uploaded promise). LTV needs revocation fetches — the same two.


### Approval caption + guided Signers panel (F-D D1/D2)

> **[Re-checked 2026-09-28]** the `locales/ar.json` and `placementManager.ts` line citations below have drifted — cite the key (`mentionDefault`) and the method (`commitPlacement`).

A drawn `SignatureElement` carries an OPTIONAL
caption (`signer`/`mention` default "Lu et approuvé"/`signedDate`); `buildSignatureCaptionLines` (pure) is
shared by the DOM render and the export bake (`pdfElementRenderer`) — caption ABSENT ⇒ byte-identical, and
`toJSON` omits the keys unset (NO schema bump). D2 = `src/ui/signersPanel.ts` (👥 `signersBtn`, gated
`VITE_FEATURE_SIGNERS`; mirrors batesPanel — own focus-trap/Esc/backdrop, no preview) is a **guided wizard**:
fill name+mention(+date) → `buildSignerCaption` → arms `pendingSignatureCaption` → `setMode('addSignature')`
opens the pad → `commitPlacement` (placementManager.ts:196) reads/applies `{...caption}` then CLEARS it.
Repeat per signer — the PAGE is the roster (no separate list). **Non-obvious leak guard:** the plain ✍ click
(toolBinder) + `S` shortcut (keyboardBinder) + pad-cancel (`SignatureManager.closeModal`) ALL clear
`pendingCaption` first, so a plain signature can NEVER inherit a panel caption (provable invariant; guards in
`tests/ui/signersPanel.test.ts`, `placementSignatureCaption.test.ts`, `keyboardBinder.test.ts`,
`signatureManager.test.ts`). **Remote round-robin**: each signer draws → exports (D1 bakes the sig into page
content) → sends to the next, who opens it and adds theirs; the 🔏 crypto seal applies ONCE, LAST (re-export
after sealing invalidates it — `ALREADY_SIGNED`). Visible sigs = approval-stamp grade, NOT tamper-evident.
**D3 spike (2026-06-18) — true N-party CRYPTO co-signing is REACHABLE, NOT a structural ceiling.**
`src/signing/incrementalSigner.ts` (EXPERIMENTAL, **unwired**, `ALREADY_SIGNED` guard untouched) proves a 2nd
independent CMS signature can be appended via a hand-built **append-only incremental update**: read structure
with pdf-lib (never re-save) → append new sig dict + field + new-revision page/AcroForm + classic incremental
`xref`/`trailer << … /Prev >>` → reuse `byteRange.ts` primitives + `buildDetachedCms`. The prior "ceiling" was
mis-attributed: pdf-lib's `save()` renumbers objects (kills sig-1), but that's the *tool's serialiser*, not the
PDF format. Sig-1 survives because its `/ByteRange` ends at the original EOF (untouched by the append). Guarded
by `tests/signing/incrementalSigner.test.ts` (append-only prefix byte-identical, BOTH `/ByteRange` digests
validate, pdf-lib re-parses). **Caveat:** proves ByteRange-digest correctness + append-only preservation;
Adobe/DSS acceptance is UNVERIFIED in-repo (no Acrobat) → keep `ALREADY_SIGNED` until manual verification.
**In-repo hardening H1–H4 DONE (2026-06-18, still unwired, `ALREADY_SIGNED` untouched):** **H1** NEW
`src/signing/cmsVerify.ts` `verifyAllSignatures(bytes)` cryptographically re-checks EVERY embedded sig via
node-forge `rawCapture` (no brittle `p7.verify()`) — messageDigest authAttr === SHA-256(ByteRange span) AND
the authAttrs RSA-verify against the **CMS-embedded** signer cert (`p7.certificates[0]`); the auth-attrs are
re-DER'd wrapped in a **UNIVERSAL SET (0x31)**, NOT the `[0]` IMPLICIT tag (the classic forge-verify trap) —
a tamper test (flip a covered byte → `digestMatches:false`) proves it's real, not rubber-stamp. Kept OUT of
the `index.ts` barrel (mirrors `incrementalSigner`). **H2** `addIncrementalSignature` now preflights via the
shipped `validatePageIndex`/`validateRect` (typed `INVALID_PAGE`/`INVALID_RECT`) but deliberately does NOT
call `isPdfSigned` (it MUST accept an already-signed PDF — that's the point). **H3** exported
`assertClassicXref(bytes, startxrefOffset)` refuses xref-STREAM / hybrid inputs (peek at the offset, require
the literal `xref` keyword) with NEW typed `SignError('UNSUPPORTED_XREF')` (added to the union + 3 locales,
ar reviewed 2026-07-30; `signingHandler` maps `sign.error.${code}` dynamically so it's additive). **H4** coverage:
two DISTINCT certs (each sig verifies against its own embedded cert), triple-sign N>2 (3 ByteRanges valid,
append-only prefix preserved), multi-page. `beforeAll` gets 60s (two RSA-2048 keygens; hookTimeout ≠ the 30s
testTimeout). Classic-xref + ASCII-object only remains the documented input contract. **Approval model B (D1/D2) stays the default**
for the no-backend tool; D3 is now an opt-in productionisation candidate. Editable free-text caption date = v1b.
**Arabic `modal.signers.mentionDefault`/labels: accepted by the 2026-09-13 WS3 closure ruling** — see
§ i18n. The key has an Arabic value (`locales/ar.json:442`) and predates the 2026-07-30 sign-off; whether
that pass covered it was never provable, and the ruling closed the question rather than re-reading it. Note the prose said `mentionDefault` for two years — the actual key
is `modal.signers.mentionDefault`, which is why a grep for the short name finds only `signersPanel.ts`.
