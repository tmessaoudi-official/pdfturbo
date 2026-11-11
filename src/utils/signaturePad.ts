import type { DecodedSignature, SignatureInput, SignaturePoint } from './signatureStrokes';

export interface SignaturePadOptions {
  lineWidth?: number;
  color?: string;
  /** Draw a dot for a tap (a stroke with no movement). Only the phone pad sets it: a tap there is encoded and
   *  replayed as a dot, so it must be visible while drawing. The ✍ modal pad leaves it off and a tap draws nothing. */
  dotOnTap?: boolean;
}

/**
 * The drawn-signature canvas. Besides painting, it records every stroke as the points it handed to moveTo/lineTo
 * (canvas drawing coordinates), so the phone pad can encode the signature (PTSIG, signatureStrokes.ts) and the PC can
 * replay a decoded one. A stroke belongs to ONE pointer: while it draws, other pointers (a second finger, a palm) are
 * ignored, so they can neither bend nor end it.
 */
export class SignaturePad {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private isDrawing = false;
  lineWidth: number;
  color: string;
  private readonly _dotOnTap: boolean;
  private _strokes: SignaturePoint[][] = [];
  private _current: SignaturePoint[] | null = null;
  private _pointerId: number | null = null;
  /** The drawing size in CSS px once `setSize` ran; until then the buffer size (the ✍ modal pad never calls it). */
  private _size: { width: number; height: number } | null = null;

  constructor(canvas: HTMLCanvasElement, options: SignaturePadOptions = {}) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.lineWidth = options.lineWidth ?? 2;
    this.color     = options.color     ?? '#000000';
    this._dotOnTap = options.dotOnTap ?? false;
    this._setupEvents();
  }

  private _setupEvents(): void {
    this.canvas.addEventListener('pointerdown',   (e) => this._startDrawing(e));
    this.canvas.addEventListener('pointermove',   (e) => this._draw(e));
    this.canvas.addEventListener('pointerup',     (e) => this._stopDrawing(e));
    this.canvas.addEventListener('pointercancel', (e) => this._stopDrawing(e));
    this.canvas.addEventListener('pointerleave',  (e) => this._stopDrawing(e));
    // Defensive: a canvas hidden mid-stroke (the modal closed) may release the capture with its pointerup landing
    // elsewhere, leaving the pad "drawing" for a pointer that is gone. The milestone panel's reviewer (round 1,
    // 2026-11-11) saw Chrome 157 still deliver that pointerup to the canvas; the listener is harmless and stays.
    this.canvas.addEventListener('lostpointercapture', (e) => this._stopDrawing(e));
  }

  private _startDrawing(e: PointerEvent): void {
    if (this.isDrawing) return; // another pointer already owns the stroke
    if (e.pointerType === 'mouse' && e.buttons !== 1) return;
    this.isDrawing = true;
    this._pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (this._dotOnTap) this._dot(x, y, this.lineWidth, this.color);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this._current = [{ x, y }];
    this._strokes.push(this._current);
    e.preventDefault();
  }

  private _draw(e: PointerEvent): void {
    if (!this.isDrawing || e.pointerId !== this._pointerId) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.ctx.lineTo(x, y);
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth   = this.lineWidth;
    this.ctx.lineCap     = 'round';
    this.ctx.lineJoin    = 'round';
    this.ctx.stroke();
    this._current?.push({ x, y });
    e.preventDefault();
  }

  private _stopDrawing(e: PointerEvent): void {
    if (e.pointerId !== this._pointerId) return;
    this.isDrawing = false;
    this._pointerId = null;
    this._current = null;
  }

  private _dot(x: number, y: number, width: number, color: string): void {
    paintDot(this.ctx, x, y, width, color);
  }

  /** The drawing size in CSS px: what points are recorded in, encoded against and replayed into. */
  private _logical(): { width: number; height: number } {
    return this._size ?? { width: this.canvas.width, height: this.canvas.height };
  }

  /**
   * Size the pad to `cssWidth` x `cssHeight` CSS px on a `dpr` screen: the buffer gets device pixels (sharp on a
   * phone), the canvas box is fixed in px (recorded points are CSS px relative to it, so it must not stretch), and the
   * context is scaled so drawing stays in CSS px. A stroke in progress ends; strokes already drawn are rescaled into the
   * new size (contain, centred) and redrawn at the pad's own colour and width.
   */
  setSize(cssWidth: number, cssHeight: number, dpr: number = window.devicePixelRatio): void {
    const old = this._logical();
    const strokes = this._strokes;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this._size = { width: cssWidth, height: cssHeight };
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // a width assignment reset it
    this.isDrawing = false;
    this._pointerId = null;
    this._current = null;
    const s = Math.min(cssWidth / old.width, cssHeight / old.height);
    const ox = (cssWidth - old.width * s) / 2;
    const oy = (cssHeight - old.height * s) / 2;
    this._strokes = strokes.map((st) => st.map((p) => ({ x: ox + p.x * s, y: oy + p.y * s })));
    paintStrokes(this.ctx, this._strokes, this.color, this.lineWidth);
  }

  /** Wipe the canvas and the recorded strokes, and end any stroke in progress. */
  clear(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0); // the whole buffer, whatever the dpr scale
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
    this._strokes = [];
    this._current = null;
    this.isDrawing = false;
    this._pointerId = null;
  }
  getDataURL():               string  { return this.canvas.toDataURL(); }
  setLineWidth(w: number):    void    { this.lineWidth = w; }
  setColor(c: string):        void    { this.color = c; }

  /** The recorded strokes, copied. */
  getStrokes(): SignaturePoint[][] {
    return this._strokes.map((s) => s.map((p) => ({ x: p.x, y: p.y })));
  }

  /** The signature for `encodeSignatureFrames`, in the pad's CURRENT colour and width (PTSIG v1 carries one of each). */
  toSignatureInput(): SignatureInput {
    const { width, height } = this._logical();
    return { width, height, color: this.color, lineWidth: this.lineWidth, strokes: this.getStrokes() };
  }

  /**
   * Clear the pad and draw a decoded signature: its grid fitted inside the canvas (contain, centred), the line width
   * scaled with it, in the decoded colour; a one-point stroke is a dot. The pad's own colour and width are untouched;
   * the drawn strokes become the recorded ones.
   */
  replay(sig: DecodedSignature): void {
    this.clear();
    const { width: w, height: h } = this._logical();
    const box = fitContain(sig.gridWidth, sig.gridHeight, w, h);
    const s = box.w / sig.gridWidth;
    this._strokes = sig.strokes.map((stroke) => stroke.map((p) => ({ x: box.x + p.x * s, y: box.y + p.y * s })));
    paintStrokes(this.ctx, this._strokes, sig.color, sig.lineWidth * s);
  }

  /**
   * Clear the pad and draw an imported signature image (phone-signature-pad step 5a) fitted inside the drawing size
   * (contain, centred). It has no strokes: Save takes the pixels (`getDataURL`), and the PC never encodes it.
   */
  drawImage(img: CanvasImageSource & { width: number; height: number }): void {
    this.clear();
    const { width: w, height: h } = this._logical();
    const box = fitContain(img.width, img.height, w, h);
    this.ctx.drawImage(img, box.x, box.y, box.w, box.h);
  }

  isEmpty(): boolean {
    const data = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) return false; }
    return true;
  }
}

/** The largest `sw x sh` box that fits inside `dw x dh` with the same shape, centred. */
export function fitContain(sw: number, sh: number, dw: number, dh: number): { x: number; y: number; w: number; h: number } {
  const s = Math.min(dw / sw, dh / sh);
  const w = sw * s;
  const h = sh * s;
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

function paintDot(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, width / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Draw strokes as the pad shows them: a round-capped polyline each, a one-point stroke as a dot of the line width. */
export function paintStrokes(ctx: CanvasRenderingContext2D, strokes: readonly SignaturePoint[][], color: string, width: number): void {
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      paintDot(ctx, stroke[0].x, stroke[0].y, width, color);
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
    ctx.strokeStyle = color;
    ctx.lineWidth   = width;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
  }
}
