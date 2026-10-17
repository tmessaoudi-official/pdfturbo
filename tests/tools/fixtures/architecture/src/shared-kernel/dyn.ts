// Fixture: imports the scanner cannot follow must be REPORTED (unresolved), never dropped or misnamed — otherwise a
// kernel file could reach any directory or package with the rules green: a package path with a `..` segment (it names
// pdfjs-dist, not the allowlisted bidi-js), a non-literal dynamic import, and a Vite glob.
import type * as P from 'bidi-js/../pdfjs-dist';
export type Pdf = typeof P;
export const load = (): Promise<unknown> => import(('../core/app'));
export const mods = import.meta.glob('../core/*.ts');
