// @vitest-environment jsdom
/**
 * M2 #18 — SigningHandler must depend on a NARROW role-interface (ISigningContext),
 * not the concrete PDFTurboApp. This builds a fully-typed ISigningContext mock and
 * constructs the handler from it; tsc fails until the ctor accepts the narrow
 * interface (red test). Crypto is mocked — the real sign path lives in the browser
 * harness; here we prove the handler's app-surface is exactly {currentFilename,
 * assemblePdfBytes} and that the preassembled path skips re-assembly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const signMock = vi.fn();
vi.mock('../../src/signing', () => ({
  PdfSigner: class {
    sign(...args: unknown[]) {
      return signMock(...args);
    }
  },
}));

import { SigningHandler, type ISigningContext, type SignFormInput } from '../../src/handlers/signingHandler';

function makeForm(): SignFormInput {
  return { p12: new Uint8Array([1, 2, 3]), passphrase: 'pw', page: 1, x: 0, y: 0, width: 10, height: 10 };
}

describe('SigningHandler depends only on a narrow ISigningContext (M2 #18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signMock.mockResolvedValue({ bytes: new Uint8Array([9]), signerCommonName: 'CN=Test' });
    // jsdom does not implement URL.createObjectURL / revokeObjectURL.
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('signs preassembled bytes via the narrow context and scrubs the p12', async () => {
    const assembleSpy = vi.fn<ISigningContext['assemblePdfBytes']>();
    const ctx: ISigningContext = { currentFilename: 'report.pdf', assemblePdfBytes: assembleSpy };
    const handler = new SigningHandler(ctx);
    const form = makeForm();

    const cn = await handler.sign(form, new Uint8Array([7, 7]));

    expect(cn).toBe('CN=Test');
    expect(assembleSpy).not.toHaveBeenCalled(); // preassembled → no re-assembly
    expect(Array.from(form.p12)).toEqual([0, 0, 0]); // cert material scrubbed
  });

  it('assembles when no preassembled bytes are supplied', async () => {
    const ctx: ISigningContext = {
      currentFilename: null,
      assemblePdfBytes: vi.fn<ISigningContext['assemblePdfBytes']>().mockResolvedValue(new Uint8Array([1])),
    };
    const handler = new SigningHandler(ctx);

    await handler.sign(makeForm());

    expect(ctx.assemblePdfBytes).toHaveBeenCalledOnce();
  });
});
