/**
 * Task 2 — find/replace ProseMirror plugin: state recompute, navigation, decorations,
 * and replace semantics (match-start mark inheritance, single-transaction right-to-left
 * replace-all, doc-edit recompute + activeIndex clamp). Driven without a view by applying
 * commands through a counting dispatch.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, type Command } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { docxSchema as s } from '../../src/docx/docxSchema';
import { findMatches, type FindOptions } from '../../src/docx/findReplace';
import {
  findReplaceKey,
  findReplacePlugin,
  openFindReplace,
  closeFindReplace,
  setFindQuery,
  setReplacement,
  findNext,
  findPrev,
  replaceCurrent,
  replaceAll,
} from '../../src/docx/findReplacePlugin';

const PLAIN: FindOptions = { caseSensitive: false, wholeWord: false, regex: false };

function para(...children: PMNode[]): PMNode {
  return s.node('paragraph', null, children.length ? children : undefined);
}
function doc(...blocks: PMNode[]): PMNode {
  return s.node('doc', null, blocks);
}
function bold(text: string): PMNode {
  return s.text(text, [s.marks.strong.create()]);
}

const plugin = findReplacePlugin();
function mkState(d: PMNode): EditorState {
  return EditorState.create({ schema: s, doc: d, plugins: [plugin] });
}
/** Apply a command, returning the new state and how many transactions it dispatched. */
function run(state: EditorState, cmd: Command): { state: EditorState; count: number } {
  let count = 0;
  let next = state;
  cmd(state, tr => {
    count += 1;
    next = state.apply(tr);
  });
  return { state: next, count };
}
function fr(state: EditorState) {
  const v = findReplaceKey.getState(state);
  if (!v) throw new Error('plugin state missing');
  return v;
}
function decoCount(state: EditorState): number {
  const decorations = plugin.props.decorations;
  if (!decorations) return 0;
  const set = decorations.call(plugin, state) as DecorationSet | null | undefined;
  return set ? set.find().length : 0;
}

describe('findReplacePlugin', () => {
  it('setFindQuery populates matches and starts at index 0', () => {
    let st = mkState(doc(para(s.text('a b a'))));
    st = run(st, setFindQuery('a', PLAIN)).state;
    expect(fr(st).matches).toHaveLength(2);
    expect(fr(st).activeIndex).toBe(0);
  });

  it('findNext / findPrev cycle with wraparound', () => {
    let st = mkState(doc(para(s.text('a a a'))));
    st = run(st, setFindQuery('a', PLAIN)).state;
    st = run(st, findNext()).state;
    expect(fr(st).activeIndex).toBe(1);
    st = run(st, findNext()).state;
    expect(fr(st).activeIndex).toBe(2);
    st = run(st, findNext()).state; // wrap
    expect(fr(st).activeIndex).toBe(0);
    st = run(st, findPrev()).state; // wrap back
    expect(fr(st).activeIndex).toBe(2);
  });

  it('open/close toggles active and gates decorations', () => {
    let st = mkState(doc(para(s.text('a a'))));
    st = run(st, setFindQuery('a', PLAIN)).state;
    st = run(st, openFindReplace(false)).state;
    expect(fr(st).active).toBe(true);
    expect(decoCount(st)).toBe(2);
    st = run(st, closeFindReplace()).state;
    expect(fr(st).active).toBe(false);
    expect(decoCount(st)).toBe(0);
  });

  it('replaceCurrent inherits the marks at the match start', () => {
    let st = mkState(doc(para(bold('foo'), s.text(' bar'))));
    st = run(st, setFindQuery('foo', PLAIN)).state;
    st = run(st, setReplacement('XYZ')).state;
    const res = run(st, replaceCurrent());
    st = res.state;
    expect(res.count).toBe(1);
    const firstPara = st.doc.firstChild;
    const firstText = firstPara?.firstChild;
    expect(firstText?.text).toBe('XYZ');
    expect(firstText?.marks.some(mk => mk.type === s.marks.strong)).toBe(true);
  });

  it('replaceAll is ONE transaction and applies right-to-left correctly', () => {
    let st = mkState(doc(para(s.text('a-a-a'))));
    st = run(st, setFindQuery('a', PLAIN)).state;
    st = run(st, setReplacement('bb')).state;
    const res = run(st, replaceAll());
    st = res.state;
    expect(res.count).toBe(1); // single undo step
    expect(st.doc.textContent).toBe('bb-bb-bb');
    expect(fr(st).matches).toHaveLength(0); // 'a' no longer present
  });

  it('expands capture groups in replaceCurrent (regex)', () => {
    let st = mkState(doc(para(s.text('2026-06'))));
    st = run(st, setFindQuery('(\\d{4})-(\\d{2})', { ...PLAIN, regex: true })).state;
    st = run(st, setReplacement('$2/$1')).state;
    st = run(st, replaceCurrent()).state;
    expect(st.doc.textContent).toBe('06/2026');
  });

  it('recomputes and clamps activeIndex when the doc changes underneath', () => {
    let st = mkState(doc(para(s.text('aaa'))));
    st = run(st, setFindQuery('a', PLAIN)).state;
    st = run(st, findNext()).state;
    st = run(st, findNext()).state; // activeIndex 2
    expect(fr(st).activeIndex).toBe(2);
    st = st.apply(st.tr.delete(1, 4)); // clear the paragraph content
    expect(fr(st).matches).toHaveLength(0);
    expect(fr(st).activeIndex).toBe(-1);
  });

  it('invalid regex surfaces a typed error and no matches', () => {
    let st = mkState(doc(para(s.text('x'))));
    st = run(st, setFindQuery('(', { ...PLAIN, regex: true })).state;
    expect(fr(st).error).toBe('invalid-regex');
    expect(fr(st).matches).toHaveLength(0);
  });

  it('plugin matches agree with the pure core', () => {
    const d = doc(para(s.text('cat category')));
    let st = mkState(d);
    st = run(st, setFindQuery('cat', { ...PLAIN, wholeWord: true })).state;
    const core = findMatches(d, 'cat', { ...PLAIN, wholeWord: true });
    expect(core.ok && core.matches).toHaveLength(fr(st).matches.length);
  });
});
