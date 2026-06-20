/**
 * findReplacePlugin — ProseMirror plugin holding find/replace state, painting match
 * decorations, and exposing commands. The pure matching lives in findReplace.ts; this
 * unit owns: (a) recomputing matches when the query/options change OR the document
 * changes underneath, (b) a DecorationSet highlighting every match (active one brighter),
 * and (c) Replace / Replace-all transactions that inherit the marks at each match start.
 *
 * `replaceAll` applies matches right-to-left in ONE transaction so earlier positions stay
 * valid mid-apply and the whole batch is a single undo step.
 */
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { findMatches, expandReplacement, type FindOptions, type FindMatch } from './findReplace';

export interface FindReplaceState {
  active: boolean;
  query: string;
  replacement: string;
  opts: FindOptions;
  matches: FindMatch[];
  activeIndex: number; // -1 when there are no matches
  error: 'invalid-regex' | null;
}

type FRAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'setQuery'; query: string; opts: FindOptions }
  | { type: 'setReplacement'; text: string }
  | { type: 'setActiveIndex'; index: number };

export const findReplaceKey = new PluginKey<FindReplaceState>('docxFindReplace');

const INITIAL: FindReplaceState = {
  active: false,
  query: '',
  replacement: '',
  opts: { caseSensitive: false, wholeWord: false, regex: false },
  matches: [],
  activeIndex: -1,
  error: null,
};

function clampIndex(idx: number, len: number): number {
  if (len === 0) return -1;
  if (idx < 0) return 0;
  if (idx >= len) return len - 1;
  return idx;
}

/** Recompute matches for `query`/`opts` against `doc` (empty query → no matches, no error). */
function recompute(doc: EditorState['doc'], query: string, opts: FindOptions): { matches: FindMatch[]; error: 'invalid-regex' | null } {
  if (query === '') return { matches: [], error: null };
  const r = findMatches(doc, query, opts);
  if (r.ok) return { matches: r.matches, error: null };
  return { matches: [], error: r.error === 'invalid-regex' ? 'invalid-regex' : null };
}

export function findReplacePlugin(): Plugin<FindReplaceState> {
  return new Plugin<FindReplaceState>({
    key: findReplaceKey,
    state: {
      init: () => ({ ...INITIAL }),
      apply(tr: Transaction, value: FindReplaceState, _old, newState): FindReplaceState {
        const meta = tr.getMeta(findReplaceKey) as FRAction | undefined;
        if (meta) {
          switch (meta.type) {
            case 'open':
              return { ...value, active: true };
            case 'close':
              return { ...value, active: false };
            case 'setReplacement':
              return { ...value, replacement: meta.text };
            case 'setActiveIndex':
              return { ...value, activeIndex: clampIndex(meta.index, value.matches.length) };
            case 'setQuery': {
              const { matches, error } = recompute(newState.doc, meta.query, meta.opts);
              return { ...value, query: meta.query, opts: meta.opts, matches, error, activeIndex: matches.length ? 0 : -1 };
            }
          }
        }
        if (tr.docChanged && value.query !== '') {
          const { matches, error } = recompute(newState.doc, value.query, value.opts);
          return { ...value, matches, error, activeIndex: clampIndex(value.activeIndex, matches.length) };
        }
        return value;
      },
    },
    props: {
      decorations(state): DecorationSet {
        const fr = findReplaceKey.getState(state);
        if (!fr || !fr.active || fr.matches.length === 0) return DecorationSet.empty;
        const decos: Decoration[] = [];
        fr.matches.forEach((m, i) => {
          if (m.to <= m.from) return; // skip zero-length (regex) matches
          decos.push(Decoration.inline(m.from, m.to, { class: i === fr.activeIndex ? 'fr-match fr-match-active' : 'fr-match' }));
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

function dispatchMeta(action: FRAction): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.setMeta(findReplaceKey, action));
    return true;
  };
}

/** Open the find/replace UI (the bar tracks find-vs-replace mode itself). */
export function openFindReplace(_withReplace: boolean): Command {
  return dispatchMeta({ type: 'open' });
}
export function closeFindReplace(): Command {
  return dispatchMeta({ type: 'close' });
}
export function setFindQuery(query: string, opts: FindOptions): Command {
  return dispatchMeta({ type: 'setQuery', query, opts });
}
export function setReplacement(text: string): Command {
  return dispatchMeta({ type: 'setReplacement', text });
}

/** Move the editor selection to `m` so it scrolls into view, and record the active index. */
function gotoMatch(index: number, m: FindMatch): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr.setMeta(findReplaceKey, { type: 'setActiveIndex', index } satisfies FRAction);
      tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

export function findNext(): Command {
  return (state, dispatch) => {
    const fr = findReplaceKey.getState(state);
    if (!fr || fr.matches.length === 0) return false;
    const idx = (fr.activeIndex + 1) % fr.matches.length;
    return gotoMatch(idx, fr.matches[idx])(state, dispatch);
  };
}
export function findPrev(): Command {
  return (state, dispatch) => {
    const fr = findReplaceKey.getState(state);
    if (!fr || fr.matches.length === 0) return false;
    const len = fr.matches.length;
    const idx = (fr.activeIndex - 1 + len) % len;
    return gotoMatch(idx, fr.matches[idx])(state, dispatch);
  };
}

/** Marks present at the first character of a match (its "start" formatting). */
function marksAtStart(state: EditorState, m: FindMatch) {
  const pos = m.to > m.from ? m.from + 1 : m.from;
  return state.doc.resolve(pos).marks();
}

function applyReplacement(tr: Transaction, state: EditorState, m: FindMatch, replacement: string): void {
  const text = expandReplacement(replacement, m.groups);
  if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marksAtStart(state, m)));
  else tr.delete(m.from, m.to);
}

export function replaceCurrent(): Command {
  return (state, dispatch) => {
    const fr = findReplaceKey.getState(state);
    if (!fr || fr.activeIndex < 0 || fr.activeIndex >= fr.matches.length) return false;
    if (dispatch) {
      const tr = state.tr;
      applyReplacement(tr, state, fr.matches[fr.activeIndex], fr.replacement);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function replaceAll(): Command {
  return (state, dispatch) => {
    const fr = findReplaceKey.getState(state);
    if (!fr || fr.matches.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      // Right-to-left: editing the rightmost match first keeps every smaller position valid.
      const ordered = [...fr.matches].sort((a, b) => b.from - a.from);
      for (const m of ordered) applyReplacement(tr, state, m, fr.replacement);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
