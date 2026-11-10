# phone-signature-pad Plan

Sign on a phone and use that signature on the PC, with no server: the PC shows a QR that links to a light
`pad.html` page, the phone draws and then shows the signature as a QR, and the PC webcam reads it back. Also: import a
signature image (PNG/JPEG/WebP) for PCs without a webcam. Hosting stays GitHub Pages; nothing is uploaded.

## Decisions Log
- [2026-11-10 11:06] AGREED: Phone pad returns the signature to the PC as a QR read by the PC webcam; no relay server, GitHub Pages only (developer option 2).
- [2026-11-10 11:06] AGREED: Phone page is a separate light pad.html entry, not a mode of the main app.
- [2026-11-10 11:06] AGREED: Also add signature image import in the signature modal, for PCs without a webcam.
- [2026-11-10 11:06] AGREED: QR decoder is zxing-wasm (MIT, maintained), self-hosted and lazy-loaded.
- [2026-11-10 11:06] AGREED: First version = MVP plus an automated fake-camera end-to-end test in real Chrome.
- [2026-11-10 11:06] AGREED (ratified ASSUMED): pad.html does not register the service worker (stays light); no offline-first claim — because the precache would make the phone download the whole editor. Alternatives: register the SW with a pad-only precache.
- [2026-11-10 11:11] AGREED: Plan approved (8 steps, hardware test first).
- [2026-11-10 11:11] AGREED: Image import makes near-white pixels transparent.
- [2026-11-10 11:11] AGREED: Phone pad page has no offline cache: light page, network needed to open it (ratifies the earlier ASSUMED pick).
- [2026-11-10 11:11] AGREED: Feature flag phonePad defaults OFF until the step-7 manual check; isEnabled gains a per-key default.
- [2026-11-10 11:17] AGREED: Before the phone pad, fix the red audit gate and upgrade dependencies: A audit fix, B in-range minors/patches, C1 vite-plugin-pwa 2, C2 jsdom 31 if vitest 5.1 reads its Blob — one commit each; i18next 27 (released 2026-11-10) deferred ~2 weeks.
- [2026-11-10 11:54] AGREED: pdfjs-dist held at ~6.3.289 in this batch: 6.4 loses DOCX font names (commonObjs lookup), 6.5 changes the multi-stream parse the prune/load guard mirror; 6.4/6.5 is a separate task.
- [2026-11-10 11:54] AGREED: axe-core 4.14 adopted with a fix of the 4 WCAG 2.5.3 Label-in-Name buttons (langGlobeBtn, textModeBtn, signersBtn, fontSizeDownBtn) in EN/FR/AR, own commit; names start with the visible text.

## Formal Plan

**Goal.** A drawn signature made on a phone reaches the PC's `currentSignature` through the EXISTING signature modal
(replayed on `signatureCanvas`, then the existing Save), so the plain ✍ path, the Signers panel and the e-sign
appearance image all get it with no change to export, redaction or signing code.

**Design (3C round 1, advisor-reviewed 2026-11-10).**

- **Payload `PTSIG`.** Strokes normalised to a 1024 grid, Ramer–Douglas–Peucker simplification, delta + zigzag varint.
  Header: magic, format version, frame index/total (a multi-QR sequence stays possible without a format break), aspect,
  colour, line width. **base45 (RFC 9285) in QR alphanumeric mode**, so it costs about 3% rather than base64's 33%. The byte
  budget is set by the step-1 hardware test, not guessed. Decoding is strict: caps on strokes, points and bytes; bad magic,
  version or trailing bytes are rejected. The scanned QR is untrusted input and is only ever drawn onto a canvas.
- **Phone page.** `pad.html` is a separate Vite entry with the same CSP. It does NOT register the service worker, so it
  stays light: no editor precache on the phone. Once loaded it signs offline, but there is no offline-first claim. On a
  format mismatch the PC shows "refresh the page on your phone".
- **PC side.** Three buttons in the signature modal:
  - **Use phone**: a QR of the pad URL, derived from `location` + base so it also works in dev and preview.
  - **Scan**: `getUserMedia` → `zxing-wasm`, loaded lazily from a self-hosted wasm via `locateFile`, never the CDN
    default (`connect-src 'self'` would block it).
  - **Import image**: `createImageBitmap`, a size and dimension cap, a fit onto `signatureCanvas`, re-encoded to PNG,
    which drops EXIF and other metadata.

  Camera tracks are stopped on success, cancel, close and when the tab is hidden. An expected denial or a missing camera
  is shown in the UI and never logged with `console.error`, because the QA sweep fails on a console error.
- **PWA.** A runtime cache rule for the zxing wasm (like `pdfjs-wasm`); the new service worker precaches `pad.html` and
  keeps it out of the navigation fallback. **The outdated-app case cannot be fixed from new code**
  (3C round 2): the deployed `dist/sw.js` routes every navigation to the cached `index.html`
  (`NavigationRoute(createHandlerBoundToURL("index.html"))`), so a phone on an old version gets the old editor and old
  JS. Mitigation: the "Use phone" panel on the PC says "if your phone opens the editor, accept its Update prompt and
  scan again". Pad parameters go in the `#fragment`, never the query, so a precached `pad.html` still matches.
- **Feature flag `phonePad`.** Keep the buttons hidden until the step-9 manual check passes. `isEnabled` today only
  defaults to ON, so it gains a per-key default.
- **Device route for steps 1 and 9.** The PC stays on `localhost`, because the camera needs a secure context. The dev
  server runs with `vite --host`, and the phone opens `http://<LAN-IP>:5173/pdfturbo/pad.html` by hand; the phone page
  needs no secure context, since it uses no camera. Node for every step: `/stack/tools/nvm/versions/node/v26.13.0/bin`.
- **Fake-camera test.** It repaints the canvas after the stream starts; a static canvas may emit no frames.

**Steps** (Status table below). Acceptance: the full deploy gate is green, including `qa:sweep`; a real-Chrome
encode → QR → decode test and a fake-camera (`canvas.captureStream`) end-to-end test pass in `test:browser`; a manual
check with the real phone and webcam is done, with screenshots; the three-lens milestone panel is clean on a frozen
commit.

**Rollback.** The feature is additive: revert its commits. No persisted model field and no `SCHEMA_VERSION` change.

## Status
<!-- progress-block v1 -->
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 0A | Audit fix: node-forge ^1.4.3, vite ^8.3.7, undici override ^8.12.4 (master gate red since before this plan) | S | done | fd10323 | package.json, package-lock.json, .claude/rules/audit-gate.md, .claude/rules/toolchain.md |
| 0B | In-range minors/patches (vitest 5.1, playwright 1.65, oxlint 1.93, pdfjs-dist 6.5 + vendored assets, docx, prosemirror, i18next 26.7, axe-core, …) | M | todo | - | package.json, package-lock.json, public/pdfjs/** |
| 0B2 | axe-core 4.14 + the 4 Label-in-Name names (EN/FR/AR), a11y test red first | S | todo | - | package.json, package-lock.json, locales/**, src/utils/i18n.ts, tests/** |
| 0C1 | vite-plugin-pwa 2.0 (workbox-build/window peers) | M | todo | - | package.json, package-lock.json, vite.config.ts |
| 0C2 | jsdom 31 if vitest 5.1 reads its Blob (codeGenerator cases decide); else keep the hold | S | todo | - | package.json, package-lock.json, .claude/rules/toolchain.md |
| 1 | Install + audit zxing-wasm; hardware QR readability test (developer's phone + webcam, throwaway page in var/claude); set the byte budget | S | todo | - | package.json, package-lock.json |
| 2 | PTSIG codec + base45 + strict decode + fuzz, test-first (jsdom) | M | todo | - | src/utils/signatureStrokes.ts, tests/utils/** |
| 3 | SignaturePad records and replays strokes; `phonePad` flag with a per-key default OFF, test-first | S | todo | - | src/utils/signaturePad.ts, src/config/features.ts, tests/** |
| 4 | pad.html phone page (Vite entry, CSP, i18n/RTL, QR + PNG download, no SW) + its locale keys + architecture baseline + its browser test, in one commit | M | todo | - | pad.html, src/pad/**, vite.config.ts, locales/**, tests/** |
| 5 | PC modal behind the flag: Use phone / Scan (zxing-wasm, camera lifecycle) / Import image; PWA rules; locale keys, baseline, browser tests (QR round-trip, fake-camera e2e with tracks stopped, image-import pixels) in the same commits | L | todo | - | index.html, src/core/signatureManager.ts, src/ui/**, vite.config.ts, vitest.browser.config.ts, locales/**, tests/** |
| 6 | Docs + rules entry + Arabic pending-count homes + full deploy gate incl. qa:sweep | M | todo | - | README.md, .claude/rules/**, KNOWN_ISSUES.md |
| 7 | Manual check on the real phone + webcam, with screenshots; then turn the flag ON | S | todo | - | src/config/features.ts |
| 8 | Milestone three-lens panel on a frozen commit | M | todo | - | |
<!-- /progress-block -->
### Blocked
### Needs input
- Steps 1 and 7 need the developer's phone and PC webcam.
### Needs research
- The Vite multi-page option name for the installed Vite (Rule 9); the zxing-wasm wasm file size and its `locateFile` / override API.
### Fragile
### Known issues
- pdfjs-dist held at ~6.3.289 (2026-11-10): 6.4.299 resolves DOCX font names to the internal id (`docx-font-names.browser.test.ts`, 2 cases); 6.5.438 also reds 8 prune/load-guard oracle cases (multi-stream parse). Separate task, not scheduled.
- A desktop with no webcam cannot scan; it uses Import image instead.
