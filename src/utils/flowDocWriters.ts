/**
 * FlowDoc writers — one shared intermediate model (flowDoc.ts), one writer
 * per target flow format. DOCX uses the `docx` package (MIT) loaded via
 * dynamic import so the writer chunk never bloats the initial bundle.
 */

import type { FlowDoc, FlowParagraph, FlowRun, FlowImage, FlowTable, ListFormat } from './flowDoc';

// Word-safe font mapping — when a run's real face is unknown we fall back to the
// closest universally-available family by serif/sans/mono classification.
const FAMILY_TO_WORD: Record<FlowRun['fontFamily'], string> = {
  serif: 'Times New Roman',
  'sans-serif': 'Arial',
  monospace: 'Courier New',
};

// Complex-script (cs) font for RTL/Arabic runs. Generic families don't carry
// Arabic glyphs, so the cs slot needs a concrete near-universal Arabic-capable
// face — Arial ships Arabic on Windows/macOS/Office (A3).
const ARABIC_CS_FONT = 'Arial';

// Broad allow-list of common faces that Word ships (or aliases). Keyed by the
// lowercased base family name; value is the exact Word font name. A real face on
// this list is preserved instead of being flattened to one of the 3 generics —
// the single biggest "doesn't look like the PDF" issue (B-1).
const WORD_FONT_ALLOWLIST: Record<string, string> = {
  calibri: 'Calibri',
  cambria: 'Cambria',
  candara: 'Candara',
  consolas: 'Consolas',
  constantia: 'Constantia',
  corbel: 'Corbel',
  garamond: 'Garamond',
  georgia: 'Georgia',
  verdana: 'Verdana',
  tahoma: 'Tahoma',
  'trebuchet ms': 'Trebuchet MS',
  trebuchet: 'Trebuchet MS',
  'comic sans ms': 'Comic Sans MS',
  'comic sans': 'Comic Sans MS',
  'century gothic': 'Century Gothic',
  'franklin gothic': 'Franklin Gothic',
  'franklin gothic book': 'Franklin Gothic',
  'palatino linotype': 'Palatino Linotype',
  palatino: 'Palatino Linotype',
  'book antiqua': 'Book Antiqua',
  'lucida sans': 'Lucida Sans',
  'lucida console': 'Lucida Console',
  lucida: 'Lucida Sans',
  'segoe ui': 'Segoe UI',
  segoe: 'Segoe UI',
  // Core PDF base-14 families → their Word equivalents.
  helvetica: 'Arial',
  arial: 'Arial',
  times: 'Times New Roman',
  'times new roman': 'Times New Roman',
  'times roman': 'Times New Roman',
  courier: 'Courier New',
  'courier new': 'Courier New',
};

/**
 * Strip subset prefixes and style suffixes from a PostScript/base font name to
 * recover the bare family, then map to a Word font.
 *
 * Examples: 'ABCDEF+Verdana' → 'Verdana'; 'Garamond-Bold' → 'Garamond';
 * 'Tahoma,Bold' → 'Tahoma'; 'Arial-BoldMT' → 'Arial'.
 *
 * Unknown faces fall back to the serif/sans/mono generic (the safety net) so the
 * output is always a font Word can render.
 */
function resolveWordFont(run: FlowRun): string {
  const raw = run.psName ?? '';
  // Drop a 6-uppercase-letter subset tag: 'ABCDEF+Verdana' → 'Verdana'.
  let name = raw.replace(/^[A-Z]{6}\+/, '');
  // Drop everything from the first style separator: '-Bold', ',Italic', '-BoldMT'.
  name = name.replace(/[-,].*$/, '');
  // Drop a trailing 'MT'/'PS'/'PSMT' foundry suffix on the bare name (e.g. 'ArialMT').
  name = name.replace(/(MT|PS|PSMT)$/, '');
  const key = name.trim().toLowerCase();
  return WORD_FONT_ALLOWLIST[key] ?? FAMILY_TO_WORD[run.fontFamily];
}

function paragraphText(p: FlowParagraph): string {
  return p.runs.map(r => r.text).join('');
}

/**
 * Render a detected lattice table as a GitHub-flavoured Markdown pipe table (G9).
 * The first row is treated as the header (followed by the `--- | ---` divider);
 * header detection proper is out of scope, so this just gives a valid GFM table.
 * Pipes inside cell text are escaped so they don't break the column structure.
 */
function gridToPipeTable(grid: FlowTable['grid']): string {
  if (!grid.rows || !grid.cols) return '';
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
  const row = (cells: string[]) => `| ${cells.map(esc).join(' | ')} |`;
  const lines: string[] = [];
  lines.push(row(grid.cells[0]));
  lines.push(`| ${grid.cells[0].map(() => '---').join(' | ')} |`);
  for (let r = 1; r < grid.cells.length; r++) lines.push(row(grid.cells[r]));
  return lines.join('\n');
}

/** Render a detected lattice table as tab-joined rows for plain text (G9). */
function gridToTabRows(grid: FlowTable['grid']): string {
  return grid.cells.map(r => r.map(c => c.replace(/\s+/g, ' ').trim()).join('\t')).join('\n');
}

/** docx LineRuleType shape (subset). Avoids importing the value at module load. */
type LineRuleTypeEnum = { readonly EXACT: LineRuleValue; readonly AUTO: LineRuleValue };
type LineRuleValue = 'atLeast' | 'exactly' | 'exact' | 'auto';
type SpacingObject = { before?: number; after?: number; line?: number; lineRule?: LineRuleValue };

/**
 * Build a docx `spacing` object from a paragraph's measured leading/gaps (B-3).
 * Returns undefined when nothing useful was measured, so unaffected paragraphs
 * keep Word's default rhythm. All inputs are clamped to a sane point range first
 * — a mis-measured page-spanning gap must not emit a giant before/after value.
 */
function buildSpacing(
  p: FlowParagraph,
  ptToTwip: number,
  lineRule: LineRuleTypeEnum,
): SpacingObject | undefined {
  const clampPt = (v: number, max: number) => Math.max(0, Math.min(v, max));
  const spacing: SpacingObject = {};
  if ((p.spaceBefore ?? 0) > 0) spacing.before = Math.round(clampPt(p.spaceBefore ?? 0, 200) * ptToTwip);
  if ((p.spaceAfter ?? 0) > 0) spacing.after = Math.round(clampPt(p.spaceAfter ?? 0, 200) * ptToTwip);
  if ((p.lineHeight ?? 0) > 0) {
    spacing.line = Math.round(clampPt(p.lineHeight ?? 0, 200) * ptToTwip);
    spacing.lineRule = lineRule.EXACT;
  }
  return Object.keys(spacing).length ? spacing : undefined;
}

// ── Ordered-list numbering (shared by DOCX/MD/TXT) ───────────────────────────

/** Numbering reference key for an ordered paragraph (decimal `%1.` keeps the legacy id). */
export function orderedRefKey(p: FlowParagraph): string {
  const fmt = p.listFormat ?? 'decimal';
  const txt = p.listOrdinalText ?? '%1.';
  if (fmt === 'decimal' && txt === '%1.') return 'ordered-list';
  return `ordered-${fmt}-${txt.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/** 1→A, 26→Z, 27→AA … (spreadsheet-style alpha). */
function toAlpha(n: number): string {
  let s = '';
  let v = n;
  while (v > 0) { const r = (v - 1) % 26; s = String.fromCharCode(65 + r) + s; v = Math.floor((v - 1) / 26); }
  return s || 'A';
}

/** 1→I, 4→IV … (roman). */
function toRoman(n: number): string {
  const map: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let s = '';
  let v = n;
  for (const [val, sym] of map) while (v >= val) { s += sym; v -= val; }
  return s || 'I';
}

/** Render the n-th (1-based) ordinal in the paragraph's list format into its template. */
function orderedMarker(p: FlowParagraph, n: number): string {
  const fmt = p.listFormat ?? 'decimal';
  const tmpl = p.listOrdinalText ?? '%1.';
  const ord =
    fmt === 'lowerLetter' ? toAlpha(n).toLowerCase()
    : fmt === 'upperLetter' ? toAlpha(n)
    : fmt === 'lowerRoman' ? toRoman(n).toLowerCase()
    : fmt === 'upperRoman' ? toRoman(n)
    : String(n);
  return tmpl.replace('%1', ord);
}

/**
 * Per-paragraph 1-based ordinal within its ordered-list instance. Consecutive
 * ordered paragraphs sharing a reference continue; any break (non-ordered para or
 * a different reference) restarts at 1 — same instance logic as the DOCX writer.
 */
function computeOrderedOrdinals(doc: FlowDoc): Map<FlowParagraph, number> {
  const out = new Map<FlowParagraph, number>();
  let lastKey: string | null = null;
  let n = 0;
  for (const page of doc.pages) {
    for (const p of page.paragraphs) {
      if (p.listType === 'ordered') {
        const key = orderedRefKey(p);
        if (key === lastKey) n++; else { n = 1; lastKey = key; }
        out.set(p, n);
      } else {
        lastKey = null;
      }
    }
  }
  return out;
}

export function flowDocToText(doc: FlowDoc): string {
  const ordinals = computeOrderedOrdinals(doc);
  const blocks: string[] = [];
  for (const page of doc.pages) {
    for (const p of page.paragraphs) {
      const text = paragraphText(p);
      if (!text.trim()) continue;
      const indent = '  '.repeat(p.listDepth ?? 0);
      if (p.listType === 'bullet') blocks.push(`${indent}• ${text}`);
      else if (p.listType === 'ordered') blocks.push(`${indent}${orderedMarker(p, ordinals.get(p) ?? 1)} ${text}`);
      else blocks.push(text);
    }
    // G9: tables append after this page's paragraphs (tab-joined rows). Interleave
    // by reading order is DOCX-only for v1; TXT keeps it simple.
    for (const t of page.tables ?? []) blocks.push(gridToTabRows(t.grid));
    for (const _img of page.images ?? []) blocks.push('[image]');
  }
  return blocks.filter(t => t.trim().length > 0).join('\n\n');
}

function mdEscapeInline(text: string): string {
  // Escape only the markers we emit, so literal * / # in the PDF text survive.
  return text.replace(/([*\\])/g, '\\$1');
}

/**
 * Sanitise a hyperlink URL for Markdown output (#QA-2026-06-23 P2). The URL comes from a PDF
 * Link annotation (untrusted): reject any explicit scheme other than http/https/mailto (drops
 * `javascript:`/`data:` injection → returns null so the caller emits plain text), and
 * percent-encode characters that break `](url)` syntax. Schemeless (relative/anchor) URLs pass.
 */
export function safeMdUrl(url: string): string | null {
  const trimmed = url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (scheme && !/^(https?|mailto)$/i.test(scheme[1])) return null;
  // encodeURIComponent leaves ()!*'~ untouched, but ( ) break ](url) syntax — encode explicitly.
  const PCT: Record<string, string> = { '(': '%28', ')': '%29', '<': '%3C', '>': '%3E' };
  return trimmed.replace(/[()<>\s]/g, c => PCT[c] ?? encodeURIComponent(c));
}

export function flowDocToMarkdown(doc: FlowDoc): string {
  const ordinals = computeOrderedOrdinals(doc);
  const blocks: string[] = [];
  for (const page of doc.pages) {
    for (const p of page.paragraphs) {
      if (!paragraphText(p).trim()) continue;
      const body = p.runs
        .map(r => {
          // Style markers must hug non-space chars — shift edge whitespace outside.
          const lead = r.text.match(/^\s*/)?.[0] ?? '';
          const trail = r.text.match(/\s*$/)?.[0] ?? '';
          const core = mdEscapeInline(r.text.trim());
          if (!core) return r.text;
          let styled = core;
          if (r.bold && r.italic) styled = `***${core}***`;
          else if (r.bold) styled = `**${core}**`;
          else if (r.italic) styled = `*${core}*`;
          if (r.linkUrl) {
            const safe = safeMdUrl(r.linkUrl);
            if (safe) styled = `[${styled}](${safe})`; // disallowed scheme → plain text, no link
          }
          return lead + styled + trail;
        })
        .join('');
      const indent = '  '.repeat(p.listDepth ?? 0); // 2 spaces / nesting level
      if (p.listType === 'bullet') { blocks.push(`${indent}- ${body.trim()}`); continue; }
      if (p.listType === 'ordered') { blocks.push(`${indent}${orderedMarker(p, ordinals.get(p) ?? 1)} ${body.trim()}`); continue; }
      blocks.push(p.heading > 0 ? `${'#'.repeat(p.heading)} ${body.trim()}` : body);
    }
    // G9: detected lattice tables render as GitHub pipe tables. Appended after the
    // page's paragraphs (DOCX gets true reading-order interleave; MD keeps simple).
    for (const t of page.tables ?? []) {
      const tbl = gridToPipeTable(t.grid);
      if (tbl) blocks.push(tbl);
    }
    // Images the DOCX path embeds — emit a data-URI image reference so an
    // image-only page isn't silently empty (MD-3).
    for (const img of page.images ?? []) {
      blocks.push(`![image](data:${img.mimeType};base64,${img.base64})`);
    }
  }
  return blocks.join('\n\n');
}

/** Build the DOCX and return it as a base64 string (jsdom-testable core). */
export async function flowDocToDocxBase64(doc: FlowDoc): Promise<string> {
  const docx = await import('docx');
  const {
    Document, Packer, Paragraph, TextRun, ExternalHyperlink, ImageRun, HeadingLevel, AlignmentType,
    LevelFormat, LineRuleType, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom,
    TextWrappingType, UnderlineType,
    Table, TableRow, TableCell, WidthType, BorderStyle,
  } = docx;

  // Visible single-line border for ruled tables (G9). 4 = quarter-point units →
  // ~0.5pt hairline; SINGLE style auto on all sides + insideH/insideV.
  const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' } as const;
  const TABLE_BORDERS = {
    top: TABLE_BORDER, bottom: TABLE_BORDER, left: TABLE_BORDER, right: TABLE_BORDER,
    insideHorizontal: TABLE_BORDER, insideVertical: TABLE_BORDER,
  };

  /** Build a docx Table from a FlowTable's grid — one TableCell per cell, the
   * cell text as a single plain Paragraph. Header detection is out of scope (G9):
   * the first row is a normal row. Borders are visible (it's a ruled table). */
  const mkTable = (t: FlowTable) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: t.grid.cells.map(row =>
        new TableRow({
          children: row.map(cell =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: cell })] })],
            }),
          ),
        }),
      ),
    });

  // Unit conversions: 1pt = 20 twips; 1pt = 12700 EMU (914400 EMU/inch ÷ 72).
  const PT_TO_TWIP = 20;
  const PT_TO_EMU = 12700;

  const HEADINGS = [
    undefined,
    HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
  ] as const;
  const ALIGN = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
  } as const;

  // Each distinct ordered marker FORMAT (decimal `%1.`/`%1)`/`(%1)`, lower/upper
  // alpha) gets its own numbering reference. Backward-compat: plain decimal `%1.`
  // keeps the legacy id 'ordered-list'. Consecutive ordered paragraphs sharing
  // the SAME reference continue one instance; any break (non-ordered paragraph or
  // a different reference) starts a new instance → Word restarts numbering at 1.
  const refKeyOf = orderedRefKey; // shared module helper (also used by MD/TXT writers)
  const orderedInstances = new Map<FlowParagraph, number>();
  const usedRefs = new Map<string, { format: ListFormat; text: string }>();
  let instanceCounter = 0;
  let lastRefKey: string | null = null;
  for (const page of doc.pages) {
    for (const p of page.paragraphs) {
      if (p.listType === 'ordered') {
        const key = refKeyOf(p);
        if (key !== lastRefKey) instanceCounter++;
        orderedInstances.set(p, instanceCounter);
        usedRefs.set(key, { format: p.listFormat ?? 'decimal', text: p.listOrdinalText ?? '%1.' });
        lastRefKey = key;
      } else {
        lastRefKey = null;
      }
    }
  }

  const sections = doc.pages.map(page => {
    const bodyParas = page.paragraphs.filter(p => paragraphText(p).trim().length > 0);
    const textChildren = bodyParas
      .map(p => {
        const mkTextRun = (r: FlowRun) => {
          const ascii = resolveWordFont(r);
          // A3: RTL/Arabic runs need complex-script properties so Word applies the
          // correct face + bold/italic/size to the cs glyph run. The cs font must
          // be a concrete Arabic-capable face (generics don't carry Arabic glyphs);
          // Arial is near-universal and covers Arabic.
          const halfPt = Math.round(r.fontSize * 2);
          return new TextRun({
            text: r.text,
            bold: r.bold || undefined,
            italics: r.italic || undefined,
            // B-1: preserve the real face when known; generic only as fallback.
            font: r.rtl ? { ascii, cs: ARABIC_CS_FONT } : ascii,
            size: halfPt, // docx half-points
            boldComplexScript: r.rtl ? r.bold || undefined : undefined,
            italicsComplexScript: r.rtl ? r.italic || undefined : undefined,
            sizeComplexScript: r.rtl ? halfPt : undefined,
            rightToLeft: r.rtl || undefined,
            // Linked runs get the conventional blue + underline so they read as
            // hyperlinks; otherwise keep the run's own fill color.
            color: r.linkUrl ? '0563C1' : r.color,
            // Hyperlinks force the conventional underline; otherwise honour a
            // detected baseline rule (b — underline/strikethrough fidelity).
            underline: r.linkUrl || r.underline ? { type: UnderlineType.SINGLE } : undefined,
            strike: r.strikethrough || undefined,
            superScript: r.vertAlign === 'super' || undefined,
            subScript: r.vertAlign === 'sub' || undefined,
          });
        };

        // Wrap consecutive runs sharing the same linkUrl in one ExternalHyperlink
        // (Gap 2). Adjacent same-url runs were already prevented from merging in
        // reconstructColumn's merge key, so grouping here re-joins them.
        const textRuns: (ReturnType<typeof mkTextRun> | InstanceType<typeof ExternalHyperlink>)[] = [];
        for (let ri = 0; ri < p.runs.length; ri++) {
          const url = p.runs[ri].linkUrl;
          if (!url) { textRuns.push(mkTextRun(p.runs[ri])); continue; }
          const group: FlowRun[] = [];
          while (ri < p.runs.length && p.runs[ri].linkUrl === url) { group.push(p.runs[ri]); ri++; }
          ri--; // for-loop will re-increment
          textRuns.push(new ExternalHyperlink({ link: url, children: group.map(mkTextRun) }));
        }

        // B-3: paragraph + line spacing. before/after are in twips; line is in
        // twips with an EXACT rule (so a measured leading maps to a real height).
        // Clamp absurd values so a mis-measured gap can't blow out the layout.
        const spacing = buildSpacing(p, PT_TO_TWIP, LineRuleType);

        // B-5: first-line / left indent (twips). Only emitted when non-trivial.
        const indent =
          (p.indentLeft ?? 0) > 0 || (p.indentFirstLine ?? 0) > 0
            ? {
                left: Math.round((p.indentLeft ?? 0) * PT_TO_TWIP),
                firstLine: (p.indentFirstLine ?? 0) > 0
                  ? Math.round((p.indentFirstLine ?? 0) * PT_TO_TWIP)
                  : undefined,
              }
            : undefined;

        return new Paragraph({
          heading: p.listType ? undefined : HEADINGS[p.heading],
          alignment: ALIGN[p.alignment],
          bidirectional: p.rtl || undefined,
          spacing,
          indent,
          bullet: p.listType === 'bullet' ? { level: p.listDepth ?? 0 } : undefined,
          numbering: p.listType === 'ordered'
            ? { reference: refKeyOf(p), level: p.listDepth ?? 0, instance: orderedInstances.get(p) }
            : undefined,
          children: textRuns,
        });
      });

    // B-4: place each image by its PDF x/y via a floating (anchored) ImageRun
    // rather than dumping it centered after all text. The image still lands in
    // word/media/ (ISSUE-3/4 guard) — only placement changes.
    const imageChildren = (page.images ?? []).map((img: FlowImage) => {
      try {
      const bin = atob(img.base64); // #QA-2026-06-23 P2: a malformed image must not abort the whole export
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      // Flip PDF y-up (bottom-left origin) to DOCX top-left page offset.
      const topOffsetPt = Math.max(0, page.height - img.y - img.height);
      const leftOffsetPt = Math.max(0, img.x);
      return new Paragraph({
        children: [new ImageRun({
          data,
          transformation: {
            // PDF points → pixels at 96 DPI (1pt = 96/72 px)
            width: Math.round(img.width * 96 / 72),
            height: Math.round(img.height * 96 / 72),
            // docx takes rotation in DEGREES (converts to 60000ths internally).
            ...(img.rotation ? { rotation: img.rotation } : {}),
          },
          type: img.mimeType === 'image/jpeg' ? 'jpg' : 'png',
          floating: {
            horizontalPosition: {
              relative: HorizontalPositionRelativeFrom.PAGE,
              offset: Math.round(leftOffsetPt * PT_TO_EMU),
            },
            verticalPosition: {
              relative: VerticalPositionRelativeFrom.PAGE,
              offset: Math.round(topOffsetPt * PT_TO_EMU),
            },
            allowOverlap: true,
            wrap: { type: TextWrappingType.NONE },
          },
        })],
      });
      } catch {
        return null; // skip a malformed/undecodable image; text + other images still export
      }
    }).filter((p): p is NonNullable<typeof p> => p !== null);

    // B-2: emit page margins (twips) from the text-block bbox when available.
    const margin = page.margins
      ? {
          top: Math.round(page.margins.top * PT_TO_TWIP),
          right: Math.round(page.margins.right * PT_TO_TWIP),
          bottom: Math.round(page.margins.bottom * PT_TO_TWIP),
          left: Math.round(page.margins.left * PT_TO_TWIP),
        }
      : undefined;

    // G9: interleave detected tables with paragraphs in reading order (top of
    // page first → descending PDF y-up). Only when the page actually has tables;
    // otherwise the body is exactly the paragraph list (byte-identical pre-G9).
    // Each body paragraph carries its top-line y (bodyParas[i].y); a table carries
    // its region-top y. Images stay last (floating-anchored by absolute position,
    // so their order among children doesn't affect placement). A stable sort keeps
    // adjacent equal-y items (a table flush against a paragraph) in source order.
    let bodyChildren: (typeof textChildren[number] | ReturnType<typeof mkTable>)[];
    if (page.tables?.length) {
      const yOf = (p: FlowParagraph) => p.y ?? -Infinity; // y-less paragraphs sink to the end
      const items: { y: number; order: number; node: typeof textChildren[number] | ReturnType<typeof mkTable> }[] = [];
      textChildren.forEach((node, i) => items.push({ y: yOf(bodyParas[i]), order: i, node }));
      page.tables.forEach((t, i) => items.push({ y: t.y, order: textChildren.length + i, node: mkTable(t) }));
      items.sort((a, b) => (b.y - a.y) || (a.order - b.order));
      bodyChildren = items.map(it => it.node);
    } else {
      bodyChildren = textChildren;
    }

    return {
      properties: {
        page: {
          // PDF points → DOCX twips (1pt = 20 twips)
          size: { width: Math.round(page.width * 20), height: Math.round(page.height * 20) },
          margin,
        },
      },
      children: [...bodyChildren, ...imageChildren],
    };
  });

  const LEVEL_FORMAT: Record<ListFormat, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
    decimal:     LevelFormat.DECIMAL,
    lowerLetter: LevelFormat.LOWER_LETTER,
    upperLetter: LevelFormat.UPPER_LETTER,
    lowerRoman:  LevelFormat.LOWER_ROMAN,
    upperRoman:  LevelFormat.UPPER_ROMAN,
  };
  const numberingConfig = usedRefs.size > 0
    ? {
        config: [...usedRefs.entries()].map(([reference, { format, text }]) => ({
          reference,
          levels: [{
            level: 0,
            format: LEVEL_FORMAT[format] ?? LevelFormat.DECIMAL,
            text,
            alignment: AlignmentType.START,
          }],
        })),
      }
    : undefined;

  const document = new Document({ sections, numbering: numberingConfig });
  return Packer.toBase64String(document);
}

/** Browser entry point: DOCX as a downloadable Blob. */
export async function flowDocToDocxBlob(doc: FlowDoc): Promise<Blob> {
  const b64 = await flowDocToDocxBase64(doc);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
