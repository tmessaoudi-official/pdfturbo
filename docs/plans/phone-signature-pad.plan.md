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
- [2026-11-11 11:32] AGREED: Step 5b (Scan) runs as Large: the ruled 5b plan is re-read against the code after 5a, restated, and waits for an explicit go before any code.
- [2026-11-11 11:44] AGREED: 5b camera preview: while the camera runs, the live video takes the pad-URL QR's 180 px box in the Sign on phone panel; Stop or a scan brings the QR back.
- [2026-11-11 11:44] AGREED: 5b 3C tier: advisor() only.
- [2026-11-11 11:51] AGREED: Step 5b plan GO as restated after 5a (3C rounds 1-3 with advisor, clean).
- [2026-11-11 11:51] AGREED: 5b preview mirrored by CSS only (scaleX(-1)); decoding reads raw frames.
- [2026-11-11 11:51] AGREED: 5b adds the optional built-app scan of a real PTSIG QR via a .y4m fake camera, time-boxed ~30 min; dropped and recorded if the tooling fails.
- [2026-11-11 12:24] AGREED: Cookie banner over the signature modal's Save row: ruling kept after 5b's new evidence (FR 414 with the phone panel open: Save FULLY covered until the banner is dismissed); the Known issues note is updated, step 7 looks at it.
- [2026-11-11 12:42] AGREED: 5b 6C tier: advisor() only.
- [2026-11-11 13:40] AGREED: Step 5c (PWA rules) is Medium: a 3-5 bullet plan and a go before code (size gate after the 5b commit).
- [2026-11-11 13:48] AGREED: Step 5c plan GO as written: config-text tests red first, vite.config.ts (pad.html globIgnores + navigateFallbackDenylist, zxing-wasm CacheFirst, pad-page NetworkFirst), a deploy-blocking qa-sweep pad pass (SW part SKIP on dev), a built-app offline proof + 3 sabotages, docs.
- [2026-11-11 13:48] AGREED: 5c 3C tier: advisor() only.
- [2026-11-11 14:09] AGREED: Finish order: 5c, step 6 docs/NOTICES, step 7 real phone (developer), step 8 milestone panel, then the version bump LAST and one push + deploy with the feature on (status report 2026-11-11, estimate 4-5 h Claude + ~30 min developer).
- [2026-11-11 14:09] AGREED: The release is a MINOR version bump (x.Y.0): a new user-facing feature, no breaking change; the current version is shown before it is written.
- [2026-11-11 14:41] AGREED: 5c browser red (cold full run, load 33: 9 import failures + 3 tests) accepted as load noise: browser-suite inputs identical to 3cd3054 (cold 736/0), all 17 red files 225/225 together; the full suite re-runs in the pre-push gate and CI.
- [2026-11-11 14:43] AGREED: 5c 6C tier: advisor() only.
- [2026-11-11 14:51] AGREED: Step 6 is Medium; plan GO as written: notices (zxing-wasm reader = zxing-cpp + ZXingWasm.cpp Apache-2.0 + stb_image MIT/PD; qrcode-generator 2.0.4 direct), Arabic pending count 31->64 in all homes, signing.md phone-pad section, README feature + offline lines, full gate.
- [2026-11-11 14:51] AGREED: privacy.html gains a Camera section in EN/FR/AR now (camera only while scanning, frames processed on the device, never stored or sent, tracks stopped); the text is shown before the commit; Arabic [Unverified] until a native read.
- [2026-11-11 14:51] AGREED: Step 6 3C tier: advisor() only.
- [2026-11-11 15:13] AGREED: privacy.html Camera text approved as written (EN/FR/AR shown before the commit).
- [2026-11-11 15:13] AGREED: Step 6 6C tier: advisor() only.
- [2026-11-11 16:53] AGREED: Order changed while the developer is away from the PC: the step-8 three-lens panel runs now on frozen d93ed13; step 7 (real phone) after, then the flag ON (one line + the signing.md bullet), then the 1.1.0 bump and one push; a code fix from step 7 needs a panel re-round.
- [2026-11-11 16:55] AGREED: Step-8 panel reviewers run on fable.
- [2026-11-11 17:10] AGREED: Milestone panel round 1 (fable, frozen d93ed13): 22 findings (3 P1, 7 P2, 12 P3, no P0) in var/claude/raw/m3r1-*.md; fix #1-#20 as proposed, #21 resolved by the flag-ON before the push, #22 accepted; round 2 on the fix commit.
- [2026-11-11 17:10] AGREED: Agent definitions completeness-reviewer.md and safety-promises-reviewer.md: correct the stale exemption and globIgnores facts (developer go).
- [2026-11-11 17:10] AGREED: Round-1 refuter stage skipped: each finding verified by reading (greps in the session); round 2 re-reviews every fix.
- [2026-11-11 17:13] AGREED: Round-1 fix round 3C tier: advisor() only.
- [2026-11-11 17:51] AGREED: Round-1 fix round 6C tier: advisor() only (panel round 2 follows on the commit).

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
  scan again". Pad parameters go in the `#fragment`, never the query, so a cached `pad.html` still matches (5c took
  `pad.html` out of the precache: it is served NetworkFirst from the `pad-page` cache).
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
| 5 | PC modal behind the flag: Sign on phone (+ Scan in its panel) / Import image; PWA rules; locale keys, baseline, browser tests (QR round-trip, fake-camera e2e with tracks stopped, image-import pixels) in the same commits | L | done | 5a DONE 2026-11-11 (see "Step-5a DONE" under Known issues); 5b DONE 2026-11-11 ("Step-5b DONE"); 5c DONE 2026-11-11 ("Step-5c DONE") | index.html, src/core/signatureManager.ts, src/ui/**, vite.config.ts, vitest.browser.config.ts, locales/**, tests/** |
| 6 | Docs + rules entry + Arabic pending-count homes + THIRD-PARTY-NOTICES (zxing-wasm MIT + zxing-cpp Apache-2.0 + qrcode-generator MIT if not already listed via qr-code-styling into the bundled list, the wasm's NOTICE duty) + full deploy gate incl. qa:sweep | M | done | DONE 2026-11-11 ("Step-6 DONE"); also public/privacy.html (Camera section, ruled) | README.md, .claude/rules/**, KNOWN_ISSUES.md, THIRD-PARTY-NOTICES.md, public/privacy.html |
| 7 | Manual check on the real phone + webcam, with screenshots, including the badly-held re-test of the v19 M budget (40 cm, tilted, half brightness) and the phone's px/module + dpr; then turn the flag ON; also: the PNG download on the real phone (a data: URL with download), a multi-QR signature read by the webcam at the 1 s cycle, a native review of the Arabic pad.* strings; and: does the replayed copy look like the signature (unanswered at W4), a finger stroke dragged well past the pad edge keeps drawing, and closing the ✍ modal mid-stroke then reopening still lets you draw (lostpointercapture is Inferred). The flag-ON commit also edits every "off" surface: `signing.md`'s "Flag `phonePad` defaults OFF" bullet, the FEATURES and CHANGELOG "off by default" parentheticals, `flow-export.md`'s "`DEFAULT_OFF` — `phonePad`" line, and `main.ts`'s step-5 comment | S | todo | - | src/config/features.ts, .claude/rules/{signing,flow-export}.md, FEATURES.md, CHANGELOG.md, src/main.ts |
| 8 | Milestone three-lens panel on a frozen commit | M | doing | round 1 on d93ed13 (22 findings, `var/claude/raw/m3r1-*.md`); fixes in the round-1 fix commit; round 2 next | |
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
- Step-5b DONE (2026-11-11; certifying gate 13:27 + the cold-cache `test:browser`, see 6C round 1). Code: `src/utils/ptsigCollector.ts` (frames grouped by crc, LRU of 4,
  every `PtsigErrorCode` mapped), `src/ui/qrScanner.ts` (camera first, then lazy zxing; one `finish` stops every
  track), the camera toggle + preview + polite status in `signatureSources.ts`, 11 keys x 3 locales, 5 CSS lines
  (CRLF kept: numstat 5/0 with and without `-w`), `ui->utils` baseline 39/36 → 41/37 (the ratchet pins no `?query`
  count for `ui/`). Tests: jsdom collector 14 + scanner 22 + panel 17 new scan cases (+3 at 6C: 20 new; the file holds 35 with 5a's), each file red first (module/markup missing);
  Chrome `signature-scan.browser.test.ts` 9 (fake camera = repainted `canvas.captureStream`, real zxing, real pad),
  written after the code and proven by sabotage. Sabotage: 23 mutants at first, all landed and restored byte-exact; 22 red at
  once, C4 (the total-mismatch check) first stayed GREEN — the decoder's own `mixed` gave the same outcome — and its
  case now asserts the observable difference (a 3-frame group then a 2-frame frame → `dropped`, not "part 2 of 3").
  Built app (`var/claude/sig-scan-check/scan.mjs`, flag-ON build): granted 6 states (en/fr/ar x 1280/414: live
  tracks, wasm `200 /pdfturbo/assets/zxing_reader-*.wasm`, 0 CSP, preview 180x180 mirrored, axe clean with the camera
  RUNNING, Stop restores the QR); denied 3 (the refusal shown, 0 console errors, the wasm never fetched); y4m 1 — a
  REAL PTSIG QR through the fake camera: pad ink 3713 px, Save → drag → ONE signature element (ink 3.7%, spans 453 of
  500 px). 5a's driver on the 5b builds: flag OFF 3 states, modal sizes identical to 5a (600x349, 373x294, 373x299);
  flag ON 6 states (FR 414: Save covered by the storage banner, dismissed first — the known issue below). Precache:
  30 → 31 entries, +46.8 KB (the lazy `reader-*.js` zxing chunk, 36 KB, in EVERY build, flag on or off); the 947 KB
  wasm is not precached — 5c's runtime rule. zxing reached only by a dynamic `import()`, not modulepreloaded. Full gate
  (cold-cache pair included): jsdom 4223, Chrome 736, coverage 45.45% branches, qa:sweep 151/114/0.
  NOT certified by execution: a real webcam reading a real phone (step 7); the Arabic scan strings (no native review);
  a camera unplugged mid-scan in a real browser (jsdom only); `NotReadableError` (camera busy) shown as "failed";
  `NotFoundError` from a real browser with NO camera (this machine has a webcam; the fake-device flags always give one —
  jsdom only, the no-API path below reaches the same message).
- 5b, 6C round 1 (advisor, 2026-11-11) — fixed or added, test first where code changed:
  (a) a scan that ended INSIDE `startScan()` (no `getUserMedia`, so `onEnd` ran synchronously) left a dead handle in
  `camera`, so the next Start click called `stop()` on it and did nothing — fixed with an `ended` flag (jsdom case red
  first; mutant P8 red); proven in a real browser by `scan.mjs noapi` (`navigator.mediaDevices` removed, as on a
  plain-http LAN page): en/fr/ar show "No camera found", 0 console errors, no wasm fetched, and a SECOND Start runs a
  new scan (`mediaDevices` read 1 → 2). (b) the status line was rewritten every frame (≈12/s, re-announced by
  `role=status`) — now written only on change (MutationObserver records 0; P9 red). (c) a second import superseding
  the first (`++epoch`) was unpinned — supersede case + P7 red. (d) Escape with the camera RUNNING, added to granted
  mode: all 6 states end with the modal closed, `srcObject` null and every track `ended`. (e) the flag-ON qa:sweep, the
  ruled "one run against the flag-ON build": 156 checks / 114 pass / 0 fail, 0 serious a11y, 66 of 144 controls; it
  did NOT click `sigCamBtn` (SKIP "became hidden before click"), so the camera path is certified by `scan.mjs`, not
  by the sweep. Sabotage after the fixes: 26 mutants (P7–P9 added), all red, every restore `cmp` clean.
  Full gate re-run on the fixed tree (`var/claude/gate-5b-r2/gate.log`, load 28–37 from other projects' gates on 8
  cores): audit, ocr, type-check, lint, jsdom 4226 (+3), coverage, build, qa:sweep 151/114/0 all rc=0; Chrome 734
  pass + 2 red in files 5b does not touch (`redaction-orphan-leak` "Failed to fetch dynamically imported module",
  `userunit-frame` CONTROL 30 s timeout) — both files 24/24 green re-run alone (`isolated.log`). Not
  the optimizer-reload trap: no `optimized dependencies changed` line in either 5b gate log, and `zxing-wasm/reader`
  + `qrcode-generator` are in `optimizeDeps.include` since step 4. Closed by a full COLD-cache `test:browser` on the
  same tree (`rm -rf node_modules/.vite`, `browser-cold.log`): 131 files, 736 pass, 3 skipped, rc=0 at load 26.
  No timeout raised.
- Step-5c DONE (2026-11-11). `vite.config.ts`: `**/pad.html` in `globIgnores`, `navigateFallbackDenylist:
  [/^[^?]*\/pad\.html(?:\?|$)/]` (path-anchored by milestone panel round 1; Workbox matches a denylist on pathname + search — `workbox-routing/NavigationRoute.js:85`),
  `zxing-wasm` CacheFirst (`/zxing_reader` + `.wasm`, same origin, 2 entries) and `pad-page` NetworkFirst
  (`/pad.html`, same origin). Built `sw.js`: precache 31 → 30, the denylist and both caches present. Tests (red first):
  `tests/infra/pwaOcrCaching.test.ts` +4, which RUN the extracted `urlPattern` functions and the denylist on real URLs.
  `scripts/qa-sweep.mjs` pad pass (before the fixture, so no pdf.js document is live): a built worker detected by
  `sw.js`'s BODY (a dev server answers it with index.html, 200); `serviceWorker.ready` bounded at 60 s → FAIL; the
  precache by PATHNAME (keys carry `?__WB_REVISION__`) with `index.html` as the control; a new page → the pad (not the
  editor: either page is awaited, so a fallback reports "the EDITOR rendered") under the worker → draw → Done → QR, axe,
  0 errors. Red first on the pre-5c build: "pad.html IN". The sweep's `Exercised N` line now counts DOM control ids
  only (it counted `boot`/`load`/`a11y` subjects: 66 → 57 of 141 on the same build; `ui.md` amended).
  Offline proof `var/claude/sig-scan-check/pwa.mjs` (flag-ON build, y4m camera = a REAL PTSIG QR): the editor is
  controlled after a new navigation (no `clientsClaim` — the prompt behaviour is untouched); an online scan stores the
  wasm in `zxing-wasm`; a pad visit stores `pad-page`; then the preview server is STOPPED (a Node fetch must fail) and
  the editor still opens, a scan completes (ink 3713 = online) with the wasm answered by the worker
  (`fromServiceWorker`), and the pad opens from the worker. Sabotage (each landed, rebuilt, restored with `cmp`): M1 no
  denylist → config test + sweep ("the EDITOR rendered at pad.html"); M2 pad precached → config test + sweep ("pad.html
  IN"); M3 no zxing rule → config test + `pwa.mjs` (cache null, offline scan never done); M4 no pad-page rule → config
  test + `pwa.mjs` (offline pad refused). The first M3/M4 runs failed the offline scan for a DRIVER reason — the earlier
  page's autosave raised the restore prompt over the toolbar — so `pwa.mjs` now declines it, as qa-sweep does, and M3
  and M4 were re-run: M4 then fails ONLY on the pad, M3 at the scan itself.
  NOT certified by execution: an installed PWA on a real phone across a deploy (step 7); the `zxing-wasm` rule in CI
  (CI sweeps the flag-OFF build and never scans — `pwa.mjs` certifies it once).
  Gate (`var/claude/gate-5c/gate.log`): audit, OCR assets, type-check, lint, jsdom 4230, coverage:export, build — rc=0;
  qa:sweep 156 checks / 119 pass / 0 fail / 37 skip, the 5 pad checks PASS, 57 of 141; `all.sh` 11 built-app checks
  rc=0 (flag-ON sweep 161 / 119 / 0 / 42 skip, 57 of 144). `test:browser` red twice under load 27–33 (8 then 9 files
  "Failed to import", plus on the cold run 3 tests: a11y-axe 414 px timeout and its fr knock-on, redaction-orphan-leak
  "Failed to fetch dynamically imported module"); its inputs are identical to `3cd3054` (cold 736/0) and all 17 red
  files pass together (225/225, load 23–28) — accepted as load noise by ruling (Decisions Log 14:41); the full suite
  re-runs in the pre-push gate and in CI.
  6C round 1 (advisor, tier ruled): one doc defect — the CLAUDE.md pad-pass sentence had split "CI runs it with
  `--allow-destructive`" from "That run measured …", so it now follows that sentence; the gate post-dates the last
  `qa-sweep.mjs` / `vite.config.ts` edit (14:10:52 / 14:08 < 14:11:06) and `vite.config.ts` equals its snapshot; the
  offline-pad and sweep pad-QR screenshots were read. `ocr.md` § "PWA caching (#48" and the safety reviewer still quote
  the one-entry `globIgnores: ['**/tesseract/**']` — pre-existing, not changed by 5c, still true of the tesseract entry.
- Step-6 DONE (2026-11-11), docs only (no `src/`). `THIRD-PARTY-NOTICES.md`: zxing-wasm 3.1.6 moved to the bundled list
  with what its shipped READER wasm is compiled from — zxing-cpp at `2c3dcfef…` (Apache-2.0, its librscpp too),
  `ZXingWasm.cpp` (Apache-2.0), stb_image (MIT/PD, used under MIT; its error strings are in the wasm) and libzueci
  (BSD-3-Clause, inferred from zxing-cpp's CMake: `ZXING_ENABLE_UNICODE` defaults ON); zint is writer-only and not shipped;
  no `NOTICE` at either pinned commit (raw URLs 404), so Apache §4(d) adds no file. qrcode-generator 2.0.4 listed as a
  direct dependency; 1.5.2 (via qr-code-styling) now *verified* — both copies ship. Arabic pending count 31 → 64 in
  its four homes (`toolchain.md`, `redaction.md`, `export.md`, `KNOWN_ISSUES.md`); `crop.md:135`'s "15" is a dated
  statement of the 2026-09-13 set and stays. `.claude/rules/signing.md`: § "The phone signature pad" + 8 `paths:` globs
  for the pad files; CLAUDE.md signing bullet (5 → 6). README: the feature bullet and the offline line (the pad page
  registers no worker). `public/privacy.html` (ruled): a Camera section in EN/FR/AR and "Last updated" → November 2026;
  before/after screenshots `var/claude/privacy-shots/`, read; its Arabic paragraph is unreviewed and recorded beside the
  pending count in `KNOWN_ISSUES.md`. Gate (`var/claude/gate-6/gate.log`, load 17–26): all 9 steps rc=0 — jsdom 4230,
  `test:browser` 736/0 from a cleared `node_modules/.vite` (the same suite inputs as 5c bar `public/privacy.html`, which
  backs the 14:41 load-noise ruling), coverage, build, qa:sweep 156 / 119 / 0 / 37 skip with the 5 `pad:` checks PASS,
  57 of 141.
  6C round 1 (advisor, tier ruled): `SECURITY.md` § Scope lacked the new input surfaces — a phone-pad bullet added (the
  scanned QR and the imported image are untrusted, the camera's lifetime), and its node-forge sentence was stale ("exempted
  until 2026-12-31"; the allowlist is `[]` since 2026-11-10) — corrected; README's PNG route says the user moves the file;
  the notices' "added" line names the Emscripten runtime as not listed (as for every wasm in the file). Re-shot `after-fr`
  read (Camera section, "novembre 2026"); the footer and storage-banner links are `./privacy.html` (`index.html:245,260`).
  `signing.md` is now 323 lines, over the ~300 intake cap — recorded, a candidate for the next `/rules-split` prune. Its
  "Flag `phonePad` defaults OFF" bullet goes stale when step 7 turns the flag on: edit it in that commit.
- Milestone panel round 1 FIXES (2026-11-11, on d93ed13's findings, `var/claude/raw/m3r1-*.md`). Certified by
  execution (each red first or mutant-proven, restored with `cmp`): #4 the flag gate moved to `src/ui/phonePadGate.ts`
  (`applyPhonePadFlag`; `tests/ui/phonePadGate.test.ts` 6 — gate inverted → 3, main.ts negated / hard-coded true / call
  deleted → the source check, the close forward dropped → 1); #5 `tests/ui/qrScannerZxing.test.ts` 4 + a CSP
  `connect-src 'self' blob:` pin (locateFile → CDN, the retry memo, `fireImmediately`, the validity filter, a widened
  CSP → each red); #6 `--require-sw` (FAIL instead of SKIP when no built worker; `deploy.yml`, the local gate scripts;
  `tests/infra/qaSweepRequireSw.test.ts` 2 red first; LIVE on a dev server: with the flag rc=1 `FAIL pad: service
  worker`, without rc=0 SKIP); #11 the denylist anchored `^[^?]*` (red first on `/pdfturbo/?next=/pad.html`); #12 the
  `pad-css` CacheFirst rule (red first; any-css / cross-origin mutants red); #14 `canvasGrab` exported, every scan end
  calls `release()` (canvas zeroed, terminal) — 5 cases red first, 3 mutants red. NOT certified by execution: #12's
  two-build scenario (an older worker serving a newer pad offline) — never driven; the wasm heap's copy of the last
  frame (#14's bound, `KNOWN_ISSUES.md`). Docs: #1 README offline sentence, #2 FEATURES + CHANGELOG through
  2026-11-11, #3 SECURITY (the PTSIG decoder is fuzzed; zxing is not), #7 KNOWN_ISSUES § "From the phone signature
  pad", #8 signing.md globs, #9 the CLAUDE.md index counts (ui 16, toolchain 11), #10 the two agent definitions
  (developer go), #13 zxing logs on its own wasm failure, #15 the lostpointercapture comment, #16–#20.
  Outside the range, NOT fixed (reported to the developer): `icon.svg` is referenced by `index.html`, `pad.html` and
  the manifest but exists in neither `public/` nor `dist/`.
- Known, left as is (ruling 2026-11-11): at 414 px on a FIRST visit the cookie banner covers the ✍ modal's Save
  row when the phone panel is open — in French (the longest strings) even with no refusal message; the modal is
  then ~750–790 px in an 860 px viewport. It clears when the banner is dismissed, and the modal scrolls. Look at it
  on the real phone in step 7. **5b made it worse (ruling kept, 2026-11-11):** the Start camera row takes the FR
  modal at 414 px to its 90vh cap (774 px), and with the phone panel open the Save row sits FULLY under the storage
  banner (`z-index: 9000`, above every dialog at 1000) — Save cannot be clicked until the banner is dismissed
  (measured: Playwright's click timed out, `var/claude/sig-scan-check/5a-rerun/`). Panel closed: 400 px, no overlap.
  The root cause is the banner's stacking over EVERY dialog, not this modal.
- 5a, NOT certified by execution: the Arabic strings (no native review); a real phone scanning the pad-URL QR
  (step 7); flag OFF at a SHORT viewport — `.signature-content` now has `max-height: 90vh; overflow-y: auto` for
  every user, measured identical to pre-5a at 900 and 860 px high only (the modal is 349 px tall, so it bites
  below ~390 px); the zero-size image refusal in `signatureImage.ts` (no test reaches it; it fails closed).
- 5a, certified at 6C round 1 (2026-11-11): the BUILT `pad.html` honours `#lang=` (`padMain.ts`, reachable only
  through the built page; `var/claude/sig-sources-check/padlang.mjs` on the gate's own `dist/`): `#lang=ar` under
  an en-US browser → `lang="ar" dir="rtl"`, Arabic buttons, nothing stored; `#lang=en` under fr-FR → English;
  `#lang=xx` and no fragment → the browser's language, stored as before; no console or CSP error (6 cases).
- 5a, certified at 6C round 2 (2026-11-11, after the 5a commit; `var/claude/sig-sources-check/placed.mjs`, flag-ON
  build): an IMPORTED image goes Save → drag on the page → ONE signature element whose image is the import (500x200,
  ink 3.4% of the pixels, spanning the full width — not blank, not a filled box); changing the width and colour
  inputs after the import leaves the pad's pixels untouched (3428 = 3428). Save reads the pad's pixels
  (`getDataURL`, `isEmpty` by alpha), so an image with no strokes is saved as drawn. Reuse it for 5b's scan.
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
  panel, tracks stopped, never console.error from our code (zxing itself logs one when its wasm fails to load — milestone
  panel round 1, 2026-11-11; a real failure, so the QA sweep is right to flag it). Success → `pad.replay(sig)` + "Scanned — press Save" († no auto-save).
  Chrome: a fake camera (`canvas.captureStream`, repainted) with 1 then 2 cycling frames → pad pixels + every track
  `ended`; one test per stop path. Flag-ON acceptance: a build with `VITE_FEATURE_PHONE_PAD=true` into
  `var/claude/`, `vite preview`: the wasm instantiates with 0 CSP violations, a denied camera gives 0 console errors,
  axe with the scan panel open (414/1280, en/fr/ar), one `qa:sweep` run against it.
  **5b restated after 5a (3C round 1 with advisor, 2026-11-11; preview ruling 11:44).** Adds to the above:
  collector events `done | progress(have,total) | refresh | foreign | dropped`, every `PtsigErrorCode` mapped through a
  `Record<PtsigErrorCode, …>` (tsc-exhaustive; a body error in a complete, CRC-valid group → `dropped`), a non-`PtsigError`
  rethrown; groups evicted LEAST RECENTLY FED (four junk reads must not evict the group in progress). Stop paths, each
  its own test with every track `ended`: success, Stop, Cancel/Escape, Save, hidden tab, an import starting, the panel
  collapsed by *Sign on phone*, a close while `getUserMedia` is PENDING (the late stream's tracks ended), a stop while
  `video.play()` is pending (AbortError swallowed, no unhandled rejection), a track that ends by itself (UI back to
  *Start camera*); `navigator.mediaDevices` undefined → the `noCamera` message. Constraints as step 1 (ideal 1920x1080).
  † Preview: while the camera runs the `<video>` (accessible name) takes `#sigPadQr`'s 180 px box; Stop / a scan
  brings the QR back. Progress and "Scanned — press Save" go to a polite status line, not the `role="alert"` message;
  `t` gains params. Colour/width inputs leave a replayed pad's pixels untouched (pinned). Chrome: scan → Save → drag →
  ONE signature element (as `placed.mjs`). Axe + Label in Name with the camera RUNNING and in the error state; the
  modal height at 414 px FR measured against 5a's 750–790 px. Precache: the lazy zxing JS chunk matches the precache
  globs (`**/*.js`) in EVERY build — measure the delta for 5c (the wasm is not precached). Baseline: `?url` count,
  edges. Cold-cache pair re-run. Load order: camera FIRST, then the lazy zxing import (a denial costs no download).
  † The preview is mirrored by CSS only (`scaleX(-1)`); decoding reads the raw frames. An import that lands after a
  scan must not draw over it: a scan success advances the import epoch (pinned). Built-app floor (3C round 2):
  Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` [Verified 2026-11-11: live tracks
  in all 6 granted states] — the REAL `getUserMedia` →
  `<video>` → zxing path, so the wasm instantiates (0 CSP violations) and the loop runs on the synthetic pattern; a
  denied camera (no fake-ui grant) → the message, 0 console errors; 5a's `check.mjs` re-run on the 5b build, the
  three flag-OFF states first. Optional, time-boxed (offered at the gate): `--use-file-for-fake-video-capture` on a
  `.y4m` of a real PTSIG QR, so the built app SCANS a signature end to end.
  **5c — PWA.** Runtime cache `zxing-wasm` (CacheFirst, `/assets/zxing_reader*.wasm`) before the `.js` rule. †
  `pad.html` OUT of the precache (`globIgnores`) and served NetworkFirst (`pad-page` cache) — this REVERSES the Formal
  Plan line "the new service worker precaches `pad.html`": a precached pad updates only when the EDITOR's prompt is
  accepted (`registerType: 'prompt'`; the pad shows no prompt), so "refresh the page on your phone" would not cure a
  version mismatch; no offline claim (no runtime rule covered `.css` — milestone panel round 1 added the `pad-css`
  CacheFirst rule for a pad served by an older worker; that two-build case is NOT certified by execution). The `navigateFallbackDenylist` entry for
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
