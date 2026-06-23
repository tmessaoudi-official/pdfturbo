import { describe, it, expect, vi } from 'vitest';
import { PageNavigationController, type IPageNavigationContext } from '../../src/core/pageNavigationController';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function makeCtx(): IPageNavigationContext {
  return {
    renderCurrentPage: vi.fn().mockResolvedValue(undefined),
    renderThumbnails: vi.fn().mockResolvedValue(undefined),
    updateActiveThumbnail: vi.fn(),
    selectElement: vi.fn(),
    updatePageInfo: vi.fn(),
    rebuildElementLayer: vi.fn(),
    autosave: vi.fn(),
  };
}

describe('PageNavigationController.onPageStructureChange', () => {
  it('calls renderCurrentPage', async () => {
    const ctx = makeCtx();
    await new PageNavigationController(ctx).onPageStructureChange();
    expect(ctx.renderCurrentPage).toHaveBeenCalledOnce();
  });

  it('calls renderThumbnails', async () => {
    const ctx = makeCtx();
    await new PageNavigationController(ctx).onPageStructureChange();
    expect(ctx.renderThumbnails).toHaveBeenCalledOnce();
  });

  it('calls updateActiveThumbnail', async () => {
    const ctx = makeCtx();
    await new PageNavigationController(ctx).onPageStructureChange();
    expect(ctx.updateActiveThumbnail).toHaveBeenCalledOnce();
  });

  it('calls selectElement(null)', async () => {
    const ctx = makeCtx();
    await new PageNavigationController(ctx).onPageStructureChange();
    expect(ctx.selectElement).toHaveBeenCalledWith(null);
  });

  it('calls updatePageInfo', async () => {
    const ctx = makeCtx();
    await new PageNavigationController(ctx).onPageStructureChange();
    expect(ctx.updatePageInfo).toHaveBeenCalledOnce();
  });

  it('calls rebuildElementLayer', async () => {
    const ctx = makeCtx();
    await new PageNavigationController(ctx).onPageStructureChange();
    expect(ctx.rebuildElementLayer).toHaveBeenCalledOnce();
  });

  it('calls autosave', async () => {
    const ctx = makeCtx();
    await new PageNavigationController(ctx).onPageStructureChange();
    expect(ctx.autosave).toHaveBeenCalledOnce();
  });

  it('coalesces a concurrent call into a single trailing re-run', async () => {
    const ctx = makeCtx();
    let resolveFirst!: () => void;
    (ctx.renderCurrentPage as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<void>(res => { resolveFirst = res; }),
    );
    const ctrl = new PageNavigationController(ctx);
    const first = ctrl.onPageStructureChange();
    const second = ctrl.onPageStructureChange();
    resolveFirst();
    await Promise.all([first, second]);
    // The concurrent request is not dropped — it triggers exactly one re-run
    // after the in-flight pass (so the latest structure state is rendered).
    expect(ctx.renderCurrentPage).toHaveBeenCalledTimes(2);
  });

  it('collapses MANY concurrent calls into one re-run (not one per call)', async () => {
    const ctx = makeCtx();
    let resolveFirst!: () => void;
    (ctx.renderCurrentPage as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<void>(res => { resolveFirst = res; }),
    );
    const ctrl = new PageNavigationController(ctx);
    const calls = [ctrl.onPageStructureChange()];
    for (let i = 0; i < 5; i++) calls.push(ctrl.onPageStructureChange());
    resolveFirst();
    await Promise.all(calls);
    expect(ctx.renderCurrentPage).toHaveBeenCalledTimes(2); // initial + one coalesced re-run
  });

  it('resets the guard after completion so a second call succeeds', async () => {
    const ctx = makeCtx();
    const ctrl = new PageNavigationController(ctx);
    await ctrl.onPageStructureChange();
    await ctrl.onPageStructureChange();
    expect(ctx.renderCurrentPage).toHaveBeenCalledTimes(2);
  });

  it('resets the guard even when renderCurrentPage throws', async () => {
    const ctx = makeCtx();
    (ctx.renderCurrentPage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('render fail'));
    const ctrl = new PageNavigationController(ctx);
    await expect(ctrl.onPageStructureChange()).rejects.toThrow('render fail');
    // Guard should have reset — second call must proceed
    await ctrl.onPageStructureChange();
    expect(ctx.renderCurrentPage).toHaveBeenCalledTimes(2);
  });
});
