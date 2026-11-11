// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startScan, canvasGrab, CAMERA_CONSTRAINTS, type ScanDeps, type ScanEnd, type VideoLike } from '../../src/ui/qrScanner';

/**
 * The ✍ modal's camera scanner (phone-signature-pad step 5b). Every way the scan can end must leave every camera
 * track `ended` — a camera light left on reads as surveillance — and nothing may reach console.error (the QA sweep
 * fails on one). The real camera + zxing path is pinned in Chrome (tests/browser/signature-scan.browser.test.ts).
 */

interface FakeTrack { readyState: 'live' | 'ended'; stop(): void; end(): void; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void }
function fakeTrack(): FakeTrack {
  const listeners = new Set<() => void>();
  const t: FakeTrack = {
    readyState: 'live',
    stop() { t.readyState = 'ended'; }, // like the real thing: stop() does NOT fire 'ended'
    end() { t.readyState = 'ended'; listeners.forEach((f) => f()); }, // the camera unplugged
    addEventListener: (_t, f) => { listeners.add(f); },
    removeEventListener: (_t, f) => { listeners.delete(f); },
  };
  return t;
}
function fakeStream(n = 1) {
  const tracks = Array.from({ length: n }, fakeTrack);
  return { tracks, stream: { getTracks: () => tracks } as unknown as MediaStream };
}
function fakeVideo(play: () => Promise<void> = () => Promise.resolve()): VideoLike {
  return { srcObject: null, play, readyState: 4, videoWidth: 640, videoHeight: 480 };
}
const domErr = (name: string) => new DOMException('x', name);
const tick = () => new Promise<void>((r) => { setTimeout(r, 0); });

function setup(over: Partial<ScanDeps> = {}) {
  const { tracks, stream } = fakeStream(2);
  const ends: ScanEnd[] = [];
  const texts: string[] = [];
  const decode = vi.fn(() => Promise.resolve(['FRAME']));
  const loadDecoder = vi.fn(() => Promise.resolve(decode));
  const getUserMedia = vi.fn((_c: MediaStreamConstraints) => Promise.resolve(stream));
  const video = fakeVideo();
  const deps: ScanDeps = {
    video,
    onText: (t) => { texts.push(t); return true; },
    onEnd: (e) => { ends.push(e); },
    getUserMedia,
    loadDecoder,
    grab: () => ({}) as ImageData,
    wait: () => Promise.resolve(),
    doc: document,
    ...over,
  };
  const handle = startScan(deps);
  return { handle, tracks, ends, texts, decode, loadDecoder, getUserMedia, video: deps.video };
}
const allEnded = (tracks: FakeTrack[]) => tracks.every((t) => t.readyState === 'ended');

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => { consoleError = vi.spyOn(console, 'error'); });
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

describe('startScan — the happy path', () => {
  it('asks for the camera with the step-1 constraints, video only', async () => {
    const s = setup();
    await s.handle.finished;
    expect(s.getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS);
    expect(CAMERA_CONSTRAINTS).toEqual({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  });

  it('a read the caller accepts ends it as done: the exact text passed, every track ended, the video detached', async () => {
    const s = setup({ loadDecoder: () => Promise.resolve(() => Promise.resolve([' A B '])) });
    await s.handle.finished;
    expect(s.texts).toEqual([' A B ']);
    expect(s.ends).toEqual([{ reason: 'done' }]);
    expect(allEnded(s.tracks)).toBe(true);
    expect(s.video.srcObject).toBeNull();
  });

  it('keeps reading until the caller accepts a text', async () => {
    let n = 0;
    const decode = vi.fn(() => Promise.resolve([`T${++n}`]));
    const s = setup({ loadDecoder: () => Promise.resolve(decode), onText: (t) => t === 'T3' });
    await s.handle.finished;
    expect(decode).toHaveBeenCalledTimes(3);
    expect(allEnded(s.tracks)).toBe(true);
  });

  it('never runs two decodes at once', async () => {
    let active = 0;
    let peak = 0;
    let n = 0;
    const decode = async () => {
      active++; peak = Math.max(peak, active);
      await tick();
      active--;
      return [`T${++n}`];
    };
    const s = setup({ loadDecoder: () => Promise.resolve(decode), onText: (t) => t === 'T4' });
    await s.handle.finished;
    expect(peak).toBe(1);
  });

  it('loads the decoder only AFTER the camera was granted (a denial costs no download)', async () => {
    const s = setup({ getUserMedia: () => Promise.reject(domErr('NotAllowedError')) });
    await s.handle.finished;
    expect(s.loadDecoder).not.toHaveBeenCalled();
  });

  it('skips a frame the video cannot give yet (no data), without ending', async () => {
    let calls = 0;
    const grab = vi.fn(() => (++calls < 3 ? null : ({}) as ImageData));
    const s = setup({ grab });
    await s.handle.finished;
    expect(grab).toHaveBeenCalledTimes(3);
    expect(s.decode).toHaveBeenCalledTimes(1);
    expect(s.ends).toEqual([{ reason: 'done' }]);
  });
});

describe('startScan — every stop path ends every track', () => {
  it('stop() while reading', async () => {
    const s = setup({ onText: () => false, wait: () => tick() });
    await tick(); await tick();
    s.handle.stop();
    await s.handle.finished;
    const decodes = s.decode.mock.calls.length;
    await tick(); await tick();
    expect(s.decode.mock.calls.length).toBe(decodes);
    expect(s.ends).toEqual([{ reason: 'stopped' }]);
    expect(allEnded(s.tracks)).toBe(true);
    expect(s.video.srcObject).toBeNull();
  });

  it('stop() while the camera permission is still PENDING: the stream that arrives late is stopped at once', async () => {
    let grant!: (m: MediaStream) => void;
    const { tracks, stream } = fakeStream();
    const s = setup({ getUserMedia: () => new Promise<MediaStream>((r) => { grant = r; }) });
    s.handle.stop();
    expect(s.ends).toEqual([{ reason: 'stopped' }]);
    grant(stream);
    await s.handle.finished;
    expect(allEnded(tracks)).toBe(true);
    expect(s.video.srcObject).toBeNull();
    expect(s.loadDecoder).not.toHaveBeenCalled();
  });

  it('stop() while video.play() is pending: its AbortError is swallowed (no unhandled rejection)', async () => {
    let reject!: (e: unknown) => void;
    const video = fakeVideo(() => new Promise<void>((_r, j) => { reject = j; }));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const s = setup({ video });
      await tick();
      s.handle.stop();
      reject(domErr('AbortError'));
      await s.handle.finished;
      await tick(); await tick();
      expect(s.ends).toEqual([{ reason: 'stopped' }]);
      expect(allEnded(s.tracks)).toBe(true);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('stop() while the decoder is loading', async () => {
    let load!: (d: (f: ImageData) => Promise<string[]>) => void;
    const s = setup({ loadDecoder: () => new Promise((r) => { load = r; }) });
    await tick(); await tick();
    s.handle.stop();
    const decode = vi.fn(() => Promise.resolve(['X']));
    load(decode);
    await s.handle.finished;
    await tick();
    expect(decode).not.toHaveBeenCalled();
    expect(s.ends).toEqual([{ reason: 'stopped' }]);
    expect(allEnded(s.tracks)).toBe(true);
  });

  it('the tab hidden', async () => {
    const s = setup({ onText: () => false, wait: () => tick() });
    await tick(); await tick();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await s.handle.finished;
    expect(s.ends).toEqual([{ reason: 'stopped' }]);
    expect(allEnded(s.tracks)).toBe(true);
  });

  it('a track that ends by itself (camera unplugged) is a failure, and the others are stopped', async () => {
    const s = setup({ onText: () => false, wait: () => tick() });
    await tick(); await tick();
    s.tracks[0].end();
    await s.handle.finished;
    expect(s.ends).toEqual([{ reason: 'error', error: 'failed' }]);
    expect(allEnded(s.tracks)).toBe(true);
  });

  it('ends exactly once: stop() after done, and stop() twice, report nothing more', async () => {
    const s = setup();
    await s.handle.finished;
    s.handle.stop();
    s.handle.stop();
    expect(s.ends).toEqual([{ reason: 'done' }]);
  });
});

describe('startScan — failures are reported, and the scanner logs nothing itself', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'noCamera'],
    ['OverconstrainedError', 'noCamera'],
    ['NotReadableError', 'failed'],
  ] as const)('getUserMedia %s → %s', async (name, error) => {
    const s = setup({ getUserMedia: () => Promise.reject(domErr(name)) });
    await s.handle.finished;
    expect(s.ends).toEqual([{ reason: 'error', error }]);
  });

  it('no navigator.mediaDevices (an insecure page, an old browser) → noCamera', async () => {
    const s = setup({ getUserMedia: null });
    await s.handle.finished;
    expect(s.ends).toEqual([{ reason: 'error', error: 'noCamera' }]);
  });

  it('the decoder fails to load (wasm fetch, CSP) → failed, tracks stopped', async () => {
    const s = setup({ loadDecoder: () => Promise.reject(new TypeError('Failed to fetch')) });
    await s.handle.finished;
    expect(s.ends).toEqual([{ reason: 'error', error: 'failed' }]);
    expect(allEnded(s.tracks)).toBe(true);
  });

  it('a decode that throws mid-loop → failed, tracks stopped', async () => {
    const s = setup({ loadDecoder: () => Promise.resolve(() => Promise.reject(new Error('boom'))) });
    await s.handle.finished;
    expect(s.ends).toEqual([{ reason: 'error', error: 'failed' }]);
    expect(allEnded(s.tracks)).toBe(true);
  });

  it('play() rejecting on its own (not a stop) → failed, tracks stopped', async () => {
    const s = setup({ video: fakeVideo(() => Promise.reject(domErr('NotAllowedError'))) });
    await s.handle.finished;
    expect(s.ends).toEqual([{ reason: 'error', error: 'failed' }]);
    expect(allEnded(s.tracks)).toBe(true);
  });
});

// Milestone panel round 1 (2026-11-11): the last camera frame stayed in the grab canvas after the scan ended. Every end
// now releases it (width/height 0 frees the bitmap), and the release is terminal. Bound: zxing's wasm heap may still
// hold a copy of the last frame it read; the page cannot clear that.
describe('startScan — every end releases the frame canvas', () => {
  function releasingGrab() {
    const release = vi.fn();
    const grab = Object.assign(() => ({}) as ImageData, { release });
    return { grab, release };
  }
  it.each([
    ['done', (_h: { stop(): void }) => {}],
    ['stop()', (h: { stop(): void }) => { h.stop(); }],
  ] as const)('%s → release() once', async (_n, act) => {
    const { grab, release } = releasingGrab();
    const s = setup({ grab, onText: () => _n === 'done' });
    act(s.handle);
    await s.handle.finished;
    s.handle.stop();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('a failure → release() once', async () => {
    const { grab, release } = releasingGrab();
    const s = setup({ grab, loadDecoder: () => Promise.reject(new TypeError('Failed to fetch')) });
    await s.handle.finished;
    expect(release).toHaveBeenCalledTimes(1);
  });
  // The wiring the cases above cannot see (milestone panel round 2): with NO grab injected, startScan builds its own
  // canvasGrab() — a default left un-released (wrapped, or built without release) keeps the last frame. The canvas is a
  // fake returned from document.createElement, so a real one cannot throw on the fake video and end the scan early.
  it('the default grabber (no grab injected) is released when the scan is stopped', async () => {
    const ctx = { drawImage: vi.fn(), getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({ width: w, height: h }) as ImageData) };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) };
    const realCreate = document.createElement.bind(document);
    const create = vi.spyOn(document, 'createElement').mockImplementation(
      ((tag: string, o?: ElementCreationOptions) => (tag === 'canvas' ? canvas : realCreate(tag, o))) as typeof document.createElement,
    );
    try {
      let grabbed!: () => void;
      const firstFrame = new Promise<void>((r) => { grabbed = r; });
      const decode = vi.fn(() => { grabbed(); return Promise.resolve([] as string[]); });
      const s = setup({ grab: undefined, onText: () => false, loadDecoder: () => Promise.resolve(decode), wait: tick });
      await firstFrame;
      expect(ctx.getImageData).toHaveBeenCalled();
      expect([canvas.width, canvas.height]).toEqual([640, 480]);
      s.handle.stop();
      await s.handle.finished;
      expect(s.ends).toEqual([{ reason: 'stopped' }]);
      expect([canvas.width, canvas.height]).toEqual([0, 0]);
    } finally {
      create.mockRestore();
    }
  });
});

describe('canvasGrab — release() frees the canvas for good', () => {
  function fakeCanvas() {
    const ctx = { drawImage: vi.fn(), getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({ width: w, height: h }) as ImageData) };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) };
    return { canvas, ctx };
  }
  it('grabs the frame, then release() zeroes the canvas and no later grab recreates it', () => {
    const { canvas } = fakeCanvas();
    const create = vi.fn(() => canvas as unknown as HTMLCanvasElement);
    const grab = canvasGrab(create);
    const video = fakeVideo();
    expect(grab(video)).toEqual({ width: 640, height: 480 });
    expect(canvas.width).toBe(640);
    grab.release();
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(grab(video)).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });
  it('release() before any frame creates nothing', () => {
    const create = vi.fn(() => fakeCanvas().canvas as unknown as HTMLCanvasElement);
    const grab = canvasGrab(create);
    grab.release();
    expect(grab(fakeVideo())).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
