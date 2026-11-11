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
- [2026-11-10 21:10] AGREED: Step 3: a tap draws a dot only on the phone pad (SignaturePad option dotOnTap, set by pad.html); the live ✍ pad keeps drawing nothing on a tap. Replay always draws one-point strokes as dots. A stroke is one pointer: other pointers are ignored while one draws. toSignatureInput() uses the pad's current colour and width (PTSIG v1 has one), so step 4 locks or repaints the style.
- [2026-11-10 22:41] AGREED: Step 4: the phone pad ink is locked to black #000000 at 2.5 CSS px (the ✍ pad default), no picker.
- [2026-11-10 22:41] AGREED: Step 4: the phone page's Download button saves the signature as a transparent PNG (trimmed to the strokes plus a margin, device resolution) — the no-webcam route that step 5's Import image reads.
- [2026-11-10 22:41] AGREED: Step 4: a 2–4 frame signature auto-cycles its QRs every 1 s with a 'QR k of n' label.
- [2026-11-10 22:41] AGREED: Step 4: 3C certification tier advisor() only.
- [2026-11-10 22:45] AGREED: Step 4 plan approved (5 bullets + the 3C round-1 acceptance list); QR encoder qrcode-generator ^2.0.4 as a direct dependency, proven test-first against the v19-M budget, falling back to the installed 1.5.2 if it fails.
- [2026-11-10 23:35] AGREED: Step 5 is Large, delivered as three commits each test-first with its own 6C and green gate: 5a Use phone + Import image, 5b Scan (camera + zxing-wasm), 5c PWA rules.
- [2026-11-10 23:46] AGREED: Step 5 plan GO as written (5a Sign on phone + Import image, 5b Scan, 5c PWA); pad.html leaves the precache and is served NetworkFirst, reversing the Formal Plan's precache line.
- [2026-11-10 23:46] AGREED: PC modal has two buttons: Sign on phone (one panel: the pad-URL QR, then Start camera) and Import image; not three.
- [2026-11-10 23:46] AGREED: Import image removes the paper: composite over white, key out the paper level, keep the ink colour, trim to the ink.
- [2026-11-10 23:46] AGREED: After a successful scan the signature is shown on the canvas and waits for Save; no auto-save.
- [2026-11-11 09:51] AGREED: Step 5a remainder runs as Medium; plan go: the file-input reset is guarded in Chrome with a real file list (not a jsdom setter spy), beside the pad-URL QR read-back; the gate runs before the 5a commit.
- [2026-11-11 10:49] AGREED: The placement ghost floating above the open signature modal (pre-existing, placementManager.ts) is fixed now, test first, as its OWN commit before 5a.
- [2026-11-11 10:49] AGREED: The cookie banner covering the modal's Save row at 414 px on a first visit (phone panel + error message open) is noted under Known issues and left as is.

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
- **PC side.** Two buttons in the signature modal (ruled 2026-11-10, step-5 gate; the Use phone and Scan halves share one panel):
  - **Sign on phone**: a QR of the pad URL, derived from `location` + base so it also works in dev and preview.
  - **Start camera** (in the same panel): `getUserMedia` → `zxing-wasm`, loaded lazily from a self-hosted wasm via `locateFile`, never the CDN
    default (`connect-src 'self'` would block it).
  - **Import image**: `createImageBitmap`, a size and dimension cap, a fit onto `signatureCanvas`, re-encoded to PNG,
    which drops EXIF and other metadata.

  Camera tracks are stopped on success, cancel, close and when the tab is hidden. An expected denial or a missing camera
  is shown in the UI and never logged with `console.error`, because the QA sweep fails on a console error.
- **PWA.** A runtime cache rule for the zxing wasm (like `pdfjs-wasm`); `pad.html` is NOT precached (ruled 2026-11-10, step-5 gate): it is
  served NetworkFirst and kept out of the navigation fallback, so a phone refresh always gets the current pad. **The outdated-app case cannot be fixed from new code**
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
| 2 | PTSIG codec + base45 + strict decode + fuzz, test-first (jsdom) | M | done | commit "feat(sign): PTSIG v1 codec …" (2026-11-10); 45 tests red (module missing) → green, +1 at 6C (the shorter-side floor); 17 sabotages each red on their own guard (the varint-limit one first stayed green and its test was moved); 6C advisor clean, the fuzz made ~20x cheaper (one expect per signature); synthetic sizes var/claude/ptsig/sizes.txt: 6 strokes / 720 samples = 1 frame at tolerance 1 [Inferred] | src/utils/signatureStrokes.ts, tests/utils/** |
| 3 | SignaturePad records and replays strokes; `phonePad` flag with a per-key default OFF, test-first; then run a REAL hand-drawn signature through the codec and record its frames, tolerance and encode time before step 4; and observe one off-canvas coordinate during a captured drag (the codec's clamp rests on `setPointerCapture`, Inferred so far) | S | done | code: 26ffb0b + lock-out fix e32b2c5 (a pad left mid-stroke refused the next finger; found at 6C, never pushed) — jsdom 15 pad cases (14 red first) + 5 flag cases (2 red first); Chrome 4 (tap on both pad kinds, a real drag past the edge, replay pixels; written after the code, proven by sabotage); 11 sabotages (flag 3, pad 6, lock-out 2), each red on its own case; a real mouse drag keeps recording past the edge under pointer capture [Verified, desktop Chrome]; full deploy gate green on 26ffb0b; real signature (W4): 1 QR at tolerance 1, 579 chars, encode 0.3 ms on the phone | src/utils/signaturePad.ts, src/config/features.ts, tests/** |
| 4 | pad.html phone page (Vite entry, CSP, i18n/RTL, QR + PNG download, no SW) + its locale keys + architecture baseline + its browser test, in one commit | M | done | commit "feat(sign): pad.html — sign on the phone …" (2026-11-10); jsdom: 6 setSize + 6 qrCanvas + 4 PNG + 12 page + 3 CSP cases, red first; Chrome 3 (dpr-2 pixels, the 909-char v19 frame read back verbatim by zxing, drag → Done → QR → zxing → the encoded frame), written before the page, red on the missing module; 20 sabotages each red on their own guard (one first stayed green — resize mid-stroke — and its test now asserts the next pointer draws); built pad.html via vite preview at 412 px / dpr 2.8125, en + ar, re-run on the committed build at 6C: axe 0 violations (WCAG 2.0/2.1 A+AA, both views), 0 console errors, 0 failed requests, 0 CSP violations, no SW, 0 overflow (a 12 px overflow found there was fixed test-first: the pad and QR now use the content box), ~60 KB gzip; editor index.html unchanged but one modulepreload (a shared chunk: i18n + locales + pad code, 48.8 KB gzip); precache +4; full deploy gate green (jsdom 4129, Chrome 712, coverage 9, qa:sweep 151/114/0) | pad.html, src/pad/**, vite.config.ts, locales/**, tests/** |
| 5 | PC modal behind the flag: Sign on phone (+ Scan in its panel) / Import image; PWA rules; locale keys, baseline, browser tests (QR round-trip, fake-camera e2e with tracks stopped, image-import pixels) in the same commits | L | doing | 5a DONE 2026-11-11 (see "Step-5a DONE" under Known issues); 5b, 5c todo | index.html, src/core/signatureManager.ts, src/ui/**, vite.config.ts, vitest.browser.config.ts, locales/**, tests/** |
| 6 | Docs + rules entry + Arabic pending-count homes + THIRD-PARTY-NOTICES (zxing-wasm MIT + zxing-cpp Apache-2.0 + qrcode-generator MIT if not already listed via qr-code-styling into the bundled list, the wasm's NOTICE duty) + full deploy gate incl. qa:sweep | M | todo | - | README.md, .claude/rules/**, KNOWN_ISSUES.md |
| 7 | Manual check on the real phone + webcam, with screenshots, including the badly-held re-test of the v19 M budget (40 cm, tilted, half brightness) and the phone's px/module + dpr; then turn the flag ON; also: the PNG download on the real phone (a data: URL with download), a multi-QR signature read by the webcam at the 1 s cycle, a native review of the Arabic pad.* strings; and: does the replayed copy look like the signature (unanswered at W4), a finger stroke dragged well past the pad edge keeps drawing, and closing the ✍ modal mid-stroke then reopening still lets you draw (lostpointercapture is Inferred) | S | todo | - | src/config/features.ts |
| 8 | Milestone three-lens panel on a frozen commit | M | todo | - | |
<!-- /progress-block -->
### Blocked
### Needs input
- Steps 1 and 7 need the developer's phone and PC webcam.
- [x] W1. Open http://<LAN-IP>:5173/pdfturbo/var/claude/qrtest/show.html on the phone — DONE 2026-11-10: the phone connected over the LAN (ss), ufw let :5173 through
- [x] W2. Open http://localhost:5173/pdfturbo/var/claude/qrtest/scan.html in desktop Chrome, Start camera, allow it — DONE 2026-11-10: Integrated Webcam granted 1280x720 @30 fps (asked ideal 1920x1080)
- [x] W3. Run the 16-size ladder in front of the webcam — DONE 2026-11-10: two full runs (var/claude/qrtest/run1.txt, run2.txt); the badly-held re-test (40 cm, tilted, half brightness) was not run and moves to step 7
- [x] W4. On the phone, open http://<LAN-IP>:5173/pdfturbo/var/claude/ptsig/measure.html, sign with a finger as on a real document, tap Measure, paste the line (walkthrough step-3 real signature) — DONE 2026-11-10: 3 strokes, 225 raw points on a 368x147 CSS-px pad (dpr 2.8125, Android Chrome 157): 378/322/285/262 body bytes at tolerance 1-4 → 1 QR at tolerance 1, 579 chars (64% of 909); encode 0.3 ms median, decode+replay 0.6 ms on the phone (var/claude/ptsig/real-signature.txt, numbers only)
- [x] W5. On the same page, Clear, draw one stroke that starts inside the box and ends past its edge, tap Measure, paste the line (walkthrough step-3 real signature) — DONE 2026-11-10: PARTLY, by W4 — real touch data held an out-of-range point (y = -0.2, offCanvasPoints 1), which is enough to justify the codec's clamp; 0.2 px is within sub-pixel rounding, so it does NOT show a stroke keeps drawing well past the edge on touch — that long excursion moves to step 7
### Needs research
- RESOLVED (step 4): the Vite 8.3.7 multi-page option is `build.rolldownOptions.input` (`rollupOptions` is a `@deprecated` alias, vite/dist/node/index.d.ts).
- RESOLVED (step 1): zxing-wasm 3.1.6 — import from `zxing-wasm/reader` (reader-only wasm 947 KB raw / 411 KB gzip; `full` is 1.5 MB); self-host with `prepareZXingModule({ overrides: { locateFile: (p, prefix) => p.endsWith('.wasm') ? wasmUrl : prefix + p } })` and `import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'` (measured: no CDN request); reader options `{ formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 }`; a result carries `version` and `ecLevel`.
### Fragile
### Known issues
- Step-5a DONE (2026-11-11 10:59; the 00:03 "RESUME HERE" entry, closed). What the resume added to the 5a tree:
  (1) the vacuous jsdom `input.value === ''` line is gone; the reset is pinned in Chrome with a real FileList
  (`tests/browser/signature-sources.browser.test.ts`, precondition asserted: one file, a `…s.png` value) — mutant
  `input-not-reset` green in jsdom, RED there. (2) The byte-mode pad-URL QR is read back by zxing as the exact URL
  (en/fr/ar x dpr 1/2); an upper-casing mutant in `makeQr` stays green in jsdom and reds all six. (3) Built-app
  acceptance, `var/claude/sig-sources-check/check.mjs` (it asserts and exits non-zero; criteria fixed before run 1,
  two corrected after it — the QR box is AT MOST 180 CSS px, and Chrome lays out in 1/64 px): the pre-5a build 3
  states, flag OFF 3 (no `#sigSources`, modal sizes identical to pre-5a at 1280 and 414), flag ON 6 (en/fr/ar x
  1280/414: pad URL `…pad.html#lang=<lang>`, translated refusal, import onto the pad, Save closes modal + panel) —
  no console error, failed request, CSP or axe violation. (4) `src/styles/editor.css` is CRLF in git and the 5a
  edit had saved it LF (291/274 in `--numstat`); restored, the diff is 17/0. (5) Found by reading the screenshots,
  not by the script: the placement ghost floated above the modal — pre-existing, fixed in its own commit (ruling
  2026-11-11; `.claude/rules/ui.md` § "The placement ghost floated above every dialog").
- Known, left as is (ruling 2026-11-11): at 414 px on a FIRST visit the cookie banner covers the ✍ modal's Save
  row when the phone panel is open — in French (the longest strings) even with no refusal message; the modal is
  then ~750–790 px in an 860 px viewport. It clears when the banner is dismissed, and the modal scrolls. Look at it
  on the real phone in step 7.
- 5a, NOT certified by execution: the Arabic strings (no native review); a real phone scanning the pad-URL QR
  (step 7); flag OFF at a SHORT viewport — `.signature-content` now has `max-height: 90vh; overflow-y: auto` for
  every user, measured identical to pre-5a at 900 and 860 px high only (the modal is 349 px tall, so it bites
  below ~390 px); the zero-size image refusal in `signatureImage.ts` (no test reaches it; it fails closed).
- 5a, certified at 6C round 1 (2026-11-11): the BUILT `pad.html` honours `#lang=` (`padMain.ts`, reachable only
  through the built page; `var/claude/sig-sources-check/padlang.mjs` on the gate's own `dist/`): `#lang=ar` under
  an en-US browser → `lang="ar" dir="rtl"`, Arabic buttons, nothing stored; `#lang=en` under fr-FR → English;
  `#lang=xx` and no fragment → the browser's language, stored as before; no console or CSP error (6 cases).
- Step-5 plan (3C rounds 1–2 with advisor, 2026-11-10; the choices marked † were ruled by the developer 2026-11-10 23:46):
  **5a — Sign on phone + Import image.** Markup `#sigSources` in `#signatureModal` (removed by `main.ts` when
  `phonePad` is off, the existing pattern): † two buttons, *Sign on phone* (an inline panel above the canvas: the
  pad-URL QR via `drawQr`, `new URL('pad.html', origin + BASE_URL)` + `#lang=<current>`, the URL as text, the "if your
  phone opens the editor, accept Update" note, and — in 5b — *Start camera*) and *Import image*. `pad.html` honours
  `#lang=` (en/fr/ar only). `SignatureManager.onClosed(fn)`, called from `closeModal()` and `save()` (the only two
  close paths, grep-verified), exposed as public `app.onSignatureModalClosed` (no `app._` reach-in). Import
  (`src/utils/signatureImage.ts`): png/jpeg/webp, ≤ 15 MB; loaded as an `<img>` from a blob URL (header only, EXIF
  orientation applied) and refused above 50 MP BEFORE `createImageBitmap(img, {resizeWidth/Height})` to a long side ≤
  2048; composited over WHITE first (so the pad's own transparent PNG imports right); † paper keyed out: the paper level
  from a high brightness percentile, alpha ramped from it, ink colour kept; trimmed to the ink box, fitted (contain,
  centred) onto `signatureCanvas` by a new `SignaturePad.drawImage` that clears the strokes; Save unchanged (getDataURL
  re-encodes PNG, dropping metadata). Fixtures fixed BEFORE the code: (i) `strokesToCanvas` → PNG → import keeps every
  stroke; (ii) a photo-like image, paper a gradient 235 → 170 across it, ink 40: alpha 0 everywhere outside the ink,
  ink alpha ≥ 200 — if one global level fails (ii), the keying goes local, the criterion does not move. Failure paths
  (a UI message, no console.error, blob URL revoked): wrong type, too big, too many pixels, corrupt image. Gates: the
  axe gate opens the signature modal WITH the panel open, 414/1280 px, en/fr/ar; Label in Name for the new buttons;
  before/after screenshots of the modal shown in the turn.
  **5b — Scan.** `src/utils/ptsigCollector.ts` (pure, jsdom): `feed(text)` → frames grouped by
  `readFrameHeader().crc` (≤ 4 groups held, oldest dropped); a complete group decodes; `crc`/`mixed` drops that group
  and scanning goes on; `version` → "refresh the page on your phone"; `magic`/`base45` → ignored with a "not a
  PDFturbo signature" hint; text never trimmed. `src/ui/qrScanner.ts`: lazy `zxing-wasm/reader` (self-hosted wasm),
  `getUserMedia`, a non-overlapping loop (video → canvas → ImageData → `readBarcodes`); a cancel token checked after
  every await; tracks stopped on success, Stop, Cancel, Escape, Save and a hidden tab (UI back to *Start camera*);
  NotAllowed/NotFound and the unexpected failures (zxing import or wasm fetch fails, a throw in the loop) shown in the
  panel, tracks stopped, never console.error. Success → `pad.replay(sig)` + "Scanned — press Save" († no auto-save).
  Chrome: a fake camera (`canvas.captureStream`, repainted) with 1 then 2 cycling frames → pad pixels + every track
  `ended`; one test per stop path. Flag-ON acceptance: a build with `VITE_FEATURE_PHONE_PAD=true` into
  `var/claude/`, `vite preview`: the wasm instantiates with 0 CSP violations, a denied camera gives 0 console errors,
  axe with the scan panel open (414/1280, en/fr/ar), one `qa:sweep` run against it.
  **5c — PWA.** Runtime cache `zxing-wasm` (CacheFirst, `/assets/zxing_reader*.wasm`) before the `.js` rule. †
  `pad.html` OUT of the precache (`globIgnores`) and served NetworkFirst (`pad-page` cache) — this REVERSES the Formal
  Plan line "the new service worker precaches `pad.html`": a precached pad updates only when the EDITOR's prompt is
  accepted (`registerType: 'prompt'`; the pad shows no prompt), so "refresh the page on your phone" would not cure a
  version mismatch; no offline claim (no runtime rule covers `.css`). The `navigateFallbackDenylist` entry for
  `pad.html` is load-bearing: the built `dist/sw.js` registers `NavigationRoute(index.html)` BEFORE the runtime
  routes (grep-verified). `qa-sweep.mjs` gains a pad pass: await `navigator.serviceWorker.ready` on the editor, open a
  NEW page in the same context, assert `navigator.serviceWorker.controller !== null` and that the pad (not the editor)
  rendered, draw → Done → QR, axe, 0 console errors; the documented sweep baselines updated. The manifest link on
  `pad.html` stays, documented (an install from the pad installs the editor). Dev caveat (documented, no UI): on
  `localhost` the pad-URL QR names localhost; step 7 uses the by-hand LAN route.
  Each of 5a/5b/5c: test-first, sabotages, its own 6C, the full gate green before its commit.
- Step-1 findings for steps 2–5: the PTSIG text must stay in the QR alphanumeric set (alphanumeric mode is 2–7 versions smaller than byte mode for the same text, measured (3–7 at EC M, 2–7 at EC L)); the test encoder was `qrcode-generator` 1.5.2 with an explicit `'Alphanumeric'` mode — `pad.html`'s encoder is chosen in step 4 and must also force that mode; draw with integer device pixels per module and a 4-module quiet zone; `pad.html` needs a `<link rel="icon">` under the base path (the test page drew a root `/favicon.ico` 404, which the QA sweep would fail on); one decode in run 2 returned text that was not the expected payload (`bad:1` at v32 M, text not logged, cause unknown — a misread or another code in view). The strict header checks would NOT catch a misread body behind an intact header: step 2 decides whether PTSIG carries an integrity check (e.g. a CRC), and the step-7 scan page logs any mismatched text.
- Step-4 acceptance (3C round 1, 2026-11-10): (a) the BUILT `pad.html` loaded from `vite preview` in Chrome from a
  clean profile: draw, Done, QR, Download — zero console errors, failed requests or CSP violations, no service worker
  registered, favicon under the base path, screenshots en + ar; (b) `zxing-wasm/reader` and `qrcode-generator` listed in
  `vitest.browser.config.ts` `optimizeDeps.include`, proven by the cold-cache pair `rm -rf node_modules/.vite &&
  npm run test:browser && npm run test:coverage:export`; (c) the encoder pinned to the budget test-first: a 909-char
  frame starting and ending with a space → 93 modules (v19 M) and zxing reads back the identical text (else fall back
  to the installed 1.5.2); (d) `setSize` fixes the canvas CSS box in px (no fluid width in pad.css), Chrome asserts
  rect width = logical width, and a resize of a drawn pad rescales its strokes (contain) and redraws them; (e) the dpr
  transform proven by pixels: `setSize(w, h, 2)` + a real pointer at CSS (x, y) paints buffer (2x, 2y), sabotaged by
  dropping the transform. Also: the QR cycle timer stops on Edit and when the page is hidden; the PNG margin is at least
  half the line width; record the precache size delta, list what `dist/pad.html` loads (no editor chunk) and its gzip
  size; the QR draw helper lives in `src/utils/` so step 5's PC modal reuses it without a `ui->pad` direction.
- Step-4 findings for steps 5–7 (2026-11-10): `pad.html` carries the PWA `<link rel="manifest">` the plugin injects
  (start_url = the editor) — harmless without a SW, but an "Install app" from the pad installs the editor; revisit in
  step 5's PWA rules. The pad reads its language from localStorage/navigator only — step 5's pad URL may add `#lang=`.
  `mountPadPage` returns `destroy()`; `paintStrokes` (signaturePad.ts) and `drawQr`/`strokesToCanvas` (src/utils/) are
  reusable by the PC modal without a `ui->pad` direction. Rolldown names the shared chunk `signaturePad-*`. Step 5
  also owns: opening `pad.html` with the editor's service worker INSTALLED (it is now in the precache; a phone that has
  used the editor is in that state, and no run has tested it), and deciding whether `qa:sweep` gets a pad pass (nothing
  in CI loads the built pad page; the 6C check is var/claude/pad-preview/check.mjs, local only).
- Step-3 findings for step 4 (2026-11-10): the developer's phone has dpr 2.8125 and a 368x147 CSS-px pad, and the
  pad's buffer equals its CSS size, so it draws at about a third of the screen's resolution. pad.html should size the
  buffer by `devicePixelRatio` and keep RECORDED points in CSS units (scale the context, not the points) — but then
  `toSignatureInput()` and `replay()`, which read `canvas.width/height` (buffer pixels), would encode the signature into
  ~1/dpr of the grid and overshoot on replay. So step 4 gives the pad a LOGICAL size (CSS px) that both methods use,
  tested at a dpr other than 1. A real finger signature was 3 strokes / 225 points → 1 QR at tolerance 1 (579 of 909 chars).
- Step-2 findings for steps 3–5 (6C, 2026-11-10): a frame's base45 text may start or end with a SPACE (space is in the
  alphabet), so nothing on the pad or scan path may trim, normalise or re-case it; replay must draw a one-point stroke as
  a dot (the codec keeps taps); the scanner groups frames by `readFrameHeader(text).crc` and decodes a group once it is
  complete, because one stray frame of another code in view makes `decodeSignatureFrames` throw `mixed`.
- pdfjs-dist held at ~6.3.289 (2026-11-10): 6.4.299 resolves DOCX font names to the internal id (`docx-font-names.browser.test.ts`, 2 cases); 6.5.438 also reds 8 prune/load-guard oracle cases (multi-stream parse). Separate task, not scheduled.
- A desktop with no webcam cannot scan; it uses Import image instead.
