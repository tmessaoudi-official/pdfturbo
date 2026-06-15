# OCR & E-Signing — Blockers to "100%"

Read-only research, 2026-06-15. Scope: `src/ocr/*`, `src/handlers/ocrHandler.ts`,
`src/signing/*`, `src/handlers/signingHandler.ts`. Synthetic / structural metrics only.

CLASS legend: **REACHABLE** = fixable client-side with bounded effort; **CEILING** =
structurally hard or impossible in a 100%-client/no-backend PWA. Accuracy/recognition
quality is NON-DETERMINISTIC → marked **evidence-only (NO it.fails)** per the brief.

---

## OCR blockers

| ID | One-line | CLASS | file:line | Root cause | Test env | Confirming-test design |
|----|----------|-------|-----------|------------|----------|------------------------|
| O1 | UI offers 8 languages but only 3 are vendored (eng/fra/ara) | **REACHABLE** | `languages.ts:24-33` (8 langs) vs `scripts/prepare-ocr-assets.mjs:41` `LANGS=['eng','fra','ara']` | `OCR_LANGUAGES` lists deu/spa/ita/por/nld; the asset vendor downloads only 3. Under CSP (`connect-src 'self'`) selecting deu→`/tesseract/lang/deu.traineddata.gz` 404s same-origin → engine load throws. `resolveLanguage` validates against the 8-list, so a "supported" code has no asset. | jsdom (pure) | Assert the vendored set ⊇ advertised set: parse `LANGS` from the script (or a shared constant) and assert `OCR_LANGUAGES.every(l => vendored.has(l.code))`. Currently FAILS (5 langs advertised, unvendored). Fix = single source of truth or extend `LANGS`. |
| O2 | `ocrWordToTextElement` ignores word rotation/skew | **REACHABLE (partial) / CEILING (full)** | `ocrHandler.ts:68-81` | Maps only axis-aligned `bbox/scale` → x,y,w,h. Tesseract exposes per-word baseline/orientation but the `OcrWord`/`OcrBBox` shape (`ocrTypes.ts:20-35`) carries none; rotated/skewed scanned text becomes an upright box (wrong w/h, no angle). | jsdom (pure) | `it.fails`: feed a word whose bbox is tall+narrow vs the visual baseline; assert the element has a `rotation`/angle field — there is none → structurally absent. Reachable part: propagate tesseract `baseline`. Full deskew of the source raster = CEILING (no preprocessing pipeline). |
| O3 | Render scale hardcoded `RENDER_SCALE = 2` (no DPI adaptivity) | **REACHABLE** | `ocrHandler.ts:85` | Fixed 2× regardless of page size / source DPI. Small-font or high-res scans need ≥3–4×; the constant is private static, not configurable. Affects accuracy (evidence-only) AND a deterministic surface: huge pages at 2× can exceed canvas max dimension. | jsdom (geometry) / browser (canvas cap) | jsdom `it.fails`: no public seam to override scale (assert a param exists on `run()` / constructor — it does not). Browser evidence-only: oversize page → canvas allocation. |
| O4 | No image preprocessing (binarization / deskew / denoise) | **CEILING** | absent — `ocrHandler.ts:102-110` renders raw page → canvas → engine | Page is rasterized and handed straight to tesseract; no Otsu threshold, contrast, or deskew. tesseract.js has only its internal adaptive thresholding. | n/a (accuracy) | **evidence-only** — quality, non-deterministic. Document as a known limitation; no `it.fails`. |
| O5 | No multi-column / reading-order handling | **CEILING (order) / REACHABLE (PSM)** | `ocrHandler.ts:113-123`; mapper `tesseractMapper.ts:60-73` flattens blocks in raw order | Words added in tesseract's block traversal order; no XY-cut/column detection (unlike the DOCX `detectColumnSplit`). `createWorker` uses default PSM (`ocrEngine.ts:158`) — no PSM/auto-segmentation control exposed. | jsdom (PSM seam) | Reachable: `it.fails` asserting a PSM option is forwardable through `OcrOptions` — none exists. Reading-order reconstruction across columns = CEILING for this layer. |
| O6 | No confidence thresholding — every non-empty word inserted | **REACHABLE** | `ocrHandler.ts:121-123` filters only `text.trim().length>0`; `confidence` carried (`ocrTypes.ts:33`) but unused | Low-confidence garbage words become real TextElements. `clampConfidence` computes a value nobody gates on. | jsdom (pure) | `it.fails`: build an `OcrResult` with a conf=5 word + conf=95 word, run the (extracted) filter, assert only high-conf survives — currently both pass. Fix = `minConfidence` option (deterministic). |
| O7 | No detection of already-digital text (double-layer risk) | **REACHABLE** | `ocrHandler.ts:94-110` always rasterizes + OCRs the current page | OCR runs unconditionally even on a born-digital page that already has a selectable text layer → duplicate overlapping TextElements. No `page.getTextContent()` short-circuit. | jsdom (logic, mockable) / browser (real text layer) | `it.fails`: a guard `shouldOcr(page)` that returns false when source text-item count > 0 does not exist; assert its presence. Reachable: add the guard. |
| O8 | Word geometry: no Y-flip is correct ONLY because both spaces are top-left | INFO (not a blocker) | `ocrHandler.ts:64-66,68-81` | Documented invariant; deterministic and correct. Listed so it is not mis-flagged. | jsdom | Regression guard: `ocrWordToTextElement({bbox:{x0:10,y0:20,x1:30,y1:40}}, scale:2,...)` ⇒ x=5,y=10,w=10,h=10. Pin it. |
| O9 | Min element floor `Math.max(8,…)` / `fontSize≥6` distorts tiny words | **REACHABLE** | `ocrHandler.ts:71-76` | Width/height floored to 8pt and fontSize to 6pt; sub-floor words get oversized boxes (geometry drift), deterministic. | jsdom (pure) | `it.fails`: a 2pt-tall word → assert height==2/scale; actual clamps to 8 → fails. Decide if floor is intended (Chesterton). |

**OCR deterministic, testable, highest-value:** O1 (advertised≠vendored = broken feature
for 5 languages), O6 (confidence gate), O7 (digital-text guard).

---

## E-signing blockers

| ID | One-line | CLASS | file:line | Root cause | Test env | Confirming-test design |
|----|----------|-------|-----------|------------|----------|------------------------|
| S1 | No TSA timestamp (no signature-time-stamp token) | **CEILING** (needs network TSA → breaks 100%-client) | `cms.ts:82-92` auth attrs = contentType/messageDigest/signingTime only; `pdfSigner.ts:16` SCOPE note | RFC 3161 TSA requires an HTTP round-trip to a time authority; the app is offline/no-backend. `signingTime` is a self-asserted clock value, not a trusted token. | jsdom | Sign synthetic PDF, ASCII-scan output: assert NO `/TS`, no `1.2.840.113549.1.9.16.2.14` (id-aa-timeStampToken) in unauthenticated attrs. Confirms absence. |
| S2 | No LTV / DSS (no validation material embedded) | **CEILING** (OCSP/CRL fetch needs network) | whole `pdfSigner.ts`; no `/DSS` written | No `/DSS` catalog entry, no VRI, no embedded OCSP/CRL. Long-Term Validation needs revocation responses fetched online. | jsdom | Sign, assert output has NO `/DSS` and catalog has no `/DSS` key. |
| S3 | Multi-signature: signing an already-signed PDF breaks the first signature | **CEILING (correct multi-sig) / REACHABLE (refuse)** | `pdfSigner.ts:76` `doc.save({useObjectStreams:false})` does a FULL rewrite, not an incremental update | A second sign re-serializes the whole file → the first signature's ByteRange no longer matches its covered bytes → first sig invalid. Proper PAdES multi-sig needs incremental-update appends (pdf-lib full-save can't). | jsdom | `it.fails`: sign(pdf)→A, sign(A)→B; recompute SHA-256 over A's first ByteRange span within B's bytes and assert it ≠ A's embedded digest → first sig broken. Reachable mitigation: detect existing `/Sig` (`SigFlags`) and refuse/warn. |
| S4 | Encrypt-then-sign unsupported | **REACHABLE (documented) / CEILING (encrypt+sign together)** | handler `signingHandler.ts:70` signs `assemblePdfBytes()`; CLAUDE.md states encryption NOT applied to assembled bytes | Signer needs a plain stream for the ByteRange; encryption is dropped at sign time. Combining requires sign-then-encrypt with crypt filters left out of the ByteRange — not implemented. | jsdom | Assert: pass a doc that would be encrypted; signed output is unencrypted (no `/Encrypt`). Confirms the documented gap. |
| S5 | Algorithm support: SHA-256 + RSA only (no SHA-384/512, no ECDSA) | **REACHABLE** | `cms.ts:85` `digestAlgorithm: f.pki.oids.sha256` hardcoded; no curve/digest branch | A P-256/ECDSA .p12 or a policy requiring SHA-384 cannot be honored; digest is a constant, signer alg is whatever forge infers from an RSA key. | jsdom | `it.fails`: load an ECDSA-key .p12 (forge `pki.ec`?) → assert sign succeeds or that a `digestAlgorithm` option exists; neither does. At minimum assert SHA-256 OID is the only digest emitted. |
| S6 | No PAdES B-B/B-T/B-LT/B-LTA conformance (only basic CMS/`adbe.pkcs7.detached`) | **CEILING (B-LT/LTA) / REACHABLE (B-B ESS attrs)** | `sigDict` SubFilter `adbe.pkcs7.detached` (`pdfSigner.ts:160`); auth attrs lack `signingCertificateV2` | Uses legacy ISO 32000-1 PKCS#7, not `ETSI.CAdES.detached`. Missing `id-aa-signingCertificateV2` (ESS) needed for PAdES B-B; B-T needs S1, B-LT/LTA need S1+S2. | jsdom | Assert SubFilter == `adbe.pkcs7.detached` (NOT `ETSI.CAdES.detached`) and no `1.2.840.113549.1.9.16.2.47` (signingCertV2) attr. Reachable: add ESS attr + CAdES SubFilter. |
| S7 | Signature appearance is drawn content, not a stamped `/AP` normal appearance stream | **REACHABLE** | `pdfSigner.ts:94-138` `_drawAppearance` paints into the PAGE content stream; widget has Rect+V but no `/AP` | Appearance lives in page content, not the widget's appearance dict. Some validators render the widget `/AP`, not page content → blank/duplicated visual; also content drawn before sig field is part of signed bytes (OK) but not portable. | jsdom | Assert the Widget dict has NO `/AP` key (appearance not in an XObject). Reachable: build an `/AP /N` form XObject. |
| S8 | Single fixed 8 KiB `/Contents` slot — large chains overflow | **REACHABLE** | `pdfSigner.ts:44-45` `SIGNATURE_CAPACITY_BYTES=8192`; `byteRange.ts:170-178` throws on overflow | A long cert chain / RSA-4096 + many intermediates can exceed 8 KiB DER → `SIGN_FAILED`. Capacity is a constant, not sized to the CMS. | jsdom | `it.fails`: build a P12 with several large intermediates so CMS DER > 8192 B; assert sign throws the overflow Error. Reachable: size slot to `cms.length` rounded up. |
| S9 | Cert chain embedding trusts P12 bag order (`chain[0]` = leaf) | **REACHABLE** | `p12.ts:108-109` `chain = certs.map(...); leaf = chain[0]` | Assumes first certBag is the leaf; a P12 ordered issuer-first embeds a wrong leaf → CN/appearance + signer cert mismatch. No leaf-detection (issuer≠subject / matches key). | jsdom | `it.fails`: craft a P12 with CA cert first, leaf second; assert resolved `commonName`==leaf CN → currently picks CA. Reachable: select leaf by key match / non-CA. |
| S10 | No revocation (OCSP/CRL) checking or embedding | **CEILING** | absent | Needs online responders; offline PWA cannot. Coupled to S2. | jsdom | Assert no OCSP/CRL OIDs in output. evidence-of-absence only. |
| S11 | `/M` and `signingTime` use the local machine clock (spoofable) | INFO / **CEILING** | `pdfSigner.ts:69` `new Date()`; `appearance.ts:83-98` | Self-asserted time; only a TSA (S1) fixes it. | jsdom | Note only; covered by S1. |
| S12 | ByteRange sentinel caps file at ~9.9 GB; multi-`/Contents` hex slot picks FIRST | **REACHABLE (edge)** | `byteRange.ts:112` `BYTE_RANGE_SENTINEL=9999999999`; `findContentsSlot:60-94` returns first hex `/Contents` | `findContentsSlot` accepts the FIRST `/Contents <...>` hex value; a page content stream stored as a hex string (rare but legal) before the sig dict would be mis-selected. | jsdom | `it.fails`: craft bytes with a decoy `/Contents <abcd>` (short hex) before the real 16384-hex slot; assert `findContentsSlot` returns the real slot — current code returns the decoy. |

**Signing deterministic, testable, highest-value:** S3 (multi-sig silently breaks the
first signature — the most damaging correct-looking failure), S8 (capacity overflow →
hard fail on real-world chains), S9 (wrong-leaf selection → semantically wrong signer).

---

## Highest-ROI reachable

1. **O1 — advertised-vs-vendored language parity** (`languages.ts:24` / `prepare-ocr-assets.mjs:41`).
   5 of 8 offered OCR languages have no asset and fail at runtime under the CSP. One
   shared-constant test catches it; fix is a single source of truth. Pure jsdom, zero
   non-determinism, user-facing breakage today.
2. **S3 — refuse/flag re-signing an already-signed PDF** (`pdfSigner.ts:76`). A full
   re-save silently invalidates the prior signature; detecting `/Sig`/`SigFlags` and
   warning is cheap, deterministic, and prevents a trust-destroying silent failure.
   (True incremental-update multi-sig is CEILING for pdf-lib full-save.)
3. **S8 + S9 — size the `/Contents` slot to the real CMS and select the leaf by key/CA
   test** (`pdfSigner.ts:44`, `p12.ts:108`). Both are deterministic correctness bugs that
   bite real (non-self-signed) certificates the integration test never exercises.

CEILING items to DOCUMENT (not fixable in a no-backend PWA): S1/S2/S10/S11 (TSA, LTV/DSS,
revocation, trusted time — all require network/authority), the LTV tiers of S6, full O4
deskew/preprocessing and O5 cross-column reading order.
