// Fixture: imports the scanner cannot follow must be REPORTED, never dropped or misnamed — otherwise a
// kernel file could reach any directory or package with the rules green: a package path with a `..` segment (it names
// pdfjs-dist or fflate, not the allowlisted bidi-js — also when the `..` is written as escapes), a non-literal dynamic import, a
// Vite glob (all reported unresolved), and a `?worker` import (it runs pdfjs-dist's code in a worker; a kernel violation).
import type * as P from 'bidi-js/../pdfjs-dist';
import type * as Q from 'bidi-js/\u002E\x2e/fflate';
export { default as PdfWorker } from 'pdfjs-dist?worker';
export type Pdf = typeof P | typeof Q;
export const load = (): Promise<unknown> => import(('../core/app'));
export const mods = import.meta.glob('../core/*.ts');
