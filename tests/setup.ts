/**
 * Global test setup — runs before any test file is imported.
 *
 * pdfjs-dist v6 instantiates `new DOMMatrix()` at module-eval time (top-level
 * const in canvas.js). jsdom does not provide DOMMatrix, so we stub it here
 * before pdfjs-dist is imported by any test that imports pdfRenderer.ts.
 */
if (typeof globalThis.DOMMatrix === 'undefined') {
  // Minimal DOMMatrix stub — only needs to exist so module-level `new DOMMatrix()`
  // does not throw. No test exercises the matrix math directly.
  globalThis.DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;
    invertSelf() { return this; }
    multiplySelf() { return this; }
    preMultiplySelf() { return this; }
    translateSelf() { return this; }
    scaleSelf() { return this; }
    scale3dSelf() { return this; }
    rotateSelf() { return this; }
    rotateFromVectorSelf() { return this; }
    rotateAxisAngleSelf() { return this; }
    skewXSelf() { return this; }
    skewYSelf() { return this; }
    flipX() { return this; }
    flipY() { return this; }
    inverse() { return this; }
    multiply() { return this; }
    translate() { return this; }
    scale() { return this; }
    scale3d() { return this; }
    rotate() { return this; }
    rotateFromVector() { return this; }
    rotateAxisAngle() { return this; }
    skewX() { return this; }
    skewY() { return this; }
    transformPoint(p: DOMPointInit = {}) { return { x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0, w: p.w ?? 1 }; }
    toFloat32Array() { return new Float32Array(16); }
    toFloat64Array() { return new Float64Array(16); }
    toJSON() { return {}; }
    toString() { return 'matrix(1, 0, 0, 1, 0, 0)'; }
    static fromMatrix() { return new DOMMatrix(); }
    static fromFloat32Array() { return new DOMMatrix(); }
    static fromFloat64Array() { return new DOMMatrix(); }
  } as unknown as typeof DOMMatrix;
}
