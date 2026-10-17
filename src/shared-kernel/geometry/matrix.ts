/** The PDF affine matrix and its two operations (moved verbatim from utils/contentStreamEditor.ts, architecture step 2). */
export type Matrix = [number, number, number, number, number, number];

/**
 * Concatenate two affine matrices (PDF row-vector convention: A × B applies A to a point FIRST, then B).
 * PDF `cm` sets CTM_new = M_cm × CTM_old — the new matrix applies first — so pass (M_cm, CTM_old). Passing
 * them the other way round scaled an earlier translation by a later scale (limits row 47: every run of
 * Publication 17 was placed where pdf.js does not draw it). Text space → user space is (Tm, CTM).
 */
export function multiplyMatrix(A: Matrix, B: Matrix): Matrix {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
    A[4] * B[0] + A[5] * B[2] + B[4],
    A[4] * B[1] + A[5] * B[3] + B[5],
  ];
}

/** Apply an affine matrix to a 2D point; returns the transformed point. */
export function applyMatrixToPoint(M: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: x * M[0] + y * M[2] + M[4],
    y: x * M[1] + y * M[3] + M[5],
  };
}
