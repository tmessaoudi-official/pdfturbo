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
    this.ctx.beginPath();
    this.ctx.arc(x, y, width / 2, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._strokes = [];
    this._current = null;
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
    return { width: this.canvas.width, height: this.canvas.height, color: this.color, lineWidth: this.lineWidth, strokes: this.getStrokes() };
  }

  /**
   * Clear the pad and draw a decoded signature: its grid fitted inside the canvas (contain, centred), the line width
   * scaled with it, in the decoded colour; a one-point stroke is a dot. The pad's own colour and width are untouched;
   * the drawn strokes become the recorded ones.
   */
  replay(sig: DecodedSignature): void {
    this.clear();
    const s = Math.min(this.canvas.width / sig.gridWidth, this.canvas.height / sig.gridHeight);
    const ox = (this.canvas.width - sig.gridWidth * s) / 2;
    const oy = (this.canvas.height - sig.gridHeight * s) / 2;
    const width = sig.lineWidth * s;
    this._strokes = sig.strokes.map((stroke) => stroke.map((p) => ({ x: ox + p.x * s, y: oy + p.y * s })));
    for (const stroke of this._strokes) {
      if (stroke.length === 1) {
        this._dot(stroke[0].x, stroke[0].y, width, sig.color);
        continue;
      }
      this.ctx.beginPath();
      this.ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) this.ctx.lineTo(stroke[i].x, stroke[i].y);
      this.ctx.strokeStyle = sig.color;
      this.ctx.lineWidth   = width;
      this.ctx.lineCap     = 'round';
      this.ctx.lineJoin    = 'round';
      this.ctx.stroke();
    }
  }

  isEmpty(): boolean {
    const data = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) return false; }
    return true;
  }
}
