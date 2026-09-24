/**
 * WS8 — the shapes the WS7 closing audit (2026-09-24) measured getting past the mirror, against the shipped guard.
 *
 * Each file shows one page in pdf.js and exports or signs another, and every one of them LOADED through the mirror
 * (`docs/ws7-certification-record.md` § Closing audit). They are the reason WS8 replaced the mirror with pdf.js
 * itself, so they are the headline evidence that it did: every divergent shape must now refuse, and every control
 * must still load. The files are hand-written PDFs dumped from the audit's probe scripts (`var/claude/ws7/
 * audit-2026-09-24/`, gitignored) into `tests/fixtures/ws8-audit/`, so this runs on every jsdom pass.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPdfDocument } from '../../src/utils/pdfLoadGuard';

const DIR = resolve(__dirname, '../fixtures/ws8-audit');
const outcome = (file: string): Promise<string> =>
  loadPdfDocument(new Uint8Array(readFileSync(resolve(DIR, file))), { viewerCheck: 'source', updateMetadata: false })
    .then(() => 'loaded', (e: unknown) => (e as Error).name);

describe('the closing-audit shapes against the viewer check', () => {
  it.each([
    'P1_X1_trailing_startxref_comment.pdf',
    'P2_X3_xref_stream_without_Type.pdf',
    'P3b_X4_count_short_middle_table_hides_an_older_table_pdf_js_.pdf',
    'P4_X8_entry_lands_mid_token_on_4_0_obj_inside_14_0_obj_.pdf',
    'P5_X5_unparseable_stream_leaves_streamState_later_stream_rea.pdf',
    'P7_X3_xref_table_hidden_inside_stream_data.pdf',
    'P8_X4_non_first_subsection_1_N_with_free_first_row.pdf',
    'P9_X4_decimal_offset_row.pdf',
    'P9b_X4_signed_offset_row.pdf',
    'C1.pdf', // kids [5 0 R 5 1 R]: pdf.js caches by object number and shows the first page twice
    'C1b.pdf',
    'C2.pdf', // a linearization dictionary with /P null over a /Count lie
  ])('REFUSES %s', async file => {
    expect(await outcome(file)).toBe('PdfPageMismatchError');
  });

  // Controls for the MIRROR, several of which it refused because the readers genuinely differ there; the viewer check
  // must reach the same verdict by running pdf.js.
  it.each([
    ['P1_control_no_trailing_comment.pdf', 'loaded'],
    ['P2_control_same_stream_WITH_Type_XRef.pdf', 'PdfPageMismatchError'],
    ['P3a_X4_count_short_startxref_table_naming_earlier_copy.pdf', 'loaded'], // both readers repair it the same way
    ['P3b_control_middle_table_count_correct.pdf', 'loaded'],
    ['P5_control_without_the_bad_stream.pdf', 'loaded'],
    ['P8_control_single_1_N_subsection_guard_shifts_.pdf', 'PdfPageMismatchError'],
    ['C2ctl.pdf', 'loaded'], // really linearized: pdf.js shows ONE page, the one pdf-lib holds first
  ] as const)('%s → %s', async (file, expected) => {
    expect(await outcome(file)).toBe(expected);
  });

  it('does not load P6, which pdf.js cannot open at all — the app never gets that far with it either', async () => {
    expect(await outcome('P6_X6_rebuild_keeps_FIRST_definition_when_gens_differ.pdf')).not.toBe('loaded');
  });
});
