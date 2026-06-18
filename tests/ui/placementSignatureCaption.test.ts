// @vitest-environment jsdom
/**
 * F-D D2 — PlacementManager threads the Signers-panel caption into the placed
 * SignatureElement and clears it afterwards; a plain signature (no pending
 * caption) is placed caption-free (the no-regression guarantee).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlacementManager, type IPlacementContext } from '../../src/ui/placementManager';
import { SignatureElement } from '../../src/elements/signatureElement';
import { HistoryManager } from '../../src/core/historyManager';

function makeCtx() {
  const elements: SignatureElement[] = [];
  const ctx = {
    documentModel: { currentPage: { id: 'p1' } },
    elements,
    historyManager: new HistoryManager(50, vi.fn()),
    ui: { addSignatureBtn: document.createElement('button') },
    zoomScale: 1,
    reportError: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), silent: vi.fn() },
    currentSignature: 'data:image/png;base64,SIG',
    signatureNatural: null,
    pendingSignatureCaption: null,
    autosave: vi.fn(),
    setMode: vi.fn(),
    selectElement: vi.fn(),
    rebuildElementLayer: vi.fn(),
  } as unknown as IPlacementContext;
  return { ctx, elements };
}

describe('PlacementManager — signature caption threading (F-D D2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies the pending caption to the placed signature and clears it', () => {
    const { ctx, elements } = makeCtx();
    ctx.pendingSignatureCaption = { signer: 'Alice', mention: 'Lu et approuvé', signedDate: '2026-06-18' };
    new PlacementManager(ctx).commitPlacement('addSignature', 30, 40, 200, 80);

    expect(elements).toHaveLength(1);
    const el = elements[0] as SignatureElement;
    expect(el.hasCaption()).toBe(true);
    expect(el.captionLines()).toEqual(['Lu et approuvé', 'Alice — 2026-06-18']);
    // Consumed exactly once.
    expect(ctx.pendingSignatureCaption).toBeNull();
  });

  it('places a caption-free signature when none is armed (no regression for plain ✍)', () => {
    const { ctx, elements } = makeCtx();
    expect(ctx.pendingSignatureCaption).toBeNull();
    new PlacementManager(ctx).commitPlacement('addSignature', 30, 40, 200, 80);

    expect(elements).toHaveLength(1);
    expect((elements[0] as SignatureElement).hasCaption()).toBe(false);
  });
});
