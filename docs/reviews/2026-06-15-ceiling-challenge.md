# Ceiling Challenge — can the documented "blocked" items actually be broken? (2026-06-15)

User ask: don't accept the ceilings on faith — explore other libraries / custom code, challenge each.
Method: read library source where we have it; web-verify ecosystem claims. Evidence graded inline.

Verdict legend: **BREAKABLE-NOW** (known lib, modest effort) · **BREAKABLE-CUSTOM** (we write it, real effort)
· **REAL CEILING** (structural / not worth it client-side).

## Crypto & signing

### 1. `/R 6` hardened AES-256 — **BREAKABLE-CUSTOM** (was filed as ceiling)
- The "ceiling" was only *"unreachable with @cantoo/pdf-lib's current code"* — NOT a platform limit.
  `initializeV5` hardcodes `R = 5` [Verified: read `node_modules/@cantoo/pdf-lib/src/core/security/PDFSecurity.ts`].
- R6's key derivation is Adobe **Algorithm 2.B** (ISO 32000-2): an iterated SHA-256/384/512 hash chain over
  password+salt(+udata), plus a `/Perms` 16-byte AES-ECB block. It is pure hashing — implementable on WebCrypto
  in ~60–100 lines [Inferred: Algorithm 2.B is well-specified hash-only KDF; iText/qpdf both implement it].
- We HAVE the library source vendored; adding an `initializeV6` (R=6, V=5, same AESV3 CFM, Algorithm 2.B key +
  `/Perms`) is a contained fork/patch. Risk: maintaining a patched dep across upgrades.
- **Challenge to the ceiling:** stands corrected — R6 is reachable; the real question is effort vs. payoff.
  Payoff is moderate (R5→R6 hardens password-hash only; AES-256 cipher identical). Recommend only if a
  compliance requirement names R6/PDF-2.0.

### 2. PAdES (`ETSI.CAdES.detached`) — **BREAKABLE-NOW** (was filed as a node-forge ceiling)
- The block is a **node-forge** limitation (`pkcs7._attributeToAsn1` can't emit the ESS `signing-certificate-v2`
  signed attribute), NOT a browser/platform one [Verified: prior session note + forge source behavior].
- **PKI.js** (PeculiarVentures) is a pure-JS, WebCrypto CMS/CAdES/TSP library, no plugins, runs in-browser
  [Verified: github.com/PeculiarVentures/PKI.js description]. Its `SignedData` supports arbitrary signed
  attributes, so the ESS `signing-certificate-v2` attribute PAdES-BES needs is expressible [Inferred: PKI.js
  exposes generic signed-attribute construction; a 1-day spike would confirm the exact ESS helper].
- Same ByteRange/placeholder plumbing we already have; only the CMS producer swaps (forge → PKI.js) for the
  PAdES path. `node-signpdf` is the Node reference for the identical placeholder approach.
- **Challenge:** the PAdES ceiling is a *library choice*, not impossibility. Reachable client-side with PKI.js.

### 3. TSA timestamp (RFC 3161) + LTV/DSS — **BREAKABLE-NOW but NOT offline**
- PKI.js implements TSP (timestamp) requests/responses [Verified: lib description lists TSP]. So a PAdES-T
  (signature + RFC-3161 timestamp token) is buildable.
- **Honest caveat / challenge held:** this REQUIRES a network call to a TSA endpoint — it breaks the app's
  "100% client-side, nothing leaves the browser" guarantee for that one feature. LTV/DSS additionally needs
  CRL/OCSP fetches. Reachable, but it changes the privacy contract — must be an explicit, opt-in feature.

### 4. CA-issued / trusted certs — **REAL CEILING (by definition)**
- "Trusted" means a CA vouches — inherently external to a client-only tool. We can generate/sign; we cannot
  make a reader trust a self-signed cert without the user importing it. Not a code problem. Stands.

## True-edit engine

### 5. In-place Arabic true-edit — **REAL CEILING on cost/benefit, not impossibility**
- Claim: subset CID fonts lack the glyphs for new Arabic text. True for *preserving the original font*.
- **Challenge:** we already embed **Noto Naskh** for the overlay path. We *could* re-embed it and rewrite the
  text run in-stream with substituted CIDs — i.e. a "true edit with font substitution". But that yields the
  SAME visual result as the overlay while adding content-stream-surgery risk. The overlay IS the right answer;
  in-place-*preserving-original-subset-font* is the genuinely impossible part (can't draw un-embedded glyphs).
- Verdict: ceiling stands, but reframed — it's "not worth it", not "can't". [Inferred from our own overlay impl.]

### 6. cm-rotation Path-3 redraw / Type3 fonts — **BREAKABLE-CUSTOM, low payoff**
- Rotated/Type3 in-place edits are doable with more matrix + glyph-proc machinery, but they're rare and the
  overlay fallback already handles them correctly. Low ROI. [Speculative on frequency.]

### 7. Mixed LTR+RTL single-line reorder / tashkeel GPOS — **REAL CEILING (client-side, pragmatic)**
- Full UAX#9 char-level bidi + GPOS mark positioning needs a full shaping/bidi engine (HarfBuzz-class). `bidi-js`
  + HarfBuzz-wasm exist, so not *impossible*, but integrating shaping for edit-in-place is a large, fragile
  effort vs. the word-level bidi we ship. Verdict: ceiling stands for now. [Inferred.]

## DOCX fidelity

### 8. Lattice (ruled) tables — **BREAKABLE-CUSTOM** (borderless stays a ceiling)
- We ALREADY extract vector rules (the underline/strike feature decodes `constructPath` → line bboxes in Word
  space) [Verified: CLAUDE.md Sprint-4 note + code]. Those same horizontal+vertical rules can reconstruct a
  ruled-table grid (cluster x/y rule positions → cells) → docx `Table`. Medium effort, real payoff.
- **Borderless / inferred-structure tables** remain a REAL CEILING (no lines to detect; needs layout ML).

### 9. vector→raster, recursive 3-col XY-cut, exact subset-font faces — **REAL CEILING (pragmatic)**
- Vector graphics→Word shapes is effectively a vector translator (huge). 3-col recursive XY-cut is tractable
  but niche. Exact subset faces need the embedded font program re-mapped — large. All low ROI client-side.

## Rendering

### 10. R1 (pdf.js v6 TextLayer not rotated) — **BREAKABLE-CUSTOM, risky**
- We could stop using pdf.js `TextLayer` for rotated pages and position our own selectable spans via the
  rotated viewport transforms. Doable, but re-implements a pdf.js subsystem and risks selection/search
  regressions. After R2 (edit-text decoupled), impact is selection/Ctrl-F highlight only. Low ROI. Stays P3.

## Bottom line (what's worth actually building)
| Item | Verdict | Route | ROI |
|------|---------|-------|-----|
| PAdES-BES | BREAKABLE-NOW | PKI.js CMS + ESS attr (swap forge on that path) | **High** if compliance wants PAdES |
| Lattice tables → DOCX | BREAKABLE-CUSTOM | reuse vector-rule extraction → grid clustering | **High** |
| R6 AES-256 | BREAKABLE-CUSTOM | patch/fork PDFSecurity: Algorithm 2.B + /Perms | Med (only if R6 mandated) |
| TSA timestamp (PAdES-T) | BREAKABLE-NOW* | PKI.js TSP — *needs network (privacy trade-off)* | Med, opt-in only |
| In-place Arabic / bidi / GPOS | REAL CEILING | overlay already covers it | n/a |
| vector→raster, borderless tables | REAL CEILING | — | n/a |

Sources: PKI.js (github.com/PeculiarVentures/PKI.js), node-signpdf (npmjs.com/package/node-signpdf),
eIDEasy PAdES ETSI.CAdES.detached guide, iText "Unknown encryption type R=6", PDF Association ISO 32000-2.
