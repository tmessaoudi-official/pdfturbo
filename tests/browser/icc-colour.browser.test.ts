/**
 * Row 37 (real Chrome) — pdf.js's colour management is on, so CMYK colour is drawn as a colour-managed
 * viewer draws it.
 *
 * Without it pdf.js converts DeviceCMYK with a fitted formula and ignores ICC profiles. Measured 2026-09-26
 * against Ghostscript on the Pub 17 cover: rich black came out slate-blue (44,46,53) where Ghostscript and
 * colour-managed pdf.js draw it neutral (35,31,32 / 34,31,33); block error 10.81 → 4.27. Full colour management
 * is what pdf.js's own viewer does (it sets `iccUrl` and `wasmUrl`, and `useWorkerFetch` then turns on).
 *
 * The fixture (`tests/fixtures/icc/cmyk-patches.pdf`, README beside it) carries five 60pt patches. The
 * expected colours come from Ghostscript, not from pdf.js:
 * - the ICCBased patch embeds its profile, so every colour-managed renderer must agree — a CORRECTNESS check;
 * - the three DeviceCMYK patches have no profile, so the result depends on the viewer's default; they are
 *   compared with Ghostscript given pdf.js's own default (`CGATS001Compat-v2-micro.icc`) — an IMPLEMENTATION
 *   check that pdf.js really sends them through it;
 * - the DeviceRGB patch is the CONTROL: identical with colour management on or off.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { withPdfjsAssets } from '../../src/utils/pdfjsParams';
import { loadPdfDocument } from '../../src/utils/pdfLoadGuard';
import patchesUrl from '../fixtures/icc/cmyk-patches.pdf?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

/** Patch centre (canvas px at scale 1) and Ghostscript 10.06 colour (-r72; CGATS profile for DeviceCMYK). */
const PATCHES: Array<[string, number, [number, number, number]]> = [
  ['DeviceCMYK rich black', 50, [9, 15, 16]],
  ['DeviceCMYK cyan', 125, [0, 174, 239]],
  ['DeviceCMYK mid tone', 200, [181, 114, 165]],
  ['ICCBased mid tone (profile embedded)', 275, [181, 114, 165]],
  ['CONTROL: DeviceRGB', 350, [51, 102, 153]],
];
const TOLERANCE = 4;

async function bytes(): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(patchesUrl)).arrayBuffer());
}

async function renderPatches(): Promise<CanvasRenderingContext2D> {
  const task = pdfjsLib.getDocument(withPdfjsAssets({ data: await bytes() }));
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: ctx, viewport: vp } as never).promise;
    return ctx;
  } finally {
    await task.destroy();
  }
}

describe('row 37 — pdf.js colour management', () => {
  it('the colour module and the CMYK profile are served (bodies, not the dev server HTML fallback)', async () => {
    const { wasmUrl, iccUrl } = withPdfjsAssets({ data: new Uint8Array() }) as { wasmUrl: string; iccUrl?: string };
    expect(iccUrl).toMatch(/^https?:\/\//);
    expect(new URL(iccUrl as string).origin).toBe(location.origin);
    const qcms = new Uint8Array(await (await fetch(`${wasmUrl}qcms_bg.wasm`)).arrayBuffer());
    expect([...qcms.slice(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
    const icc = new Uint8Array(await (await fetch(`${iccUrl}CGATS001Compat-v2-micro.icc`)).arrayBuffer());
    // An ICC profile carries the signature 'acsp' at byte 36.
    expect(String.fromCharCode(...icc.slice(36, 40))).toBe('acsp');
  });

  it('every patch is drawn in the colour Ghostscript draws it', async () => {
    const ctx = await renderPatches();
    const got = PATCHES.map(([label, x, want]) => {
      const [r, g, b] = ctx.getImageData(x, 60, 1, 1).data;
      const off = Math.max(Math.abs(r - want[0]), Math.abs(g - want[1]), Math.abs(b - want[2]));
      return `${label}: (${r},${g},${b}) vs (${want.join(',')}) off ${off}`;
    });
    // One assertion over all five so a red names every patch at once.
    const bad = got.filter(line => Number(line.split('off ')[1]) > TOLERANCE);
    expect(bad, got.join('\n')).toEqual([]);
  });

  it('the viewer check every export runs accepts the colour-managed document', async () => {
    const doc = await loadPdfDocument(await bytes(), { viewerCheck: 'source', updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
  });
});
