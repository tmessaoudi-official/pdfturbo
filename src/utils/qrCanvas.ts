import qrcode from 'qrcode-generator';

/**
 * QR codes for the phone signature pad (phone-signature-pad plan step 4; step 5's PC modal reuses it for the pad URL).
 * ALPHANUMERIC mode at EC M by default: PTSIG frames are base45, which is the QR alphanumeric set, and that mode is 2–7
 * versions smaller than byte mode for the same text (measured in step 1). A full 909-character frame is version 19.
 * Text outside that set is REFUSED there, never silently switched to byte mode. Byte mode is asked for explicitly —
 * only the pad URL needs it (lowercase path, `#`, `=`; the path is case-sensitive on GitHub Pages, so it cannot be
 * upper-cased). The text is used verbatim — a frame may start or end with a space.
 */

const ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;
const QUIET_ZONE = 4; // modules on each side (ISO/IEC 18004)

export interface QrMatrix {
  /** Modules per side, without the quiet zone. */
  size: number;
  isDark(row: number, col: number): boolean;
}

export type QrMode = 'Alphanumeric' | 'Byte';

export function makeQr(text: string, mode: QrMode = 'Alphanumeric'): QrMatrix {
  if (mode === 'Alphanumeric' && !ALPHANUMERIC.test(text)) throw new Error('QR text must be in the QR alphanumeric set');
  const qr = qrcode(0, 'M');
  qr.addData(text, mode);
  qr.make();
  return { size: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
}

/**
 * Draw `text` as a QR filling at most `maxCssPx` CSS px on a `dpr` screen: whole device pixels per module (a
 * fractional module blurs into its neighbours on a camera), a white quiet zone, the canvas box fixed in CSS px.
 */
export function drawQr(
  canvas: HTMLCanvasElement,
  text: string,
  maxCssPx: number,
  dpr: number,
  mode: QrMode = 'Alphanumeric',
): { modules: number; modulePx: number } {
  const qr = makeQr(text, mode);
  const total = qr.size + 2 * QUIET_ZONE;
  const modulePx = Math.max(1, Math.floor((maxCssPx * dpr) / total));
  const side = total * modulePx;
  canvas.width = side;
  canvas.height = side;
  canvas.style.width = `${side / dpr}px`;
  canvas.style.height = `${side / dpr}px`;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < qr.size; r++)
    for (let c = 0; c < qr.size; c++)
      if (qr.isDark(r, c)) ctx.fillRect((QUIET_ZONE + c) * modulePx, (QUIET_ZONE + r) * modulePx, modulePx, modulePx);
  return { modules: qr.size, modulePx };
}
