/**
 * The tool modes, as a runtime VALUE with the type derived from it — not a bare type union.
 * Deriving the type this way keeps `ToolMode` byte-identical to what it was while making the
 * member list enumerable at runtime, so a test can assert that every mode has the locale strings
 * it needs. That matters because the compiler can check an exhaustive `Record<ToolMode, …>` but
 * cannot look inside `locales/*.json`: the mode badge shipped missing `signRect` in both the map
 * AND all three locales, and rendered as "SELECT" instead.
 */
export const TOOL_MODES = [
  'select',
  'addText',
  'addSignature',
  'addImage',
  'addCode',
  'drawArrow',
  'drawRect',
  'drawEllipse',
  'drawFreehand',
  'drawHighlight',
  'addComment',
  'drawRedaction',
  'drawErase',
  'editText',
  'fillBucket',
  'crop',
  'signRect',
] as const;

export type ToolMode = typeof TOOL_MODES[number];
