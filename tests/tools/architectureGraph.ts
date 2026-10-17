/**
 * The import graph behind the architecture ratchet (tests/tools/architecture.test.ts, architecture plan step 0).
 *
 * Zero install: TypeScript 7 is the native port and has no JS compiler API, and dependency-cruiser is a
 * devDependency this step does not add. So imports are read by a small lexer — comments blanked; strings, template
 * literals (with `${}` nesting) and regex literals tokenized, each string/regex scan bounded to its line so a
 * mis-lexed token cannot swallow the rest of a file — and parsed at token level. A regex over raw text was tried
 * first and lost the edge of a side-effect `import './x';` followed by another import.
 *
 * Classification follows TypeScript's own elision rules, since this repo has no `verbatimModuleSyntax`:
 * `import type …`, `export type …` and a brace list whose every specifier carries `type` are TYPE edges; everything
 * else, including an unmarked import that is only ever used as a type, is a RUNTIME edge (an overcount, the safe
 * side). `import('./x')` with a literal specifier is a runtime edge. A specifier with a Vite `?query` (`?url`,
 * `?worker&url`) is an asset URL, not a module dependency, and is counted apart.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export interface Edge { from: string; to: string; runtime: boolean }
export interface ExternalImport { from: string; pkg: string; runtime: boolean }
export interface Graph {
  files: string[];
  edges: Edge[];
  external: ExternalImport[];
  assetImports: number;
  /** Relative specifiers that resolved to no file, or to a `.ts` file outside the scanned root. */
  unresolved: string[];
  appUnderscoreInUi: number;
  getDocumentSites: number;
}

export interface Baseline {
  matrix: Record<string, { all: number; value: number }>;
  typeCycleFiles: number;
  appUnderscoreInUi: number;
  getDocumentSites: number;
}

/** Directories an edge may point INTO without a baseline entry: they hold no behaviour, only shared vocabulary. */
export const EXEMPT_TARGETS = new Set(['shared-kernel', 'contracts', 'types']);
/** npm packages the shared kernel may import (Decisions Log 2026-10-17: bidi-js is a pure UAX#9 library). */
export const KERNEL_NPM_ALLOWLIST = ['bidi-js'];

type Tok = { t: 'id' | 'str' | 'tpl' | 'num' | 're' | 'punct'; v: string };

const ID_START = /[A-Za-z_$\u0080-￿]/;
const ID_PART = /[\w$\u0080-￿]/;
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'yield', 'await', 'delete', 'throw', 'new', 'instanceof']);

function regexAllowed(prev: Tok | undefined): boolean {
  if (!prev) return true;
  if (prev.t === 'id') return KEYWORDS_BEFORE_REGEX.has(prev.v);
  if (prev.t === 'punct') return prev.v !== ')' && prev.v !== ']' && prev.v !== '}';
  return false;
}

/** Tokens of `src`, and `src` with every comment blanked (newlines kept, so offsets and line numbers survive). */
export function lex(src: string): { tokens: Tok[]; code: string } {
  const tokens: Tok[] = [];
  const out = src.split('');
  const blank = (a: number, b: number): void => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const n = src.length;
  // Brace depth, and the depths at which an open `${` expression returns to its template literal.
  let depth = 0;
  const templateAt: number[] = [];
  const readTemplate = (start: number): { end: number; text: string; open: boolean } => {
    let j = start;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') return { end: j + 1, text: src.slice(start, j), open: false };
      if (c === '$' && src[j + 1] === '{') return { end: j + 2, text: src.slice(start, j), open: true };
      j++;
    }
    return { end: n, text: src.slice(start), open: false };
  };
  const pushTemplate = (start: number): number => {
    const r = readTemplate(start);
    tokens.push({ t: 'tpl', v: r.text });
    if (r.open) { templateAt.push(depth); depth++; }
    return r.end;
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; blank(i, end); i = end; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      tokens.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c === '`') { i = pushTemplate(i + 1); continue; }
    if (c === '{') { depth++; tokens.push({ t: 'punct', v: c }); i++; continue; }
    if (c === '}') {
      depth--;
      if (templateAt.length && templateAt[templateAt.length - 1] === depth) { templateAt.pop(); i = pushTemplate(i + 1); continue; }
      tokens.push({ t: 'punct', v: c });
      i++;
      continue;
    }
    if (c === '/' && regexAllowed(tokens[tokens.length - 1])) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (inClass) { if (d === ']') inClass = false; } else if (d === '[') inClass = true; else if (d === '/') break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      tokens.push({ t: 're', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (ID_START.test(c)) { let j = i + 1; while (j < n && ID_PART.test(src[j])) j++; tokens.push({ t: 'id', v: src.slice(i, j) }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++; tokens.push({ t: 'num', v: src.slice(i, j) }); i = j; continue; }
    tokens.push({ t: 'punct', v: c });
    i++;
  }
  return { tokens, code: out.join('') };
}

/** `{ type A, type B }` → true; a specifier named `type` on its own, or any untyped specifier → false. */
function braceListAllTypes(list: Tok[]): boolean {
  const specs: Tok[][] = [[]];
  for (const t of list) { if (t.t === 'punct' && t.v === ',') specs.push([]); else specs[specs.length - 1].push(t); }
  const nonEmpty = specs.filter((s) => s.length > 0);
  return nonEmpty.length > 0 && nonEmpty.every((s) => s[0].v === 'type' && s.length > 1 && s[1].v !== 'as');
}

const PROMISE_METHODS = new Set(['then', 'catch', 'finally']);

/** Every module specifier `src` imports or re-exports, with whether TypeScript keeps it at runtime. */
export function parseImports(src: string): { spec: string; runtime: boolean }[] {
  const T = lex(src).tokens;
  const found: { spec: string; runtime: boolean }[] = [];
  const is = (k: number, v: string): boolean => T[k] !== undefined && T[k].t !== 'str' && T[k].t !== 'tpl' && T[k].v === v;
  for (let k = 0; k < T.length; k++) {
    const tk = T[k];
    if (tk.t !== 'id' || (tk.v !== 'import' && tk.v !== 'export')) continue;
    if (is(k - 1, '.')) continue;
    if (tk.v === 'import') {
      if (is(k + 1, '(')) {
        const a = T[k + 2];
        if (a && (a.t === 'str' || a.t === 'tpl') && is(k + 3, ')')) {
          // `import('x').T` and `typeof import('x')` are TypeScript import TYPES, erased at build: counted as runtime,
          // one would make its file pair runtime and hide a real runtime import added to that pair later. A member
          // access on the promise (`.then` / `.catch` / `.finally`) is a runtime dynamic import, and a bare
          // `import('x')` in a type position is a TS error (TS1340), so those two shapes are every type form.
          const member = is(k + 4, '.') && T[k + 5]?.t === 'id' ? T[k + 5].v : null;
          const typeRef = is(k - 1, 'typeof') || (member !== null && !PROMISE_METHODS.has(member));
          found.push({ spec: a.v, runtime: !typeRef });
        }
        continue;
      }
      if (is(k + 1, '.')) continue; // import.meta
      if (T[k + 1]?.t === 'str') { found.push({ spec: T[k + 1].v, runtime: true }); continue; }
      // import <clause> from '<spec>' — a clause is identifiers, braces, commas and `*` only.
      let j = k + 1;
      const clause: Tok[] = [];
      while (j < T.length && !(is(j, 'from') && T[j + 1]?.t === 'str')) {
        const t = T[j];
        if (t.t !== 'id' && !(t.t === 'punct' && '{},*'.includes(t.v))) break;
        if (t.t === 'id' && (t.v === 'import' || t.v === 'export')) break;
        clause.push(t);
        j++;
      }
      if (!(is(j, 'from') && T[j + 1]?.t === 'str') || clause.length === 0) continue;
      let typeOnly = false;
      if (clause[0].v === 'type' && clause.length > 1 && clause[1].v !== ',') typeOnly = true;
      else if (clause[0].v === '{' && clause[clause.length - 1].v === '}') typeOnly = braceListAllTypes(clause.slice(1, -1));
      found.push({ spec: T[j + 1].v, runtime: !typeOnly });
      k = j + 1;
      continue;
    }
    // export … from '<spec>': `export * [as x] from`, `export [type] { … } from`, `export type * [as x] from`.
    let j = k + 1;
    let typeOnly = false;
    if (is(j, 'type') && (is(j + 1, '{') || is(j + 1, '*'))) { typeOnly = true; j++; }
    if (is(j, '*')) {
      j++;
      if (is(j, 'as')) j += 2;
    } else if (is(j, '{')) {
      const open = j;
      while (j < T.length && !is(j, '}')) j++;
      if (!typeOnly) typeOnly = braceListAllTypes(T.slice(open + 1, j));
      j++;
    } else continue;
    if (is(j, 'from') && T[j + 1]?.t === 'str') { found.push({ spec: T[j + 1].v, runtime: !typeOnly }); k = j + 1; }
  }
  return found;
}

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

type Resolved = { kind: 'file'; path: string } | { kind: 'asset' } | { kind: 'external'; pkg: string } | { kind: 'unresolved' };

function resolveSpec(root: string, fromAbs: string, spec: string): Resolved {
  if (spec.includes('?')) return { kind: 'asset' };
  if (!spec.startsWith('.') && !spec.startsWith('/')) {
    const parts = spec.split('/');
    return { kind: 'external', pkg: spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] };
  }
  const b = resolve(dirname(fromAbs), spec);
  let hit: string | undefined;
  if (isFile(b)) { if (!b.endsWith('.ts')) return { kind: 'asset' }; hit = b; }
  else if (isFile(`${b}.ts`)) hit = `${b}.ts`;
  else if (isFile(join(b, 'index.ts'))) hit = join(b, 'index.ts');
  if (!hit || hit.endsWith('.d.ts') || !hit.startsWith(root + sep)) return { kind: 'unresolved' };
  return { kind: 'file', path: hit };
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
}

const rel = (root: string, p: string): string => relative(root, p).split(sep).join('/');

/** The graph of every `.ts` file under `root` (no `.d.ts`). Paths are `/`-separated and relative to `root`. */
export function buildGraph(root: string): Graph {
  const abs: string[] = [];
  walk(root, abs);
  const edges = new Map<string, Edge>();
  const external = new Map<string, ExternalImport>();
  const unresolved: string[] = [];
  let assetImports = 0;
  let appUnderscoreInUi = 0;
  let getDocumentSites = 0;
  for (const f of abs) {
    const text = readFileSync(f, 'utf8');
    const from = rel(root, f);
    for (const { spec, runtime } of parseImports(text)) {
      const r = resolveSpec(root, f, spec);
      if (r.kind === 'asset') { assetImports++; continue; }
      if (r.kind === 'unresolved') { unresolved.push(`${from}: '${spec}'`); continue; }
      const map = r.kind === 'file' ? edges : external;
      const to = r.kind === 'file' ? rel(root, r.path) : r.pkg;
      const key = `${from}|${to}`;
      const prev = map.get(key);
      if (prev) prev.runtime ||= runtime;
      else if (r.kind === 'file') edges.set(key, { from, to, runtime });
      else external.set(key, { from, pkg: to, runtime });
    }
    const code = lex(text).code;
    if (from.startsWith('ui/')) appUnderscoreInUi += (code.match(/\bapp\._[A-Za-z]/g) ?? []).length;
    getDocumentSites += (code.match(/\bgetDocument\(/g) ?? []).length;
  }
  return {
    files: abs.map((f) => rel(root, f)),
    edges: [...edges.values()],
    external: [...(external.values() as Iterable<ExternalImport>)],
    assetImports,
    unresolved,
    appUnderscoreInUi,
    getDocumentSites,
  };
}

/** Strongly connected components of more than one file (Tarjan), each sorted, over runtime edges or all edges. */
export function cycles(edges: Edge[], runtimeOnly: boolean): string[][] {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (runtimeOnly && !e.runtime) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)?.push(e.to);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  let next = 0;
  const visit = (v: string): void => {
    index.set(v, next); low.set(v, next); next++;
    stack.push(v); onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v) as number, low.get(w) as number)); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string | undefined;
      do { w = stack.pop() as string; onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) out.push(comp.sort());
    }
  };
  for (const v of [...adj.keys()].sort()) if (!index.has(v)) visit(v);
  return out;
}

export const topDir = (p: string): string => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '(root)');

/**
 * Edges between top-level directories, as `a->b` → { all, value }. Left out: edges inside one directory, edges
 * from the composition root (`src/*.ts`), and edges whose source or target is a vocabulary directory
 * (EXEMPT_TARGETS) — the kernel and leaf rules in `evaluate` govern those instead.
 */
export function dirMatrix(edges: Edge[]): Record<string, { all: number; value: number }> {
  const m: Record<string, { all: number; value: number }> = {};
  for (const e of edges) {
    const a = topDir(e.from);
    const b = topDir(e.to);
    if (a === b || a === '(root)' || EXEMPT_TARGETS.has(a) || EXEMPT_TARGETS.has(b)) continue;
    const k = `${a}->${b}`;
    m[k] ??= { all: 0, value: 0 };
    m[k].all++;
    if (e.runtime) m[k].value++;
  }
  return Object.fromEntries(Object.entries(m).sort(([x], [y]) => (x < y ? -1 : 1)));
}

/** Every way `graph` breaks the architecture rules or drifts from `baseline`, as one message per violation. */
export function evaluate(graph: Graph, baseline: Baseline): string[] {
  const v: string[] = [];
  for (const u of graph.unresolved) v.push(`unresolved import ${u}`);
  for (const c of cycles(graph.edges, true)) v.push(`runtime import cycle: ${c.join(', ')}`);
  for (const e of graph.edges) {
    const a = topDir(e.from);
    const b = topDir(e.to);
    if (a === 'shared-kernel' && b !== 'shared-kernel') v.push(`${e.from} imports ${e.to}: shared-kernel/ imports only itself`);
    if ((a === 'contracts' || a === 'types') && !EXEMPT_TARGETS.has(b)) v.push(`${e.from} imports ${e.to}: ${a}/ imports only shared-kernel/, contracts/ and types/`);
  }
  for (const x of graph.external) {
    if (topDir(x.from) === 'shared-kernel' && !KERNEL_NPM_ALLOWLIST.includes(x.pkg)) {
      v.push(`${x.from} imports npm '${x.pkg}': not in the kernel allowlist [${KERNEL_NPM_ALLOWLIST.join(', ')}]`);
    }
  }
  // Two-sided: a rise is a regression; a fall is progress the baseline must record, or the slack is reusable.
  const ratchet = (name: string, now: number, base: number): void => {
    if (now > base) v.push(`${name} ${now} > baseline ${base}`);
    else if (now < base) v.push(`${name} ${now} < baseline ${base}: lower the baseline to ${now}`);
  };
  const matrix = dirMatrix(graph.edges);
  for (const [pair, now] of Object.entries(matrix)) {
    const base = baseline.matrix[pair];
    if (!base) { v.push(`new dependency direction ${pair} (all ${now.all}, value ${now.value}): not in the baseline`); continue; }
    ratchet(`${pair} all edges`, now.all, base.all);
    ratchet(`${pair} value edges`, now.value, base.value);
  }
  for (const pair of Object.keys(baseline.matrix)) {
    if (!matrix[pair]) v.push(`${pair}: in the baseline but the code has no such edge: remove it from the baseline`);
  }
  ratchet('files in import cycles (type edges included)', cycles(graph.edges, false).reduce((s, c) => s + c.length, 0), baseline.typeCycleFiles);
  ratchet('app._ uses in ui/', graph.appUnderscoreInUi, baseline.appUnderscoreInUi);
  ratchet('getDocument( sites', graph.getDocumentSites, baseline.getDocumentSites);
  return v;
}
