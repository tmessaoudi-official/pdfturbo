# Adobe / DSS verification kit — two-mode multi-sign (D3)

**Purpose.** Confirm, in a real third-party validator (Adobe Acrobat/Reader and/or
an EU DSS validator), that the UNWIRED `signMultiple` orchestrator produces a PDF
whose **multiple signatures all validate and coexist** (the append-only incremental
update does not invalidate earlier signatures). **This manual check is the only gate
before wiring either mode into the app UI.**

Generated: 2026-06-18. Source code under test: `src/signing/{multiSign,incrementalSigner,cmsVerify,pdfSigner}.ts`
(all EXPERIMENTAL / out of the `index.ts` barrel / no app importer).

---

## What's in this folder

| File | What it is |
|------|-----------|
| `sample-separate.pdf` | **2 signatures, 2 DISTINCT certs.** Page 1: Alice Alpha (signer 1) + Bob Beta (signer 2). True multi-party signing. |
| `sample-shared.pdf` | **3 signatures, ONE cert.** Page 1 ×2 + page 2 ×1, all "Alice Alpha" — one identity signing 3 times (org seal / review rounds / revision locks). |
| `cert-alpha.pem`, `cert-beta.pem` | Public certs. **Import these to flip "validity unknown" → "valid"** (see step 4). |
| `cert-alpha.p12`, `cert-beta.p12` | PKCS#12 containers. Passphrase: **`pdfturbo-verify`** (throwaway test certs). |
| `verify-separate.json`, `verify-shared.json` | In-repo H1 `verifyAllSignatures` output — the cryptographic ground truth Acrobat must echo. |
| `generate-samples.test.ts` + `vitest.gen.config.ts` | Reproducible generator (see bottom). |

---

## Ground truth already established in-repo (two independent verifiers agree)

You are NOT verifying from scratch — two independent checks already PASS; Adobe is the
third, decisive confirmation.

### 1. In-repo H1 — `verifyAllSignatures` (node-forge `rawCapture`, our own code)

Every signature: `digestMatches: true` AND `signatureValid: true`.

- `sample-separate.pdf` → CNs `Alice Alpha`, `Bob Beta` (2 distinct, each valid under its OWN embedded cert).
- `sample-shared.pdf`   → CN `Alice Alpha` ×3 (same identity, all valid).

### 2. `pdfsig` (poppler-utils — a fully INDEPENDENT third-party validator)

```
$ pdfsig docs/reviews/adobe-verify-2026-06-18/sample-separate.pdf
Signature #1: CN Alice Alpha — adbe.pkcs7.detached, SHA-256
  - Signed Ranges: [0 - 2902], [19286 - 19868]   - Not total document signed
  - Signature Validation: Signature is Valid.
  - Certificate Validation: Certificate issuer is unknown.
Signature #2: CN Bob Beta
  - Signed Ranges: [0 - 20046], [36430 - 37272]   - Total document signed
  - Signature Validation: Signature is Valid.
  - Certificate Validation: Certificate issuer is unknown.

$ pdfsig docs/reviews/adobe-verify-2026-06-18/sample-shared.pdf
Signature #1..#3: CN Alice Alpha — all "Signature is Valid."
  - #1/#2: Not total document signed   - #3: Total document signed
```

**Read this carefully — it is the crux of the spike:**

- **"Signature is Valid"** on EVERY signature → the cryptography and the append-only
  byte ranges are correct.
- **"Not total document signed"** on the earlier signatures is **expected and correct**,
  not a defect: each earlier signature covers its own (smaller) revision; later
  signatures were appended *after* it. Only the **last** signature covers the whole file.
  This is exactly how PDF incremental multi-signing works in Acrobat itself.
- **"Certificate issuer is unknown"** → the self-signed trust caveat (step 4 below),
  NOT a validation failure.

---

## The expected "validity unknown / not trusted" message (read before you panic)

These are **self-signed** certificates. Every compliant validator (Acrobat, DSS,
pdfsig) will show the signature as **cryptographically valid** but the **identity as
"unknown / not trusted"** until you explicitly trust the cert. That is correct
behaviour and is surfaced in the app UI (`modal.sign.genTrustNote`). It is NOT a
signature failure. Step 4 shows how to add trust if you want the green check.

---

## Adobe verification steps (the gate)

Use **Adobe Acrobat Reader (free)** or Acrobat Pro. Do BOTH sample files.

1. **Open** `sample-separate.pdf`. A blue/yellow banner appears: *"Signed and all
   signatures are valid"* OR *"At least one signature has problems"* (the latter is
   expected ONLY because the issuer is untrusted — verify via step 3 it is a TRUST
   problem, not an integrity problem).
2. **Open the Signature Panel** (left rail → fountain-pen icon, or *View → Show/Hide →
   Navigation Panes → Signatures*). Confirm you see **two** signature entries for the
   separate sample, **three** for the shared sample.
3. **Expand each signature** → *Signature Details → Certificate Details*. For each, confirm:
   - ✅ **"The document has not been modified since this signature was applied"** (or the
     per-revision equivalent). This is the integrity claim — it MUST hold for every signature.
   - ✅ Signer name: separate → `Alice Alpha` then `Bob Beta`; shared → `Alice Alpha` three times.
   - ⚠️ "Signer's identity is unknown / not trusted" — expected (self-signed). Not a failure.
4. **(Optional) Trust the cert to get the green check:** *Certificate Details →
   Trust tab → Add to Trusted Certificates* (or import `cert-alpha.pem` / `cert-beta.pem`
   via *Preferences → Signatures → Identities & Trusted Certificates → Trusted
   Certificates → Import*). After trusting, re-validate → the signature should show as
   **valid AND trusted**.
5. **View signed revisions:** in the Signature Panel, *Click a signature → Options →
   View Signed Version*. Confirm each earlier revision opens and shows fewer signatures
   than the final document — this is the visible proof that signing was **append-only**
   and earlier signatures still validate over their own revision.

---

## PASS / FAIL acceptance criteria

**PASS (→ multi-sign may be wired into the UI, behind the honest shared-mode label):**

- [ ] Acrobat shows **all** signatures (2 in separate, 3 in shared) in the Signature Panel.
- [ ] **Every** signature reports **"document has not been modified since signed"** (integrity intact).
- [ ] Separate sample shows **two distinct signer names**; shared sample shows **the same name three times**.
- [ ] After trusting the cert(s), every signature validates as **valid + trusted**.
- [ ] "View Signed Version" opens earlier revisions (append-only confirmed).

**FAIL (→ keep `ALREADY_SIGNED` guard; do NOT wire; reopen the spike):**

- [ ] Acrobat reports any signature's **content/integrity** as broken (not merely "untrusted").
- [ ] An earlier signature **disappears** or is marked invalid after a later one is added.
- [ ] Acrobat refuses to parse the file / reports a malformed signature dictionary.

> If FAIL: the in-repo + pdfsig PASS means the defect is Adobe-specific (likely a
> signature-dictionary/ByteRange nuance Adobe is stricter about). Capture the exact
> Acrobat error and attach it to `docs/reviews/2026-06-18-incremental-multisign-spike-verdict.md`.

---

## Optional: EU DSS / online cross-check

- **DSS demo validator** (eSignature DSS, ec.europa.eu) accepts an uploaded PDF and
  reports per-signature status — a good second opinion beyond Acrobat. (Self-signed →
  "indeterminate / no trust anchor" is the expected trust outcome, same caveat.)
- Treat any **integrity** failure there as FAIL; treat **trust-only** findings as expected.

---

## Reproduce the samples

```bash
./node_modules/.bin/vitest run \
  --config docs/reviews/adobe-verify-2026-06-18/vitest.gen.config.ts
# then re-cross-check offline:
pdfsig docs/reviews/adobe-verify-2026-06-18/sample-separate.pdf
pdfsig docs/reviews/adobe-verify-2026-06-18/sample-shared.pdf
```

The generator is **not** part of `npm test` (the jsdom config globs only `tests/**`),
so it never runs in CI and never blocks a deploy. It exists solely to (re)produce this kit.
