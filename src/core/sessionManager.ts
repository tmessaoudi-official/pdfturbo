import { saveState } from '../infra/storage';
import { t } from '../utils/i18n';
import type { DocumentModel } from './documentModel';
import type { PDFElement } from '../elements/annotationElement';
import type { InkLayer } from '../infra/inkLayer';

export interface SessionSnapshot {
  documentModel: DocumentModel;
  elements: PDFElement[];
  inkLayer: InkLayer;
  formValues: Record<string, Record<string, string>>;
  onError: (msg: string) => void;
}

/** Debounced autosave — schedules a save 800ms after the last call. */
export class SessionManager {
  private _timer: ReturnType<typeof setTimeout> | null = null;

  schedule(snapshot: () => SessionSnapshot): void {
    clearTimeout(this._timer ?? undefined);
    this._timer = setTimeout(() => this._flush(snapshot()), 800);
  }

  private async _flush(snap: SessionSnapshot): Promise<void> {
    if (!snap.documentModel.pageCount) return;
    const sourcePdfs = Array.from(snap.documentModel.sourcePdfs.values()).map(s => ({
      id: s.id, name: s.name, bytes: s.bytes,
    }));
    try {
      await saveState({
        elements: snap.elements.map(el => el.toJSON()),
        pages: [...snap.documentModel.pages],
        watermark: { ...snap.documentModel.watermark },
        currentPageIndex: snap.documentModel.currentPageIndex,
        sourcePdfs,
        formValues: { ...snap.formValues },
        inkData: snap.inkLayer.toJSON(),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        snap.onError(t('toast.storageFull'));
      } else {
        console.warn('[SessionManager] autosave error:', err);
      }
    }
  }

  destroy(): void {
    clearTimeout(this._timer ?? undefined);
  }
}
