# PDFturbo — Cross-cutting Quality Audit (2026-06-14)

Scope: accessibility (WCAG 2.1 AA), i18n, security, mobile/responsive, SEO/PWA.
Method: static read of `index.html`, `src/`, `locales/`, `vite.config.ts`; grep for risky
patterns; locale key-diff. **No code modified.** Evidence cited as `file:line`.

Overall the app is markedly more accessible/secure than typical: strong CSP, dialogs carry
`role=dialog`/`aria-modal`, a working focus trap, `role=img`+aria-label on the page canvas,
two `aria-live` regions, key-identical locales, 40px mobile touch targets, dedicated
privacy/legal/accessibility pages. The findings below are the residual gaps.

---

## Locale key-diff (run output)

```
$ node -e '<flatten+diff en/fr/ar>'
en keys: 313  fr keys: 313  ar keys: 313
=== diff complete ===   # zero key differences across all 6 directional comparisons
```

All three locale files are **key-identical** (313 keys each). No missing/extra keys in any
direction (en↔fr, en↔ar, fr↔ar). i18n structural integrity: PASS.

---

## 1. Accessibility (WCAG 2.1 AA)

### P1
- **Canvas annotations have zero a11y / keyboard-only inaccessible** —
  `src/ui/elementLayerRenderer.ts` (grep: 0 hits for `aria|role|tabindex|setAttribute`).
  Text/shape/signature/redaction elements are rendered as plain DOM with no `role`, no
  `tabindex`, no accessible name. They are reachable via keyboard arrow-nudge *only after*
  selection, but selection itself is pointer-driven; a screen-reader/keyboard user cannot
  enumerate, focus, or identify placed annotations. WCAG 2.1.1 (Keyboard), 4.1.2 (Name/Role/Value).
  Fix: give each rendered element `tabindex="0"`, a `role` (e.g. `button`/`group`), and an
  `aria-label` derived from its type+content; route selection through focus.
- **Toasts are not announced to screen readers** — `index.html:1375` `<div id="toast"></div>`
  has no `role="status"`/`aria-live`; `src/ui/toastQueue.ts` (grep: 0 hits for `aria|role|live`)
  never sets one. All transient feedback (errors, confirmations, "update available") is
  silent to AT. WCAG 4.1.3 (Status Messages). Fix: add `role="status" aria-live="polite"`
  to `#toast` (or set it in toastQueue), `aria-live="assertive"` for errors.

### P2
- **Desktop icon-button target size** — `index.html:154` `.btn-icon { min-width: 28px; ... }`
  has **no `min-height`**; mobile override (`index.html:345`) fixes this to 40×40 but desktop
  icon buttons can fall below the 24×24 CSS-px floor in height-constrained layouts. WCAG 2.5.8
  (Target Size (Minimum), AA). Fix: add `min-height: 24px` (ideally `min-height: 32px`) to the
  base `.btn-icon`.
- **No `prefers-reduced-motion` support** — grep across `index.html`+`src/`: 0 hits. CSS
  transitions (`transition: background 0.15s` etc.) and any animation ignore the user setting.
  WCAG 2.3.3 (Animation from Interactions, AAA — but a cheap, expected win). Fix: wrap
  transitions in `@media (prefers-reduced-motion: no-preference)` or add a reduce-motion reset.
- **Single-key shortcuts cannot be disabled / no remap** — `keyboardBinder.ts` binds bare
  letters (t/s/i/a/r/c/b/d/f/h/n/e/x/k/q/w/?) as global tool toggles. They *are* guarded
  against `input,textarea,select` (line 18), which avoids the worst trap, but WCAG 2.1.4
  (Character Key Shortcuts, AA) requires a way to turn off or remap single-char shortcuts, or
  to limit them to on-focus. No such mechanism exists. Fix: add a settings toggle, or require
  the element-not-focused condition (already partly met) plus document it.

### P3
- **Color-contrast risk on muted text** — `#94a3b8` used widely (`index.html:232,642,736,797`)
  on light backgrounds (~3.1:1 on white) fails 4.5:1 for normal text (WCAG 1.4.3). Verify each
  usage is large text or decorative; darken to `#64748b` (~5:1) where it carries information.
- **No `tabindex` anywhere** (grep: 0) — relies entirely on natural DOM order for tab sequence.
  Generally good (avoids positive tabindex anti-pattern) but means dynamically-shown panels/
  flyouts must be DOM-ordered correctly; spot-check flyout/modal insertion order.

### Strengths (verified)
- Dialogs: `role="dialog" aria-modal="true"` + `aria-labelledby` on restore/help/settings/
  watermark/code/signature/blankPage/password/lock modals (`index.html:1176–1448`).
- Focus trap (`src/utils/focusTrap.ts`) correctly cycles Tab/Shift-Tab, filters
  hidden/disabled, restores focus on close; wired via `PanelFocusTrapService`, codeModalManager,
  watermarkPanel.
- Canvas: `role="img"` + `data-i18n-aria="canvas.ariaLabel"` (`index.html:1143`).
- `aria-live` on find-count (`:1131`) and progress-overlay (`:1376`, `role=status`).
- Escape closes every modal/findbar then de-selects (`keyboardBinder.ts:6–17`).

---

## 2. Internationalization

### P1
- **Hardcoded English fallback toast** — `src/main.ts:16`
  `toast.textContent = 'Update available — reload to apply';` bypasses `t()`. Only fires when
  `window.app` is unset (production SW-update path), i.e. it is the *production* string, shown
  to FR/AR users in English. Key `toast.appUpdateAvailable` already exists (used on line 13).
  Fix: call `i18next.t('toast.appUpdateAvailable')` directly (i18n is initialised before SW
  registration matters) or store the translated string.

### P3 / notes
- Other `textContent = literal` hits are glyphs/emoji only (`×`, `↻`, `↺`, `+`, `📄`, `🖼`,
  `🌐`, page-count templates like `/ ${total}`) — `annotationElement.ts:43,63`,
  `pageThumbnailPanel.ts:87–167`, `uiController.ts:466`, `findBarController.ts:113`. Acceptable;
  not user-language text.
- **RTL**: handled correctly — `updateHtmlDir()` (`i18n.ts:46`) sets `<html dir="rtl">` for
  Arabic; CSS uses logical properties (`inset-inline-start`, `inset-block-start`) in the mobile
  thumbnail rules (`index.html:809+`). Good.
- **Arabic needs native-speaker review** (per CLAUDE.md) — `locales/ar.json` is structurally
  complete (313 keys) but values are **not** confirmed by a native speaker; treat as DRAFT.
- **Doc drift**: CLAUDE.md states i18next `escapeValue: false`; actual config is
  `escapeValue: true` (`i18n.ts:71`) — the *safer* value. The CLAUDE.md "never interpolate
  user data into innerHTML" warning is therefore over-stated but harmless. Recommend updating
  CLAUDE.md to match (and the SECURITY framing below assumes the real `true`).

---

## 3. Security

### Strengths / low risk (verified)
- **Strong CSP** present as meta (`index.html:5`):
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
  worker-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' blob:;
  object-src 'none';`. No `script-src 'unsafe-inline'`/`unsafe-eval` (only `wasm-unsafe-eval`,
  required by pdf.js). `object-src 'none'`. Solid.
- **No dangerous innerHTML sinks** — grep `innerHTML`: 5 hits, all `= ''` (clearing) at
  `pageThumbnailPanel.ts:49`, `documentLoader.ts:203,324`, `exportPreviewPanel.ts:29,70`.
  Zero `insertAdjacentHTML`/`outerHTML`/`document.write`/`eval`/`new Function`. With
  `escapeValue: true` (see §2) there is no translation/user-data → HTML XSS path. XSS risk: LOW.
- **No external/CDN resource loads** — only same-origin assets; the lone external URL is a
  GitHub link in the footer. `connect-src 'self' blob:` enforces "nothing uploaded".
- **File-type validation** — `documentLoader.ts:216–266` filters by MIME
  (`application/pdf`, `image/*`).

### P2
- **External link missing `noreferrer`** — `index.html:1164` GitHub link has `rel="noopener"`
  but not `noreferrer` (grep `noreferrer`: 0). Minor referrer leak. Fix: `rel="noopener noreferrer"`.
  (The 5 footer links at `:1156–1171` are same-origin, fine.)

### P3 / privacy notes
- **Raw PDF bytes persisted unencrypted in IndexedDB** — `src/infra/storage.ts` `SavedState.
  sourcePdfs[].bytes: Uint8Array` stored under fixed key on every edit. By design (offline
  session restore) and never leaves the device, but on a shared machine the last-edited PDF is
  recoverable from IndexedDB. Acceptable for the product's threat model; recommend a documented
  "Clear session"/wipe action and a note in the privacy page. (Storage banner + privacy page
  exist — `index.html:1171` — confirm they disclose this.)
- **CSP is meta-only** — header-level CSP (via GitHub Pages can't set headers; meta is the only
  option) cannot use `frame-ancestors`/`report-uri`. Acceptable given the hosting constraint;
  note it as a known limitation.
- **Dependency surface**: pdfjs-dist, @cantoo/pdf-lib, bwip-js, qr-code-styling, docx,
  sortablejs, i18next — all actively-maintained; `pdf-lib`/`qpdf-wasm` already removed. No
  known-abandoned dep. (Run `npm audit` for CVE confirmation — not done here.)

---

## 4. Mobile / Responsive

### Strengths (verified)
- Viewport: `width=device-width, initial-scale=1.0, viewport-fit=cover` (`index.html:6`) —
  notch-safe, pinch-zoom NOT disabled (no `user-scalable=no`/`maximum-scale`). Good (WCAG 1.4.4).
- Mobile touch targets ≥40px (`index.html:345` `.btn-icon{min-width:40px;min-height:40px}`,
  `.btn{min-height:40px}`) — passes WCAG 2.5.8 AA on mobile.
- Pointer-events model is unified (`pointerdown/move/up/cancel/leave` dominate; grep shows
  5 pointerdown vs few legacy mouse) — handles touch+mouse together.
- `touch-action` managed contextually — `none` while drawing, `pan-x pan-y` otherwise
  (`uiController.ts:329`, `navigationBinder.ts:78`); `passive:false` only where preventDefault
  is needed (`navigationBinder.ts:32`). Correct for canvas gestures.
- Thumbnail controls forced visible on touch (hover never fires) — `index.html:809+`.

### P2
- **Only one breakpoint (640px)** — `@media (max-width: 640px)` ×2 (`index.html:332,809`).
  No tablet (~768–1024px) tier; the dense desktop toolbar (28px icon buttons) is what tablets
  in this range get. Toolbar overflow on mid-width screens is likely. Fix: add an intermediate
  breakpoint or make the toolbar horizontally scrollable/wrapping below ~900px.

### P3
- Desktop icon-button height (see §1 P2) also affects coarse-pointer laptops/touch-displays
  above 640px — same fix resolves both.

---

## 5. SEO + PWA

### P2
- **Missing SEO meta** — `index.html` head has `<title>PDFturbo</title>` (`:14`) but **no**
  `<meta name="description">`, **no** Open Graph (`og:*`) or Twitter Card tags (grep: 0).
  Link previews (social, chat) will be bare. Fix: add `meta description`, `og:title/description/
  image/type/url`, `twitter:card`. (A description exists in the manifest but that is not used
  for crawler/social preview.)
- **PWA icons are SVG-only** — `vite.config.ts` manifest icons are both `icon.svg`
  (declared 192/512). Some installers/launchers and older Android require raster PNG
  (192×192 + 512×512) for the home-screen icon; SVG-only weakens installability and can yield a
  blank/placeholder icon. Fix: add PNG `icon-192.png`/`icon-512.png` (keep SVG as `any`,
  PNGs as `any maskable`).

### P3
- **No robots.txt / sitemap.xml** (none in repo root or `public/`). For a single-page app this
  is low impact but a one-line `robots.txt` + tiny sitemap helps indexing.
- **registerType doc drift** — `vite.config.ts` uses `registerType: 'prompt'` (user is shown an
  "update available" toast and chooses), but CLAUDE.md claims `autoUpdate` ("silently updates
  open sessions"). The actual `prompt` behavior is better UX; update CLAUDE.md to match. The
  fallback toast in `main.ts:16` confirms `prompt` is the real mode.

### Strengths (verified)
- `<html lang="en">` (`index.html:2`) set, updated per-language by `updateHtmlDir()`.
- Manifest complete on the essentials: name, short_name, description, theme_color,
  background_color, `display: standalone`, `start_url: './'` (`vite.config.ts`).
- theme-color + apple-mobile-web-app meta tags present (`index.html:7–10`).
- Workbox precache + runtime CacheFirst for large pdf chunks; 6 MB cache limit for pdf.js/
  pdf-lib (`vite.config.ts`).

---

## Priority rollup

| Pri | Finding | Location |
|-----|---------|----------|
| P1 | Canvas annotations: no role/tabindex/label (keyboard+SR inaccessible) | `elementLayerRenderer.ts` |
| P1 | Toasts not announced (no role/aria-live) | `index.html:1375`, `toastQueue.ts` |
| P1 | Hardcoded English update toast | `main.ts:16` |
| P2 | Desktop `.btn-icon` no min-height (target size) | `index.html:154` |
| P2 | No `prefers-reduced-motion` | global CSS |
| P2 | Single-key shortcuts not disablable (2.1.4) | `keyboardBinder.ts` |
| P2 | External link missing `noreferrer` | `index.html:1164` |
| P2 | Only one (640px) breakpoint — tablet toolbar overflow | `index.html:332` |
| P2 | No SEO description/OG/Twitter meta | `index.html` head |
| P2 | PWA icons SVG-only (installability) | `vite.config.ts` |
| P3 | Muted `#94a3b8` text contrast | `index.html` (multiple) |
| P3 | Raw PDF bytes unencrypted in IndexedDB (privacy) | `storage.ts` |
| P3 | No robots.txt/sitemap | repo root |
| P3 | Doc drift: escapeValue / registerType / autoUpdate | CLAUDE.md vs config |

Severity legend: P0 ship-blocker (none found) · P1 high · P2 medium · P3 low/polish.
