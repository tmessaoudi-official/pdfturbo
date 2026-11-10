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
- [2026-11-10 12:10] AGREED (ratified ASSUMED): textModeBtn name is 'T Text — add text (T)', not the ruled example 'Text — add text (T)': an axe 4.14 probe fails the example (the visible text is 'T Text'; axe strips pictographs, not the letter T); the ruling's principle (start with the visible text) decides it. Alternatives: aria-hidden on the T glyph (needs a markup split of a data-i18n textContent).
- [2026-11-10 14:36] AGREED: The 23 gitignored zz* probe files (2026-10-01..17 review rounds) moved from tests/tools/ to var/claude/zz-probes-2026-10/: two wrote to a dead session's scratchpad and failed the local pre-push hook.
- [2026-11-10 14:36] AGREED: 6C for the dependency phase (0A-0C2) is advisor() only; the three-lens panel stays at the milestone end (step 8).
- [2026-11-10 14:40] AGREED: Fix three more Label-in-Name buttons found at 1280 px (ocrBtn, signBtn, fontSizeUpBtn) like the first four, and widen the axe gate with a 1280 px pass; the CI gate only ran at 414 px and the sweep runs wcag2a/aa tags only.
- [2026-11-10 18:19] AGREED: Fix the last 7 Label-in-Name buttons (editText, exportDocx, exportMd, superscript, subscript, bulletList, numberedList) with 'visible text — purpose' titles in EN/FR/AR as tabled 2026-11-10; the list buttons' visible word is translated via formatting.list.
- [2026-11-10 18:19] AGREED: The axe gate gains a pass that opens every flyout and every role=dialog at 414 and 1280 px in en/fr/ar with the 0 ceiling; per-task certification advisor() only.
- [2026-11-10 19:47] AGREED: Byte budget = one QR of version 19 at EC M (~900 base45 chars, ~600 payload bytes); a bigger signature uses the PTSIG multi-QR sequence. Measured: the developer's Integrated Webcam is 1280x720@30; v19 M read ~3/s in both ladder runs, v23+ only intermittently; the badly-held re-test is left to the step-7 manual check.
- [2026-11-10 20:18] AGREED: PTSIG v1 frame: magic PT, version 1, index/total nibbles, CRC-32 of the whole body (also the sequence id), then the body slice; one frame = base45 of at most 606 bytes (909 alphanumeric chars = the measured v19 EC M cap), so 598 body bytes per frame.
- [2026-11-10 20:18] AGREED: Oversize signatures: simplify with RDP tolerance 1 to 4 grid units to fit one QR, then use the fewest frames up to 4 (hybrid); per-task certification advisor() only, the three-lens panel stays at step 8.

## Formal Plan

**Goal.** A drawn signature made on a phone reaches the PC's `currentSignature` through the EXISTING signature modal
(replayed on `signatureCanvas`, then the existing Save), so the plain ✍ path, the Signers panel and the e-sign
appearance image all get it with no change to export, redaction or signing code.

**Design (3C round 1, advisor-reviewed 2026-11-10).**

- **Payload `PTSIG` v1** (`src/utils/signatureStrokes.ts`, ruled 2026-11-10 20:18). One frame per QR, base45
  (RFC 9285) so it stays in QR alphanumeric mode (about 3% overhead rather than base64's 33%), at most 909 characters
  (606 bytes, the measured v19 EC-M budget). Frame: magic `PT`, version 1, frame index/total nibbles (1–4 frames),
  CRC-32 of the WHOLE body (also the sequence id), then up to 598 body bytes. Body: grid width/height varints (longer
  side exactly 1023), RGB colour, line width in quarter grid units, stroke count, then per stroke a point count and
  zigzag-varint deltas (the first point relative to the previous stroke's end). The encoder quantises, drops repeats
  and simplifies with Ramer–Douglas–Peucker; it picks the fewest frames over tolerances 1–4 grid units, then the
  lowest tolerance. Decoding is strict, with a typed error code per failure: the length cap runs before base45,
  canonical varints of at most 3 bytes, stroke (256) and point (1024) caps checked before anything is read, every
  point on the grid, no trailing bytes. **The CRC detects misreads; it authenticates nothing** — the parser behind it
  is fuzzed with re-sealed mutated bodies. The scanned QR is untrusted input and is only ever drawn onto a canvas.
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
- **Feature flag `phonePad`.** Keep the buttons hidden until the step-7 manual check passes. `isEnabled` today only
  defaults to ON, so it gains a per-key default.
- **Device route for steps 1 and 7.** The PC stays on `localhost`, because the camera needs a secure context. The dev
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
| 0B | In-range minors/patches (vitest 5.1, playwright 1.65, oxlint 1.93, pdfjs-dist 6.5 + vendored assets, docx, prosemirror, i18next 26.7, axe-core, …) | M | done | 4ccb8ff (pdfjs-dist held ~6.3.289, axe-core held ~4.13 for 0B2) | package.json, package-lock.json, src/utils/i18n.ts, src/core/globalErrorBoundary.ts, tests/** |
| 0B2 | axe-core 4.14 + the 4 Label-in-Name names (EN/FR/AR), a11y test red first | S | done | 70be82b + e082b92 (3 more at 1280 px); a11y-axe red→green, tests/utils/i18nLabelInName.test.ts 4 red→green, sabotage reds the globe case | package.json, package-lock.json, locales/**, src/utils/i18n.ts, tests/utils/i18nLabelInName.test.ts, .claude/rules/{ui,redaction,export,toolchain}.md, KNOWN_ISSUES.md |
| 0C1 | vite-plugin-pwa 2.0 (workbox-build/window peers) | M | done | 9ed17b8; dist/sw.js, manifest.json, index.html, workbox runtime byte-identical to 1.3.0, all 26 emitted assets same hashed names and sizes; vite.config.ts unchanged | package.json, package-lock.json, .claude/rules/audit-gate.md |
| 0C2 | jsdom 31 if vitest 5.1 reads its Blob (codeGenerator cases decide); else keep the hold | S | done | 4b5e4ad; codeGenerator 10/10 on jsdom 31 + vitest 5.1; undici override dropped (jsdom 31 floor ^8.12.3 clears the advisories); 3 tests adapted to jsdom 31 behaviour, 2 sabotages | package.json, package-lock.json, tests/{elements,handlers,utils}/**, .claude/rules/{toolchain,audit-gate,conventions}.md, CLAUDE.md |
| 0D | Label in Name for the last 7 buttons (flyouts + text-options panel, EN/FR/AR, list word translated) + axe gate opening every flyout and dialog at 414/1280 px in en/fr/ar | M | done | commit "fix(a11y): opened flyouts and panels …" (2026-11-10); both tests red on the 7 → green; sabotages: no-op open() reds 6, one FR title reds the 2 fr tests | locales/**, index.html, tests/browser/a11y-axe.browser.test.ts, tests/utils/i18nLabelInName.test.ts, .claude/rules/{ui,redaction,export,toolchain}.md, KNOWN_ISSUES.md |
| 1 | Install + audit zxing-wasm; hardware QR readability test (developer's phone + webcam, throwaway page in var/claude); set the byte budget | S | done | zxing-wasm ^3.1.6 (MIT, audit:gate ok, +4 packages); canvas round-trip 16/16 sizes v9–v35, wasm self-hosted, 0 non-localhost requests; 2 webcam runs (1280x720; the phone's px/module and dpr were not recorded) → budget v19 M / ~600 B per QR (Decisions Log 19:47) | package.json, package-lock.json |
| 2 | PTSIG codec + base45 + strict decode + fuzz, test-first (jsdom) | M | done | commit "feat(sign): PTSIG v1 codec …" (2026-11-10); 45 tests red (module missing) → green; 15 sabotages each red on their own guard (the varint-limit one first stayed green and its test was moved); synthetic sizes var/claude/ptsig/sizes.txt: 6 strokes / 720 samples = 1 frame at tolerance 1 [Inferred] | src/utils/signatureStrokes.ts, tests/utils/** |
| 3 | SignaturePad records and replays strokes; `phonePad` flag with a per-key default OFF, test-first; then run a REAL hand-drawn signature through the codec and record its frames, tolerance and encode time before step 4 | S | todo | - | src/utils/signaturePad.ts, src/config/features.ts, tests/** |
| 4 | pad.html phone page (Vite entry, CSP, i18n/RTL, QR + PNG download, no SW) + its locale keys + architecture baseline + its browser test, in one commit | M | todo | - | pad.html, src/pad/**, vite.config.ts, locales/**, tests/** |
| 5 | PC modal behind the flag: Use phone / Scan (zxing-wasm, camera lifecycle) / Import image; PWA rules; locale keys, baseline, browser tests (QR round-trip, fake-camera e2e with tracks stopped, image-import pixels) in the same commits | L | todo | - | index.html, src/core/signatureManager.ts, src/ui/**, vite.config.ts, vitest.browser.config.ts, locales/**, tests/** |
| 6 | Docs + rules entry + Arabic pending-count homes + THIRD-PARTY-NOTICES (zxing-wasm MIT + zxing-cpp Apache-2.0 into the bundled list, the wasm's NOTICE duty) + full deploy gate incl. qa:sweep | M | todo | - | README.md, .claude/rules/**, KNOWN_ISSUES.md |
| 7 | Manual check on the real phone + webcam, with screenshots, including the badly-held re-test of the v19 M budget (40 cm, tilted, half brightness) and the phone's px/module + dpr; then turn the flag ON | S | todo | - | src/config/features.ts |
| 8 | Milestone three-lens panel on a frozen commit | M | todo | - | |
<!-- /progress-block -->
### Blocked
### Needs input
- Steps 1 and 7 need the developer's phone and PC webcam.
- [x] W1. Open http://<LAN-IP>:5173/pdfturbo/var/claude/qrtest/show.html on the phone — DONE 2026-11-10: the phone connected over the LAN (ss), ufw let :5173 through
- [x] W2. Open http://localhost:5173/pdfturbo/var/claude/qrtest/scan.html in desktop Chrome, Start camera, allow it — DONE 2026-11-10: Integrated Webcam granted 1280x720 @30 fps (asked ideal 1920x1080)
- [x] W3. Run the 16-size ladder in front of the webcam — DONE 2026-11-10: two full runs (var/claude/qrtest/run1.txt, run2.txt); the badly-held re-test (40 cm, tilted, half brightness) was not run and moves to step 7
### Needs research
- The Vite multi-page option name for the installed Vite 8.3.7 (Rule 9) — step 4.
- RESOLVED (step 1): zxing-wasm 3.1.6 — import from `zxing-wasm/reader` (reader-only wasm 947 KB raw / 411 KB gzip; `full` is 1.5 MB); self-host with `prepareZXingModule({ overrides: { locateFile: (p, prefix) => p.endsWith('.wasm') ? wasmUrl : prefix + p } })` and `import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'` (measured: no CDN request); reader options `{ formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 }`; a result carries `version` and `ecLevel`.
### Fragile
### Known issues
- Step-1 findings for steps 2–5: the PTSIG text must stay in the QR alphanumeric set (alphanumeric mode is 2–7 versions smaller than byte mode for the same text, measured (3–7 at EC M, 2–7 at EC L)); the test encoder was `qrcode-generator` 1.5.2 with an explicit `'Alphanumeric'` mode — `pad.html`'s encoder is chosen in step 4 and must also force that mode; draw with integer device pixels per module and a 4-module quiet zone; `pad.html` needs a `<link rel="icon">` under the base path (the test page drew a root `/favicon.ico` 404, which the QA sweep would fail on); one decode in run 2 returned text that was not the expected payload (`bad:1` at v32 M, text not logged, cause unknown — a misread or another code in view). The strict header checks would NOT catch a misread body behind an intact header: step 2 decides whether PTSIG carries an integrity check (e.g. a CRC), and the step-7 scan page logs any mismatched text.
- pdfjs-dist held at ~6.3.289 (2026-11-10): 6.4.299 resolves DOCX font names to the internal id (`docx-font-names.browser.test.ts`, 2 cases); 6.5.438 also reds 8 prune/load-guard oracle cases (multi-stream parse). Separate task, not scheduled.
- A desktop with no webcam cannot scan; it uses Import image instead.
