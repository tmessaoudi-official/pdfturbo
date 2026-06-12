export interface InkStroke {
  type: 'ink' | 'erase';
  points: Array<{ x: number; y: number }>;
  width: number;
  color: string;
  fillColor?: string;
}

export class InkLayer {
  private _strokes = new Map<string, InkStroke[]>();

  getStrokes(pageId: string): InkStroke[] {
    return this._strokes.get(pageId) ?? [];
  }

  addStroke(pageId: string, stroke: InkStroke): void {
    if (!this._strokes.has(pageId)) this._strokes.set(pageId, []);
    (this._strokes.get(pageId) as InkStroke[]).push(stroke);
  }

  removeLastStroke(pageId: string): void {
    this._strokes.get(pageId)?.pop();
  }

  hasContent(pageId: string): boolean {
    return (this._strokes.get(pageId)?.length ?? 0) > 0;
  }

  hasAnyContent(): boolean {
    for (const strokes of this._strokes.values()) {
      if (strokes.length > 0) return true;
    }
    return false;
  }

  clearPage(pageId: string): void {
    this._strokes.delete(pageId);
  }

  clearAll(): void {
    this._strokes.clear();
  }

  /**
   * Render all strokes for `pageId` onto `canvas`.
   * Points are stored in scale=1 coordinates — multiply by `scale` for display.
   */
  renderToCanvas(pageId: string, canvas: HTMLCanvasElement, scale: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of this.getStrokes(pageId)) {
      if (stroke.points.length < 2) continue;
      ctx.save();
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.width * scale;
      if (stroke.type === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
      }
      ctx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * scale, stroke.points[i].y * scale);
      }
      if (stroke.fillColor) {
        ctx.fillStyle = stroke.fillColor;
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Returns a PNG data URL at natural PDF dimensions (scale=1),
   * or null if the page has no visible ink content.
   */
  toDataURL(pageId: string, pdfWidth: number, pdfHeight: number): string | null {
    if (!this.hasContent(pageId)) return null;
    const c = document.createElement('canvas');
    c.width  = Math.round(pdfWidth);
    c.height = Math.round(pdfHeight);
    this.renderToCanvas(pageId, c, 1);
    const ctx2d = c.getContext('2d');
    if (!ctx2d) return null;
    const data = ctx2d.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return c.toDataURL('image/png');
    }
    return null;
  }

  toJSON(): Record<string, InkStroke[]> {
    const out: Record<string, InkStroke[]> = {};
    for (const [id, strokes] of this._strokes) out[id] = strokes;
    return out;
  }

  fromJSON(data: Record<string, InkStroke[]>): void {
    this._strokes.clear();
    for (const [id, strokes] of Object.entries(data)) {
      this._strokes.set(id, strokes);
    }
  }
}
