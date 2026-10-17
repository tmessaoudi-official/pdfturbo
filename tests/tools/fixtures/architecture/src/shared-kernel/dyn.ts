// Fixture: a dynamic import whose specifier is not one literal names no file the scanner can follow, so it must be
// REPORTED (unresolved), never dropped — dropped, a kernel file could reach any directory with the rules green.
export const load = (): Promise<unknown> => import(('../core/app'));
