/**
 * Make `@pdf-lib/fontkit` (v1) present the API surface `@cantoo/pdf-lib` ≥2.8.1 expects.
 *
 * THE BUG THIS EXISTS FOR. pdf-lib 2.8.1 added feature-detection to
 * `CustomFontSubsetEmbedder.serializeFont`:
 *
 *     // Upstream fontkit v2+ exposes sync `encode()`; @pdf-lib/fontkit uses
 *     // Node-style `encodeStream()`.
 *     if (typeof this.subset.encode === 'function') {
 *       return Promise.resolve(this.subset.encode());
 *     }
 *     … else use encodeStream() …
 *
 * `@pdf-lib/fontkit@1.1.1`'s `TTFSubset` DOES have an `encode` — but it is restructure's low-level
 * `Struct.encode(stream, value)`, which needs a stream. Called with no arguments it dereferences
 * `undefined`, so every subset embed dies with:
 *
 *     TypeError: Cannot read properties of undefined (reading 'pos')
 *       ❯ Struct.encode      fontkit.es.js
 *       ❯ TTFSubset.encode   fontkit.es.js
 *       ❯ CustomFontSubsetEmbedder.serializeFont
 *
 * Measured: 2.8.0 passes, 2.8.1 fails, nothing else changed — 13 tests across 6 files, every one of
 * them a custom-font embed. The detection is simply wrong for fontkit 1.x, whose `encode` is a
 * different method that happens to share the name.
 *
 * THE DISCRIMINATOR IS ARITY, NOT PRESENCE. Upstream fontkit v2's sync `encode()` takes **no**
 * arguments; fontkit 1.x's `Struct.encode(stream)` takes **one**. So a subset whose `encode.length > 0`
 * is the incompatible one, and hiding it makes pdf-lib take the `encodeStream()` branch that fontkit 1
 * actually implements. Nothing is patched or monkey-patched: the real objects are untouched and we hand
 * pdf-lib a thin wrapper.
 *
 * WHY NOT `subset: false`. That embeds the whole ~250 KB Noto Naskh Arabic face in every export that
 * touches Arabic, instead of the handful of glyphs used — a permanent size regression to work around a
 * transient upstream bug.
 *
 * REMOVING THIS. It self-obsoletes in two ways, both safe: if pdf-lib fixes the detection, the wrapper
 * is inert (it only ever hides a method pdf-lib should not have called); if we move to a real fontkit
 * v2, `encode.length === 0` and the wrapper stops hiding anything. Delete it when
 * `tests/export/fontkitAdapter.test.ts` still passes with the raw fontkit registered.
 */

/** The parts of a fontkit subset that `@cantoo/pdf-lib` actually calls. */
interface SubsetLike {
  encode?: (...args: unknown[]) => unknown;
  encodeStream?: () => unknown;
  includeGlyph?: (glyph: unknown) => unknown;
  cff?: unknown;
}

interface FontLike {
  createSubset?: () => SubsetLike;
  [k: string]: unknown;
}

interface FontkitLike {
  create: (bytes: Uint8Array, postscriptName?: string) => FontLike;
  [k: string]: unknown;
}

/**
 * True when `subset.encode` is fontkit 1.x's stream-taking `Struct.encode` rather than fontkit v2's
 * argument-less sync encoder — i.e. when pdf-lib ≥2.8.1 would call it wrongly.
 */
export function hasIncompatibleEncode(subset: SubsetLike): boolean {
  return typeof subset.encode === 'function' && subset.encode.length > 0;
}

/**
 * Wrap a subset so an incompatible `encode` is invisible to `typeof … === 'function'`, forcing the
 * `encodeStream()` path. Delegates every other member to the real subset.
 */
export function adaptSubset(subset: SubsetLike): SubsetLike {
  if (!hasIncompatibleEncode(subset)) return subset;
  return new Proxy(subset, {
    get(target, prop, receiver) {
      if (prop === 'encode') return undefined;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(target, prop) {
      return prop === 'encode' ? false : Reflect.has(target, prop);
    },
  });
}

/**
 * Wrap a fontkit module so every subset it produces is adapted. Register the RESULT with
 * `pdfDoc.registerFontkit(...)` instead of the raw module.
 */
export function adaptFontkit<T extends object>(fontkit: T): T {
  const target = fontkit as unknown as FontkitLike;
  return new Proxy(fontkit, {
    get(_t, prop, receiver) {
      if (prop !== 'create') {
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      }
      return (bytes: Uint8Array, postscriptName?: string): FontLike => {
        const font = target.create(bytes, postscriptName);
        if (typeof font?.createSubset !== 'function') return font;
        return new Proxy(font, {
          get(fTarget, fProp, fReceiver) {
            if (fProp === 'createSubset') {
              return () => adaptSubset((fTarget.createSubset as () => SubsetLike)());
            }
            const v = Reflect.get(fTarget, fProp, fReceiver);
            return typeof v === 'function' ? v.bind(fTarget) : v;
          },
        });
      };
    },
  });
}
