// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { SessionManager, type SessionSnapshot } from '../../src/core/sessionManager';
import { saveState } from '../../src/infra/storage';

vi.mock('../../src/infra/storage', () => ({ saveState: vi.fn() }));

function makeSnapshot(errors: SessionSnapshot['errors']): SessionSnapshot {
  return {
    documentModel: {
      pageCount: 1,
      sourcePdfs: new Map([['s', { id: 's', name: 'a.pdf', bytes: new Uint8Array([1]) }]]),
      pages: [{ id: 'p1' }],
      watermark: {},
      bates: { enabled: true, mode: 'bates', prefix: 'X-', startNumber: 1, digits: 6, position: 'br', fontSize: 10, color: '#555555' },
      currentPageIndex: 0,
    },
    elements: [],
    inkLayer: { toJSON: () => ({}) },
    formValues: {},
    errors,
  } as unknown as SessionSnapshot;
}

function makeErrors() {
  return { error: vi.fn(), silent: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('SessionManager autosave error handling (M0 #12)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  it('surfaces a toast on QuotaExceededError instead of silently dropping the save', async () => {
    (saveState as Mock).mockRejectedValue(new DOMException('quota', 'QuotaExceededError'));
    const errors = makeErrors();
    new SessionManager().schedule(() => makeSnapshot(errors));
    await vi.runAllTimersAsync();
    expect(errors.error).toHaveBeenCalledWith('toast.storageFull', expect.anything());
    expect(errors.silent).not.toHaveBeenCalled();
  });

  it('logs silently (no scary toast) on a non-quota save failure', async () => {
    (saveState as Mock).mockRejectedValue(new Error('idb unavailable'));
    const errors = makeErrors();
    new SessionManager().schedule(() => makeSnapshot(errors));
    await vi.runAllTimersAsync();
    expect(errors.silent).toHaveBeenCalled();
    expect(errors.error).not.toHaveBeenCalled();
  });

  it('persists the Bates settings in the saved state (#61b)', async () => {
    (saveState as Mock).mockResolvedValue(undefined);
    const errors = makeErrors();
    new SessionManager().schedule(() => makeSnapshot(errors));
    await vi.runAllTimersAsync();
    expect(saveState).toHaveBeenCalledWith(expect.objectContaining({
      bates: expect.objectContaining({ enabled: true, mode: 'bates', prefix: 'X-' }),
    }));
  });

  it('debounces rapid schedules into a single save', async () => {
    (saveState as Mock).mockResolvedValue(undefined);
    const errors = makeErrors();
    const mgr = new SessionManager();
    mgr.schedule(() => makeSnapshot(errors));
    mgr.schedule(() => makeSnapshot(errors));
    mgr.schedule(() => makeSnapshot(errors));
    await vi.runAllTimersAsync();
    expect(saveState).toHaveBeenCalledTimes(1);
  });
});
