# PDFturbo — Vision & Future Ideas

_Last updated: 2026-06-26._

## Vision

PDFturbo is a complete PDF (and DOCX) editor that runs **100% in the browser** — no backend,
no upload, nothing tracked. The bet: a privacy-first, install-free tool can cover the great
majority of everyday PDF work — edit, annotate, sign, fill, redact, convert, export — without
ever sending a document to a server. Everything that *can* be done client-side, is.

The current capabilities are in [`FEATURES.md`](FEATURES.md); the honest limits of the
no-backend approach are in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).

## Future ideas (not committed)

These are candidates, not a roadmap. Each is weighed against the no-backend / nothing-uploaded
promise and the dependency-size budget.

| Idea | Notes |
|------|-------|
| **More form-widget types** | Detect & fill checkboxes, radio groups, dropdowns, list boxes (today: text fields) |
| **Stamps** | Pre-defined image overlays (Approved / Draft / Confidential / custom) |
| **Date field** | One-click "today's date" text element |
| **Batch export** | All pages as separate PDFs or a ZIP of PNGs |
| **Page background** | Solid-colour background (useful for blank PDFs) |
| ~~XLSX table export~~ | **SHIPPED 2026-08-04** (`src/export/xlsxWriter.ts`) |
| **Open-via-picker + recent files** | Use the File System Access API for opening, not just saving |
| **Resizable crop handles / numeric margins** | Richer crop UX |

## Things deliberately *not* pursued

Anything requiring a server (best-in-class PDF→DOCX identity, TSA/LTV signature timestamping,
cloud OCR) is out of scope while the no-backend promise stands. See the "escape-hatch families"
in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) for the full reasoning.
