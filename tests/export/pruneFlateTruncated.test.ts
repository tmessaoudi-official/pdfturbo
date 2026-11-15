/**
 * dependency-upgrade-2026-11, milestone panel round 1, safety F1 (P0). pdf.js 6.5's `FlateStream` stopped padding a
 * stored (uncompressed) deflate block that declares more bytes than the stream holds; pdf-lib 2.11 still pads it with
 * NULs, as pdf.js 6.3 did. `contentOf` decodes a kept page's content with pdf-lib, so the prune read up to 65,535 NULs
 * pdf.js never draws — an inline image's `EI` moved, and a removed page's form shipped in the export (or a drawn one was
 * dropped). The prune now refuses a Flate stage that does not inflate strictly to exactly what pdf-lib decoded.
 *
 * pdf.js is the oracle: every export that is NOT refused must carry the removed page's form exactly when pdf.js paints
 * it on the kept page, and the kept page's own form exactly when pdf.js paints that.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { zlibSync } from 'fflate';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { copySourcePages, ExportResourcesUnreadableError } from '../../src/export/copySourcePages';

const PUB = 'PUBLICKEPTNEEDLE', SEC = 'SECRETREMOVEDNEEDLE';
const IMG = 'BI /W 1 /H 1 /BPC 8 /CS /G';
const bytesOf = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));

/** A zlib stream of ONE stored block declaring `extra` more bytes than it holds; no Adler trailer. */
function stored(content: string, extra: number): Uint8Array {
  const data = bytesOf(content);
  const len = data.length + extra, n = ~len & 0xffff;
  return Uint8Array.from([0x78, 0x01, 0x01, len & 0xff, len >> 8, n & 0xff, n >> 8, ...data]);
}
/** ASCII85 of `data`, `~>`-terminated (no `z` shortcut, so every group is five characters). */
function ascii85(data: Uint8Array): string {
  let out = '';
  for (let k = 0; k < data.length; k += 4) {
    const chunk = [0, 1, 2, 3].map(j => data[k + j] ?? 0);
    let v = ((chunk[0] << 24) >>> 0) + (chunk[1] << 16) + (chunk[2] << 8) + chunk[3];
    const digits: string[] = [];
    for (let j = 0; j < 5; j++) { digits.unshift(String.fromCharCode(33 + (v % 85))); v = Math.floor(v / 85); }
    out += digits.join('').slice(0, Math.min(4, data.length - k) + 1);
  }
  return out + '~>';
}

type Member = string | { raw: Uint8Array; filter: string | string[] };

/** Page 1 (kept) draws `members`; page 2 (left out) draws Fm2; both share one /Resources. */
async function build(members: Member[]): Promise<Uint8Array> {
  const d = await PDFDocument.create({ updateMetadata: false });
  const ctx = d.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const form = (t: string, w: number) => ctx.register(ctx.stream(`BT /F1 12 Tf 20 200 Td (${t}) Tj ET`,
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, 300], Resources: { Font: { F1: font } } }));
  const resources = ctx.register(ctx.obj({ XObject: { Fm1: form(PUB, 300), Fm2: form(SEC, 301) }, Font: { F1: font } }));
  const raw = (m: Member) => typeof m === 'string'
    ? ctx.register(ctx.stream(bytesOf(m)))
    : ctx.register(ctx.stream(m.raw, { Filter: m.filter }));
  const p0 = d.addPage([300, 300]);
  p0.node.set(PDFName.of('Resources'), resources);
  p0.node.set(PDFName.of('Contents'), ctx.obj(members.map(raw)));
  const p1 = d.addPage([300, 300]);
  p1.node.set(PDFName.of('Resources'), resources);
  p1.node.set(PDFName.of('Contents'), raw('/Fm2 Do'));
  return d.save({ useObjectStreams: false });
}

/** The forms pdf.js 6.5 paints on page 1 (its operator list; Fm2's BBox is one point wider). */
async function pdfjsPaints(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), verbosity: 0 }).promise;
  try {
    const ol = await (await doc.getPage(1)).getOperatorList();
    const painted = new Set<string>();
    ol.fnArray.forEach((fn, k) => {
      if (fn === pdfjs.OPS.paintFormXObjectBegin) painted.add(((ol.argsArray[k] as unknown[])[1] as number[])[2] === 301 ? 'Fm2' : 'Fm1');
    });
    return [...painted].sort();
  } finally { await doc.loadingTask.destroy(); }
}

/** Page 1 alone through the real pruned copy: 'refused', or which forms' text the exported bytes carry. */
async function exported(bytes: Uint8Array): Promise<'refused' | string[]> {
  const dest = await PDFDocument.create({ updateMetadata: false });
  try {
    const { pages } = await copySourcePages(dest, await PDFDocument.load(bytes, { updateMetadata: false }), [0], { pruneSharedResources: true });
    pages.forEach(p => dest.addPage(p));
  } catch (e) {
    if (e instanceof ExportResourcesUnreadableError) return 'refused';
    throw e;
  }
  const out = Buffer.from(await dest.save({ useObjectStreams: false })).toString('latin1');
  return [out.includes(PUB) && 'Fm1', out.includes(SEC) && 'Fm2'].filter((x): x is string => !!x);
}

const BIG = ' '.repeat(1200);
const A = `/Fm1 Do ${IMG} /F /DCT ID \xFF\xC0`, A2 = `\xFF\xD9 EI\x01/Fm2 Do`;
const B = `/Fm1 Do ${IMG} ID x EI`, B2 = '/Fm2 Do';
const C = `/Fm1 Do ${IMG} ID x EI q`, C2 = `/Fm2 Do Q   \x01 EI`;
const flate = (raw: Uint8Array): Member => ({ raw, filter: 'FlateDecode' });

describe('the prune refuses a Flate stage pdf-lib decodes differently from pdf.js 6.5 (depup r1 safety F1)', () => {
  // Each shape read by pdf-lib's padding and by pdf.js 6.5 disagrees on the kept page's drawing (measured by the
  // safety lens: A/Abig/C leaked Fm2, B dropped it).
  const TRUNCATED: [string, Member[]][] = [
    ['A: DCT inline image, stored block 40 bytes short', [flate(stored(A, 40)), A2]],
    ['Abig: the same past 1024 compressed bytes (pdf.js tries DecompressionStream first)', [flate(stored(BIG + A, 40)), A2]],
    ['B: unfiltered inline image, 40 short (the export would DROP a drawn form)', [flate(stored(B, 40)), B2]],
    ['C: unfiltered inline image, 1 short', [flate(stored(C, 1)), C2]],
    ['A behind ASCII85: the Flate stage is the second filter', [{ raw: bytesOf(ascii85(stored(A, 40))), filter: ['ASCII85Decode', 'FlateDecode'] }, A2]],
  ];
  for (const [label, members] of TRUNCATED) {
    it(`refuses ${label}`, async () => {
      expect(await exported(await build(members))).toBe('refused');
    });
  }

  // Controls: well-formed Flate (stored, Huffman with and without the Adler trailer, behind ASCII85) is read, and the
  // export carries exactly what pdf.js paints — K proves the probe can see the removed page's form at all.
  const READ: [string, Member[], string[]][] = [
    ['A0: block complete', [flate(stored(A, 0)), A2], ['Fm1']],
    ['Abig0: block complete', [flate(stored(BIG + A, 0)), A2], ['Fm1']],
    ['B0: block complete', [flate(stored(B, 0)), B2], ['Fm1', 'Fm2']],
    ['C0: block complete', [flate(stored(C, 0)), C2], ['Fm1']],
    ['K: the kept page plainly draws Fm2', [flate(stored('/Fm1 Do', 0)), '/Fm2 Do'], ['Fm1', 'Fm2']],
    ['K2: the kept page never names Fm2', [flate(stored('/Fm1 Do', 0)), 'q Q'], ['Fm1']],
    ['Huffman-compressed, with the Adler trailer', [flate(zlibSync(bytesOf(BIG + A))), A2], ['Fm1']],
    ['Huffman-compressed, no Adler trailer', [flate(zlibSync(bytesOf(BIG + A)).subarray(0, -4)), A2], ['Fm1']],
    ['Huffman-compressed behind ASCII85', [{ raw: bytesOf(ascii85(zlibSync(bytesOf(A)))), filter: ['ASCII85Decode', 'FlateDecode'] }, A2], ['Fm1']],
  ];
  for (const [label, members, painted] of READ) {
    it(`reads ${label}`, async () => {
      const bytes = await build(members);
      expect(await pdfjsPaints(bytes)).toEqual(painted);
      expect(await exported(bytes)).toEqual(painted);
    });
  }

  // The premise, tested rather than assumed from the shapes above: a member cut at EVERY length, stored and Huffman,
  // and a stored block declaring 1..48 bytes more than it holds, is either refused or exported exactly as pdf.js
  // paints it. (Cutting alone cannot see the bug: it removes content, and the padding only bites when the content is
  // all there and the block claims more — the cut-only version of this case was green on the unfixed code.)
  it('cut at every length, or declared long, a Flate member is refused or exported as pdf.js paints it', async () => {
    const disagree: string[] = [];
    let refused = 0, read = 0;
    const variants: [string, Uint8Array, string][] = [];
    for (const [name, full, second] of [['stored C', stored(C, 0), C2], ['stored A', stored(A, 0), A2], ['huffman C', zlibSync(bytesOf(C)), C2], ['huffman A', zlibSync(bytesOf(A)), A2]] as const) {
      for (let cut = 2; cut <= full.length; cut++) variants.push([`${name} cut ${cut}/${full.length}`, full.subarray(0, cut), second]);
    }
    for (const [name, content, second] of [['A', A, A2], ['B', B, B2], ['C', C, C2]] as const) {
      for (let extra = 1; extra <= 48; extra++) variants.push([`stored ${name} +${extra}`, stored(content, extra), second]);
    }
    for (const [name, member, second] of variants) {
      const bytes = await build([flate(member), second]);
      const out = await exported(bytes);
      if (out === 'refused') { refused++; continue; }
      read++;
      const painted = await pdfjsPaints(bytes);
      if (JSON.stringify(out) !== JSON.stringify(painted)) disagree.push(`${name}: export ${out} pdf.js ${painted}`);
    }
    expect(disagree).toEqual([]);
    // Pinned: the 4 complete members, and the 2 Huffman members cut inside their Adler trailer (4 cuts each), which
    // neither reader checks. Every other cut and every long declaration refuses.
    expect({ refused, read }).toEqual({ refused: 337, read: 12 });
  }, 120_000);
});

// pdf.js 6.5 reads page content through `asyncGetBytes`, which tries the native `DecompressionStream` first when the
// COMPRESSED stream is at least 1024 bytes (`FlateStream.#MIN_NATIVE_COMPRESSED_LENGTH`) and falls back to its own
// decoder when that rejects. `BIG` is spaces, which deflate shrinks to a few bytes, so a Huffman member padded with it
// never reaches that path; 2000 pseudo-random printable characters in a comment cannot be shrunk below 1024. pdf.js runs
// in this thread here (no worker), so a spy on the global proves the native reader was tried — the observation a real
// browser cannot make from the test page (its pdf.js runs in a worker). A browser twin of these cases was tried and
// dropped: with it in the suite, other browser files failed to IMPORT (6 vs 0 without it, 0 with a trivial 135th file).
describe('members past 1024 compressed bytes take pdf.js 6.5\'s native DecompressionStream path (depup r1 safety F1)', () => {
  let seed = 12345;
  const noise = Array.from({ length: 2000 }, () => { seed = (seed * 1103515245 + 12345) >>> 0; return String.fromCharCode(33 + (seed >>> 16) % 94); }).join('');
  const N = `%${noise}\n${A}`;
  const Native = globalThis.DecompressionStream;
  let formats: string[] = [];
  const spy = () => {
    formats = [];
    vi.stubGlobal('DecompressionStream', class extends Native { constructor(f: CompressionFormat) { super(f); formats.push(f); } });
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the spy reads zero for a member under 1024 compressed bytes (pdf.js decodes it in JS)', async () => {
    const small = zlibSync(bytesOf(A));
    expect(small.length).toBeLessThan(1024);
    spy();
    expect(await pdfjsPaints(await build([flate(small), A2]))).toEqual(['Fm1']);
    expect(formats).toEqual([]);
  });
  it('refuses the stored block declared 40 bytes long', async () => {
    expect(stored(N, 40).length).toBeGreaterThan(1024);
    expect(await exported(await build([flate(stored(N, 40)), A2]))).toBe('refused');
  });
  for (const [label, member] of [
    ['a complete stored block (native rejects it: no trailer)', stored(N, 0)],
    ['a Huffman stream with its Adler trailer (native inflates it)', zlibSync(bytesOf(N))],
    ['a Huffman stream without the trailer (native rejects it)', zlibSync(bytesOf(N)).subarray(0, -4)],
  ] as const) {
    it(`reads ${label} exactly as pdf.js paints it`, async () => {
      expect(member.length).toBeGreaterThan(1024);
      const bytes = await build([flate(member), A2]);
      spy();
      const painted = await pdfjsPaints(bytes);
      expect(formats).toContain('deflate');
      expect(painted).toEqual(['Fm1']);
      expect(await exported(bytes)).toEqual(painted);
    });
  }
});
