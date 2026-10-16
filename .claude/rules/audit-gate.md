---
paths:
  - "scripts/audit-gate*"
  - "package.json"
  - "package-lock.json"
  - "tests/tools/auditGate.test.ts"
  - ".github/workflows/**"
---

# pdfturbo gotchas — the audit gate and the supply-chain pins

Moved verbatim from CLAUDE.md § "Git & CI" on 2026-10-17 (review-remediation row 7, DOC-7): the six
audit occurrences were always-loaded toolchain history, against the intake rule. Scope: the
deploy-blocking `npm audit` gate, its one expiring exemption, and the `overrides` pins in
`package.json`. The `undici` pin's story is in `toolchain.md` § "`jsdom` is held at 30.0.x" (SEC-10).
New entries for this area go HERE, not into CLAUDE.md.

### Supply chain (#37)

**Supply chain (#37)**: the audit gate (`node scripts/audit-gate.mjs` — `npm audit --audit-level=high` plus one expiring exemption, see the fifth occurrence below) runs first and is **deploy-blocking**
(a high/critical advisory fails the build before anything deploys). It was briefly disabled
(`e154540`, 2026-07-28) and **restored the same day** once the blocker was root-caused — keep it on.
**What the blocker was, so it is recognised next time:** 8 "high" findings that were really ONE
advisory counted at 8 levels of a single chain — `brace-expansion` (GHSA-mh99-v99m-4gvg, DoS/OOM)
← `minimatch` ← `filelist` ← `jake` ← `ejs` ← `@trickfilm400/rollup-plugin-off-main-thread`
← `workbox-build` ← `vite-plugin-pwa`. Only ONE vulnerable copy was installed
(`filelist/node_modules/brace-expansion@2.1.2`; the hoisted copy was already patched), it is
**devDependency-only**, and `npm audit fix` could not touch it: ERESOLVE, because
`vite-plugin-pwa@1.2.0` peer-requires `vite ^3–^7` while this project is on `vite@8`.
**The fix is the `overrides` block in `package.json`** — it pins the transitive dep without touching
`vite-plugin-pwa`, so the peer conflict never arises. **Do not remove those overrides** without
re-checking the advisories, and reach for the same pattern the next time a transitive dev-dep
advisory is unfixable through the dependency that pulls it in.

**The overrides are a LIVING pin, not a one-off — re-audit before every push.** On 2026-07-31 the
gate went from `found 0 vulnerabilities` to **2 high** in a single day, with no dependency change on
our side, and one of them was `brace-expansion` **again**: GHSA-rgw5-rvv9-x895 explicitly *bypasses
the CVE-2026-14257 mitigation*, so the very version this block pinned to (`^5.0.8`) became the
vulnerable one. The second was `fast-uri` (GHSA-7p8r-x3mc-p8w7, host confusion via a backslash
authority introducer) via `ajv` ← `workbox-build`. Both were devDependency-only and both were fixed
the same way — bump to `^5.0.9` / add `^3.1.5`, one deduped copy each, audit clean, and the PWA
precache unchanged at the 22 entries it had then (24 at the 2026-09-13 upgrade build — recount rather
than assuming any figure here). Lesson: a pinned version is a snapshot of the advisory database, not a
permanent fix, and because `npm audit` is the FIRST CI step a new advisory turns every deploy red
before a single test runs — including deploys of changes that have nothing to do with it.

**Third occurrence, 2026-09-04 — `fast-uri` again, and the pin that fixed it became the
vulnerable one.** Four new advisories (GHSA-5jgf-p345-68v8, -f65p-4m7j-42xc, -fph4-wmhf-6fwf,
-jqff-g426-hqxp) put the whole `3.0.0 - 3.1.5` range in scope, so the `^3.1.5` pin added on
2026-07-31 was itself inside it. Bumped to `^3.1.7`, one deduped copy, audit back to
`found 0 vulnerabilities`, build green with 25 precache entries that day (24 at the 2026-09-13 build). **Stay inside the dependent's
own range**: `ajv` declares `fast-uri: ^3.0.1`, so 3.1.7 satisfies it natively while the current
4.1.4 would force a major past that range — an override can express it, and the PWA build is what
pays. Same shape as the `brace-expansion` `^5.0.8` → `^5.0.9` bump.

**Fourth occurrence, 2026-09-30 — both again.** `brace-expansion` 4.0.0–5.0.11 (three DoS advisories, high) put the
`^5.0.9` pin in scope, and `fast-uri` 3.0.0–3.1.7 (host-case normalisation, moderate) did the same to `^3.1.7`. Bumped
to `^5.0.12` / `^3.1.8`, one deduped copy each, `found 0 vulnerabilities`. It surfaced as the first step of the deploy
gate on an unrelated change, which is the normal way this shows up.

**Fifth occurrence, 2026-10-02 — an advisory with NO patched release.** `node-forge` <= 1.4.0 (GHSA-86w9-cpqp-85rv, high, RSA PKCS#1 v1.5 verification accepts extra nested `DigestAlgorithm` elements; forgery needs a low-exponent RSA key) was in the npm database an hour after a green audit; 1.4.0 is the latest release, so no `overrides` bump exists. The gate is now `scripts/audit-gate.mjs`: the same `npm audit`, failing on any high/critical advisory EXCEPT one named in `scripts/audit-gate-allowlist.json` by id AND package, with a reason and an expiry date (an expired entry fails the gate again by itself; a gone advisory is reported STALE). It fails closed: an audit that produced no verdict, or a malformed allowlist entry, is a failure. The one entry rests on this evidence: no forge RSA verification ships (`cmsVerify.ts` now checks the RSA signature with WebCrypto, a source guard in `tests/signing/rsaVerify.test.ts` forbids any other `.verify(` call in every code file under `src/` at any depth and in the HTML pages — widened 2026-10-06, it scanned only `src/signing`, flat, so a forge verify in `src/handlers/` would have passed it — and forge only PARSES and CREATES), and `verifyAllSignatures` never had a production caller (`multiSign.ts` and tests only, kept out of the signing barrel). Before the swap the only forge verify call was in that unwired module. Developer ruling 2026-10-02 (a narrow exemption plus the WebCrypto verify swap in `cmsVerify.ts`, so wiring the verifier later is safe). **Do not widen the allowlist for convenience**, and remove the entry when a patched release ships. The exemption is also void by itself once `npm audit` reports `fixAvailable` on the vulnerable node (a patched release shipped), so the bump is prompted by the gate and not by someone remembering the date. Guard: `tests/tools/auditGate.test.ts` (26) — the exemption is keyed on id AND package, expires, never covers a different advisory of the same package, a transitive chain is judged by its advisory, and every no-verdict shape fails; each sabotage reds exactly its case — and two sabotages first stayed GREEN because two guards covered the same input (the `error` branch next to the missing-`vulnerabilities` check; the node-level and the advisory-level 'no usable severity' problem), which is how a redundant guard shows up: the redundant one was deleted and the other pinned alone. **The gate fails closed on every shape a reviewer found:** an unknown, missing or upper-case severity (normalised, a non-npm word is a problem), a high advisory object with no usable id (`unidentified advisory`, including a url that ends at `/advisories/`), the same advisory at two severities (the worst counts), and a blocking node whose chain never reaches an advisory object. Round 8 added two more: a missing `fixAvailable` is not "no fix exists" (only an explicit `false` keeps the exemption), and a blocking node whose chain reaches no blocking advisory is a problem (a mixed node whose chain reaches one is not; a string `via` naming a package the report does not list is a problem too). Round 9 added: a launch through a symlink still runs (the entry guard compares real paths; it used to exit 0 having audited nothing), and the report's own `metadata.vulnerabilities` high/critical counts must equal the nodes it lists (an empty `vulnerabilities` beside a count of 2 is no verdict). The WebCrypto swap is pinned by `tests/signing/rsaVerify.test.ts` (8): a signature whose DigestInfo carries an extra element inside the DigestAlgorithm sequence is built with a REAL private key and the installed forge ACCEPTS it (red first: `expected true to be false`) while WebCrypto rejects it; a source-level guard forbids any `.verify(` call in what ships (all of `src/`, recursively, plus `index.html` and `public/*.html`) except WebCrypto's — the only thing that notices a revert to forge, since the behavioural suite stays green with either — and a fixture control plants one in `src/handlers/`, one in `src/signing/<sub>/` and one in a page script, and requires all three caught (red against the old `src/signing`-only scope; a non-recursive walk and a scan without the HTML pages each red it too).

**Sixth occurrence, 2026-10-06 — `source-map-js`.** GHSA-68fv-2mgg-jv7q (high, `>=1.0.0 <1.2.2`) reached the one deduped 1.2.1 copy (devDependency-only: `postcss` ← `vite`, `css-tree` ← `jsdom`, `magicast` ← `@vitest/coverage-v8`, all declaring `^1.2.1`). Same shape as the others: `overrides` `"source-map-js": "^1.2.2"` (inside every dependent's own range), one deduped copy, `audit-gate: ok (1 exempted)`, build green with 24 precache entries. Found by the pre-push audit of an unrelated change.

**Never run the audit gate with `--offline`.** It reads the cached advisory database and reported
`found 0 vulnerabilities` against the very tree that was carrying this high — a false green that
looks exactly like a real one [measured 2026-09-04].

OCR traineddata stays SHA-256-pinned (`scripts/prepare-ocr-assets.mjs`); no other remote assets are
fetched at build.
