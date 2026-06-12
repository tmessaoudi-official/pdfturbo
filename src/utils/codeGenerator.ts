import * as bwipjs from 'bwip-js/browser';
import QRCodeStyling, { type Options as QRStylingOptions, type DotType, type ErrorCorrectionLevel } from 'qr-code-styling';

export interface CodeFormat {
  id: string;
  label: string;
  category: '2d' | '1d';
  bcid: string;
  /** 2D codes with square output (QR, DataMatrix, Aztec) — height is locked to width. */
  squareOutput: boolean;
  placeholder: string;
}

export const CODE_FORMATS: CodeFormat[] = [
  { id: 'qrcode',     label: 'QR Code',     category: '2d', bcid: 'qrcode',     squareOutput: true,  placeholder: 'https://example.com' },
  { id: 'datamatrix', label: 'Data Matrix',  category: '2d', bcid: 'datamatrix', squareOutput: true,  placeholder: 'Any text…' },
  { id: 'pdf417',     label: 'PDF417',       category: '2d', bcid: 'pdf417',     squareOutput: false, placeholder: 'Any text…' },
  { id: 'azteccode',  label: 'Aztec Code',   category: '2d', bcid: 'azteccode',  squareOutput: true,  placeholder: 'Any text…' },
  { id: 'code128',    label: 'Code 128',     category: '1d', bcid: 'code128',    squareOutput: false, placeholder: 'ABC-123' },
  { id: 'code39',     label: 'Code 39',      category: '1d', bcid: 'code39',     squareOutput: false, placeholder: 'CODE39' },
  { id: 'ean13',      label: 'EAN-13',       category: '1d', bcid: 'ean13',      squareOutput: false, placeholder: '590123412345' },
  { id: 'ean8',       label: 'EAN-8',        category: '1d', bcid: 'ean8',       squareOutput: false, placeholder: '1234567' },
  { id: 'upca',       label: 'UPC-A',        category: '1d', bcid: 'upca',       squareOutput: false, placeholder: '01234567890' },
  { id: 'upce',       label: 'UPC-E',        category: '1d', bcid: 'upce',       squareOutput: false, placeholder: '0123456' },
  { id: 'itf14',      label: 'ITF-14',       category: '1d', bcid: 'itf14',      squareOutput: false, placeholder: '1234567890123' },
  { id: 'codabar',    label: 'Codabar',      category: '1d', bcid: 'rationalizedCodabar', squareOutput: false, placeholder: 'A12345A' },
];

export interface QRStyleOptions {
  styled: boolean;
  dotType?: string;
  dotColor?: string;
  bgColor?: string;
  /** data URL for a logo image placed in the center of the QR code. */
  logoSrc?: string;
  /** QR error correction level: L 7%, M 15%, Q 25%, H 30%. Auto-set to H when logo is present. */
  eclevel?: string;
}

export interface BwipOptions {
  /** Show human-readable text below 1D barcodes. Default: true for 1D, false for 2D. */
  includetext?: boolean;
}

const TARGET_PX = 600;
const is2DCode = (formatId: string) => ['qrcode', 'datamatrix', 'azteccode', 'pdf417'].includes(formatId);

/**
 * Generates a barcode/QR code as a high-resolution PNG data URL.
 * Uses bwip-js for all formats; qr-code-styling for styled QR with logo/colors.
 * Throws on invalid data (bad checksum, unsupported characters, etc.).
 */
export async function generateCodeDataUrl(
  formatId: string,
  data: string,
  qrStyle?: QRStyleOptions | null,
  bwipOpts?: BwipOptions | null,
): Promise<string> {
  if (formatId === 'qrcode' && qrStyle?.styled) {
    return generateStyledQR(data, qrStyle);
  }
  // Look up the bwip-js encoder name — may differ from the format id (e.g. codabar → rationalizedCodabar).
  const bwipBcid = CODE_FORMATS.find(f => f.id === formatId)?.bcid ?? formatId;
  const extra: Record<string, unknown> = {};
  if (bwipOpts?.includetext !== undefined) extra['includetext'] = bwipOpts.includetext;
  if (formatId === 'qrcode' && qrStyle?.eclevel) extra['eclevel'] = qrStyle.eclevel;
  return generateBwip(bwipBcid, data, extra);
}

/**
 * Returns the CodeFormat descriptor for a given bcid, or null if not found.
 */
export function getCodeFormat(bcid: string): CodeFormat | null {
  return CODE_FORMATS.find(f => f.id === bcid) ?? null;
}

function generateBwip(bwipBcid: string, data: string, extra: Record<string, unknown> = {}): string {
  const canvas = document.createElement('canvas');
  // Bump scale until the longer edge reaches TARGET_PX so the code is scannable at print size.
  for (let scale = 4; scale <= 64; scale = Math.ceil(scale * 2)) {
    bwipjs.toCanvas(canvas, {
      bcid: bwipBcid,
      text: data,
      scale,
      includetext: !is2DCode(bwipBcid),  // default; caller may override via extra.includetext
      textxalign: 'center',
      ...extra,
    });
    if (Math.max(canvas.width, canvas.height) >= TARGET_PX) break;
  }
  return canvas.toDataURL('image/png');
}

async function generateStyledQR(data: string, opts: QRStyleOptions): Promise<string> {
  const size = 1000;
  // Auto-bump to H when a logo is present so the obscured modules are recoverable.
  const eclevel = (opts.eclevel ?? (opts.logoSrc ? 'H' : 'M')) as ErrorCorrectionLevel;
  const qrOpts: QRStylingOptions = {
    width: size,
    height: size,
    data,
    qrOptions: { errorCorrectionLevel: eclevel },
    dotsOptions: {
      type: (opts.dotType ?? 'square') as DotType,
      color: opts.dotColor ?? '#000000',
    },
    backgroundOptions: { color: opts.bgColor ?? '#ffffff' },
  };

  // qr-code-styling XHRs the image URL internally. data: URIs are blocked by the CSP
  // default-src 'self' fallback on connect-src. Convert to blob: URL which is allowed.
  let logoBlobUrl: string | null = null;
  if (opts.logoSrc) {
    logoBlobUrl = dataUriToBlobUrl(opts.logoSrc);
    qrOpts.image = logoBlobUrl;
    qrOpts.imageOptions = { margin: 5, imageSize: 0.3 };
  }

  try {
    const qr = new QRCodeStyling(qrOpts);
    const blob = await qr.getRawData('png');
    if (!blob || !(blob instanceof Blob)) throw new Error('Styled QR generation failed');
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } finally {
    if (logoBlobUrl) URL.revokeObjectURL(logoBlobUrl);
  }
}

/** Converts a data: URI to a short-lived blob: URL for use in XHR-based image loaders. */
export function dataUriToBlobUrl(dataUri: string): string {
  const [header, b64] = dataUri.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream';
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
