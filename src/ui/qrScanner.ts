import type { ReaderOptions } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/**
 * The ✍ modal's camera scanner (phone-signature-pad step 5b): camera → video → frame → zxing → text, until the caller
 * accepts a text. The camera is asked for FIRST and the decoder (zxing-wasm, ~400 KB gzip, self-hosted wasm — the CSP
 * has `connect-src 'self'`, so never the CDN default) loads only once it was granted, so a denial costs no download.
 *
 * Every end — done, stop(), the tab hidden, a track that ends by itself, any failure — stops every track and detaches
 * the video, exactly once, and reports once through `onEnd`. A stop that lands while an await is pending (the
 * permission prompt, `play()`, the decoder load, a decode) is honoured when that await returns: a stream granted late
 * is stopped at once. Nothing is logged: an expected denial is shown by the caller, and the QA sweep fails on any
 * console error.
 */

export type ScanError = 'denied' | 'noCamera' | 'failed';
export type ScanEnd = { reason: 'done' } | { reason: 'stopped' } | { reason: 'error'; error: ScanError };
export type Decode = (frame: ImageData) => Promise<string[]>;

/** The part of `HTMLVideoElement` the scanner uses. */
export interface VideoLike {
  srcObject: MediaProvider | null;
  play(): Promise<void>;
  readonly readyState: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
}

export interface ScanDeps {
  video: VideoLike;
  /** Each decoded text, verbatim. Return true to accept it: the scan ends as done. */
  onText(text: string): boolean;
  /** Called exactly once, after the tracks were stopped. */
  onEnd(end: ScanEnd): void;
  /** `null` = no camera API at all. Default: `navigator.mediaDevices.getUserMedia`. */
  getUserMedia?: ((c: MediaStreamConstraints) => Promise<MediaStream>) | null;
  loadDecoder?: () => Promise<Decode>;
  /** The current video frame, or null when the video has none yet. */
  grab?: (video: VideoLike) => ImageData | null;
  /** The pause between two reads. */
  wait?: () => Promise<void>;
  doc?: Document;
}

export interface ScanHandle {
  stop(): void;
  /** Settles once the scan has ended and nothing more will run. Never rejects. */
  readonly finished: Promise<void>;
}

/** As the step-1 webcam measurement asked (it got 1280x720, on which the v19 QR budget rests). */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};

const READ_OPTIONS: ReaderOptions = { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 };
let zxingReady: Promise<unknown> | null = null;

/** zxing-wasm's reader, loaded on first use, its wasm from this origin. Rejects if the module or the wasm fails. */
export async function loadZxingDecoder(): Promise<Decode> {
  const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');
  zxingReady ??= prepareZXingModule({
    overrides: { locateFile: (p: string, prefix: string) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) },
    fireImmediately: true,
  });
  try {
    await zxingReady;
  } catch (e) {
    zxingReady = null; // a later Start camera tries again
    throw e;
  }
  return async (frame) => (await readBarcodes(frame, READ_OPTIONS)).filter((r) => r.isValid).map((r) => r.text);
}

function canvasGrab(): (video: VideoLike) => ImageData | null {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  return (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (video.readyState < 2 || !w || !h) return null; // HAVE_CURRENT_DATA
    if (!canvas) {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) return null;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(video as HTMLVideoElement, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  };
}

function classify(e: unknown): ScanError {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'noCamera';
  return 'failed';
}

export function startScan(deps: ScanDeps): ScanHandle {
  const doc = deps.doc ?? document;
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const getUserMedia = deps.getUserMedia === undefined ? (md?.getUserMedia ? (c: MediaStreamConstraints) => md.getUserMedia(c) : null) : deps.getUserMedia;
  const loadDecoder = deps.loadDecoder ?? loadZxingDecoder;
  const grab = deps.grab ?? canvasGrab();
  const wait = deps.wait ?? (() => new Promise<void>((r) => { setTimeout(r, 80); }));

  let ended = false;
  let stream: MediaStream | null = null;
  const onTrackEnded = () => finish({ reason: 'error', error: 'failed' });
  const onVisibility = () => { if (doc.hidden) finish({ reason: 'stopped' }); };

  function finish(end: ScanEnd): void {
    if (ended) return;
    ended = true;
    doc.removeEventListener('visibilitychange', onVisibility);
    for (const track of stream?.getTracks() ?? []) {
      track.removeEventListener('ended', onTrackEnded);
      track.stop();
    }
    stream = null;
    deps.video.srcObject = null;
    deps.onEnd(end);
  }

  async function run(): Promise<void> {
    if (!getUserMedia) return finish({ reason: 'error', error: 'noCamera' });
    let granted: MediaStream;
    try {
      granted = await getUserMedia(CAMERA_CONSTRAINTS);
    } catch (e) {
      return finish({ reason: 'error', error: classify(e) });
    }
    if (ended) {
      for (const track of granted.getTracks()) track.stop(); // stopped while the prompt was open
      return;
    }
    stream = granted;
    for (const track of granted.getTracks()) track.addEventListener('ended', onTrackEnded);
    deps.video.srcObject = granted;
    try {
      await deps.video.play();
    } catch {
      return finish({ reason: 'error', error: 'failed' }); // a no-op when a stop() caused it (AbortError)
    }
    if (ended) return;
    const decode = await loadDecoder();
    while (!ended) {
      const frame = grab(deps.video);
      if (frame) {
        const texts = await decode(frame);
        if (ended) return;
        for (const text of texts) if (deps.onText(text)) return finish({ reason: 'done' });
      }
      await wait();
    }
  }

  doc.addEventListener('visibilitychange', onVisibility);
  const finished = run().catch(() => finish({ reason: 'error', error: 'failed' }));
  return { stop: () => finish({ reason: 'stopped' }), finished };
}
