# DOCX editor — image Cut & Paste (Sub-project B, sub-slice 3) — Design

> Follow-up B, sub-slice 3 of 4 (INSERT ✓ · MOVE ✓ · **Cut & paste** · Drag). Builds on slice-1
> (`opcParts.ensureImagePart` mint + `docModel.buildDrawingParagraph`) and slice-2
> (`docModel.placeImageAnchors` save-side insert/move). Adds **no new save logic** — the entire
> feature is three small ProseMirror-layer hooks that route a pasted image into the *existing*
> `anchorId:-1 ⇒ mint-fresh` insert path.

## Goal

Let the user **cut / copy / paste** an image inside the DOCX editor with the standard
Ctrl/Cmd+X / +C / +V, and **paste an external image blob** (OS "copy image", screenshot tool,
image editor), persisted byte-correctly through the in-place `save()`.

## Scope (Option 1, user-confirmed)

**In:**
- Intra-editor **copy** + **paste** of an existing `docx_image` (native PM clipboard).
- Intra-editor **cut** + **paste** (= native copy + delete; relocates the image).
- **External image blob** paste (`image/png` / `image/jpeg` on the OS clipboard).

**Out (ceiling, documented):**
- `http(s)` `<img src="…">` from web HTML — CORS blocks reading the bytes client-side, and we
  need the actual bytes to mint an OPC media part. Such an `<img>` is simply not matched → dropped.
- GIF / SVG / WebP — only PNG/JPEG are minted (matches the slice-1 `sniffImageMime` contract).
- Orphaned-media garbage collection after a cut — the old `word/media/imageN` part is left
  unreferenced (no part GC in v1; identical to the C2 delete behavior).
- Mixed text+image HTML fragments — text pastes normally; an embedded image embeds **only** if it
  is a `data:`-uri `<img data-docx-image>` (our own), otherwise it is dropped.

## Root cause this slice exists to fix

`docx_image` has a `toDOM` but **no `parseDOM`**, and ProseMirror's native copy preserves a node's
attrs. So an intra-editor **copy** yields a second `docx_image` carrying the **same** `anchorId`
(e.g. two nodes both `anchorId:0`). At `save()`, `placeImageAnchors`' safety guard requires the
model's image `anchorId`s to be a **duplicate-free** subset of the DOM anchor map keys; the
duplicate trips the guard → the save **bails to verbatim** → the pasted copy is silently dropped.
It looks like it worked in the editor, then vanishes on save.

**Fix principle:** every *pasted* image must arrive with `anchorId:-1` ("new, no identity"). Then
`placeImageAnchors` treats it as a brand-new image → mints a fresh OPC media part and inserts a new
`w:drawing` anchor — exactly the slice-1 insert path that is already built, tested, and gated green.

## Architecture — three units, all in the ProseMirror layer

### Unit 1 — `transformPasted(slice)` (the universal fix)

A new `EditorView` prop. ProseMirror runs `transformPasted` on the final parsed `Slice` for **both**
clipboard paths:
- intra-editor paste (PM detects its own `data-pm-slice` marker → uses the internal slice directly),
- cross-context paste (PM parses `text/html` via `transformPastedHTML` + `parseDOM` → builds a slice).

Either way the slice passes through `transformPasted`. The function walks the slice's fragment
(recursively) and rebuilds every `docx_image` node with `anchorId:-1`, preserving
`dataB64`/`mime`/`widthPt`/`heightPt`. This single hook covers copy/paste **and** cut/paste.

```
function resetPastedImageAnchors(slice: Slice): Slice
  // map the fragment: for any node of type docx_image, return
  //   node.type.create({ ...node.attrs, anchorId: -1 })
  // recurse into non-leaf nodes; leaves (docx_image is an atom) just get re-created.
```

Implemented as a pure helper in a new `src/docx/docxImagePaste.ts` (jsdom-testable against the
schema), wired in `docxProseMirror.ts` as `transformPasted: (slice) => resetPastedImageAnchors(slice)`.
`view.setProps` later merges, so the existing `transformPastedHTML`/`handlePaste`/`dispatchTransaction`
props are preserved (same merge guarantee slice-1/2 already rely on).

### Unit 2 — `parseDOM` on the `docx_image` schema node

Add a `parseDOM` rule so our own image survives the **HTML-clipboard** path (e.g. paste into a fresh
editor instance, or a browser that only round-trips `text/html`):

```
parseDOM: [{
  tag: 'img[data-docx-image]',
  getAttrs(dom: HTMLElement) {
    const src = dom.getAttribute('src') ?? '';
    const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(src);
    if (!m) return false;                       // non-data: src (web image) → skip, never match
    return { mime: m[1], dataB64: m[2], anchorId: -1, widthPt: 0, heightPt: 0 };
  },
}]
```

Tightly scoped: requires the `data-docx-image` attribute **and** a `data:image/png|jpeg` src. An
arbitrary web `<img>` (no attribute, or `http(s)` src) returns `false` → never produces a node.
`anchorId:-1` here too (belt-and-suspenders with Unit 1; the HTML path produces a fresh node anyway).

### Unit 3 — `handlePaste` image-blob branch

Extend the existing `handlePaste` (which currently handles only the Ctrl/Cmd+Shift+V plain-text
arm). **After** the plain-paste check, inspect `event.clipboardData` for an image item/file:

```
// (after the existing `if (_plainPasteArmed) {…}` block)
const file = firstImageFile(event.clipboardData);   // items/files, mime png|jpeg
if (!file) return false;                              // let PM default handle text/html/slice
// async: read bytes → createImageBitmap dims (slice-1 logic) → insert docx_image anchorId:-1
void insertImageBlob(v, file);
return true;
```

`insertImageBlob` reuses the slice-1 dimension logic (`PT_PER_PX = 0.75`, `CONTENT_WIDTH_PT = 468`,
`createImageBitmap` for natural px, `catch → 0 dims`) and dispatches a `tr.replaceSelectionWith` of a
`docx_image` node with `anchorId:-1`. Bytes → base64 via the slice-1 `imgBytesToB64`. (Factor the
shared bytes→node logic so the toolbar 📷 button and this paste path use one implementation — likely
exported from `docxToolbar.ts` or lifted into `docxImagePaste.ts`; no behavior change to the toolbar.)

`firstImageFile` returns the first `clipboardData.files`/`items` entry whose type is
`image/png`/`image/jpeg`; otherwise `null` (a non-image paste falls through to PM's default).

## Cut behavior (no extra code)

Ctrl/Cmd+X on a selected `docx_image` is PM's native cut = **copy + deleteSelection**. The delete
removes the node from the doc (its `anchorId` disappears from the model); the copy puts it on the
clipboard. On paste, Unit 1 resets `anchorId:-1` → mint-fresh. At `save()`:
- `reconcileImageAnchors` sees the original `anchorId` absent from the model → `el.remove()` deletes
  the original `w:drawing` (same path as a C2 delete);
- `placeImageAnchors` mints a new media part + inserts a new anchor for the pasted node.

Net: a true move-via-clipboard. The original media part is orphaned (acceptable v1, == C2 delete).
Cut therefore needs **no new wiring** — it is copy (Unit 1) + native delete.

## Data flow

```
copy/cut a docx_image ─▶ PM clipboard (slice + text/html)
paste ─▶ transformPasted(slice)  ──────────────▶ docx_image anchorId:-1   (Unit 1)
   or  ─▶ transformPastedHTML → parseDOM(img[data-docx-image]) ─▶ anchorId:-1 (Unit 2)
   or  ─▶ handlePaste reads image blob ─▶ insert docx_image anchorId:-1     (Unit 3)
save() ─▶ applyBlocks({editImages:true, mintImage}) ─▶ placeImageAnchors:
            anchorId:-1 ⇒ ensureImagePart (new media+rel+Default) + buildDrawingParagraph insert
            (existing/removed anchors handled by reconcileImageAnchors — unchanged)
```

## Files

- **Create** `src/docx/docxImagePaste.ts` — `resetPastedImageAnchors(slice)`, `firstImageFile(dt)`,
  `insertImageBlob(view, file)` (+ shared bytes→`docx_image`-attrs helper if lifted here).
- **Modify** `src/docx/docxSchema.ts` — add `parseDOM` to the `docx_image` node (Unit 2).
- **Modify** `src/docx/docxProseMirror.ts` — wire `transformPasted` (Unit 1) + the image-blob branch
  in `handlePaste` (Unit 3).
- **Modify** `src/docx/docxToolbar.ts` — if the bytes→node helper is shared, export it (no behavior
  change to the 📷 Insert button).
- **Tests:** `tests/docx/docxImagePaste.test.ts` (jsdom) + `tests/browser/docx-image-cutpaste.browser.test.ts`.

## Testing

**jsdom (`tests/docx/docxImagePaste.test.ts`):**
1. `resetPastedImageAnchors` rebuilds a `docx_image` (anchorId 0 → -1), preserving dataB64/mime/dims.
2. `resetPastedImageAnchors` leaves non-image nodes untouched (paragraph/text identity).
3. `parseDOM`: a `<img data-docx-image src="data:image/png;base64,…">` parses to a `docx_image`
   `anchorId:-1`; an `<img src="https://…">` (no attr / http src) does NOT (`false`).
4. `firstImageFile` returns a png/jpeg item, `null` for a text-only DataTransfer.

**Real Chrome (`tests/browser/docx-image-cutpaste.browser.test.ts`):**
1. **Copy → paste** an existing image, then `save()` → **two** `w:drawing` elements in
   `document.xml` (proves the save did NOT bail to verbatim — the regression guard).
2. **Cut → paste** → still exactly one `w:drawing` after save, relocated (image moved, no dup).
3. (best-effort) external-blob paste via a synthesized `paste` event carrying an `image/png` blob →
   a new `docx_image` renders + survives save.

## Global constraints (verbatim from program)

- Cardinal DOCX rule: edit `word/document.xml` **in place**, never rebuild via the docx writer.
- No new dependency; no `SCHEMA_VERSION` bump (the docx model is export-transient, not persisted).
- Rides the existing `VITE_FEATURE_DOCX_EDIT` flag — no new flag.
- `docModel.ts` must NOT import `opcParts.ts` (cycle) — minting stays the `opts.mintImage` callback.
- oxlint: no non-null `!`, no `==`; avoid `as any` (localize casts).
- Per-item commit pre-authorized; **push is manual**. No `Co-Authored-By` trailer.
- i18n: any new user-facing string added to en/fr/ar (ar [Unverified]).

## Adversarial check

Worst failure mode: `transformPasted` misses a path → a duplicate `anchorId` reaches `save()` →
silent verbatim-bail (paste lost). The browser test asserting **two** `w:drawing` after copy→paste
catches exactly this. Second risk: `parseDOM` matching too broadly → arbitrary web images attempt
embedding; mitigated by requiring `data-docx-image` **and** a `data:image/png|jpeg` src
(`getAttrs` returns `false` otherwise). Both survive.
