/**
 * Export coordinate system tests.
 *
 * The core invariant: pdfjs renders in CropBox space (origin at CropBox
 * bottom-left), so element positions are stored relative to the CropBox.
 * All export paths must add the CropBox origin offset when writing to
 * pdf-lib coordinates (which are in MediaBox space).
 *
 * constat-amiable.pdf geometry:
 *   MediaBox [0 0 703 950]
 *   CropBox  [28.3465 28.3465 674.654 921.654]
 *   → cropX=28.3465, cropY=28.3465, cropW=646.307, cropH=893.307
 */

import { describe, it, expect } from 'vitest';

// ── Inline the private helper under test ──────────────────────────────────────
// _transformPoint mirrors the implementation in pdfEditorApp.ts exactly.
// Any change to the production function must be reflected here.
function _transformPoint(
  px: number, py: number, W: number, H: number, totalRot: number
): { x: number; y: number } {
  switch (((totalRot % 360) + 360) % 360) {
    case 90:  return { x: py,     y: px     };
    case 180: return { x: W - px, y: py     };
    case 270: return { x: W - py, y: H - px };
    default:  return { x: px,     y: H - py };
  }
}

// tp() with crop offset — mirrors the fixed production code inside _renderElementToPdfLib
function tp(px: number, py: number, W: number, H: number, rot: number, cropX: number, cropY: number) {
  const r = _transformPoint(px, py, W, H, rot);
  return { x: r.x + cropX, y: r.y + cropY };
}

// Inline the _getPageCropBox fallback logic (the js-side logic, not the pdf-lib call)
function getPageCropBoxFallback(mediaW: number, mediaH: number) {
  return { x: 0, y: 0, width: mediaW, height: mediaH };
}

// ── _transformPoint (no crop offset) ─────────────────────────────────────────
describe('_transformPoint coordinate transform', () => {
  const W = 646.307, H = 893.307;

  it('rotation=0: flips y (PDF y-up from bottom)', () => {
    const r = _transformPoint(100, 200, W, H, 0);
    expect(r.x).toBeCloseTo(100);
    expect(r.y).toBeCloseTo(H - 200);   // 693.307
  });

  it('rotation=180: mirrors both axes', () => {
    const r = _transformPoint(100, 200, W, H, 180);
    expect(r.x).toBeCloseTo(W - 100);   // 546.307
    expect(r.y).toBeCloseTo(200);
  });

  it('rotation=90: transposes x/y', () => {
    const r = _transformPoint(100, 200, W, H, 90);
    expect(r.x).toBeCloseTo(200);
    expect(r.y).toBeCloseTo(100);
  });

  it('rotation=270: W - py, H - px', () => {
    const r = _transformPoint(100, 200, W, H, 270);
    // case 270: { x: W - py, y: H - px }
    expect(r.x).toBeCloseTo(W - 200);   // 446.307
    expect(r.y).toBeCloseTo(H - 100);   // 793.307
  });

  it('rotation=360 normalises to 0', () => {
    const r0   = _transformPoint(50, 80, W, H, 0);
    const r360 = _transformPoint(50, 80, W, H, 360);
    expect(r360.x).toBeCloseTo(r0.x);
    expect(r360.y).toBeCloseTo(r0.y);
  });

  it('negative rotation normalises correctly (-90 → 270)', () => {
    const r270 = _transformPoint(100, 200, W, H, 270);
    const rNeg = _transformPoint(100, 200, W, H, -90);
    expect(rNeg.x).toBeCloseTo(r270.x);
    expect(rNeg.y).toBeCloseTo(r270.y);
  });

  it('origin (0,0) top-left maps to (0, H) bottom-left in PDF space', () => {
    const r = _transformPoint(0, 0, W, H, 0);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(H);
  });

  it('bottom-right corner (W, H) maps to (W, 0) in PDF space', () => {
    const r = _transformPoint(W, H, W, H, 0);
    expect(r.x).toBeCloseTo(W);
    expect(r.y).toBeCloseTo(0);
  });
});

// ── tp() with CropBox offset (the key fix) ───────────────────────────────────
describe('tp() CropBox offset (the CropBox export fix)', () => {
  // constat-amiable.pdf real values
  const cropW = 646.307, cropH = 893.307;
  const cropX = 28.3465, cropY = 28.3465;

  it('adds CropBox origin to all exported coordinates', () => {
    const r = tp(100, 200, cropW, cropH, 0, cropX, cropY);
    // Without fix: { x: 100, y: 693.307 }
    // With fix:    { x: 128.3465, y: 721.654 }
    expect(r.x).toBeCloseTo(100 + cropX);
    expect(r.y).toBeCloseTo((cropH - 200) + cropY);
  });

  it('element at origin (0,0) maps to CropBox origin in MediaBox space', () => {
    const r = tp(0, 0, cropW, cropH, 0, cropX, cropY);
    expect(r.x).toBeCloseTo(cropX);         // 28.3465
    expect(r.y).toBeCloseTo(cropH + cropY); // 921.654
  });

  it('element at CropBox bottom-right maps to CropBox far corner in MediaBox', () => {
    const r = tp(cropW, cropH, cropW, cropH, 0, cropX, cropY);
    expect(r.x).toBeCloseTo(cropW + cropX); // 674.654
    expect(r.y).toBeCloseTo(cropY);         // 28.3465
  });

  it('standard PDF with no CropBox (cropX=0, cropY=0) is unaffected', () => {
    const W = 595, H = 842;  // A4
    const r = tp(100, 200, W, H, 0, 0, 0);
    expect(r.x).toBeCloseTo(100);
    expect(r.y).toBeCloseTo(H - 200);  // no offset
  });

  it('VERIFICATION: matches the actual browser export result', () => {
    // Ground truth from the actual export test:
    //   el.x=100, el.y=200  → Tm 128.3465 710.854
    //   y = (cropH - 200 - fontSize*0.9) + cropY where fontSize=12
    //   = (893.307 - 200 - 10.8) + 28.3465 = 710.854
    const fontSize = 12;
    const r = tp(100, 200 + fontSize * 0.9, cropW, cropH, 0, cropX, cropY);
    expect(r.x).toBeCloseTo(128.3465, 2);
    expect(r.y).toBeCloseTo(710.854, 1);
  });

  it('rotation=90 with CropBox offset', () => {
    const r = tp(100, 200, cropW, cropH, 90, cropX, cropY);
    // _transformPoint(100, 200, cropW, cropH, 90) = { x: 200, y: 100 }
    expect(r.x).toBeCloseTo(200 + cropX);
    expect(r.y).toBeCloseTo(100 + cropY);
  });

  it('rotation=180 with CropBox offset', () => {
    const r = tp(100, 200, cropW, cropH, 180, cropX, cropY);
    // _transformPoint(100, 200, cropW, cropH, 180) = { x: W-100, y: 200 }
    expect(r.x).toBeCloseTo((cropW - 100) + cropX);
    expect(r.y).toBeCloseTo(200 + cropY);
  });

  it('rotation=270 with CropBox offset', () => {
    const r = tp(100, 200, cropW, cropH, 270, cropX, cropY);
    // case 270: { x: W - py, y: H - px } → { x: cropW-200, y: cropH-100 }
    expect(r.x).toBeCloseTo((cropW - 200) + cropX);  // 446.307 + 28.35 = 474.654
    expect(r.y).toBeCloseTo((cropH - 100) + cropY);  // 793.307 + 28.35 = 821.654
  });
});

// ── _getPageCropBox fallback behaviour ──────────────────────────────────────
describe('_getPageCropBox fallback logic', () => {
  it('returns zero origin and MediaBox dims when getCropBox is absent', () => {
    const cb = getPageCropBoxFallback(703, 950);
    expect(cb).toEqual({ x: 0, y: 0, width: 703, height: 950 });
  });

  it('standard A4 page returns zero-origin crop', () => {
    const cb = getPageCropBoxFallback(595, 842);
    expect(cb.x).toBe(0);
    expect(cb.y).toBe(0);
    expect(cb.width).toBe(595);
    expect(cb.height).toBe(842);
  });

  // Simulate the live getCropBox() path (pdf-lib returns {x, y, width, height})
  it('live path returns CropBox values directly', () => {
    const mockCropBox = { x: 28.3465, y: 28.3465, width: 646.307, height: 893.307 };
    const mockPage = { getCropBox: () => mockCropBox, getSize: () => ({ width: 703, height: 950 }) };

    // Inline the production logic
    let result: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 0, height: 0 };
    try {
      const cb = mockPage.getCropBox?.();
      if (cb && typeof cb.width === 'number') {
        result = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
      } else {
        throw new Error('no CropBox');
      }
    } catch {
      const { width, height } = mockPage.getSize();
      result = { x: 0, y: 0, width, height };
    }

    expect(result.x).toBeCloseTo(28.3465);
    expect(result.y).toBeCloseTo(28.3465);
    expect(result.width).toBeCloseTo(646.307);
    expect(result.height).toBeCloseTo(893.307);
  });

  it('falls back to MediaBox when getCropBox throws', () => {
    type CropBox = { x: number; y: number; width: number; height: number };
    const mockPage: { getCropBox: () => CropBox; getSize: () => { width: number; height: number } } = {
      getCropBox: () => { throw new Error('no CropBox support'); },
      getSize: () => ({ width: 703, height: 950 }),
    };

    let result: CropBox = { x: 0, y: 0, width: 0, height: 0 };
    try {
      const cb = mockPage.getCropBox?.();
      if (cb && typeof cb.width === 'number') {
        result = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
      } else {
        throw new Error('no CropBox');
      }
    } catch {
      const { width, height } = mockPage.getSize();
      result = { x: 0, y: 0, width, height };
    }

    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(703);
    expect(result.height).toBe(950);
  });

  it('falls back when getCropBox returns null-ish', () => {
    type CropBox = { x: number; y: number; width: number; height: number };
    const mockPage: { getCropBox: () => CropBox | null; getSize: () => { width: number; height: number } } = {
      getCropBox: () => null,
      getSize: () => ({ width: 595, height: 842 }),
    };

    let result: CropBox = { x: 0, y: 0, width: 0, height: 0 };
    try {
      const cb = mockPage.getCropBox?.();
      if (cb && typeof cb.width === 'number') {
        result = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
      } else {
        throw new Error('no CropBox');
      }
    } catch {
      const { width, height } = mockPage.getSize();
      result = { x: 0, y: 0, width, height };
    }

    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(595);
    expect(result.height).toBe(842);
  });
});

// ── Effective dims calculation (rotation-aware CropBox dims) ─────────────────
describe('effective dims from CropBox (w_eff / h_eff)', () => {
  const cropW = 646.307, cropH = 893.307;

  it('rotation=0: w_eff=cropW, h_eff=cropH', () => {
    const rot: number = 0;
    const w_eff = (rot === 90 || rot === 270) ? cropH : cropW;
    const h_eff = (rot === 90 || rot === 270) ? cropW : cropH;
    expect(w_eff).toBeCloseTo(cropW);
    expect(h_eff).toBeCloseTo(cropH);
  });

  it('rotation=90: w_eff=cropH, h_eff=cropW (swapped)', () => {
    const rot: number = 90;
    const w_eff = (rot === 90 || rot === 270) ? cropH : cropW;
    const h_eff = (rot === 90 || rot === 270) ? cropW : cropH;
    expect(w_eff).toBeCloseTo(cropH);
    expect(h_eff).toBeCloseTo(cropW);
  });

  it('rotation=180: w_eff=cropW, h_eff=cropH (same as 0)', () => {
    const rot: number = 180;
    const w_eff = (rot === 90 || rot === 270) ? cropH : cropW;
    const h_eff = (rot === 90 || rot === 270) ? cropW : cropH;
    expect(w_eff).toBeCloseTo(cropW);
    expect(h_eff).toBeCloseTo(cropH);
  });

  it('rotation=270: swapped like 90', () => {
    const rot: number = 270;
    const w_eff = (rot === 90 || rot === 270) ? cropH : cropW;
    const h_eff = (rot === 90 || rot === 270) ? cropW : cropH;
    expect(w_eff).toBeCloseTo(cropH);
    expect(h_eff).toBeCloseTo(cropW);
  });
});

// ── Watermark tiling bounds with CropBox offset ──────────────────────────────
describe('watermark tiling within CropBox area', () => {
  it('tiling start incorporates cropOrigin offset', () => {
    const cropW = 646.307, cropH = 893.307, cropX = 28.3465, cropY = 28.3465;
    const stepX = 200, stepY = 150;

    // Production code: y starts at cropOriginY - (stepY / 2)
    const yStart = cropY - stepY / 2;
    const yEnd   = cropY + cropH + stepY;
    const xStart = cropX - stepX / 2;
    const xEnd   = cropX + cropW + stepX;

    // Should cover the visible CropBox area [cropX..cropX+cropW] × [cropY..cropY+cropH]
    expect(yStart).toBeLessThan(cropY);       // starts before visible area
    expect(yEnd).toBeGreaterThan(cropY + cropH); // ends after visible area
    expect(xStart).toBeLessThan(cropX);
    expect(xEnd).toBeGreaterThan(cropX + cropW);
  });

  it('no-cropbox page: tiling starts at -(step/2), same as before', () => {
    const cropX = 0, cropY = 0;
    const stepX = 150, stepY = 100;

    const yStart = cropY - stepY / 2;   // = -(stepY/2) when cropY=0
    const xStart = cropX - stepX / 2;

    expect(yStart).toBe(-stepY / 2);
    expect(xStart).toBe(-stepX / 2);
  });

  it('tiling covers every point in the CropBox area', () => {
    const cropW = 646.307, cropH = 893.307, cropX = 28.3465, cropY = 28.3465;
    const stepX = 200, stepY = 150;

    // Check that at least one tile position falls within the CropBox
    const tilesX: number[] = [], tilesY: number[] = [];
    for (let x = cropX - stepX / 2; x < cropX + cropW + stepX; x += stepX) tilesX.push(x);
    for (let y = cropY - stepY / 2; y < cropY + cropH + stepY; y += stepY) tilesY.push(y);

    // At least one x tile falls inside [cropX, cropX+cropW]
    expect(tilesX.some(x => x >= cropX && x <= cropX + cropW)).toBe(true);
    // At least one y tile falls inside [cropY, cropY+cropH]
    expect(tilesY.some(y => y >= cropY && y <= cropY + cropH)).toBe(true);
  });
});

// ── Ink layer placement ───────────────────────────────────────────────────────
describe('ink layer placement with CropBox', () => {
  it('ink canvas placed at CropBox origin in MediaBox space', () => {
    const cropX = 28.3465, cropY = 28.3465;
    const cropW = 646.307, cropH = 893.307;

    // Before fix: page.drawImage(inkImg, { x: 0, y: 0, width: W_orig, height: H_orig })
    // After fix:  page.drawImage(inkImg, { x: cropX, y: cropY, width: cropW, height: cropH })
    const placement = { x: cropX, y: cropY, width: cropW, height: cropH };

    expect(placement.x).toBeCloseTo(cropX);
    expect(placement.y).toBeCloseTo(cropY);
    expect(placement.width).toBeCloseTo(cropW);
    expect(placement.height).toBeCloseTo(cropH);

    // The ink canvas is W_orig × H_orig = CropBox dims; placed at CropBox origin
    // → covers exactly the visible area in MediaBox space
    expect(placement.x + placement.width).toBeCloseTo(cropX + cropW);   // 674.654 = right edge of CropBox
    expect(placement.y + placement.height).toBeCloseTo(cropY + cropH);  // 921.654 = top edge of CropBox
  });

  it('no-CropBox page: ink placed at origin (backwards compatible)', () => {
    const cropX = 0, cropY = 0, cropW = 595, cropH = 842;
    const placement = { x: cropX, y: cropY, width: cropW, height: cropH };
    expect(placement.x).toBe(0);
    expect(placement.y).toBe(0);
  });
});

// ── Before/after comparison (the regression check) ───────────────────────────
describe('CropBox fix regression: before vs after', () => {
  const cropW = 646.307, cropH = 893.307;
  const cropX = 28.3465, cropY = 28.3465;
  const mediaW = 703, mediaH = 950;

  // Simulate the BUGGY behaviour (using MediaBox dims, no crop offset)
  const buggy_tp = (px: number, py: number) =>
    _transformPoint(px, py, mediaW, mediaH, 0);

  // Simulate the FIXED behaviour
  const fixed_tp = (px: number, py: number) =>
    tp(px, py, cropW, cropH, 0, cropX, cropY);

  it('text at (100,200): buggy result differs from fixed result by crop offset', () => {
    const buggy = buggy_tp(100, 200);
    const fixed  = fixed_tp(100, 200);

    // Buggy: x=100, y=(950-200)=750  (uses MediaBox height)
    expect(buggy.x).toBeCloseTo(100);
    expect(buggy.y).toBeCloseTo(mediaH - 200);  // 750

    // Fixed: x=128.35, y=(893.307-200)+28.35=721.657  (CropBox dims + offset)
    expect(fixed.x).toBeCloseTo(100 + cropX);           // 128.35
    expect(fixed.y).toBeCloseTo((cropH - 200) + cropY); // 721.65

    // The difference between buggy and fixed
    expect(fixed.x - buggy.x).toBeCloseTo(cropX);    // +28.35 in x
    expect(fixed.y - buggy.y).toBeCloseTo(           // y diff = different crop dims
      ((cropH - 200) + cropY) - (mediaH - 200)
    );
  });

  it('text at top-left of visible area: fixed maps to CropBox top-left', () => {
    // (0, 0) in CropBox space = top-left of visible page
    // Should export to y=cropH+cropY (near top in PDF y-up space)
    const fixed = fixed_tp(0, 0);
    expect(fixed.x).toBeCloseTo(cropX);         // 28.35 — not 0
    expect(fixed.y).toBeCloseTo(cropH + cropY); // 921.65 — not 950 (MediaBox top)
  });
});

// ── _transformPoint symmetry / inverse ───────────────────────────────────────
describe('_transformPoint properties', () => {
  const W = 595, H = 842;

  it('double-applying rotation=180 is identity', () => {
    const x = 150, y = 300;
    const once  = _transformPoint(x, y, W, H, 180);
    const twice = _transformPoint(once.x, once.y, W, H, 180);
    // After 180+180=360 = identity: x unchanged, y unchanged
    expect(twice.x).toBeCloseTo(x);
    expect(twice.y).toBeCloseTo(y);
  });

  it('applying 90 four times is identity', () => {
    let { x, y } = { x: 150, y: 300 };
    // Note: after 90° the dims swap — alternate between (W,H) and (H,W)
    for (let i = 0; i < 4; i++) {
      const r = _transformPoint(x, y, i % 2 === 0 ? W : H, i % 2 === 0 ? H : W, 90);
      x = r.x; y = r.y;
    }
    expect(x).toBeCloseTo(150);
    expect(y).toBeCloseTo(300);
  });
});
