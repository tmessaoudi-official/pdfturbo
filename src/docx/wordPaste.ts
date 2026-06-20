/**
 * wordPaste — pure sanitiser for HTML pasted from Word/Google Docs/web sources.
 * Strips Microsoft Office clipboard cruft (mso-* styles, <o:p>, conditional
 * comments, empty MsoNormal paragraphs, office-namespaced tags) and leaves only
 * the markup the DOCX editor's ProseMirror schema can parse (b/i/u/a/h1-6/ul/ol/
 * li/p/span[style]). Runs as the EditorView's transformPastedHTML hook.
 *
 * Total: any input returns a string; malformed HTML returns a best-effort
 * cleaned fragment and never throws.
 */

// CSS style declarations the schema's parseDOM rules actually read.
const _KEEP_STYLE = /^(font-family|font-size|font-weight|font-style|text-decoration)$/;
// Office-namespaced or metadata elements removed wholesale (content dropped).
const _DROP_TAGS = new Set(['xml', 'style', 'meta', 'link', 'title', 'script']);

/** Handle Word's two conditional-comment forms on the raw string before parsing. */
function _stripConditionals(html: string): string {
  // Downlevel-hidden: <!--[if ...]> ... <![endif]--> — remove entirely.
  let out = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
  // Downlevel-revealed: <![if ...]> ... <![endif]> — keep inner, drop delimiters.
  out = out.replace(/<!\[if[^\]]*\]>/gi, '').replace(/<!\[endif\][^>]*>/gi, '');
  return out;
}

/** Keep only schema-readable style declarations; remove the attr if none survive. */
function _cleanStyle(el: Element): void {
  const style = el.getAttribute('style');
  if (style === null) return;
  const kept = style
    .split(';')
    .map(d => d.trim())
    .filter(d => {
      const prop = d.split(':')[0]?.trim().toLowerCase() ?? '';
      return prop !== '' && _KEEP_STYLE.test(prop);
    });
  if (kept.length > 0) el.setAttribute('style', kept.join('; '));
  else el.removeAttribute('style');
}

/** A <p>/<div> with no text (only NBSP/whitespace) and no image/br is a spacer. */
function _isEmptyBlock(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'p' && tag !== 'div') return false;
  if (el.querySelector('img, br') !== null) return false;
  return (el.textContent ?? '').replace(/ /g, ' ').trim() === '';
}

function _imgIsUsable(el: Element): boolean {
  const src = el.getAttribute('src') ?? '';
  return /^(https?:|data:)/i.test(src);
}

export function cleanWordHtml(html: string): string {
  if (html === '') return '';
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(_stripConditionals(html), 'text/html');
  } catch {
    return html.replace(/<[^>]*>/g, '');
  }
  const body = doc.body;

  // Pass 1: drop metadata tags wholesale; unwrap office-namespaced tags to text.
  body.querySelectorAll('*').forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (_DROP_TAGS.has(tag)) {
      el.remove();
      return;
    }
    if (tag.includes(':')) {
      const text = el.textContent ?? '';
      if (text.trim() !== '') el.replaceWith(doc.createTextNode(text));
      else el.remove();
    }
  });

  // Pass 2: drop unusable images; clean styles + noise attributes.
  body.querySelectorAll('*').forEach(el => {
    if (el.tagName.toLowerCase() === 'img' && !_imgIsUsable(el)) {
      el.remove();
      return;
    }
    _cleanStyle(el);
    el.removeAttribute('class');
    el.removeAttribute('lang');
  });

  // Pass 3: remove empty block paragraphs (Word's MsoNormal spacers).
  body.querySelectorAll('p, div').forEach(el => {
    if (_isEmptyBlock(el)) el.remove();
  });

  return body.innerHTML.replace(/ /g, ' ');
}
