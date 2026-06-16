// @vitest-environment jsdom
/**
 * M2 #18/#19 — SigningHandler depends on a NARROW role-interface (ISigningContext)
 * and OWNS the full sign-flow orchestration (`runSignFlow`), which previously lived
 * inline in the PDFTurboApp god-class (untestable: needed a full app + real crypto).
 *
 * Here we build a fully-typed ISigningContext mock and unit-test:
 *   - sign(): preassembled-bytes path + p12 scrub (the #18 narrow surface)
 *   - runSignFlow(): required-field guards, the S-FLOW cert-free preflight bail
 *     (no orphan cert generation), and the generate→download→sign→close→toast path.
 * Crypto + cert generation are mocked; the real end-to-end path is the browser harness.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const preflightMock = vi.fn();
const signMock = vi.fn();
const generateMock = vi.fn();

vi.mock('../../src/signing', () => {
  class SignError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    PdfSigner: class {
      preflight(...args: unknown[]) {
        return preflightMock(...args);
      }
      sign(...args: unknown[]) {
        return signMock(...args);
      }
    },
    SignError,
  };
});
vi.mock('../../src/signing/certGen', () => ({ generateSelfSignedP12: (...a: unknown[]) => generateMock(...a) }));
vi.mock('../../src/utils/i18n', () => ({ t: (k: string) => k }));

import { SignError } from '../../src/signing';
import { SigningHandler, type ISigningContext, type SignFormInput } from '../../src/handlers/signingHandler';
import type { AppDOMRefs } from '../../src/ui/uiController';
import type { IErrorReporter } from '../../src/contracts/errorReporter';

function inp(value = ''): HTMLInputElement {
  const e = document.createElement('input');
  e.value = value;
  return e;
}

interface SignUi {
  signError: HTMLElement;
  signProgressRow: HTMLElement;
  signPage: HTMLInputElement;
  signX: HTMLInputElement; signY: HTMLInputElement; signW: HTMLInputElement; signH: HTMLInputElement;
  signReason: HTMLInputElement; signLocation: HTMLInputElement; signName: HTMLInputElement;
  signPassword: HTMLInputElement; signCertInput: HTMLInputElement;
  runSignModal: HTMLButtonElement;
  signSourceGenerate: HTMLInputElement;
  signGenCN: HTMLInputElement; signGenPassword: HTMLInputElement; signGenOrg: HTMLInputElement;
  signGenEmail: HTMLInputElement; signGenCountry: HTMLInputElement; signGenValidity: HTMLInputElement;
}

function makeUi(): SignUi {
  const cert = document.createElement('input');
  cert.type = 'file';
  const gen = document.createElement('input');
  gen.type = 'checkbox';
  return {
    signError: document.createElement('div'),
    signProgressRow: document.createElement('div'),
    signPage: inp('1'),
    signX: inp('10'), signY: inp('10'), signW: inp('100'), signH: inp('40'),
    signReason: inp(''), signLocation: inp(''), signName: inp(''),
    signPassword: inp(''), signCertInput: cert,
    runSignModal: document.createElement('button'),
    signSourceGenerate: gen,
    signGenCN: inp(''), signGenPassword: inp(''), signGenOrg: inp('Acme Inc'),
    signGenEmail: inp('a@b.c'), signGenCountry: inp('FR'), signGenValidity: inp('2'),
  };
}

function makeCtx(ui: SignUi) {
  const reportError: IErrorReporter = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() };
  const assemblePdfBytes = vi.fn<ISigningContext['assemblePdfBytes']>().mockResolvedValue(new Uint8Array([1]));
  const closeSignModal = vi.fn();
  const ctx: ISigningContext = {
    currentFilename: 'doc.pdf',
    ui: ui as unknown as AppDOMRefs,
    reportError,
    assemblePdfBytes,
    closeSignModal,
  };
  return { ctx, reportError, assemblePdfBytes, closeSignModal };
}

describe('SigningHandler.sign — narrow ISigningContext (M2 #18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signMock.mockResolvedValue({ bytes: new Uint8Array([9]), signerCommonName: 'CN=Test' });
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('signs preassembled bytes via the narrow context and scrubs the p12', async () => {
    const { ctx, assemblePdfBytes } = makeCtx(makeUi());
    const handler = new SigningHandler(ctx);
    const form: SignFormInput = { p12: new Uint8Array([1, 2, 3]), passphrase: 'pw', page: 1, x: 0, y: 0, width: 10, height: 10 };

    const cn = await handler.sign(form, new Uint8Array([7, 7]));

    expect(cn).toBe('CN=Test');
    expect(assemblePdfBytes).not.toHaveBeenCalled();
    expect(Array.from(form.p12)).toEqual([0, 0, 0]);
  });

  it('assembles when no preassembled bytes are supplied', async () => {
    const { ctx, assemblePdfBytes } = makeCtx(makeUi());
    const handler = new SigningHandler(ctx);
    await handler.sign({ p12: new Uint8Array([1]), passphrase: '', page: 1, x: 0, y: 0, width: 1, height: 1 });
    expect(assemblePdfBytes).toHaveBeenCalledOnce();
  });
});

describe('SigningHandler.runSignFlow — orchestration moved out of the god-class (M2 #19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preflightMock.mockResolvedValue(undefined);
    signMock.mockResolvedValue({ bytes: new Uint8Array([9]), signerCommonName: 'CN=Acme' });
    generateMock.mockResolvedValue({ p12: new Uint8Array([5, 5]), pem: 'PEM' });
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('upload mode with no cert file shows INVALID_P12 and never assembles/signs', async () => {
    const ui = makeUi();
    ui.signSourceGenerate.checked = false;
    const { ctx, assemblePdfBytes } = makeCtx(ui);
    await new SigningHandler(ctx).runSignFlow();
    expect(ui.signError.textContent).toBe('sign.error.INVALID_P12');
    expect(ui.signError.style.display).toBe('');
    expect(assemblePdfBytes).not.toHaveBeenCalled();
    expect(signMock).not.toHaveBeenCalled();
  });

  it('generate mode missing CN shows NO_CERTIFICATE and does not generate', async () => {
    const ui = makeUi();
    ui.signSourceGenerate.checked = true;
    ui.signGenCN.value = '';
    const { ctx } = makeCtx(ui);
    await new SigningHandler(ctx).runSignFlow();
    expect(ui.signError.textContent).toBe('sign.error.NO_CERTIFICATE');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('generate mode missing password warns and does not generate', async () => {
    const ui = makeUi();
    ui.signSourceGenerate.checked = true;
    ui.signGenCN.value = 'Acme';
    ui.signGenPassword.value = '';
    const { ctx, reportError } = makeCtx(ui);
    await new SigningHandler(ctx).runSignFlow();
    expect(reportError.warn).toHaveBeenCalledWith('toast.passwordRequired');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('S-FLOW: a preflight failure shows the typed error and skips cert generation', async () => {
    preflightMock.mockRejectedValue(new SignError('INVALID_RECT', 'rect out of bounds'));
    const ui = makeUi();
    ui.signSourceGenerate.checked = true;
    ui.signGenCN.value = 'Acme';
    ui.signGenPassword.value = 'pw';
    const { ctx } = makeCtx(ui);
    await new SigningHandler(ctx).runSignFlow();
    expect(ui.signError.textContent).toBe('sign.error.INVALID_RECT');
    expect(generateMock).not.toHaveBeenCalled(); // no orphan .p12/.pem download
    expect(signMock).not.toHaveBeenCalled();
  });

  it('generate happy path: preflight → generate → sign → close + toast, button re-enabled', async () => {
    const ui = makeUi();
    ui.signSourceGenerate.checked = true;
    ui.signGenCN.value = 'Acme';
    ui.signGenPassword.value = 'pw';
    ui.runSignModal.disabled = false;
    const { ctx, reportError, closeSignModal } = makeCtx(ui);
    await new SigningHandler(ctx).runSignFlow();
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ commonName: 'Acme', organization: 'Acme Inc', country: 'FR', validityYears: 2 }),
      'pw',
    );
    expect(signMock).toHaveBeenCalled();
    expect(closeSignModal).toHaveBeenCalled();
    expect(reportError.info).toHaveBeenCalledWith('toast.signed', { name: 'CN=Acme' });
    expect(ui.runSignModal.disabled).toBe(false); // finally re-enables
  });
});
