# Feature 3 — Overlay-text links (design)

**Date:** 2026-06-24  **Status:** approved (autonomous-design mode)  **Program:** feature-program-2026-06-24

## Goal

Let a user make an overlay `TextElement` a **clickable hyperlink**. On export, a real PDF
`/Link` annotation with a `/URI` action is added over the element's rect, so the text is
clickable in any PDF viewer. The editor shows a link affordance (🔗 badge + the URL as a
tooltip). Whole-box link (one element = one URL) — per-run links need rich-text runs (ceiling).

## Non-goals (v1 ceiling — documented)

- Per-run / partial-text links (needs multi-run rich text).
- Internal GoTo links (page jumps) — `/URI` external links only.
- Forced link styling — the user styles the text (color/underline) via existing controls.
- Rotated-element link rect is the axis-aligned bbox (PDF `/Link` rects can't rotate).

## Security (non-negotiable)

`sanitizeLinkUrl` rejects any non-web scheme. ONLY `http:`, `https:`, `mailto:` pass; a
bare domain-like string (`example.com`, contains a dot, no scheme, no space) is upgraded to
`https://`. Everything else — `javascript:`, `data:`, `vbscript:`, `file:`, empty, spaces —
returns `null` (no annotation written). This blocks `javascript:`-URI injection through a
crafted link. (`pdfSanitizer` already preserves `/URI` actions, so a sanitized link survives
the sanitize-and-download path too.)

## Data model

`TextElement.linkUrl?: string` — OPTIONAL, **no `SCHEMA_VERSION` bump**. `toJSON` omits when
unset; `elementFactory` reads `typeof data['linkUrl'] === 'string' ? data['linkUrl'] : undefined`.
NOT part of the format painter or `clearFormatting` — a URL is per-element data (like `text`),
not visual style; it is cleared explicitly via the popover (empty input → `setLinkUrl(null)`).

## Pure core — `src/utils/linkUrl.ts`

```ts
const ALLOWED = /^(https?:|mailto:)/i;
const BARE_DOMAIN = /^[^\s:]+\.[^\s:]+/; // has a dot, no scheme, no whitespace

export function sanitizeLinkUrl(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (ALLOWED.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // some other scheme → reject
  if (BARE_DOMAIN.test(s)) return `https://${s}`;
  return null;
}
```

## Export bake — `src/export/pdfElementRenderer.ts` `renderText`

After the text is drawn, if `te.linkUrl` sanitizes to a non-null URL, append a `/Link`
annotation to the page `/Annots` (the `incrementalSigner.ts` idiom: `ctx.obj`, `PDFArray`,
`page.node.get('Annots')` push-or-create). Rect = element box in PDF coords via the SAME
`rectAnchor` + swap-dims used for the background rect (AABB, rotation-safe):

```
<< /Type /Annot /Subtype /Link /Rect [llx lly urx ury] /Border [0 0 0]
   /A << /S /URI /URI (sanitized) >> >>
```

`/Border [0 0 0]` = no visible box. Pure helper `buildUriAnnotation(libs, ctx, rect, url)`
returns the registered `PDFRef`; `renderText` pushes it. Because the redaction-raster path
also runs `renderText` on the same page object (via `buildPageOverlays`), links survive both
export paths. Byte-identical when `linkUrl` is unset/invalid.

## Editor — `src/elements/textElement.ts`

When `linkUrl` is set, `render()` adds `class="...text-element--linked"`, sets the div
`title` to the URL, and appends a small non-interactive `🔗` badge (`.text-link-badge`,
`pointer-events:none`). No forced text restyle. CSS in `editor.css`.

## Service — `src/core/formattingService.ts`

```ts
setLinkUrl(raw: string | null): void  // sanitize; null/empty clears; MoveResizeCmd { linkUrl }
```
Early-returns unless a `text` element is selected. `app.setLinkUrl(raw)` delegator.

## UI

- A "Link" row in the **Text ⋮** popover: `<input type="url" id="textLinkInput">`. Its
  `change` → `svc.setLinkUrl(value)` (empty clears). Added to `AppDOMRefs`; `open()` populates
  `value` from `te.linkUrl ?? ''`.
- i18n `formatting.linkLabel` ("Link URL") + `formatting.linkPlaceholder` ("https://…") in
  en/fr/ar (ar [Unverified]). No feature flag (additive).

## Tests

- `tests/utils/linkUrl.test.ts` — pure: http/https/mailto pass; bare domain → https; reject
  javascript:/data:/file:/empty/whitespace.
- `tests/elements/textElement.test.ts` — toJSON omit/include; factory round-trip; editor badge
  + title present when set, absent when unset.
- `tests/core/formattingService.test.ts` — set/clear/validate (javascript: → no link), undoable,
  no-op without a text selection.
- `tests/ui/textOptionsPopover.test.ts` — input change wires `setLinkUrl`.
- `tests/browser/text-link.browser.test.ts` — real Chrome: export a linked text element →
  `page.getAnnotations()` has a Link annot whose `url` is the sanitized URL over the rect; a
  javascript: URL produces NO annotation.

## Gate (one commit)

`npm run type-check && lint && test && test:browser && build`. No Co-Authored-By. Push manual.
