/**
 * Re-exports of @cantoo/pdf-lib runtime types used across the export pipeline.
 * Import from here instead of using `any` for pdf-lib objects.
 */
export type { PDFDocument as PdfLibDocument, PDFPage as PdfLibPage, PDFFont as PdfLibFont } from '@cantoo/pdf-lib';
import type { RGB, Degrees } from '@cantoo/pdf-lib';

/** Subset of pdf-lib module exports used in page overlay helpers. */
export interface PdfLibOps {
  rgb: (r: number, g: number, b: number) => RGB;
  degrees: (deg: number) => Degrees;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  StandardFonts: Record<string, any>;
}

/** PdfLibOps extended with the document reference for helpers that embed fonts/images. */
export interface PdfLibDrawOps extends PdfLibOps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any;
}
