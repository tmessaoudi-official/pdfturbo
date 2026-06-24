# Feature 3 — Overlay-text links — Implementation Plan

**Goal:** Clickable `/Link` (URI) annotation over an overlay TextElement, editor affordance.
**Tech:** TS, @cantoo/pdf-lib `/Annots` append, jsdom + real-Chrome (getAnnotations) tests. TDD.

## Global Constraints
- No `SCHEMA_VERSION` bump (`linkUrl` optional, omitted-when-unset).
- Security: `sanitizeLinkUrl` allows ONLY http/https/mailto (+ bare-domain→https); else null.
- NOT in format painter / clearFormatting (URL = element data, not style).
- One feature commit. No Co-Authored-By. Push manual. Full gate per commit.

---

### Task 1: pure `linkUrl.ts`
- Test `tests/utils/linkUrl.test.ts`: http/https/mailto pass; bare-domain→https; reject
  javascript:/data:/file:/vbscript:/empty/whitespace-only.
- Create `src/utils/linkUrl.ts` `sanitizeLinkUrl(raw): string | null` per spec.

### Task 2: model + factory + toJSON
- `textElement.ts`: `linkUrl?: string` field + `TextOptions.linkUrl` + constructor; toJSON
  spreads `...(this.linkUrl ? { linkUrl: this.linkUrl } : {})`.
- `elementFactory.ts`: `linkUrl: typeof data['linkUrl']==='string' ? data['linkUrl'] : undefined`.
- Test (textElement.test.ts): omit/include; factory round-trip.

### Task 3: editor affordance
- `textElement.render()`: when `linkUrl`, add `.text-element--linked` to div, set `div.title`,
  append a `.text-link-badge` (🔗, pointer-events:none). CSS in `editor.css`.
- Test (textElement.test.ts): badge + title present when set; absent when unset.

### Task 4: FormattingService.setLinkUrl + delegator
- `formattingService.ts`: `setLinkUrl(raw|null)` — `sanitizeLinkUrl`, set, MoveResizeCmd `{linkUrl}`.
- `pdfTurboApp.ts`: `setLinkUrl(raw)` delegator.
- Test (formattingService.test.ts): set/clear/validate(javascript:→undefined)/undoable/no-op.

### Task 5: bake the Link annotation in renderText
- `pdfElementRenderer.ts`: pure `buildUriAnnotation(libs, ctx, rect, url)` → registered PDFRef;
  in renderText, after the line loop, if `sanitizeLinkUrl(te.linkUrl)` non-null, compute the
  rect (rectAnchor + swapDims dims, same as background), push the annot ref to page `/Annots`.
- Browser test `tests/browser/text-link.browser.test.ts`: linked element export → getAnnotations
  has a Link annot with `url`; javascript: → no annot.

### Task 6: UI + i18n
- `index.html`: `#textLinkInput` (type=url) "Link" row in the Text ⋮ popover.
- `uiController.ts` AppDOMRefs: add ref; popover open() populates from `te.linkUrl ?? ''`.
- `textOptionsPopover.ts`: input `change` → `svc.setLinkUrl(value)`.
- `locales/{en,fr,ar}.json`: `formatting.linkLabel` + `formatting.linkPlaceholder`.
- Tests (textOptionsPopover.test.ts): change wires setLinkUrl.

### Final: full gate, one commit, visual screenshot (qa-shots/f3-links/).
