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
- [2026-11-11 18:20] AGREED: Milestone panel round 2 on frozen e54f5a1 (round-1 fixes): reviewers stay on fable.
- [2026-11-11 19:00] AGREED: Panel round 2 (e54f5a1, 15 findings, no P0/P1): fix all 15 as proposed, then round 3; #3 (--require-sw) stays a text pin plus the recorded live run.
- [2026-11-11 19:00] AGREED: Agent-definition go for round 2: completeness-reviewer.md 'The deploy gate, in full' gains the qa:sweep step (one clause); round-2 fix 3C tier: advisor() only.
- [2026-11-11 19:00] ASSUMED (review): Round-1 raw reports renamed var/claude/raw/m3r1-* -> pp1-* (round 2: pp2-*): the m3r* names belonged to the 2026-10-17 architecture milestone and were overwritten, then restored from that session's transcript; the 17:10 entry's m3r1 path reads pp1.
- [2026-11-11 19:22] AGREED: Round-2 fix 6C tier: advisor() only (panel round 3 follows on the commit).
- [2026-11-11 19:30] AGREED: Offline pad after an app update (6C round-2 finding: a pad cached before the update loads assets the new worker dropped, so it breaks offline until opened online once): accepted as a documented bound, not fixed (efe36b1 wording).
- [2026-11-11 19:30] AGREED: Milestone panel round 3 on frozen efe36b1 (round-2 fixes): reviewers stay on fable.
- [2026-11-11 19:51] AGREED: Panel round 3 (efe36b1, 12 P3, no product defect; var/claude/raw/pp3-*.md): fix all as proposed, then round 4; round-3 fix 3C tier: advisor() only.
- [2026-11-11 19:51] AGREED: privacy.html (EN/FR/AR): the phone-to-PC sentence gains the Download PNG route (shown before the commit; Arabic unreviewed); the camera grant being per site origin (shared github.io) is disclosed in SECURITY.md only.
- [2026-11-11 20:30] AGREED: privacy.html Download PNG clause approved as shown (EN/FR/AR, Arabic unreviewed); 6C tier for the round-3 fixes: advisor() only.
- [2026-11-11 20:56] AGREED: Step 7 (real phone) runs now, BEFORE panel round 4; round 4 then runs once on the commit holding the round-3 fixes, any step-7 fixes and the flag ON. Test route: a throwaway Chrome profile with --unsafely-treat-insecure-origin-as-secure for the LAN dev server, so the modal's real QR is scanned.
- [2026-11-11 22:44] AGREED: Step 7 walkthrough done on the real phone (W6-W15). F1: an Import after a scan leaves the 'Signature scanned' status on screen: fix now, test-first.
- [2026-11-11 22:44] AGREED: F2: a phone signature's ink: BOTH the PC modal's Color and Line Width apply to a scanned signature (repainted live when changed) AND the phone pad gets colour and width controls (PTSIG already carries both; no format change). Precedence rule still to rule.
- [2026-11-11 22:44] AGREED: F3: the editor is mostly unusable on the developer's phone (about a quarter visible; works in Chrome's desktop-site mode); a separate plan after 1.1.0, not this milestone.
- [2026-11-11 22:44] AGREED: W16 Arabic: later, all 64 pending keys in one pass.
- [2026-11-11 22:47] AGREED: F1+F2 sized Large: full written plan and the developer's explicit go before any code (stop for the night requested 2026-11-11).
- [2026-11-11 22:47] AGREED: F2 precedence: the PC passes its ink to the phone (the pad link's #fragment carries the PC modal's Color and Line Width, validated like lang); the phone's new controls start from them and the signer may change them; the scan replays what the phone sends; a PC Color/Line Width change after the scan repaints the scanned strokes; the QR is re-made when Color/Width change before the scan.
- [2026-11-12 09:56] AGREED: 7b phone colour: the shared palette (COLOR_PRESETS without #ffffff, plus recent colours, plus a custom swatch), the PC's colour pre-selected.
- [2026-11-12 09:56] AGREED: 7b phone width: a − / number / + stepper on the PC's 1–10 scale; the pad link carries the PC canvas width so width N on either side replays as N on the PC.
- [2026-11-12 09:56] AGREED: 7b PC modal after a scan: #sigColor and #sigLineWidth follow the scanned ink (colour, nearest whole width); a later change repaints the strokes.
- [2026-11-12 09:56] AGREED: 7b scope: the PC ✍ modal's lone native colour picker gets the shared swatch row in a follow-up row after 1.1.0, not in 7b.
- [2026-11-12 10:06] AGREED: 7b 3C tier: advisor() only.
- [2026-11-12 10:15] AGREED: 7b re-scan on an open pad: a hashchange applies the new language and ink to the open pad and repaints the strokes already drawn in it.
- [2026-11-12 10:15] AGREED: 7b real-phone re-walk (W17-W20: stepper, swatches + custom picker, red/4 round trip, PC repaint) runs on the LAN dev server BEFORE the flag-ON commit.
- [2026-11-12 10:25] AGREED: 7b Import image: an image that already has transparent pixels keeps its own alpha (no paper keying), so a light-ink phone PNG (yellow) survives; JPEG and opaque PNG are keyed as before.
- [2026-11-12 10:33] AGREED: Go on the 7b plan as written (A, A2, B, gate, re-walk W17-W22, C flag ON, panel round 4, 1.1.0, one push); default replay width 2 px accepted pending W21; A2 transparency share T measured before its commit.
- [2026-11-12 11:44] ASSUMED (review): 7b B: a custom pick of white on the phone is ignored silently (the pad keeps its colour, nothing stored) — the white ruling applied to the picker; alternative: a message.
- [2026-11-12 11:44] ASSUMED (review): 7b B: in Arabic the phone's colour row and the − 4 + stepper mirror with the page (RTL: − at the start, on the right), like every other row of the pad.
- [2026-11-12 11:44] ASSUMED (review): 7b B: a phone swatch tap does not add to the recent colours; only a custom pick does (the plan's text). The toolbar pushes on every swatch click; alternative: match it.
- [2026-11-12 11:46] AGREED: 7b B: privacy.html lists pdfturbo.recentColors in EN/FR/AR as shown; commit as is (the Arabic joins the pending native review).
- [2026-11-12 13:55] AGREED: W22 finding (WhatsApp photo mode re-encodes the pad's transparent PNG as a JPEG on black; Import kept the black and dropped the yellow): Import rescues it — an opaque, mostly pure-black image is keyed in reverse so light ink comes back, and one with no light ink (black ink sent as a photo) is refused with a 'send it as a file, not a photo' message; a fix commit before C
- [2026-11-12 14:04] AGREED: W22-F is Medium; plan GO as written (border ≥90% near-black + no own alpha → reverse keying, no bright ink → 'flattened' refusal with a send-as-a-file message, 1 key ×3, tests first, fix commit before C, W22 re-walked as a photo); 3C/6C tier advisor() only
- [2026-11-12 14:23] AGREED (ratified ASSUMED): W22-F keeps the scanner-lid bound (a light sheet on a PURE-black surround is read as light ink: the sheet kept, the ink a hole) — because it was already unusable before the fix (measured on 2bd36d9: the ink inside a thick black frame) and no cheap feature separates it from a dense flattened scribble. Alternatives: refuse when the kept area is large (breaks the 91.5%-ink scribble), a region-shape test (complex)
- [2026-11-12 14:23] AGREED (ratified ASSUMED): W22-F paints every kept pixel in ONE ink colour (the mean of the brightest tenth) with alpha = coverage, instead of the plan's 'same ramp' wording — because PTSIG and the pad carry one ink per signature and dividing each pixel by its coverage amplified the JPEG's colour error at the edges (advisor 3C round 1). Alternatives: per-pixel un-premultiply, the luminance ramp (drops pure blue)
- [2026-11-12 14:37] AGREED: W22-F ratified: the black-frame bound stays a documented limit, the rescue paints one ink colour, and the FR/AR 'lost its transparency' strings stand (Arabic still on the pending native-review list)
- [2026-11-12 14:47] ASSUMED (review): commit C removes DEFAULT_OFF from src/config/features.ts instead of emptying it — phonePad was its only key, and every flag defaults ON again with VITE_FEATURE_PHONE_PAD=false as the kill-switch; to be ratified in the 1.1.0 question. Alternatives: keep an empty DEFAULT_OFF set for a future default-OFF feature
- [2026-11-12 15:37] AGREED: Panel round 4 (frozen 3918563; 21 findings after dedup, P2:8 P3:13, no P0/P1; var/claude/raw/pp4-*.md): fix C1 (flattened test only on images without own alpha), C4 (status clears only after a successful import), C5 (bitmap.close in finally) test-first; C2 and C3 stay bounds, pinned by tests and listed in KNOWN_ISSUES; S4 reworded to exact white; the doc findings K2-K14 fixed as proposed (K8 dates at the 1.1.0 bump); then round 5
- [2026-11-12 15:37] AGREED: Kill-switch scope (PP4-K1/S3): document it — VITE_FEATURE_PHONE_PAD=false removes the PC's entry points (Sign on phone, Import image, camera); pad.html stays built and served; the variable must be added to deploy.yml to pull it
- [2026-11-12 15:37] AGREED: LAN addresses in the plan (PP4-S1): redact both in a new commit; git history keeps them
- [2026-11-12 15:37] AGREED: privacy.html (PP4-S2/K5/S5/K6): complete the storage list in EN/FR/AR (four localStorage keys, the recent-files list, Clear recent files vs Reset Session), exact text shown to the developer before the commit; both Arabic passages recorded as unreviewed
- [2026-11-12 15:49] AGREED: Round-4 fix task tier (answered 15:40, logged at the save): advisor() only at its 3C and 6C; spec mode asks the tier again at the next gate
- [2026-11-12 19:09] AGREED: The 12 commits through 9312404 were pushed at 16:04 (CI run 43243778809 green, deployed), so the flag-ON pad is live before the round-4 fixes; new order: the HTTPS smoke walk on the deployed build FIRST, then the privacy.html text (R4-1) for approval, then the other round-4 fixes, round 5, 1.1.0
- [2026-11-12 19:09] AGREED: Full-screen signing = a big pad with the controls hidden (a full-screen button; only Clear / Done / exit stay), the pad keeps PAD_ASPECT 0.4, a CSS fill as the base (iPhone Safari has no element fullscreen), requestFullscreen + orientation lock only where supported
- [2026-11-12 19:09] AGREED: Full-screen signing lands AFTER 1.1.0 as its own Medium plan and review, never inside the round-4 fix batch or round 5
- [2026-11-12 19:21] AGREED: R4-5: the privacy.html fix is pushed on its own as soon as the full gate is green (with the local docs commits), not held for 1.1.0
- [2026-11-12 19:57] AGREED: R4-1: privacy.html storage text approved as shown (built from the running app: 4 localStorage keys, 1 sessionStorage flag, IndexedDB session + recent + OCR language copy + cache list, Cache Storage of own files, no cookies; FR/AR quote the real Reset labels) PLUS one sentence that the data is stored unencrypted and a private window is advised on a shared computer
- [2026-11-12 19:57] AGREED: R4-2: C4 reverses the 10:33 pin — 'Signature scanned' clears only after a SUCCESSFUL import; a refused import leaves it, since the pad still holds the scan

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
  served NetworkFirst and kept out of the navigation fallback, so an online phone gets the current pad from the network first (the browser's HTTP cache may answer for a few minutes after a deploy). **The outdated-app case cannot be fixed from new code**
  (3C round 2): the deployed `dist/sw.js` routes every navigation to the cached `index.html`
  (`NavigationRoute(createHandlerBoundToURL("index.html"))`), so a phone on an old version gets the old editor and old
  JS. Mitigation: the "Use phone" panel on the PC says "if your phone opens the editor, accept its Update prompt and
  scan again". Pad parameters go in the `#fragment`, never the query, so a cached `pad.html` still matches (5c took
  `pad.html` out of the precache: it is served NetworkFirst from the `pad-page` cache).
- **Feature flag `phonePad`.** Keep the buttons hidden until the step-7 manual check passes. `isEnabled` today only
  defaults to ON, so it gains a per-key default.
- **Device route for steps 1 and 7.** The PC stays on `localhost`, because the camera needs a secure context. The dev
  server runs with `vite --host`, and the phone opens `http://<LAN-IP>:5173/pdfturbo/pad.html` by hand; the phone page
  needs no secure context, since it uses no camera. Node for every step: `/stack/tools/nvm/versions/node/v26.13.1/bin` (v26.13.0 until 2026-11-12; `ls` it first).
- **Fake-camera test.** It repaints the canvas after the stream starts; a static canvas may emit no frames.

**Steps** (Status table below). Acceptance: the full deploy gate is green, including `qa:sweep`; a real-Chrome
encode → QR → decode test and a fake-camera (`canvas.captureStream`) end-to-end test pass in `test:browser`; a manual
check with the real phone and webcam is done, with screenshots; the three-lens milestone panel is clean on a frozen
commit.

**Rollback.** The feature is additive: revert its commits. No persisted model field and no `SCHEMA_VERSION` change.

### Step 7b plan (written 2026-11-12; 3C round 1 advisor-reviewed; awaiting the developer's go)

**My understanding:** fix the stale scan status (F1), let the signer choose the ink on the phone with the PC's ink as
the starting point (F2, rulings 2026-11-11 22:44/22:47 and 2026-11-12 09:56/10:15), re-walk it on the real phone, then
turn the flag ON. **Key assumption:** the width unit — "Line Width N" means N CSS px on the PC's ✍ canvas, carried to
the phone as `w` plus that canvas's width `cw`. **What would redirect me:** wanting the phone width in the phone's own
px (then the scan replays at a different N on the PC), or wanting the PC's swatch row in 7b after all.
**A visible default change (3C round 2):** with the PC's default Line Width 2, a phone signature now replays at about
2 px on the PC; the approved 2026-11-11 walkthrough replayed at about 3.4 px (2.5 px locked on a 368 px pad). W21 checks
that the default still looks right; if it does not, the remedy is the PC's default, a separate ruling.

**Commit A — `fix(sign): a scan's status clears on import and on Clear` (F1).** Red first in
`tests/ui/signatureSources.test.ts`: scan done → import → status `''`; scan done → Clear → status `''`; a refused import
after a scan also clears it. Code: `setStatus(null)` where the import starts (`signatureSources.ts` input `change`), and
a Clear hook — `SignatureSourcesDeps.onPadCleared(fn)` fed by `modalBinder`'s `#clearSignature` through `phonePadGate`
(the module owns its status line; no DOM reach-in from the binder). Sabotage: drop either clear → its case reds.

**Commit A2 — `fix(sign): an imported image with transparency keeps its own alpha`** (3C round 3 #1, ruling
2026-11-12 10:25). Measured with `keyOutPaper`'s own formula: on white paper (255) a stroke keeps alpha only when its
luminance is more than `KEY_LO` 30 below — yellow `#ffff00` (226) keys to 0% and the import says "no ink found",
orange `#ff9900` (166) to 98%, every other preset 100%; any custom colour above ~225 vanishes. `loadSignatureImage`
draws the bitmap on a CLEAR canvas first; when a MATERIAL share of its pixels is fully transparent (alpha 0) the image
keeps its own alpha (no white fill, no keying), else it is composited over white and keyed as today. Not "any pixel
below 255" (3C round 4): a paper photo saved as PNG/WebP with rounded corners, a soft crop edge or one stray pixel would
then skip keying and import as an opaque sheet — invisible on the white pad, visible only when it covers the page's
text. The share T is fixed by measurement BEFORE the commit: the phone's own Download PNG of a normal signature and of
a pad-filling scribble (W11's shape) must clear it, and rounded corners / a 2 px soft edge on a 1000×700 sheet (about
1%) must not — proposed T = 25%, lowered if the scribble measures under it, never below 5%. Chrome cases, red first: a yellow transparent PNG
imports yellow with its stroke box; the dense scribble PNG keeps its alpha; an opaque white-background PNG is still
keyed (control); an opaque paper PNG with transparent rounded corners is still keyed (control); a JPEG photo fixture
unchanged (control); a fully transparent PNG is still refused `empty`. Stale: the file's header ("over WHITE …") and
`signing.md`'s "the paper keyed out" — both gain the transparency branch. Bound, accepted by the ruling: a transparent
PNG that carries an opaque white box keeps the box.

**Commit B — `feat(sign): the phone pad's ink — colour and width, from the PC` (F2).**

- **The link.** `padUrlFor(origin, base, lang, ink?)` → `…pad.html#lang=en&c=1d4ed8&w=2&cw=500`. `c` = 6 hex digits
  without `#`; `w` = integer 1–10; `cw` = integer 200–4000 (the floor: at w=10 a `cw` under 162 hits PTSIG's 255-quarter
  cap, `signatureStrokes.ts` `lineQuarters` — measured `cw=150 → 273`). Read on the PC at each QR draw from ONE
  sanitised source (3C round 2 #1): `ink.get()` returns the BOXES' values — `#sigColor`, and `#sigLineWidth` clamped to
  a whole 1–10 and written back to the box — plus `cw` = `signatureCanvas.width` clamped to 200–4000. Never the pad's
  own width, which is a float after a replay.
- **PC ink sanitised at the source** (3C #4): `modalBinder`'s bare `parseInt` becomes a clamp to 1–10 (NaN → the
  previous value), so neither the URL nor a repaint ever sees NaN or 50. Test: `''`, `'0'`, `'50'`, `'3.7'`.
- **Phone side.** `padInkFromHash(hash)` beside `padLanguageFromHash`, strict like `lang`: any invalid field falls back
  to that field's default (black, w 2, cw 500). The page draws at `w × padWidth / cw` CSS px. Controls above the pad:
  the shared swatch row (`COLOR_PRESETS` without `#ffffff`, then `getRecentColors()`, then a custom swatch opening a
  native picker; a custom pick → `pushRecentColor`), the PC's colour selected (added as a swatch when it is not a
  preset). White is filtered from the RECENTS too (case-insensitive — the pad reads the same `pdfturbo.recentColors`
  the editor writes on that phone), and a link carrying `c=ffffff` falls back to black: invisible ink is never offered,
  whichever way it arrives (3C round 4 #2), and a `−` / number / `+` stepper 1–10 (48 px targets). Any ink change repaints every stroke (one PTSIG ink)
  — on the phone ALWAYS, through a public `SignaturePad.repaint()` that `padPage` calls; the PC's `inkFollows` flag is
  not used there, so Clear → draw → change ink still shows what PTSIG sends. `layout()` recomputes the CSS-px width
  (`w × padWidth / cw`) BEFORE `setSize` repaints, so a rotation keeps the replayed width. `hashchange` re-applies
  language and ink and repaints (ruling 10:15); while the QR view shows, it returns to the draw view (cycle stopped), so
  no frame in the old ink stays on screen. The ink read and the `hashchange` listener live INSIDE `mountPadPage`
  (`padMain.ts` only passes `location`), removed by `destroy()`; the language half of the ruling too — `mountPadPage`
  takes a `setLanguage` option like `t` (default: `changeLanguage` from `utils/i18n`, which re-translates
  `[data-i18n]` and sets `lang`/`dir`), and the pad NEVER caches a language (`initI18n` gains a no-store option the pad
  always passes: today a pad opened without `lang` caches to `i18nextLng`, so a later `#lang=fr` would switch the
  EDITOR's language on that phone) — `padMain.ts` is imported by no test, so a listener
  there would let the "hash read once" mutant survive (the `main.ts` trap of panel round 1). `repaint()` wipes pixels
  only — never through `clear()`, which empties the stroke record; a case changes the ink twice and both repaint.
  Accessible names (3C #9): a colour swatch is named by
  its hex through `title`, exactly as the toolbar row does (`src/main.ts` `_renderColorSwatches`: `btn.title = norm`, no
  visible text, so no Label-in-Name risk), with `aria-pressed` on the selected one; the custom swatch and both stepper
  buttons get translated `aria-label`s (EN/FR/AR); the number is `aria-live`. The QA sweep's pad pass runs axe on it. New keys `pad.color`, `pad.width`, `pad.widthDown`, `pad.widthUp`; the
  custom swatch reuses `toolbar.customColorTitle`, already in all three locales (Arabic pending, W16 ruling: the pending count rises by their number in this commit).
- **PC side.** `SignaturePad` gains `inkFollows` (set by `replay`, cleared by `clear`/`drawImage`); while set,
  `setColor`/`setLineWidth` repaint every recorded stroke. `replay` now ALSO sets the pad's colour and width to the
  replayed ink (docstring rewritten — it says "untouched" today). After a scan, `signatureSources` writes the boxes
  (`#sigColor` = decoded colour, `#sigLineWidth` = round(width) clamped 1–10) and re-draws the QR from them explicitly —
  a programmatic `.value` fires no event (3C #5). The pad KEEPS the exact replayed width (the scan replays what the phone
  sends; only the box rounds): writing the box never snaps the strokes; the first user change does. The PC's boxes drive
  the pad on `input` (live while the picker is dragged, ruling "repainted live") with the CLAMPED value, but write the
  box back only on `change` — writing back on `input` fights the user's typing. Done in `modalBinder`, so it holds with
  the flag off too (no test dispatches on `#sigLineWidth`/`#sigColor` today: `grep -rn sigLineWidth tests` finds only
  the `uiController` id list). The QR and URL text re-draw on `change`. **The pad's ink must not outlive the scan**
  (3C round 3 #3): a replayed width comes from an untrusted QR (up to about 31 px on a 500 px canvas) while the box
  shows at most 10, so when following ends — `clear()`, `drawImage()`, a modal close — the pad's colour and width are
  reset FROM THE BOXES; a case: scan a 30 px signature → Clear → draw → the stroke is the box's width. A PC tap draws nothing (`dotOnTap` off), so on a pad without `dotOnTap` a stroke
  that ends as one point is dropped from the record — else a repaint would turn it into a dot (3C round 2 #4). Injected as `SignatureSourcesDeps.ink: { get(): Ink; set(ink): void; onChange(fn): void }` from
  `phonePadGate` (app.ui refs), so `signatureSources` still never queries outside `#sigSources`.
- **Old or cached pad** (3C #6): a pad that ignores the fragment sends black 2.5 phone px; the boxes clamp it. Tests with a decoded
  width of 0.25, 3.4 and 40 (PC px after the fit): the box reads 1, 3, 10; the replayed stroke stays 0.25, 3.4, 40 wide
  (pixel-measured in Chrome for 3.4) until the first user change.
- **Tests, red first.** jsdom: `padUrlFor` with/without ink; `padInkFromHash` (valid; each field invalid alone; `#`,
  empty, `w=0`, `w=11`, `cw=199`, `c=red`, `c=%23000000`); padPage controls (swatch → pad colour + repaint + selected
  state; stepper bounds; hashchange); `SignaturePad` repaint only while `inkFollows`; signatureSources box sync + QR
  re-draw on change. **Real Chrome — the oracle** (3C #1): PC canvas forced to 640 px, phone pad to 320 px (so
  pad ≠ `cw` ≠ 500); PC red w=4 → `padUrlFor` → `mountPadPage` with that hash → assert the pad opens on red / 4 → a
  scripted stroke → the PHONE changes to green / 6 (so "boxes follow the scan" is not vacuous) → Done → frames →
  collector → replay → measure the replayed stroke's thickness across a straight segment (expect 6 ± 0.5 px), its colour
  green, and the boxes green / 6; then PC → blue, w=2 → pixels blue, thickness 2 ± 0.5. Mutants that must red: the phone
  ignores `cw`; it ignores `w`; replay leaves the pad ink; the boxes not written; the repaint flag never set; the hash
  read once only; `layout()` sizing before recomputing the width (a rotation case); the phone repaint gated by
  `inkFollows` (Clear → draw → change ink).
- **Pins to update in this commit** (every `pad.html#lang=…` exact match): `tests/ui/signatureSources.test.ts`
  (107/108/121/400/401 — `padUrlFor` without ink stays `#lang=xx`; the mounted QR gains the ink),
  `tests/browser/signature-sources.browser.test.ts:48`, `tests/utils/qrCanvas.test.ts:62` (a fixed string — kept),
  `scripts/qa-sweep.mjs:689` (kept: a bare `#lang=en` must still load), `var/claude/sig-sources-check/check.mjs:104`
  (scratch, re-run for the visual evidence).
- **Stale claims to rewrite here** (3C #8): `tests/browser/signature-import.browser.test.ts:40` ("2.5 CSS px …
  exactly as the phone's Download makes them"), `src/pad/padPage.ts` header ("ink locked to black 2.5 CSS px"),
  `signaturePad.ts` `replay` docstring, `.claude/rules/signing.md` § "The phone signature pad" ("ink locked to black
  2.5 CSS px", the Guards list), `toolchain.md` § i18n "Pending count", `KNOWN_ISSUES.md` "Sixty-four values are
  pending" + "the 33 phone-signature-pad keys", `signing.md` "the 33 Arabic keys", `public/privacy.html`: its
  `localStorage` list (EN/FR/AR, lines 56/79/102 on 2026-11-12) names only `i18nextLng` and `pdfturbo_storage_notice`,
  yet the editor has written `pdfturbo.recentColors` since Slice 1 and the phone pad now writes it too — the key is
  added in all three languages, the text shown to the developer before the commit (Arabic unreviewed), as for the
  Camera section. `tests/tools/architecture.baseline.json` if `pad→utils` counts move.
  FEATURES.md / CHANGELOG.md `[Unreleased]`: one line each.
- **Visual evidence:** before/after screenshots of the phone pad (en 412 px, ar RTL) and of the PC modal after a red/4
  scan, read by eye, not only by the script.

**Gate, then the re-walk (ruling 10:15), then Commit C.** Full deploy gate on B. Then `/walkthrough` W17–W22 on the
LAN dev server with the flag forced on (as W6–W15). A finding there → a fix commit before C.

**Commit C — `feat(sign): phone signature pad on by default`.** Row 7's whole "off" surface list, plus the step-7
"Not certified by execution: a real phone" bullets (`KNOWN_ISSUES.md`, `signing.md`), the `pdf-qa-sweep` SKILL baseline
re-measured on the flag-ON build. Full gate. **Then** milestone panel round 4 (three lenses, fable, frozen on C — it
covers the round-3 fixes, A, B and C), then step 9 (1.1.0, the bump shown first), the gate, ONE push, `/ci-watch`.

**Size and cost [Inferred: from the files read]:** A ≈ 20 lines + 3 tests; B ≈ 250–350 lines across ~12 files + ~25
jsdom and ~4 Chrome cases; C ≈ 15 surfaces, mostly prose. **Rollback:** each commit reverts alone; B → A is safe
(the link without ink still works, by design).

## RESUME HERE (saved 2026-11-12 ~15:50 — the session stopped at a WORKING state)

**State.** HEAD = the two resume-state docs commits ("docs: phone signature pad — resume state after panel round 4",
"… round-4 tier logged, three user-only items listed", and this wording fix) on top of `3918563` (commit C,
`feat(sign): phone signature pad on by default`). **SUPERSEDED 19:09: every commit through `9312404` was PUSHED at
16:04 from this checkout (`git reflog show origin/master`), CI run 43243778809 green and deployed — the flag-ON pad is
LIVE before the round-4 fixes.** New order (ruling 19:09): the HTTPS smoke walk on the deployed build first, then the
privacy text (R4-1), then the other fixes below. (Was: "local and NOT pushed, origin `e534300`, one push after 1.1.0".) The full deploy gate
ran on the tree that became `3918563` (only `tests/config/features.test.ts` was edited after it, re-run alone + tsc +
lint green) and was 9/9 rc=0 (`var/claude/gate-c.log`: Node 26.13.1, 0 VITE_FEATURE vars, jsdom 4324, Chrome 748,
coverage 9, QA sweep 161 / 119 / 0 fail / 42 skip, 57 of 144). Working tree: only the developer's own
`.claude/settings.json` edit (never commit, stash or write it). No round-4 fix has been started; nothing is half-edited.

**Where the work stands in the 7b sequence (go 10:33):** A, A2, B, gate, W17–W23 re-walk, C (flag ON) — DONE.
Milestone panel round 4 (fable, frozen `3918563`) — DONE, ruled 15:37 (four AGREED lines in the Decisions Log).
**NEXT (ruling 19:09 — this order replaces the 15:45 "Order of work" and "After round 5" sequence below):**
(a) the HTTPS smoke walk on the DEPLOYED build (user-only, Needs input R4-4) — DONE 2026-11-12 except R4-4.7; (b) the privacy.html text (R4-1) shown to
the developer, then committed and pushed on its own (R4-5) — DONE 2026-11-12; (c) the rest of the round-4 fix task (Medium; tier
`advisor()` only, ruled 15:40) in the 15:45 order's steps (1)–(4), (6)–(8); (d) panel round 5 (the LAST before the
5-round cap); (e) step 9 (1.1.0, shown first), gate, push, `/ci-watch`. The 10:33 "ONE push after 1.1.0" is void in fact
(everything through `9312404` is live).

**Round 4: 21 findings after dedup (P2:8 P3:13, no P0/P1).** Raw: `var/claude/raw/pp4-{correctness,safety,completeness}.md`
(gitignored); the reviewer's probes `var/claude/pp4-probe/` (probe2/3/4 `.out` match the claims — verified).
Rulings 15:37 decide each:

| Finding | Fix (ruled) |
|---|---|
| C1 (P2) transparent PNG with an opaque dark frame refused as "flattened" / alpha rewritten (`signatureImage.ts:250`) | test-first: run `isFlattenedOnBlack` only when the image is FULLY opaque (new exported `isOpaque`, jsdom test); Chrome cases B (own alpha + black frame + black stroke imports, not refused) and B2 (50%-alpha yellow keeps ≈128) — shapes in `var/claude/pp4-probe/probe4.bprobe.test.ts` |
| C4 (P3) a REFUSED import clears "Signature scanned" though the pad still holds the scan (`signatureSources.ts:187`) | test-first: clear the status only after a successful import. **This REVERSES the 10:33 plan's pinned behaviour** (Commit A design, "a refused import after a scan also clears it") — tell the developer. TWO pinned tests in `tests/ui/signatureSources.test.ts` § "after a scan, the status does not outlive the pad" turn red: "an import clears it as soon as the import starts" (asserts `''` synchronously) and "a REFUSED import clears it too" — rewrite both; grep `tests/browser/` for status asserts after an import |
| C5/S6 (P3) `bitmap.close()` skipped on the `flattened` throw | test-first: a Chrome spy on `ImageBitmap.prototype.close` on a flattened refusal; `bitmap?.close()` in `finally` (earlier throws come before the bitmap is assigned) |
| C2 (P2) a paper PNG with ≥5% clear (a scan rotated 3°, 9.9% clear) imports as an opaque sheet | stays a BOUND: Chrome pin + KNOWN_ISSUES; reword "MOSTLY transparent" to "at least 5% fully transparent" wherever it appears (grep) |
| C3 (P3) w=1 straight stroke along the top/left edge, saturated non-yellow, sent as a photo → not detected (30/252) | stays a BOUND: Chrome pin asserting the PROPERTY (border share well under 0.9), not pixel counts (JPEG differs across Chrome builds) + KNOWN_ISSUES |
| K9 (P3) the white-box and >95%-cross-hatch bounds of keep-own-alpha unpinned, not in KNOWN_ISSUES | pin both + KNOWN_ISSUES (with C2) |
| S4 (P3) "invisible ink never offered" holds only for exact `#ffffff` | reword to "exact white" (ruling 09:56) in signing.md / code comment |
| K1/S3 (P2) the kill-switch leaves `pad.html` built and served; no deploy path sets the variable | DOCUMENT the scope (ruled): signing.md, features.ts, vite-env.d.ts — removes the PC's entry points (Sign on phone, Import image, camera); pad.html stays; to pull it the variable must be added to deploy.yml |
| S1 (P2) LAN addresses in this plan | DONE in this save commit: redacted to `<LAN-IP>`; history keeps them (ruled) |
| S2/K5 (P2/P3) privacy.html storage list incomplete; S5/K6 the Arabic recentColors sentence not in the pending-review note | **DONE 2026-11-12 (R4-1, AGREED 19:57)** — complete EN/FR/AR (ruled), **exact text shown to the developer BEFORE the commit**. Build the list from the RUNNING app, not a grep (the grep missed `i18nextLng`, written by a library): preview build, clean profile, exercise editor + pad.html, dump localStorage, sessionStorage, `indexedDB.databases()`, `caches.keys()`; say what clears each (Reset Session clears only the session; "Clear recent files" clears recents). Known so far: `i18nextLng`, `pdfturbo_storage_notice`, `pdfturbo.recentColors`, `pdfturbo_toolbar_order`; IndexedDB `pdf-editor` stores `state` + `recent` (≤8 file names + handles); sessionStorage `pdfturbo_privacy_toast_shown`. KNOWN_ISSUES:618 note must name BOTH Arabic passages + the new Arabic |
| K2 (P2) no axe on the pad's draw view | add an axe run in the QA sweep's pad pass BEFORE Done (same tags + animation settle as the existing pad axe call); check `tests/infra/qaSweepRequireSw.test.ts` still matches; run the sweep alone first (2 min); re-measure the SKILL baseline (the "five `pad:` lines" and 161/119 change) |
| K3 (P2) signing.md `paths:` misses `src/utils/signatureInk.ts`, `src/ui/signatureInkBoxes.ts`, `tests/utils/signatureInk.test.ts`, `tests/ui/signatureInkBoxes.test.ts`, `tests/browser/pad-ink.browser.test.ts`, `tests/utils/i18nInitLang.test.ts` | add the six |
| K4 (P2) F3 (the editor "mostly unusable" on the phone, W15) only in `docs/plans/mobile-editor-layout.plan.md` | KNOWN_ISSUES entry |
| K7 (P3) Status row 7 still `todo` | close it pointing at 7b; px/module written as "not measured" (dropping it needs a ruling) |
| K8 (P3) dates the bump won't touch | name in row 9 now: CHANGELOG.md:6 `[Unreleased]` range "→ 2026-11-11", CHANGELOG.md:12 "2026-10-09 → 2026-11-11", FEATURES.md:6 "Last updated: 2026-11-11" — fix them AT the 1.1.0 bump |
| K10 (P3) CLAUDE.md over-cap list stale (signing.md now >300) | re-measure `wc -l .claude/rules/*.md` LAST, after signing.md grows |
| K11 (P3) row-7b figures without artefacts | "43/43" = the six Chrome files signing.md names at 8b39515 (the correctness lens re-ran them: 43); say which figures' logs were not kept (jsdom 4260/4264/4310, Chrome 744, B's 20 mutants) |
| K12 (P3) flag ON drops `clearSignature`/`cancelSignature` from the sweep (cause inferred) | time-box a trace in `scripts/qa-sweep.mjs` `exercise()`/`unwind()`; if not traced, ask the developer to accept the loss at the privacy-text stop |
| K13 (P3) SECURITY.md:33-36 omits the pad-link fragment as untrusted input | add it |
| K14 (P3) CHANGELOG misses the ✍ Line Width clamp 1–10 (live) and "a tap on the ✍ pad is no longer recorded" | add both |

**Order of work (advisor 3C round 1, 15:45 — SUPERSEDED in sequence by the 19:09 NEXT above; its steps still apply inside (c)):** (1) BEFORE any `src/` edit, capture "before" evidence on commit C's
build (`dist/` is C — rebuild with `bash var/claude/node26.sh npm run build` if in doubt): C1 = the black-framed
transparent PNG through the real Import (driver shape: `var/claude/w22/real-import.mjs <port> <file> <tag>`), C4 = a
scan then a refused import (`var/claude/ink-check/check.mjs` scans with real zxing). (2) C1, C4, C5 red first, then
green. (3) Re-run BOTH real WhatsApp files through `real-import.mjs` after C1 (`var/claude/w22/whatsapp.jpeg` →
yellow, `var/claude/w22/whatsapp-black.jpeg` → the `flattened` refusal) — re-proves W23. (4) Bound pins, K2 sweep
change (sweep alone), docs. (5) Privacy text → the developer (plus: C4 reverses the 10:33 pin; K12 if not traced).
(6) ONE full gate after the last tracked edit: `bash var/claude/gate-c.sh > var/claude/gate-r4fix.log 2>&1` (its
preview kill was fixed after the C gate and tested alone at the save: port up, killed, free — the full script has
not re-run since). (7) Walk all 21 "Refuted if" clauses against the diff. (8) 6C advisor,
commit by pathspec (no trailers; author verified). (9) Round 5: frozen on the fix commit, same three agents on fable,
prompts naming the 15:37 Decisions-Log lines so C2, C3, the kill-switch scope and the IP history are not re-raised;
run tests through `bash var/claude/node26.sh …` (a raw nvm path in an agent prompt trips the expertise gate).

**After round 5 (the smoke walk at its end MOVED FIRST by ruling 19:09):** step 9 — show the bump (package.json, package-lock root fields, FEATURES Version stamp,
CHANGELOG `[Unreleased]` → `[1.1.0] — <date>` and its "no version bump" line, the K8 dates) and ratify in the same
question the ASSUMED `DEFAULT_OFF` removal (14:47) and the Clear/Cancel sweep loss; gate; ONE push (pre-push runs
~145 s of jsdom: foreground, 600 s timeout, check the `To …` line); `/ci-watch`; then one smoke walk on the deployed
HTTPS Pages build (service worker controls pad.html, the Update-prompt path) — the two "not certified" items.
Later: row 10 (PC `#sigColor` swatch row), W16 (native Arabic read, optional), mobile-editor-layout plan.

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
| 7 | Manual check on the real phone + webcam, with screenshots, including the badly-held re-test of the v19 M budget (40 cm, tilted, half brightness) and the phone's px/module + dpr; then turn the flag ON; also: the PNG download on the real phone (a data: URL with download), a multi-QR signature read by the webcam at the 1 s cycle, a native review of the Arabic pad.* strings; and: does the replayed copy look like the signature (unanswered at W4), a finger stroke dragged well past the pad edge keeps drawing, and closing the ✍ modal mid-stroke then reopening still lets you draw (lostpointercapture is Inferred). The flag-ON commit also edits every "off" surface (from a grep of `phonePad`, `DEFAULT_OFF`, "off by default", "flag-OFF", "Defaults OFF", panel round 2): `src/config/features.ts` (`DEFAULT_OFF` and its comments), `src/vite-env.d.ts` ("Defaults OFF"), `tests/config/features.test.ts` (the default-false cases), `src/main.ts`'s step-5 comment, `src/ui/phonePadGate.ts`'s header ("the default app keeps the old modal"), `signing.md`'s "Flag `phonePad` defaults OFF" bullet, `flow-export.md`'s "`DEFAULT_OFF` — `phonePad`" line, `toolchain.md`'s "CI sweeps the flag-OFF build and never scans", the FEATURES and CHANGELOG "off by default" parentheticals, and the `pdf-qa-sweep` SKILL baseline (re-measured on the flag-ON deploy build); and the lines step 7 itself makes stale (panel round 3): the "Not certified by execution: a real phone … (step 7)" bullets in `KNOWN_ISSUES.md` § "From the phone signature pad" and `signing.md` § "The phone signature pad", and — when the Arabic review happens — the pending count in `toolchain.md` § i18n ("Pending count: 64"), `KNOWN_ISSUES.md` ("Sixty-four values are pending") and `signing.md` ("the 33 Arabic keys") | S | todo | - | src/config/features.ts, src/vite-env.d.ts, tests/config/features.test.ts, src/main.ts, src/ui/phonePadGate.ts, .claude/rules/{signing,flow-export,toolchain}.md, .claude/skills/pdf-qa-sweep/SKILL.md, FEATURES.md, CHANGELOG.md, KNOWN_ISSUES.md |
| 8 | Milestone three-lens panel on a frozen commit | M | doing | round 1 on d93ed13 (22 findings, `var/claude/raw/pp1-*.md`), fixed in e54f5a1; round 2 on e54f5a1 (15 findings: 3 P2, 12 P3, no P0/P1, `pp2-*.md`), fixed in efe36b1; round 3 on efe36b1 (12 P3, no product defect, `pp3-*.md`), fixed in the round-3 fix commit; round 4 next ; round 4 on 3918563 (fable; 21 findings after dedup, P2:8 P3:13, no P0/P1; `var/claude/raw/pp4-*.md`), ruled 15:37, fixes NOT started — § "RESUME HERE"; round 5 = the last before the cap | |
| 7b | Step-7 findings (2026-11-11 walkthrough W6–W15): F1 an Import after a scan clears the stale "Signature scanned" status (test-first); F2 ink control — phone pad colour + width controls (EN/FR/AR strings), the PC passes its Color/Line Width to the phone through the pad link's #fragment, the QR re-made on change, the scan replays the phone's ink, a later PC change repaints (precedence ruled 2026-11-11). Large: written plan + the developer's go FIRST; then gate, flag ON (row 7's surface list), round 4 on that commit | L | doing | plan § "Step 7b plan" (commits A, A2, B, re-walk W17–W22, commit C), go 2026-11-12 10:33; A DONE (commit "fix(sign): a scan's status clears on import and on Clear": 4 jsdom cases red first — 3 F1 + the gate wiring — plus a control; sabotage: the import clear dropped → 2, the Clear clear dropped → 1, the running-scan guard dropped → the control; jsdom 4260 pass on Node 26.13.1); A2 DONE (commit "fix(sign): an imported image with transparency keeps its own alpha": T = 5% measured in Chrome — phone PNG 73–95% clear for a signature, 8.5–66% for a pad-filling scribble, 3.1% for an extreme cross-hatch (falls back to keying), an opaque sheet with r=40 transparent corners 0.2%; 4 jsdom + 2 Chrome red first ("no ink found"), 3 controls; sabotage: never keyed → 4, any pixel < 255 → the corner control + 2 jsdom, always keyed → the 2 yellow cases, share 25% → the scribble + 2 jsdom; jsdom 4264 pass); B DONE (commit "feat(sign): the phone pad's ink — colour and width, from the PC": signatureInk.ts (fragment c/w/cw, strict read, white → black), SignaturePad inkFollows/repaint/onFollowEnd + the ✍ tap dropped, signatureInkBoxes.ts (input live clamped, change writes back, follow end resets from the boxes), the phone's swatch row + 1–10 stepper + hashchange, initI18n store:false; ~40 jsdom + 3 Chrome cases red first; the Chrome oracle PC red/4 → phone green/6 → replay 6 ± 0.5 px green, boxes green/6 → PC blue/2 at 2 ± 0.5; sabotage 20 ways, each red, restored byte-exact; three step-5b/4 pins REVERSED on purpose (the ✍ tap was recorded, replay left the pad ink, the inputs left a scan unchanged); real app at :5181 through the phone's own QR + real zxing: replay 6.004 px green, boxes #00cc00/6, then 2.0 px blue; before (HEAD): boxes red/4 over a 3.5 px black stroke — screenshots var/claude/ink-check/; jsdom 4310 pass, full Chrome suite green after the 3 rewrites; pending count 64 → 68); full deploy gate on 2bd36d9 9/9 rc=0 (Node 26.13.1, load 19.6: jsdom 4310, Chrome 744, coverage 9, QA sweep 156 checks / 119 pass / 0 fail, 57 of 141 controls); W17–W22 re-walked on the real phone 2026-11-12 (office Wi-Fi), all done; W22 FOUND WhatsApp's photo mode flattens the PNG on black → W22-F (ruling 13:55, plan GO 14:04): `isFlattenedOnBlack` + `keyOutBlackSheet` + `importError.flattened` ×3 — the ink by MAX CHANNEL not luminance (advisor 3C round 1: pure blue's luminance 29 = the noise), alpha = coverage floored at 40, ONE ink colour (a departure from the plan's 'same ramp' wording, on advisor's advice), black threshold 32 over the measured noise max 29; tests first (jsdom 13 new, Chrome 4 new incl. the scanner-lid bound pinned), real file after: ink [255,252,32], black gone; 9 mutants red on 8b39515 (the ink colour from a histogram, not a sort); jsdom 4324 pass (810bdaa), signature Chrome suites 43/43 (8b39515), tsc/lint rc 0; pending count 68 → 69; the bound measured before (2bd36d9: ink inside a black frame) and after (sheet kept, ink a hole), KNOWN_ISSUES 8258951; W23 (as a photo, yellow + black) done on the real phone, picks ratified 14:37; C (flag ON by default): `DEFAULT_OFF` removed (ASSUMED 14:47, to ratify at 1.1.0), 2 jsdom cases red first (`expected false to be true`), sabotage `case 'phonePad'` dropped from `envFlag` → exactly the kill-switch case red, restored byte-exact; full deploy gate 9/9 rc=0 with 0 VITE_FEATURE vars (Node 26.13.1: jsdom 4324, Chrome 748, coverage 9, QA sweep --require-sw 161 checks / 119 pass / 0 fail / 42 skip, 57 of 144 controls — sigPhoneBtn + sigImportBtn PASS, clearSignature/cancelSignature now hidden-SKIP, sigCamBtn never clicked); clean-context screenshots on built apps, no feature override: HEAD's flag code → old modal, C → Sign on phone + Import image (var/claude/c-default/); 'Not certified' narrowed to the deployed HTTPS build + the Update-prompt path; C committed as 3918563; panel round 4 done and ruled 15:37 (see row 8); NEXT: § "RESUME HERE" — the 19:09 order (walk, privacy text, then the round-4 fixes); rulings 2026-11-11 22:44/22:47, 2026-11-12 09:56/10:15/10:25/13:55 | src/ui/signatureSources.ts, src/ui/phonePadGate.ts, src/ui/binders/modalBinder.ts, src/utils/signaturePad.ts, src/pad/padPage.ts, src/padMain.ts, src/styles/pad.css, src/utils/{signatureInk,i18n,signatureImage}.ts, src/ui/signatureInkBoxes.ts, src/main.ts, locales/*.json, public/privacy.html, tests, tests/tools/architecture.baseline.json, .claude/rules/{signing,toolchain,redaction,export}.md, KNOWN_ISSUES.md, FEATURES.md, CHANGELOG.md |
| 9 | Version 1.1.0 (MINOR; the bump shown to the developer first), after step 7's flag ON: `package.json` `version`, `package-lock.json` (its root `version` fields), FEATURES.md's `Version` stamp, CHANGELOG.md's `[Unreleased]` heading → `[1.1.0] — <date>` and its "Shipped continuously to GitHub Pages; no version bump." line (panel round 3); then the full deploy gate, ONE push, /ci-watch | S | todo | - | package.json, package-lock.json, FEATURES.md, CHANGELOG.md |
| 10 | Follow-up after 1.1.0 (ruling 2026-11-12 09:56): the PC ✍ modal's lone `#sigColor` native picker gets the shared swatch row (`COLOR_PRESETS` + recent + custom), as the phone pad has since 7b | S | todo | - | index.html, src/ui/binders/modalBinder.ts, tests |
| 11 | Follow-up after 1.1.0 (rulings 2026-11-12 19:09): full-screen signing — a ⛶ button, the pad fills the screen, only Clear / Done / exit stay; phone first (pad.html: width = min(screen width, height ÷ 0.4), layout must react to height in that mode), PC ✍ modal second (re-size via `setSize`; test the QR's `cw`, the 1–10 width box, an imported image, and Esc leaving full screen WITHOUT closing the modal). CSS fill is the base — iPhone Safari has no element fullscreen; `requestFullscreen` + landscape lock only where supported. Own Medium plan + review | M | todo | - | src/pad/padPage.ts, src/styles/pad.css, src/core/signatureManager.ts, index.html, locales/*.json, tests |
<!-- /progress-block -->
### Blocked
### Needs input
- [x] R4-1. Approve the completed privacy.html storage text (EN/FR/AR) before its commit (ruling 15:37; round-4 fix task) — DONE 2026-11-12: AGREED 19:57 (+ the unencrypted sentence); built from a clean-profile run of the built app (`var/claude/privacy/dump.json`: no cookie; colour pick writes recentColors, Reset Session empties only `state`, Reset toolbar deletes the key); closes S2/K5 and S5/K6 (KNOWN_ISSUES names both Arabic passages); FR guillemets get no-break spaces (414 px wrap); full gate 9/9 rc=0 twice (`var/claude/gate-privacy2.log`: jsdom 4324, Chrome 748, coverage 9, sweep 161/119/0); before/after EN/FR/AR × 1280/414 in `var/claude/privacy/`, 0 px overflow
- [x] R4-2. Acknowledge that the C4 fix reverses the 10:33 plan's pinned "a refused import after a scan also clears the status" — DONE 2026-11-12: AGREED 19:57
- [ ] R4-3. If the K12 trace fails: accept that the deploy sweep no longer clicks clearSignature / cancelSignature with the flag ON
- [ ] R4-4. HTTPS smoke walk on the deployed Pages build (ruling 19:09, FIRST): on the phone, open the pad from the deployed editor's QR; check the service worker controls `pad.html` and `pad.html` still loads offline/after reload; sign, Done, scan on the PC; then a new deploy → the phone accepts the pad's Update prompt and scans again
  - [x] R4-4.1. PC Chrome: open the deployed editor, open a PDF, ✍ → Sign on phone; the QR names an https github.io pad.html URL — DONE 2026-11-12: developer-reported (the https github.io pad.html link); confirmed by R4-4.2
  - [x] R4-4.2. Phone: scan that QR with the camera app; the pad opens — DONE 2026-11-12: developer-reported, pad opened on github.io with swatches, width stepper, Clear + disabled Done
  - [x] R4-4.3. Phone: open the deployed EDITOR once in a new tab (installs the worker — pad.html registers none, toolchain.md 5c), then back to the pad tab and reload it online; the pad (not the editor) shows — DONE 2026-11-12: developer-reported, the pad (not the editor) came back after the reload
  - [x] R4-4.4. Phone: airplane mode, reload; the pad still loads offline (service worker) — DONE 2026-11-12: developer-reported, the pad loaded with airplane mode on
  - [x] R4-4.5. Phone, STILL offline: sign, Done; QR frame(s) shown — DONE 2026-11-12: developer-reported, QR shown with airplane mode on
  - [x] R4-4.6. PC: Start camera, scan the phone; the signature lands on the canvas, Save places it — DONE 2026-11-12: developer-reported on the deployed HTTPS build, scanned from the offline phone, saved and placed
  - [ ] R4-4.7. After the next deploy (the privacy push): on the phone open the editor (the Update prompt is the EDITOR's — pad.html shows none), accept it, then reload the pad and scan again (walkthrough R4-4; open, waits for that deploy)
- [ ] R4-5. Push cadence after the early push: does the privacy.html fix push as soon as it is green, or wait for 1.1.0 — RULED 19:21: push alone when green
- Steps 1 and 7 need the developer's phone and PC webcam.
- [x] W1. Open http://<LAN-IP>:5173/pdfturbo/var/claude/qrtest/show.html on the phone — DONE 2026-11-10: the phone connected over the LAN (ss), ufw let :5173 through
- [x] W2. Open http://localhost:5173/pdfturbo/var/claude/qrtest/scan.html in desktop Chrome, Start camera, allow it — DONE 2026-11-10: Integrated Webcam granted 1280x720 @30 fps (asked ideal 1920x1080)
- [x] W3. Run the 16-size ladder in front of the webcam — DONE 2026-11-10: two full runs (var/claude/qrtest/run1.txt, run2.txt); the badly-held re-test (40 cm, tilted, half brightness) was not run and moves to step 7
- [x] W4. On the phone, open http://<LAN-IP>:5173/pdfturbo/var/claude/ptsig/measure.html, sign with a finger as on a real document, tap Measure, paste the line (walkthrough step-3 real signature) — DONE 2026-11-10: 3 strokes, 225 raw points on a 368x147 CSS-px pad (dpr 2.8125, Android Chrome 157): 378/322/285/262 body bytes at tolerance 1-4 → 1 QR at tolerance 1, 579 chars (64% of 909); encode 0.3 ms median, decode+replay 0.6 ms on the phone (var/claude/ptsig/real-signature.txt, numbers only)
- [x] W5. On the same page, Clear, draw one stroke that starts inside the box and ends past its edge, tap Measure, paste the line (walkthrough step-3 real signature) — DONE 2026-11-10: PARTLY, by W4 — real touch data held an out-of-range point (y = -0.2, offCanvasPoints 1), which is enough to justify the codec's clamp; 0.2 px is within sub-pixel rounding, so it does NOT show a stroke keeps drawing well past the edge on touch — that long excursion moves to step 7
- [x] W6. PC (throwaway Chrome, flag-ON LAN dev server): open a PDF, ✍ Add signature → Sign on phone → the real pad-URL QR shows — DONE 2026-11-11: the modal QR names http://<LAN-IP>:5173/pdfturbo/pad.html#lang=en, not localhost (var/claude/step7/01-scanned-pc.png)
- [x] W7. Phone (same Wi-Fi): scan that QR with the camera app → the pad page opens — DONE 2026-11-11: the phone opened the pad from the modal's QR (proven by W9's read)
- [x] W8. Phone: sign as on a real document, tap Done → QR code(s) shown — DONE 2026-11-11: signed on the phone, Done showed the QR the PC read (W9)
- [x] W9. PC: Start camera → allow → hold the phone up → read; does the replay look like your signature; Save, place it on the page — DONE 2026-11-11: the developer's real signature read by the PC webcam from the phone, replay confirmed as theirs by the developer; Save placed it where clicked (var/claude/step7/02-real-signature-scanned.png, 03-placed.png)
- [x] W10. Badly-held re-read: 40 cm, tilted, phone at half brightness — DONE 2026-11-11: read in about 1 s with the phone at its LOWEST brightness (harsher than the half asked), held as asked — the developer's report, not timed
- [x] W11. A long signature that needs several QR frames (cycled every 1 s) read by the webcam — DONE 2026-11-11: a pad-filling scribble cycled several codes on the phone (count not reported) and the PC read the whole set and replayed it (var/claude/step7/04-multiframe-read.png)
- [x] W12. Phone: one finger stroke that starts inside the pad and drags well past its edge keeps drawing — DONE 2026-11-11: a stroke dragged a few cm outside the pad and back kept drawing, page still (developer's report on the real phone; closes W5's open half)
- [x] W13. Phone: Download PNG → move the file to the PC → ✍ Import image — DONE 2026-11-11: the phone saved signature.png (22.9 KB, moved by WhatsApp) and Import image drew it (developer's report; screenshot not kept, it showed private chats). FOUND: after a completed scan, an import leaves the status "Signature scanned. Check it, then press Save." on screen — the import path never calls setStatus(null) (signatureSources.ts input 'change' handler); P3, fix pending a ruling
- [x] W14. PC ✍ pad: press and hold to draw, press Esc mid-stroke, reopen ✍, drawing still works — DONE 2026-11-11: Esc closed the dialog mid-stroke; after reopening, drawing was normal with no stray line (developer's report, mouse on the PC — closes the lostpointercapture [Inferred] item)
- [x] W15. Phone: open the editor itself on a first visit, ✍ → Sign on phone; is Save under the cookie banner — DONE 2026-11-11: Save visible on the developer's phone (FR, banner up). FOUND (developer): the editor itself is "mostly unusable" on that phone — only about a quarter of the content visible — until Chrome's "desktop site" is on (pre-existing app layout, not the pad); and the phone pad has no colour/width choice, and the PC modal's Color / Line Width are ignored for a scanned signature (by design today: the pad locks black 2.5 px, `SignaturePad.replay` paints in the DECODED colour and width) — both pending a ruling
- [x] W17. (7b, before flag ON) Phone: the width stepper — − and + reach 1 and 10 and stop; the stroke thickness follows — DONE 2026-11-12: on the office Wi-Fi (dev server on the LAN, the phone connected per `ss`), the pad opened from the modal's QR; the number went 1…10 and the drawn line's thickness followed (developer's report on the real phone)
- [x] W18. (7b) Phone: tap three swatches and the custom swatch (Android's native picker) — the strokes already drawn repaint — DONE 2026-11-12: three swatches and Android's native picker each repainted the drawn line (developer's report on the real phone)
- [x] W19. (7b) PC Color red, Line Width 4 → Sign on phone → the phone pad opens on red / 4 → sign, then change the phone to another colour and width → Done → scan → the PC boxes show the PHONE's choice and the replay matches the phone — DONE 2026-11-12: the pad opened on red / 4 from the PC's link; signed, changed to another colour and width (7 suggested), Done → the PC webcam read it: replay in the phone's colour and thickness, the Color and Line Width boxes switched to the phone's choice (developer's report; no screenshot — the PC Chrome is a throwaway window with no driver)
- [x] W20. (7b) PC: after the scan, drag the Color picker and change Width → the scanned strokes repaint live (while dragging, not only when the picker closes) — DONE 2026-11-12: the colour followed while dragging and the thickness followed the width box (developer's report, the PC Chrome)
- [x] W21. (7b) PC on its defaults (black, 2) → Sign on phone → sign without touching the controls → scan → does a width-2 signature look right on the page (it was about 3.4 px yesterday) — DONE 2026-11-12: PC black / 2 → pad signed untouched → scanned, saved and placed: a thin pen line, not bold (developer's report; the 2 px replay itself is measured by the Chrome oracle `pad-ink.browser.test.ts`)
- [x] W22. (7b) Phone: yellow ink → Done → Download PNG → move it to the PC → ✍ Import image → the signature arrives yellow (W13 was walked in black only) — DONE 2026-11-12: sent through WhatsApp as a DOCUMENT, `signature (1).png` arrived as an 848x339 RGBA PNG (`file`, IHDR colour type 6) and Import drew it yellow with no box (developer's report). FOUND first: sent as a PHOTO, WhatsApp re-encoded it as a JPEG on black (848x339, 3 components, 94.5% of pixels near-black), and Import kept the black and dropped the yellow — reproduced on that file by `keyOutPaper` (`var/claude/w22/probe.mts`: 56,326 black pixels kept, 0 yellow); ruled 13:55 → fix W22-F before C
- [x] W23. (7b W22-F) Phone: yellow ink → Download PNG → WhatsApp as a PHOTO (not a document) → PC ✍ Import image the `WhatsApp Image … .jpeg` → arrives yellow, no black; then black ink the same way → the 'send it as a file' message — DONE 2026-11-12: yellow — the 13:48 WhatsApp JPEG re-imported in the developer's Chrome arrived yellow, no black (their report; the same file through the real Import by driver: 4,679 pad px all yellow, 0 near-black); black — a new black-ink PNG sent as a photo (`WhatsApp Image 2026-11-12 at 14.35.53.jpeg`, 708x386, no alpha) showed the 'lost its transparency' message, no signature (their report; by driver: 0 pad px, the message at `#sigSourceMsg`, 0 console errors — `var/claude/w22/black-real.json`)
- [ ] W16. Optional: native read of the Arabic pad strings (walkthrough step 7)
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
- Milestone panel round 1 FIXES (2026-11-11, on d93ed13's findings, `var/claude/raw/pp1-*.md`; the files were first
  written as `m3r1-*`, a name the 2026-10-17 milestone already used — Decisions Log 19:00). Certified by
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
  #21 is resolved by the flag ON before the push (step 7). #22 accepted, NOT fixed (ruling 17:10), its three items
  named (panel round 2): the unpushed SHAs cited in `toolchain.md`, `redaction.md`, `export.md` and `KNOWN_ISSUES.md`
  (local commits are signed and keep their SHAs; the one push carries them), the developer-machine Node path in this
  plan's toolchain note, and the Emscripten runtime left unlisted in `THIRD-PARTY-NOTICES.md` (as for every wasm there).
  Outside the range, NOT fixed (reported to the developer): `icon.svg` is referenced by `index.html`, `pad.html` and
  the manifest but exists in neither `public/` nor `dist/`.
- Milestone panel round 2 FIXES (2026-11-11, on e54f5a1's 15 findings, `var/claude/raw/pp2-*.md`; ruling 19:00).
  Certified by execution (each mutant applied, red on its own case only, restored with `cmp`): #1 the main.ts source
  check ends at `[,}]` (mutant `isEnabled('phonePad') === false` → that check); #2 the gate's fake app method reads
  `this` (unbound-method mutant → 2 cases), a real-mount case with no `mount` injected (no-op default → 1), a
  `startScan` case with no `grab` and a fake canvas (default wrapped without `release` → 1); #3 `argv` and `has` pinned
  (a `has` ignoring `--require-sw` → 1; the FAIL itself stays proven by the recorded live run). Gate on the fix tree
  (`var/claude/gate-pp2/`): 9/9 rc=0 — jsdom 4251 + 2 expected fail, Chrome 736/0, coverage, build, QA sweep
  156/119/0 with the 5 pad checks; built-app checks 10/10 rc=0, 22 states with no console error, flag-ON sweep
  161/119/0. Docs: #4 the 30-day offline limit (README, FEATURES, CHANGELOG, `toolchain.md`); #5 "always fetched fresh"
  (CHANGELOG, the `vite.config.ts` comment, `toolchain.md`); #6 "nothing leaves" (FEATURES, CHANGELOG, `padPage.ts`'s
  comment); #7 `completeness-reviewer.md` + CLAUDE.md § Git & CI (that line also had `ocr:assets` in the wrong place:
  it runs right after the audit in `deploy.yml`); #8 the CHANGELOG bullet for the 2026-10-17 prune rounds (every one of
  the five bodies is the keep-a-removed-page's-form direction); #9 row 7 completed from a grep, row 9 added; #10 the
  #22 items named; #11 the KNOWN_ISSUES stamp; #12 the session-restore exception (KNOWN_ISSUES, this plan); #13 the
  `pdf-qa-sweep` recipe, skip count and flag lists (and the script's header); #14 "main.ts removes" in 3 files; #15
  `signing.md` paths (one per line; no rules file here used a brace glob, and its support is unverified) and guards.
  The 30-day limit is read from source, not driven: `ExpirationPlugin.cachedResponseWillBeUsed` serves a `pad-page`
  copy only while its `Date` header is within `maxAgeSeconds` (`workbox-expiration/ExpirationPlugin.js:70-97,186-203`),
  and every asset `dist/pad.html` loads is precached [Verified: 4 URLs in `dist/sw.js`], so `pad-page` is the only
  clock. NOT certified by execution: the
  "few minutes" HTTP-cache window (the reviewer's GitHub Pages `max-age=600`, not measured here); and the reverse
  worker-age case found at 6C — after the app updates, a pad cached before it loads assets the new worker dropped
  (`PrecacheController.activate` deletes them), so the offline pad breaks until opened online once; now in the
  docs' wording and `KNOWN_ISSUES.md`, never driven. Two comment-only edits landed after that gate and before
  efe36b1 (`src/ui/placementManager.ts`, `tests/ui/placementGhost.test.ts`, the ghost wording); the round-3
  reviewer re-ran type-check, lint and that test, and the round-3 fix gate re-runs everything on a tree that holds them.
- Milestone panel round 3 FIXES (2026-11-11, on efe36b1's 12 P3 findings, `var/claude/raw/pp3-*.md`; ruling 19:51).
  Certified by execution (each mutant applied, red on its own case only, restored with `cmp`; runners
  `var/claude/r3mut/run.py`, `run2.py`): two `qrScanner` stop cases — a decode returning after `stop()` (its `if (ended)` removed
  → that case) and `play()` resolving after `stop()` (its check removed → that case; before, it cost only a decoder
  load); the `main.ts` gate call must be its own statement and the only `isEnabled('phonePad')` (call under `if`, under
  `&&`, inside an if-block → that case each — that if-block mutant opens a brace it never closes, which stands because the
  guard reads the source as text; a bare `if (x)` on the line before → that case; the call in a block after another
  statement stays GREEN, measured, and is the bound written in the test comment); the cache ages pinned —
  `ocr-assets`, `pdfjs-cmaps`, `pdfjs-wasm`, `zxing-wasm`, `app-fonts` at 90 days, `pad-page`, `pad-css` at 30 (pad-page
  30 → 7, zxing 90 → 30, and pad-page losing its `maxAgeSeconds` beside a 30-day neighbour → that case each). Docs:
  "up to 30 days" (README, FEATURES, CHANGELOG, `toolchain.md`, the `vite.config.ts` comment) and "up to 90 days after
  it was downloaded" for the first-use files (README, FEATURES, `toolchain.md` — CacheFirst does not refresh a copy it
  still serves, and the `Date` check counts from the download); a `KNOWN_ISSUES.md` § Privacy paragraph on Safari's seven-day deletion
  [Verified: WebKit blog 10218, J. Wilander, Mar 24, 2020, fetched 2026-11-11: "without user interaction on the site";
  Safari only — no claim about other browsers; `privacy.html` promises no retention period, so nothing contradicts it]; `privacy.html`
  EN/FR/AR and `signing.md` name the *Download PNG* route (Arabic [Unverified], before/after screenshots in
  `var/claude/privacy-shots/`; the page's "Last updated: November 2026" stamp still holds; no test names the page, and
  `rsaVerify.test.ts`'s `public/*.html` source scan ran green in the gate); `SECURITY.md` discloses the
  camera grant's origin (the shared GitHub Pages origin); the stacking claims restated as z-ranges from an enumeration
  of all 18 dialogs (17 `role="dialog"` in `index.html` + the DOCX editor): the banner (9000) is above the dialogs at
  1000–2000 only, and the ghost (9999) is painted over the two 9999 dialogs (appended to `body` after them) and below
  the two at 10000 — round 2's "every dialog but the session-restore one" was wrong for both (KNOWN_ISSUES, this plan,
  `ui.md`, `placementManager.ts`, `placementGhost.test.ts`); rows 7 and 9 completed; the `pdf-qa-sweep` skip count
  dated; `tests/security/csp.test.ts` in `signing.md`'s paths.
  Gate on the fix tree (`var/claude/gate-pp3/`, load 13–23 from another project's runs): 9/9 rc=0 — jsdom 4255 + 2
  expected fail (+4, the new cases), Chrome 736/0, coverage 45.45% branch, build, QA sweep 156/119/0; built-app checks
  10/10 rc=0, flag-ON sweep 161/119/0. Written after that gate (6C round 1): this paragraph, the plan wording, the
  Safari wording (README, KNOWN_ISSUES), `toolchain.md`'s CacheFirst clause and the `phonePadGate` bound comment —
  re-run after them: `phonePadGate.test.ts` 8/8, type-check rc=0, lint rc=0, and the four tests that read files
  (`sourceControlBytes`, `rsaVerify`'s `public/*.html` scan, `phonePadGate`, `pwaOcrCaching`) 37/37; no test reads
  README, KNOWN_ISSUES, `toolchain.md` or this plan (grep for a `readFileSync` of each).
- Known, left as is (ruling 2026-11-11): at 414 px on a FIRST visit the cookie banner covers the ✍ modal's Save
  row when the phone panel is open — in French (the longest strings) even with no refusal message; the modal is
  then ~750–790 px in an 860 px viewport. It clears when the banner is dismissed, and the modal scrolls. Look at it
  on the real phone in step 7. **5b made it worse (ruling kept, 2026-11-11):** the Start camera row takes the FR
  modal at 414 px to its 90vh cap (774 px), and with the phone panel open the Save row sits FULLY under the storage
  banner (`z-index: 9000`, above the dialogs at 1000–2000, the ✍ modal among them) — Save cannot be clicked until the banner is dismissed
  (measured: Playwright's click timed out, `var/claude/sig-scan-check/5a-rerun/`). Panel closed: 400 px, no overlap.
  The root cause is the banner's stacking over the dialogs at 1000–2000, not this modal.
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
