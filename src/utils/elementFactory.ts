import { TextElement } from '../elements/textElement';
import { SignatureElement } from '../elements/signatureElement';
import { ShapeElement, type ShapeType } from '../elements/shapeElement';
import { ImageElement } from '../elements/imageElement';
import { HighlightElement } from '../elements/highlightElement';
import { CommentElement } from '../elements/commentElement';
import { RedactionElement } from '../elements/redactionElement';
import { CodeElement } from '../elements/codeElement';
import type { QRStyleOptions, BwipOptions } from './codeGenerator';
import { PDFElement } from '../elements/annotationElement';

export class ElementFactory {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static fromJSON(data: Record<string, any>): PDFElement | null {
    const pageId: string = data['pageId'] ?? String(data['page'] ?? '1');
    const applyBase = (el: PDFElement) => {
      // B3: only override the constructor-assigned id when the blob carries a
      // valid finite number. A legacy/corrupt blob missing `id` (or holding NaN
      // / a non-number) would otherwise set el.id = undefined/NaN, which then
      // poisons syncIdCounter (Math.floor(undefined) → NaN) and breaks every
      // later id. Keeping the auto-assigned id is the safe fallback.
      const rawId = data['id'];
      if (typeof rawId === 'number' && Number.isFinite(rawId)) el.id = rawId;
      if (data['rotation']) el.rotation = data['rotation'] as number;
      return el;
    };
    if (data['type'] === 'text') {
      const el = new TextElement(data['x'], data['y'], pageId, {
        width: data['width'], height: data['height'],
        fontSize: data['fontSize'], color: data['color'],
        fontFamily: data['fontFamily'] || 'Arial',
        bold: data['bold'] || false, italic: data['italic'] || false,
        underline: data['underline'] || false, strikethrough: data['strikethrough'] || false,
        align: data['align'] || 'left',
        direction: data['direction'] === 'rtl' || data['direction'] === 'ltr' ? data['direction'] : 'auto',
        multiline: data['multiline'],
        backgroundColor: data['backgroundColor'],
        lineHeight: typeof data['lineHeight'] === 'number' ? data['lineHeight'] : undefined,
        opacity: typeof data['opacity'] === 'number' ? data['opacity'] : undefined,
        strokeWidth: typeof data['strokeWidth'] === 'number' ? data['strokeWidth'] : undefined,
        charSpacing: typeof data['charSpacing'] === 'number' ? data['charSpacing'] : undefined,
        horizontalScale: typeof data['horizontalScale'] === 'number' ? data['horizontalScale'] : undefined,
        baselineShift: data['baselineShift'] === 'super' || data['baselineShift'] === 'sub' ? data['baselineShift'] : undefined,
        list: data['list'] === 'bullet' || data['list'] === 'ordered' ? data['list'] : undefined,
        linkUrl: typeof data['linkUrl'] === 'string' ? data['linkUrl'] : undefined,
      });
      el.text = data['text'] || '';
      return applyBase(el);
    }
    if (data['type'] === 'signature') {
      const el = new SignatureElement(data['x'], data['y'], pageId, data['data'],
        {
          width: data['width'], height: data['height'],
          // F-D D1 — optional approval caption (legacy blobs lack these → undefined).
          signer: data['signer'] as string | undefined,
          mention: data['mention'] as string | undefined,
          signedDate: data['signedDate'] as string | undefined,
        });
      return applyBase(el);
    }
    if (data['type'] === 'shape') {
      const el = new ShapeElement(
        data['shapeType'] as ShapeType,
        data['x'], data['y'], data['width'], data['height'], pageId, {
          strokeColor: data['strokeColor'], fillColor: data['fillColor'], strokeWidth: data['strokeWidth'],
          x1: data['x1'], y1: data['y1'], x2: data['x2'], y2: data['y2'],
          points: data['points'] || []
        });
      return applyBase(el);
    }
    if (data['type'] === 'image') {
      const el = new ImageElement(data['x'], data['y'], data['width'], data['height'], pageId, data['src'] || '');
      return applyBase(el);
    }
    if (data['type'] === 'highlight') {
      const el = new HighlightElement(data['x'], data['y'], data['width'], data['height'], pageId, data['color'] || '#FFFF00', data['opacity'] ?? 0.3);
      return applyBase(el);
    }
    if (data['type'] === 'comment') {
      const el = new CommentElement(data['x'], data['y'], pageId, { color: data['color'] as string, text: data['text'] as string });
      el.width  = data['width']  as number;
      el.height = data['height'] as number;
      return applyBase(el);
    }
    if (data['type'] === 'redaction') {
      const el = new RedactionElement(data['x'], data['y'], data['width'], data['height'], pageId, data['color'] as string | undefined);
      return applyBase(el);
    }
    if (data['type'] === 'code') {
      const el = new CodeElement(
        data['x'], data['y'], pageId,
        { codeType: data['codeType'] as string, data: data['data'] as string, qrStyle: data['qrStyle'] as QRStyleOptions | null ?? null, bwipOpts: data['bwipOpts'] as BwipOptions | null ?? null },
        (data['cachedDataUrl'] as string) || '',
        { w: data['width'] as number, h: data['height'] as number },
      );
      return applyBase(el);
    }
    return null;
  }

  static syncIdCounter(elements: PDFElement[]): void {
    if (!elements.length) return;
    const maxId = elements.reduce((max, e) => Math.max(max, Math.floor(e.id)), 0);
    if (maxId >= PDFElement._nextId) PDFElement._nextId = maxId + 1;
  }
}
