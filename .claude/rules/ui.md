---
paths:
  - "src/ui/**"
  - "src/core/**"
  - "src/handlers/**"
  - "src/infra/**"
  - "src/styles/**"
  - "index.html"
  - "scripts/qa-sweep.mjs"
---

# pdfturbo gotchas — ui

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: the app shell: open/save, storage, modes, pointer and click routing, a11y, thumbnails, watermark, the QA sweep. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas indexes every one.

### Open via the native picker + recent files (#54b, 2026-09-04)

> **[Re-checked 2026-09-28]** `tests/ui/recentFilesMenu.test.ts` has gained a case since (`4f3c5fd`), and that commit deleted `canUseFsSave` — so `canUseFsOpen` no longer has a save twin. The file is the authority for the count.

The save side has used `showSaveFilePicker` since #54; the open side now mirrors it.
`canUseFsOpen`/`pickOpenFiles`/`ensureReadPermission` sit beside their save twins in
`src/utils/fileSystemAccess.ts`, remembered handles live in `src/infra/recentFiles.ts`, and the File
menu grows a recents list (`src/ui/recentFilesMenu.ts`). No new dependency; the hidden
`<input type=file>` path is untouched and is still the whole story on Firefox and Safari.

**`'cancelled'` and `'unavailable'` are DIFFERENT return values, and that is the point.** Collapsing
them — the obvious simplification, since both mean "no handle" — makes dismissing the native dialog
immediately open the fallback `<input type=file>`: the user says no and is answered with a second
file dialog. Only `'unavailable'` may click the input. Sabotage S1 fails exactly the two cases that
pin it.

**A handle is a capability the user re-grants, not a stored path.** `FileSystemFileHandle` is
structured-cloneable, so IndexedDB can persist the CHOICE across sessions while the page never
learns a filesystem path — which is what makes this safe in a tool whose promise is that nothing
leaves the device. Permission does NOT survive the reload: Chromium answers `'prompt'`, and
`requestPermission` needs transient user activation, so it is called from the click that opens the
file and never speculatively. Probing at startup would either throw or train the user to dismiss a
prompt they did not ask for.

**De-duplicate by `isSameEntry`, never by name.** Two handles for the same file are different
objects; `isSameEntry` is the only identity the API exposes. Keying on the name collapses two
different `invoice.pdf`s from two folders into one row and then opens the wrong document. Where
`isSameEntry` is unavailable, the entry is added WITHOUT de-duplication — a duplicate row is
cosmetic, opening the wrong file is not. S2 fails exactly the same-name case.

**Two traps found by the tests, both worth carrying forward:**

- **A fake handle must put its methods on the PROTOTYPE.** IndexedDB stores by structured clone,
  which throws `DataCloneError` on a function-valued OWN property — so a fake built as
  `{ getFile: () => … }` makes every `put` fail and every list come back empty. A real handle is a
  platform object and clones fine. The jsdom consequence is stated in the test: a handle read back
  out of the store there keeps `name` but no methods, so anything that CALLS a method on a STORED
  handle is a browser-only concern.
- **`Date.now()` ties, and the ordering guard was a coin flip.** Opening a multi-file selection adds
  several entries inside one millisecond; `at` ties, the stable sort falls back to insertion order,
  and the list came out OLDEST first for exactly the case that adds more than one entry. `at` is now
  strictly increasing. The test caught it on a fast run and PASSED on a slower one where the adds
  landed in different milliseconds — so the case now freezes the clock rather than hoping for the
  tie. Same family as § "A flaky gate": a guard that depends on machine load pins nothing.

`DB_VERSION` moved 2 → 3 for the new `recent` store; an upgrade never drops a store, so an existing
session in `state` is carried across. **TWO test files had the version copied by hand** and broke on
that move: `storage.test.ts` opened `indexedDB.open('pdf-editor', 2)` and failed with a VersionError,
and `storageErrors.test.ts` declared its own `const DB_VERSION = 2` to seed the database "at the
version it expects" — which quietly stopped being true. The first now goes through `openAppDB`; the
second imports the constant, which is exported for exactly this reason. **A test-side copy of a
production constant only ever breaks later, and for a reason unrelated to what the test is about.**

Guards: `tests/infra/recentFiles.test.ts` (10), `tests/ui/recentFilesMenu.test.ts` (12),
`tests/utils/fileSystemAccess.test.ts` (+10). Sabotage-verified six ways, each landing where
predicted: collapsing cancelled/unavailable → 2; name-keyed de-duplication → the same-name case;
non-monotonic `at` → 3 (newest-first, the frozen-clock case, AND de-duplication's move-to-front,
which is the non-obvious one: moving an entry to the front is itself a same-millisecond write); `innerHTML` for the file name → the untrusted-name case; rendering recents
with no open picker → that case; skipping the permission re-request → the denied case; dropping one
MIME from the picker filter → the index.html parity case.

**The picker's type filter must match the fallback input's `accept`, and it did not.** `OPEN_TYPES`
listed PDF and PNG while `#fileInput` accepts JPEG, GIF, WebP and BMP too, all of which `loadFiles`
converts — so on Chromium the native dialog REFUSED four formats that Firefox's plain input opens.
The enhanced path was strictly worse than the one it enhances. The two lists live in different
files, so a test reads `index.html` and asserts the picker covers every MIME it accepts.

### `saveState` read the wrong error property, so every failed autosave looked like a success (2026-08-28)

`tx.onerror = () => reject(tx.error)`. Per the IndexedDB spec the step that *sets*
`transaction.error` is "abort a transaction", and it runs only **after** the request's error event
finishes dispatching — so inside `tx.onerror` the transaction has not aborted and `tx.error` is
`null`, while the failure sits on `request.error`. Measured against a real IDB implementation:
`{txErrorInOnError: 'NULL', reqErrorInOnError: 'ConstraintError', txErrorInOnAbort: 'ConstraintError'}`.

The consequence was total, not degraded. `saveState`'s catch re-threw only
`err instanceof DOMException && err.name === 'QuotaExceededError'`, and `null instanceof DOMException`
is `false` — so **every** write failure took the silent-skip arm, `saveState` RESOLVED, and
`toast.storageFull` was unreachable code. The user keeps editing a document that has silently stopped
being persisted and loses it on reload.

**The root cause was scope, not just the property.** `SessionManager._flush` already handles both
cases correctly (quota → toast, anything else → `silent()`), so the filter inside `saveState` was
redundant *and* was the thing that broke the contract. The swallow is now scoped to what its own
comment says it is for — the **open** failing (private browsing, permissions) — and any failure of
the **write** propagates.

`tests/core/sessionManager.test.ts` could not catch this: it `vi.mock`s `saveState` wholesale and
rejects with a hand-built DOMException, so both sides are green while the seam between them is
broken. **A test that mocks the collaborator it depends on proves nothing about the seam.**

Two more things came out of the same file. `clearState` had the identical wiring (fixed; its swallow
is deliberate, so there is no behavioural test to write — the dead branch was corrected so the next
person to make it report errors does not inherit it). And `openDB` **never closed its connection**:
every call opened a fresh one, so they accumulated for the life of the tab and blocked any later
`deleteDatabase`/version upgrade indefinitely. That is why the storage suite used to take 37s and now
takes 3s. Guard: `tests/core/storageErrors.test.ts`, whose deadline helper exists because the leak's
natural failure mode is a **hang** — an opaque 30s vitest timeout that reads as "slow test". It now
fails in 5s saying `saveState() never settled — a leaked IndexedDB connection is blocking it`.

### `Record<string, …>` on a mode map defeats the compiler — the badge said "SELECT" in sign mode (2026-08-28)

`uiController`'s `badgeKeys` covered 16 of `ToolMode`'s 17 members; `signRect` was missing from the
map **and** from `badge.*` in all three locales. With its `?? 'badge.select'` fallback, entering the
e-signature rectangle mode rendered the badge as **"SELECT"** while `.active` was toggled on — wrong
in a way nobody reports, because it looks like a real state rather than a missing string.

Fixed in three parts, and the third is the point: the map is `Record<ToolMode, string>` so the
compiler refuses a new mode that forgets its badge; the fallback is **deleted**, because a fallback
re-opens exactly this gap by turning a missing entry into a wrong label instead of a build failure;
and `ToolMode` is now derived from a runtime `TOOL_MODES` array (`typeof TOOL_MODES[number]` — the
type is unchanged) so a test can assert the half TypeScript cannot see, namely that the locale files
carry a string for every mode. Guard: `tests/ui/modeBadgeCoverage.test.ts`, both directions.

### Destroying a node on `pointerup` suppresses the mouse `click` — desktop selection was dead for two months (2026-08-22)

Reported as *"adding text and then trying to edit it on desktop does not work — it works only on
mobile"*. It was not a text bug: **no annotation element of any type could be selected with a mouse
once it was unselected.** Root cause, in two coupled halves both from `c6bd71d` (2026-06-24,
*"fix(mobile): element drag no longer scrolls the page or lags"*):

1. `startDrag` engaged on the bare `pointerdown` with **no movement threshold** for mouse, so a plain
   click set `isDragging = true`.
2. That commit added `if (wasDragging || …) rebuildElementLayer()` to `_finish()`, which runs on
   `pointerup`. `rebuildElementLayer()` removes and recreates **every** `.pdf-element` node.

So a zero-movement click detached its own `mousedown` target before `mouseup` landed. **A mouse
`click` is only dispatched when mousedown and mouseup share a live common ancestor**, so Chrome
dispatched *no click at all* — measured: zero on the element **and** zero on the document.
`handleElementClick` → `selectElement` never ran.

**Why it looked like a mobile-only success, which is the genuinely non-obvious part: a
touch-derived click SURVIVES the same node swap.** Isolated in a synthetic page with identical DOM
mutation — mouse `0` clicks, touch `1` click. Pre-c6bd71d the drag path rebuilt the layer on every
`pointermove` and `_finish()` rebuilt nothing, so a click with no movement never triggered a rebuild
and selection worked. **Do not "verify" a pointer regression on touch and conclude the path is
fine.**

**Fix: the drag is deferred behind `_DRAG_THRESHOLD` for EVERY pointer type** (`_pendingTouchDrag` →
`_pendingDrag`), which is c6bd71d's own touch pattern generalised. `wasDragging` then *implies* real
movement, so its `_finish()` rebuild became correct as written and needed no second change. A mouse
press inside a text control still returns early and is left to the browser — that is what keeps
caret placement and drag-to-select-text alive. `startDrag` is gone; its `e.preventDefault()` (which
also suppressed native text selection during a drag) is replaced by `user-select:none` on
`.pdf-element`, with the inner control opting back in.

**Two traps for whoever reads this next.** First, `git blame` credits c6bd71d with the
`if (!isSelected) input.style.pointerEvents = 'none'` line in `elementLayerRenderer.ts` — **blame is
wrong there, the code was only MOVED into `_renderOne`.** That gate is older, so
click-to-select-then-click-to-focus (two clicks) is the ORIGINAL design; do not "restore" one-click
editing by adding auto-focus-on-select, and do not delete the gate. Second, this class is invisible
to jsdom, which does not model the mousedown/mouseup common-ancestor rule — a dispatched `click`
runs no matter what happened to the node. The jsdom guard therefore pins the *cause* (a press with
no movement must leave the handler idle and must not rebuild the layer, for both pointer types) and
`tests/browser/element-click-select.browser.test.ts` drives a **real mouse** for the outcome.
Sabotage-verified: re-committing the drag on pointerdown fails 3 browser + 6 jsdom cases.

### pdf.js's text layer swallowed every click on the page, so nothing ever deselected (2026-08-22)

Found while hunting the click-to-select regression above, and independent of it. The click that
deselects an annotation was bound to `<canvas id="pdfCanvas">`. But
`TextLayerManager.setPointerEvents(mode === 'select')` makes pdf.js's `.textLayer` interactive in
SELECT mode so PDF text can be selected and copied — and that layer is a **sibling overlay covering
the whole page**. So in exactly the mode where clicking empty page area should deselect, the click
landed on `.textLayer`, never reached the canvas, and `CanvasClickRouter`'s `selectElement(null)`
branch was **dead code on any page carrying a text layer**. Escape was the only way to deselect.

**Proven by single-variable experiment on the running app**, which is the technique worth copying
here: with the layer interactive, a click on empty page area leaves the element selected; setting
ONLY `document.querySelector('.textLayer').style.pointerEvents = 'none'` — changing nothing else —
makes the identical click deselect. The behaviour is also **page-type-inconsistent** (a page with no
text layer deselects fine), which is what marks it an accident rather than a design choice.

**The listener moved to `#canvasContainer`, gated on `isPageSurfaceClick`.** The gate is the whole
point and must not be dropped for a bare container listener: `#exportPreviewOverlay`, the ink
canvas and the annotation layer are children of that same container, and routing their clicks into
`handleCanvasClick` would deselect — and in `editText`/`fillBucket` modes run canvas-relative
coordinate maths — for clicks that are not page clicks at all. The surface is the canvas plus
anything inside `.textLayer`; pdf.js emits **one span per glyph**, so the real target is almost
never the layer node itself and the check has to be `closest`, not `===`. Annotation elements
already `stopPropagation` in `ElementLayerRenderer`, so they never arrive. Guard:
`tests/ui/binders/canvasClickRouting.test.ts` — sabotage-verified (rebinding to the canvas fails
exactly the text-layer case and nothing else).

**The same gate needed a THIRD branch: the grey area AROUND the page (2026-08-22, same day).**
Fixing the text layer fixed clicks *on* the page; a click *beside* it still did nothing.
`.canvas-container` is `padding: 20px` and `#pdfCanvas` is `margin: 0 auto` (`editor.css`), so
whenever the page is narrower than the viewport there is a band of the container's own
background next to it. **At fit-to-width that band is only 20px, which is why it reads as
negligible — but it grows with every zoom-out step: measured 909px canvas in a 1200px container,
a 146px gap after five clicks, unbounded below that.** So the deselect worked on the page and
silently failed on what looks like the same empty space.

The fix is a SECOND predicate, `isEmptyCanvasAreaClick`, composed with the first —
**deliberately not a looser `isPageSurfaceClick`**, because the grey margin is genuinely not the
page surface and saying so would make the name lie. **`target === container`, never
`closest('#canvasContainer')`**: every overlay lives INSIDE that container, so `closest` re-admits
exactly what the gate above exists to exclude. Sabotage-proven — swapping in `closest` fails the
descendant and overlay cases and nothing else.

Routing the margin through `handleCanvasClick` is safe in every mode, and this was checked rather
than assumed: the placement modes (`addText`/`addImage`/`addComment`/`addSignature`/`addCode`) and
the shape modes return early in `CanvasClickRouter`, so **no element can be dropped out there**;
`editText` maps the click to PDF content coords, finds no item within `TOLERANCE`, and re-shows its
hint; `fillBucket` bounds-tests shapes and ink (`hitTestShape` has no `Math.abs`, so a negative x
cannot match). Only the `select` branch does anything.

**Known bound, unmeasured:** on a platform with CLASSIC (space-taking) scrollbars, a click on the
container's scrollbar would also have `target === container` and would deselect. This Chrome uses
overlay scrollbars (`offsetWidth - clientWidth === 0`) and `::-webkit-scrollbar` sizing would not
force one, so it could not be reproduced — it is recorded rather than guessed at, and no guard was
written for a failure mode with no observed instance. If it ever surfaces, the one-line test is
`e.offsetX < container.clientWidth`.

Guards: the `isEmptyCanvasAreaClick` + wiring cases in the same jsdom file, and
`tests/browser/canvas-margin-deselect.browser.test.ts` — the browser one earns its place because
jsdom picks its own event target, so it assumes what a pointer in the gap hits; only a real layout
can show the gap exists and that no stretched overlay swallows the click first, which is the exact
shape of the bug this gate already had once.

### `/pdf-qa-sweep` reaches 66 of 141 controls, and that is the app's design — do not "fix" the crawl (2026-07-31)

The sweep's `0 fail` covers **66 distinct controls of 141 in the DOM**. Every report now ends with
`Exercised N distinct control(s) of M` and **names** the rest, because 31 `SKIP became hidden` lines
buried among 150 entries read as thorough and are not. **Read that line before claiming the sweep
covers a feature** — `flattenBtn`, `sanitizeBtn`, `watermarkBtn`, `batesBtn`, `compressBtn`, `exportXlsxBtn` and the
DOCX/MD/XFDF export buttons are **never clicked** (a `deploy.yml` comment claimed otherwise; corrected).

**The cause is the product, not the driver.** `modalBinder.ts` registers the export flyout with
`closeWhen: 'any-click'`, and each file-menu item removes `.open` from its wrap in its own handler — so
the app shuts the container as soon as one child is used and every later sibling is legitimately hidden.
Only re-opening the toggle once per child could reach them. **Four shapes of that were built and
measured; all lost coverage overall** against the 2026-07-31 baseline `150 checks / 112 pass / 0 warn / 36 skip`. `scripts/qa-sweep.mjs` records
`145 / 107 / 0 / 36` for the same day and the same flag: two runs, both from `5170c27`, neither log kept, and
which one the attempts below were measured against was not recorded. Each total also counts its A11Y /
ACCEPT lines, which is why pass + skip falls 2 short in both:

| attempt | checks | pass | warn | skip |
|---|---|---|---|---|
| unwind only when something was revealed | 143 | 81 | 30 | 30 |
| re-click any parent when a sibling went hidden | 107 | 54 | 38 | 13 (+1 FAIL) |
| re-click flyout/menu toggles only | 132 | 78 | 33 | 21 |
| separate post-crawl container pass | 170 | 112 | 0 | 55 (+1 FAIL; a variant hung 15 min) |

A hidden-SKIP and a `blocked by` WARN are **the same phenomenon** — a container in the way — so trading
one for the other buys nothing and costs stability. The numbers live in `exercise()`; do not re-attempt
without beating them. Two traps found along the way, both worth knowing: `unwind()` inspects only the
**page centre**, so it is structurally blind to a toolbar flyout (which is why a naive re-open *closed*
them); and `exercise()` marks a control `visited` **before** its visibility check, so a second pass that
guards on `visited` silently skips exactly the controls it exists to reach.

Two robustness fixes landed from this: `page.setDefaultTimeout(6_000)` after boot (Playwright's 30s
default made 40 covered undo-clicks in the scenario reset hang the run for **20 minutes** with no
output — in CI a job timeout, i.e. an unactionable red), and crash containment around the crawl (this
container's Chromium SIGSEGVs non-deterministically; it used to throw out of `main()` → exit 2, **no
report and no CI artifact**. Now it records the crash and still prints).

### A CRITICAL a11y rule the gates could barely see: `<label>` with no `for=` (2026-07-31)

`/pdf-qa-sweep` caught axe `select-name` (**critical** — a tier above the three `serious` rules fixed on
2026-07-29) on `#blankPageSize`/`#blankPagePosition`, and caught it **by luck**: the rule fires only
while a control is VISIBLE, so it needed a run that happened to leave `blankPageModal` open. The cause
was systemic — **16 controls** sat beside a bare `<label>` with no `for=`, i.e. a visible label with
**zero** programmatic association to the sibling it labels. Chrome's own computed name, before → after:
`combobox:` (nameless) → `combobox "Mode"`. Worse, `#batesPrefix` reported `textbox "ACME-"` — it was
falling back to its **placeholder**, so AT announced an example value as the field's name.

Fixed by adding `for=` to all 16 (pure markup, existing i18n keys, no new strings; the labels also
become click targets, which is a bonus not a risk — nothing in `src/` reads label structure).

**The gate is now static, because the live one cannot be trusted for this.** `tests/ui/indexHtmlA11y.test.ts`
enumerates **every** `input`/`select`/`textarea` rather than four hand-picked ids: zero unnamed
`<select>` (that rule is critical), plus a **declining allowlist** `UNNAMED_OK` for the remainder and a
third test that fails if an entry becomes stale — so a fixed control cannot be left in the list. Proven
non-vacuous: reverting `index.html` fails 2 of the 3 and names all 16.

**The remaining 8 were closed the same day, with ZERO new i18n keys** — and the measurement that made
that possible is the reusable lesson. They were **never axe violations**: accname falls back to
`placeholder`, then `title`, so Chrome computed a name for every one and axe reported nothing. The
defect was the *fragility* of that fallback, and `#pdfPasswordInput` is the proof — it announced its
placeholder `"Enter password…"` while a perfectly good `<label>Password</label>` sat unassociated
directly above it. **Do not budget new strings for this class before probing Chrome's computed name;
the keys the placeholders already reference are the keys you need.** Fixes: `for=` on the password
label; `role="group"` + `aria-labelledby` on the `signX/Y/W/H` and `blankPageW/H` rows so a bare `"X"`
is announced with its group label; `data-i18n-aria` reusing the existing placeholder/title keys.

`UNNAMED_OK` is therefore down to **5** — hidden file/colour inputs that exist only to be `.click()`ed
by a visible button. That is a coherent permanent category, not a backlog: axe skips hidden nodes and
no user can focus them.

### Live-app a11y: 3 serious WCAG rules fixed, and why the static gate missed them (2026-07-29)

`/pdf-qa-sweep` found three `serious` axe violations in the **running** app that
`tests/browser/a11y-axe.browser.test.ts` cannot see. That test injects `index.html`'s static body with
`<script>` stripped, so `main.ts` never runs: no document is loaded, so **no thumbnails are rendered
and the canvas region does not scroll**, and the elements that fail are either absent or `display:none`
(axe skips hidden nodes). It gates on zero critical/serious and passes truthfully — it just cannot
reach these. Keep both gates; they answer different questions. Fixes:

1. **`nested-interactive` (2 nodes) — the real defect.** `.thumb-item` carried `role="button"` +
   `tabindex="0"` while also containing the rotate / export / delete buttons: a control inside a
   control. Its hand-rolled Enter/Space competed with the children's, and a screen reader announced a
   button within a button. Now the tile is a plain div (drag surface + positioning context only) and
   the nav affordance is a real `<button class="thumb-nav">` wrapping the image. `.thumb-label` stays
   a **direct child of the tile** so its `position:absolute` keeps anchoring there. **The Enter/Space
   handler was DELETED, not moved** — a native button does activation *and* Space-scroll suppression
   for free, so keeping it would fire `onNavigate` twice per Enter. Post-delete focus restoration now
   targets `.thumb-nav`; focusing the tile would silently drop focus to `<body>`. Native activation is
   **verified live** (2026-07-29): focusing the page-2 `.thumb-nav` and pressing Enter moves the page
   indicator to 2. jsdom cannot show this — it does not synthesise click from keydown, and a synthetic
   `KeyboardEvent` never runs a default action — so the jsdom test asserts only the structural
   precondition (the control is a real `<button>`) and the behaviour is guarded by
   `tests/browser/thumbnail-activation.browser.test.ts` (real Enter/Space via `userEvent`, asserting
   `onNavigate` fires **exactly once**). That guard is proven non-vacuous: reintroducing the deleted
   keydown handler fails it with 2 calls.
2. **`color-contrast` (2 nodes).** `.btn-success` `#10b981` on white was **2.53:1** — and its
   `:hover` `#059669` was **3.77:1**, never measured because axe does not test hover. Now `#0a855b`
   (4.65) / `#087d55` (5.15). `.toolbar-label` `#64748b` on `#f0f4f8` was **4.3:1** → `#616a78`
   (4.95). Both are the *lightest* values clearing 4.5:1, so the visual delta is minimal. `#64748b`
   elsewhere sits on white (4.76:1) and is left alone.
3. **`scrollable-region-focusable` (1 node) — FIXED 2026-07-31, and the ruling below still stands.**
   The rule is satisfied by the region containing focusable **content**, not only by the region itself
   being focusable — so `#pdfCanvas` (which already had `role="img"` + an i18n aria-label) is now
   `tabindex="0"`, and `#canvasContainer` keeps its `tabindex="-1"`. Both halves are asserted in
   `tests/ui/indexHtmlA11y.test.ts`. Verified live with a document loaded: the violation is present
   before and absent after, and with the canvas focused ArrowDown genuinely scrolls the region
   (`scrollTop` 20 → 100) — the keyboard access the rule exists to protect, actually working.
   **`A11Y_ACCEPTED` in `scripts/qa-sweep.mjs` is now EMPTY**, so the deploy gate has zero accepted
   exceptions; keep it that way. The history below is kept because the trade-off it describes is real
   and someone will re-propose `tabindex="0"` on the landmark:
   `#canvasContainer` was briefly changed `tabindex="-1"` → `"0"` on 2026-07-29 to satisfy the rule.
   The developer ruled on 2026-07-30 to keep the strict skip-nav idiom (`-1`) instead, so the landmark
   stays out of the tab order and a keyboard user reaches the page content without an extra stop —
   **that ruling was never overturned and still holds.** For one day the violation was therefore left
   open and carried as the sole `A11Y_ACCEPTED` entry, reported as `ACCEPT` on every run rather than
   hidden. What resolved it was noticing the rule accepts focusable *content*, so the landmark and the
   rule were never actually in conflict — only the first fix attempt was. The lesson worth keeping:
   **when a gate and a ruling appear to collide, re-read the rule before accepting a hole in the
   gate.** Note the static test cannot see the rule either way — its DOM never scrolls.

**Do not "fix" a contrast report without checking `opacity` has reached 1.** axe reads *composited*
colour, so a control caught mid fade-in reports the blend over the toolbar: `#textModeBtn` at
opacity 0.508 measured `#6f787f` (4.49, FAIL) when its real background is `#6c757d` (4.69, PASS) —
8 phantom violations whose count drifted run to run with load timing. `scripts/qa-sweep.mjs` now waits
for `document.getAnimations()` to settle before running axe.

### Mobile thumbnail controls = a single ⋮ action menu (F2b, 2026-06-26)

The per-thumbnail controls
(↺↻ rotate / 📄🖼 export / × delete) reveal on `:hover` on **desktop only**. On `≤640px` a 50×74px tile
can't host five 44px touch targets, so the media query in `pdf-layers.css` **hides** `.thumb-rotate`/
`.thumb-dl`/`.thumb-delete` (they stay in the DOM — desktop uses them) and **shows** a single `.thumb-more`
⋮ button that opens `_openActionMenu` — a body-anchored popup (`.thumb-action-menu` / `.thumb-action-menu-item`,
≥44px rows) with Rotate L/R, Export PDF, Export image (→ the existing format submenu), Delete. Both popups
share ONE open-menu state (`_openMenu`/`_closeMenu`/`_onMenu*`) and the shared `_positionMenu(menu, anchor)`,
which **flips the menu upward** when there's no room below (the thumbnail strip sits at the viewport bottom,
so it almost always opens up) + clamps horizontally. Guarded by the F2b jsdom tests in
`tests/ui/pageThumbnailPanel.test.ts` (wiring) + live @375px evidence (`qa-shots/f2b/`: overlays `display:none`,
rows measured 44px, menu fully in-viewport). i18n: one new key `thumbnail.moreActions` (ar reviewed 2026-07-30);
row labels reuse the existing `thumbnail.*` keys.

### Watermark renders LIVE on the editor canvas (2026-06-25)

The watermark was historically
export-only (only `exportPreviewPanel` called `drawWatermark`), so enabling it showed *nothing*
while editing — read as "watermark not working." `PageRenderPipeline._renderWatermarkOverlay()`
now paints it onto a dedicated `#watermarkOverlay` canvas (z-index 1, pointer-events none, NOT the
pdf.js page canvas — keeps true-edit colour sampling / thumbnails clean), removed+recreated every
`renderCurrentPage`; `WatermarkPanel.apply()` re-renders so toggling is immediate. **De-dup
invariant**: the export-preview ghost draws its OWN watermark, so `_renderWatermarkOverlay` SKIPS
when `exportPreviewOpen`, `ExportPreviewPanel.show()` removes the live overlay, and `hide()`
re-renders to restore it — exactly one watermark in every mode (guarded by
`tests/core/pageRenderPipeline.test.ts` + `tests/ui/exportPreviewPanel.test.ts` +
`tests/browser/watermark-live.browser.test.ts`). The exported PDF is unchanged (pdf-lib
`drawWatermark` in `buildPageOverlays`, no double-bake). **Density is now 1–10 (0.5 steps),
font-size max 400** (angle ±180 and opacity 1–100 were already full); the export spacing uses the
shared pure `src/utils/watermarkDensity.ts` `densitySpacingFactor` (interpolated table preserving
the old integer-1..5 factors EXACTLY → byte-stable at integer densities). `apply()`/`_updatePreview()`
parse density with `parseFloat` (NOT `parseInt`, which truncated 1.5→1).

### `renderElements()` destroys and recreates every element DOM node

> **[Re-checked 2026-09-28]** `renderElements()` was removed in `a49a6d8`; the behaviour below holds in `rebuildElementLayer()` (`src/ui/elementLayerRenderer.ts`), and `rerenderElement()` replaces a single node the same way.

On each call.
Focus-restoration hacks depend on this; keyed identity is NOT preserved.

### File System Access save (#54)

`src/utils/fileSystemAccess.ts` (`pickSaveTarget`/
`writeToHandle`; the unused `canUseFsSave` probe was deleted by limits row 11, local types — the API is absent from some `lib.dom` versions, so no dep). `downloadPDF`
uses the native Save dialog on Chromium. **Non-obvious: `showSaveFilePicker` needs *transient user
activation*** — an `await` (e.g. PDF assembly) can outlive it, so the picker MUST be acquired BEFORE the
slow work (`pickSaveTarget` is called first in `downloadPDF`, then assemble, then `writeToHandle`).
Cancel (AbortError) → silent no-op; any non-abort failure → anchor-download fallback (progressive
enhancement). The picker is now used by **all the major byte exports** — `downloadPDF`,
`downloadPage`/`downloadPageRange`, `downloadFlattened`, `sanitizeAndDownload`, `compressAndDownload`,
`exportTableCsv`, `downloadPageAsImage`, **and `exportAsDocx`** (each calls `pickSaveTarget` FIRST, before
the heavy assembly, to stay within the transient-activation window). Only `exportAsMarkdown`/TXT and the
XFDF export stay plain `_downloadBlob`. **Automation note:** the native Save dialog can't be driven by
Playwright — to capture a download in a browser test, `delete window.showSaveFilePicker` to force the
anchor-download fallback. Open-via-picker + recent files SHIPPED 2026-09-04 — see § "Open via the native picker + recent files (#54b)".
