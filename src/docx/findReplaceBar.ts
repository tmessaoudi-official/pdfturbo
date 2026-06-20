/**
 * findReplaceBar — the find/replace UI for the DOCX editor. Pure DOM (no framework);
 * each control drives a plugin command against the live view. The bar tracks its own
 * find-vs-replace visibility and the match options (case / whole-word / regex); the
 * plugin owns matches, decorations, and the actual edits. i18n via t().
 */
import { type EditorView } from 'prosemirror-view';
import { type Command } from 'prosemirror-state';
import { t } from '../utils/i18n';
import { type FindOptions } from './findReplace';
import {
  findReplaceKey,
  openFindReplace,
  closeFindReplace,
  setFindQuery,
  setReplacement,
  findNext,
  findPrev,
  replaceCurrent,
  replaceAll,
} from './findReplacePlugin';

export interface FindReplaceBar {
  dom: HTMLElement;
  open(withReplace: boolean): void;
  close(): void;
  isOpen(): boolean;
  /** Re-sync the counter + error state from the plugin (called after transactions). */
  update(): void;
  destroy(): void;
}

export function buildFindReplaceBar(view: EditorView): FindReplaceBar {
  const opts: FindOptions = { caseSensitive: false, wholeWord: false, regex: false };
  let openFlag = false;

  const dom = document.createElement('div');
  dom.className = 'fr-bar';
  dom.style.display = 'none';

  const findRow = document.createElement('div');
  findRow.className = 'fr-row fr-find-row';
  const replaceRow = document.createElement('div');
  replaceRow.className = 'fr-row fr-replace-row';

  const findInput = document.createElement('input');
  findInput.type = 'text';
  findInput.className = 'fr-find';
  findInput.placeholder = t('findReplace.find');

  const replaceInput = document.createElement('input');
  replaceInput.type = 'text';
  replaceInput.className = 'fr-replace';
  replaceInput.placeholder = t('findReplace.replace');

  const run = (cmd: Command): void => {
    cmd(view.state, view.dispatch.bind(view), view);
    update();
  };
  const runQuery = (): void => run(setFindQuery(findInput.value, { ...opts }));

  function update(): void {
    const fr = findReplaceKey.getState(view.state);
    if (!fr) return;
    findInput.classList.toggle('fr-error', fr.error === 'invalid-regex');
    const total = fr.matches.length;
    const current = total === 0 ? 0 : fr.activeIndex + 1;
    counter.textContent = fr.query === '' ? '' : t('findReplace.counter', { current, total });
  }

  // Option toggles (case / whole-word / regex).
  const mkToggle = (opt: 'case' | 'word' | 'regex', label: string, titleKey: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fr-toggle';
    b.dataset.opt = opt;
    b.textContent = label;
    b.title = t(titleKey);
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => {
      if (opt === 'case') opts.caseSensitive = !opts.caseSensitive;
      else if (opt === 'word') opts.wholeWord = !opts.wholeWord;
      else opts.regex = !opts.regex;
      b.classList.toggle('active');
      runQuery();
    });
    return b;
  };
  const caseBtn = mkToggle('case', 'Aa', 'findReplace.caseSensitive');
  const wordBtn = mkToggle('word', '\\b', 'findReplace.wholeWord');
  const regexBtn = mkToggle('regex', '.*', 'findReplace.regex');

  const counter = document.createElement('span');
  counter.className = 'fr-counter';

  const mkBtn = (cls: string, label: string, titleKey: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `fr-btn ${cls}`;
    b.textContent = label;
    b.title = t(titleKey);
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', onClick);
    return b;
  };
  const prevBtn = mkBtn('fr-prev', '▲', 'findReplace.previous', () => run(findPrev()));
  const nextBtn = mkBtn('fr-next', '▼', 'findReplace.next', () => run(findNext()));
  const closeBtn = mkBtn('fr-close', '✕', 'findReplace.close', () => close());
  const replaceOneBtn = mkBtn('fr-replace-one', t('findReplace.replaceOne'), 'findReplace.replaceOne', () => run(replaceCurrent()));
  const replaceAllBtn = mkBtn('fr-replace-all', t('findReplace.replaceAll'), 'findReplace.replaceAll', () => run(replaceAll()));

  findInput.addEventListener('input', runQuery);
  findInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run(e.shiftKey ? findPrev() : findNext());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  replaceInput.addEventListener('input', () => run(setReplacement(replaceInput.value)));
  replaceInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run(replaceCurrent());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  findRow.append(findInput, caseBtn, wordBtn, regexBtn, counter, prevBtn, nextBtn, closeBtn);
  replaceRow.append(replaceInput, replaceOneBtn, replaceAllBtn);
  dom.append(findRow, replaceRow);

  function open(withReplace: boolean): void {
    openFlag = true;
    dom.style.display = 'block';
    replaceRow.style.display = withReplace ? 'flex' : 'none';
    run(openFindReplace(withReplace));
    findInput.focus();
    findInput.select();
    if (findInput.value) runQuery();
  }
  function close(): void {
    openFlag = false;
    dom.style.display = 'none';
    run(closeFindReplace());
    view.focus();
  }

  return {
    dom,
    open,
    close,
    isOpen: () => openFlag,
    update,
    destroy(): void {
      dom.remove();
    },
  };
}
