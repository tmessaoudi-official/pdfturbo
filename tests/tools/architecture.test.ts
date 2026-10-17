/**
 * The architecture ratchet (docs/plans/architecture.plan.md, step 0). It fails when `src/` gains a runtime import
 * cycle, a new dependency direction between top-level directories, or more edges along an existing one; when the
 * shared kernel or a vocabulary directory (contracts/, types/) imports outward; and when the `app._` reach-ins from
 * ui/ or the `getDocument(` call sites grow. It also fails when any of those counts FALLS below
 * `architecture.baseline.json`, until the baseline is lowered in the same commit — otherwise the freed slack could
 * be spent again silently.
 *
 * The graph builder is checked first against a fixture tree (tests/tools/fixtures/architecture/src) that holds every
 * import form, a runtime cycle, a new direction and both kernel violations, so a scanner that silently stopped
 * seeing edges goes red here rather than leaving the real-tree assertion green on an empty graph.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { META_GLOB, NON_LITERAL, buildGraph, evaluate, parseImports, type Baseline } from './architectureGraph';

const ROOT = join(__dirname, '..', '..');

describe('architecture ratchet — the scanner', () => {
  it('classifies every import form as TypeScript does without verbatimModuleSyntax', () => {
    const src = [
      "import Def, { type A } from './mixed';",
      "import type from './defaultNamedType';",
      "import { type B, type C } from './allTypes';",
      "import * as ns from './ns';",
      "export * from './star';",
      "export type * as types from './typeStar';",
      "export { a as b } from './renamed';",
      "export { type D, type E } from './typeList';",
      'const t = `a ${ { x: 1 }.x } b`;',
      "import { y } from './afterTemplate';",
      "const s = `${'`'}`;",
      "import type { z } from './afterBacktickString';",
      "const lazy = () => import(`./templateSpec`);",
      'const dyn = (name: string) => import(name);',
      "const notAnImport = obj.import('./method');",
      'const url = import.meta.url;',
      'const re = /\\/\\//;',
      "import './sideEffect';",
      "import { w } from './afterSideEffect';",
      "type Q = import('./typeQualified').Shape;",
      "type G = import('./typeGeneric').Box<number>[];",
      "let n: typeof import('./typeofImport');",
      "const p = import('./thenChain').then((m) => m);",
      "const c = import('./catchChain').catch(() => null);",
      "const f = import('./finallyChain').finally(() => 0);",
      "const v = typeof import('./valueTypeof') === 'object';",
      "const w = typeof import('./valueTypeofNe') !== 'x';",
      "const k = import('./ctorProp').constructor;",
      "const s2 = import('./calledMember').describe();",
      "const at = import('./withAttrs', { with: { type: 'json' } });",
      "const tc = import(\n  './trailingComma',\n);",
      "const vt = typeof import('./valueTypeofBare');",
      "type TA<K extends string> = typeof import('./typeofAlias');",
      "const m3: Map<string, typeof import('./typeofInArgs')> = new Map();",
      "type U = A | typeof import('./unionTypeof');",
      "type V = A & typeof import('./intersectionTypeof');",
      "let m4: Map<typeof import('./genericFirst'), string>;",
      "const lo = cond || typeof import('./logicalOr');",
      "const la = a && typeof import('./logicalAnd') === 'object';",
      "const fr = import('./finallyRead').finally;",
      "const np = import(('./parenthesized'));",
      'const nt = import(`./tpl/${x}`);',
      "const nc = import('./concat' + x);",
      'class L { import(spec: string) { return spec; } }',
      'interface I { import(s: string): Promise<unknown> }',
      'const o = { import(s: string) { return s; } };',
      'const tern = c ? import(spec) : null;',
      'const ta = c ? await import(spec) : null;',
      'switch (x) { case import(spec): break; }',
      'abstract class A { static async import(s: string): Promise<void> {} }',
      "const g = import.meta.glob('./mods/*.ts');",
    ].join('\n');
    expect(parseImports(src)).toEqual([
      { spec: './mixed', runtime: true },
      { spec: './defaultNamedType', runtime: true },
      { spec: './allTypes', runtime: false },
      { spec: './ns', runtime: true },
      { spec: './star', runtime: true },
      { spec: './typeStar', runtime: false },
      { spec: './renamed', runtime: true },
      { spec: './typeList', runtime: false },
      { spec: './afterTemplate', runtime: true },
      { spec: './afterBacktickString', runtime: false },
      { spec: './templateSpec', runtime: true },
      { spec: NON_LITERAL, runtime: true },
      { spec: './sideEffect', runtime: true },
      { spec: './afterSideEffect', runtime: true },
      { spec: './typeQualified', runtime: false },
      { spec: './typeGeneric', runtime: false },
      { spec: './typeofImport', runtime: false },
      { spec: './thenChain', runtime: true },
      { spec: './catchChain', runtime: true },
      { spec: './finallyChain', runtime: true },
      { spec: './valueTypeof', runtime: true },
      { spec: './valueTypeofNe', runtime: true },
      { spec: './ctorProp', runtime: true },
      { spec: './calledMember', runtime: true },
      { spec: './withAttrs', runtime: true },
      { spec: './trailingComma', runtime: true },
      { spec: './valueTypeofBare', runtime: true },
      { spec: './typeofAlias', runtime: false },
      { spec: './typeofInArgs', runtime: true },
      { spec: './unionTypeof', runtime: false },
      { spec: './intersectionTypeof', runtime: false },
      { spec: './genericFirst', runtime: false },
      { spec: './logicalOr', runtime: true },
      { spec: './logicalAnd', runtime: true },
      { spec: './finallyRead', runtime: true },
      { spec: NON_LITERAL, runtime: true },
      { spec: NON_LITERAL, runtime: true },
      { spec: NON_LITERAL, runtime: true },
      { spec: NON_LITERAL, runtime: true },
      { spec: NON_LITERAL, runtime: true },
      { spec: NON_LITERAL, runtime: true },
      { spec: META_GLOB, runtime: true },
    ]);
  });

  it('builds the fixture graph exactly: comments and strings ignored, asset URLs set apart, npm packages named, an import leaving the root unresolved', () => {
    const g = buildGraph(join(__dirname, 'fixtures', 'architecture', 'src'));
    const edges = g.edges.map((e) => `${e.from} -> ${e.to} ${e.runtime ? 'runtime' : 'type'}`).sort();
    expect(edges).toEqual([
      'contracts/leak.ts -> export/shape.ts type',
      'core/app.ts -> export/render.ts runtime',
      'core/app.ts -> export/shape.ts type',
      'core/app.ts -> types/tool.ts type',
      'core/app.ts -> ui/lazy.ts runtime',
      'core/app.ts -> ui/panel.ts runtime',
      'export/render.ts -> types/tool.ts runtime',
      'export/render.ts -> ui/side.ts runtime',
      'main.ts -> ui/side.ts runtime',
      'shared-kernel/math.ts -> core/app.ts runtime',
      'types/bad.ts -> export/shape.ts type',
      'ui/lazy.ts -> types/tool.ts runtime',
      'ui/panel.ts -> core/app.ts runtime',
      'ui/panel.ts -> export/shape.ts type',
      'ui/typeRef.ts -> export/shape.ts type',
    ]);
    expect(g.external.map((x) => `${x.from} -> ${x.pkg}`).sort()).toEqual([
      'shared-kernel/math.ts -> bidi-js',
      'shared-kernel/math.ts -> fflate',
    ]);
    expect(g.assetImports).toBe(1);
    expect(g.unresolved).toEqual([
      "main.ts: '../outside'",
      "shared-kernel/dyn.ts: 'bidi-js/../pdfjs-dist'",
      `shared-kernel/dyn.ts: ${NON_LITERAL}`,
      `shared-kernel/dyn.ts: ${META_GLOB}`,
    ]);
    expect(g.appUnderscoreInUi).toBe(1);
    expect(g.getDocumentSites).toBe(2);
  });

  // main.ts -> ui/ is absent from the expected list: the composition root may import any directory.
  it('reports every planted violation, and both directions of baseline drift', () => {
    const g = buildGraph(join(__dirname, 'fixtures', 'architecture', 'src'));
    const baseline: Baseline = {
      matrix: {
        'core->ui': { all: 2, value: 2 },
        'core->export': { all: 3, value: 1 },
        'ui->core': { all: 1, value: 1 },
        'export->ui': { all: 1, value: 1 },
        'core->handlers': { all: 1, value: 1 },
      },
      typeCycleFiles: 3,
      appUnderscoreInUi: 2,
      getDocumentSites: 1,
    };
    expect([...evaluate(g, baseline)].sort()).toEqual([
      'app._ uses in ui/ 1 < baseline 2: lower the baseline to 1',
      'core->export all edges 2 < baseline 3: lower the baseline to 2',
      'core->handlers: in the baseline but the code has no such edge: remove it from the baseline',
      'files in import cycles (type edges included) 2 < baseline 3: lower the baseline to 2',
      'getDocument( sites 2 > baseline 1',
      'new dependency direction ui->export (all 2, value 0): not in the baseline',
      'runtime import cycle: core/app.ts, ui/panel.ts',
      "unresolved import main.ts: '../outside'",
      "unresolved import shared-kernel/dyn.ts: 'bidi-js/../pdfjs-dist'",
      `unresolved import shared-kernel/dyn.ts: ${NON_LITERAL}`,
      `unresolved import shared-kernel/dyn.ts: ${META_GLOB}`,
      "shared-kernel/math.ts imports core/app.ts: shared-kernel/ imports only itself",
      "shared-kernel/math.ts imports npm 'fflate': not in the kernel allowlist [bidi-js]",
      'types/bad.ts imports export/shape.ts: types/ imports only shared-kernel/, contracts/ and types/',
      'contracts/leak.ts imports export/shape.ts: contracts/ imports only shared-kernel/, contracts/ and types/',
    ].sort());
  });
});

describe('architecture ratchet — src/', () => {
  const graph = buildGraph(join(ROOT, 'src'));
  const baseline = JSON.parse(readFileSync(join(__dirname, 'architecture.baseline.json'), 'utf8')) as Baseline;

  it('sees the whole tree (a scanner that lost its edges would make every rule vacuous)', () => {
    expect(graph.files.length).toBeGreaterThanOrEqual(150);
    expect(graph.edges.length).toBeGreaterThanOrEqual(600);
    expect(graph.external.some((x) => x.pkg === 'pdfjs-dist')).toBe(true);
  });

  it('matches architecture.baseline.json exactly — no regression, and no unrecorded progress', () => {
    expect(evaluate(graph, baseline)).toEqual([]);
  });
});
