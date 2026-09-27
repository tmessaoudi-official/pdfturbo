/**
 * Glyph names to Unicode, for an embedded SIMPLE font that carries no /ToUnicode (limits row 39).
 *
 * Such a font's codes are read through its /Encoding: a base encoding (only /WinAnsiEncoding here) plus
 * /Differences, whose entries are glyph NAMES. A name becomes text by the Adobe Glyph List rules, applied
 * to a deliberately small table: every name the WinAnsi and Symbol encodings use (generated from
 * @cantoo/pdf-lib's standard-fonts package, MIT; `tests/utils/glyphNames.test.ts` checks it still matches)
 * plus the extras the 15-file corpus draws with (ligatures, dotless i, L-slash, the spacing accents).
 * A name outside the table and the rules is UNKNOWN, and the caller fails closed on it: a wrong character
 * in the editor would be written back as the wrong glyph.
 *
 * WIN_ANSI_NAMES is PDF 32000 Annex D's WinAnsiEncoding by code, taken from pdf.js (Apache-2.0), with the
 * six codes the Annex leaves undefined (0x7F 0x81 0x8D 0x8F 0x90 0x9D) blank: pdf.js draws them as bullets,
 * but no producer writes them to mean text. It is not cp1252: 0xA0 is `space` and 0xAD is `hyphen`.
 */

const NAMES: Record<string, number> = {
  A: 0x0041, AE: 0x00c6, Aacute: 0x00c1, Acircumflex: 0x00c2, Adieresis: 0x00c4, Agrave: 0x00c0,
  Alpha: 0x0391, Aring: 0x00c5, Atilde: 0x00c3, B: 0x0042, Beta: 0x0392, C: 0x0043,
  Ccedilla: 0x00c7, Chi: 0x03a7, D: 0x0044, Delta: 0x0394, E: 0x0045, Eacute: 0x00c9,
  Ecircumflex: 0x00ca, Edieresis: 0x00cb, Egrave: 0x00c8, Epsilon: 0x0395, Eta: 0x0397, Eth: 0x00d0,
  Euro: 0x20ac, F: 0x0046, G: 0x0047, Gamma: 0x0393, H: 0x0048, I: 0x0049,
  Iacute: 0x00cd, Icircumflex: 0x00ce, Idieresis: 0x00cf, Ifraktur: 0x2111, Igrave: 0x00cc, Iota: 0x0399,
  J: 0x004a, K: 0x004b, Kappa: 0x039a, L: 0x004c, Lambda: 0x039b, M: 0x004d,
  Mu: 0x039c, N: 0x004e, Ntilde: 0x00d1, Nu: 0x039d, O: 0x004f, OE: 0x0152,
  Oacute: 0x00d3, Ocircumflex: 0x00d4, Odieresis: 0x00d6, Ograve: 0x00d2, Omega: 0x03a9, Omicron: 0x039f,
  Oslash: 0x00d8, Otilde: 0x00d5, P: 0x0050, Phi: 0x03a6, Pi: 0x03a0, Psi: 0x03a8,
  Q: 0x0051, R: 0x0052, Rfraktur: 0x211c, Rho: 0x03a1, S: 0x0053, Scaron: 0x0160,
  Sigma: 0x03a3, T: 0x0054, Tau: 0x03a4, Theta: 0x0398, Thorn: 0x00de, U: 0x0055,
  Uacute: 0x00da, Ucircumflex: 0x00db, Udieresis: 0x00dc, Ugrave: 0x00d9, Upsilon: 0x03a5, Upsilon1: 0x03d2,
  V: 0x0056, W: 0x0057, X: 0x0058, Xi: 0x039e, Y: 0x0059, Yacute: 0x00dd,
  Z: 0x005a, Zcaron: 0x017d, Zeta: 0x0396, a: 0x0061, aacute: 0x00e1, acircumflex: 0x00e2,
  acute: 0x00b4, adieresis: 0x00e4, ae: 0x00e6, agrave: 0x00e0, aleph: 0x2135, alpha: 0x03b1,
  ampersand: 0x0026, angle: 0x2220, angleleft: 0x2329, angleright: 0x232a, approxequal: 0x2248, aring: 0x00e5,
  arrowboth: 0x2194, arrowdblboth: 0x21d4, arrowdbldown: 0x21d3, arrowdblleft: 0x21d0, arrowdblright: 0x21d2, arrowdblup: 0x21d1,
  arrowdown: 0x2193, arrowhorizex: 0xf8e7, arrowleft: 0x2190, arrowright: 0x2192, arrowup: 0x2191, arrowvertex: 0xf8e6,
  asciicircum: 0x005e, asciitilde: 0x007e, asterisk: 0x002a, asteriskmath: 0x2217, at: 0x0040, atilde: 0x00e3,
  b: 0x0062, backslash: 0x005c, bar: 0x007c, beta: 0x03b2, braceex: 0xf8f4, braceleft: 0x007b,
  braceleftbt: 0xf8f3, braceleftmid: 0xf8f2, bracelefttp: 0xf8f1, braceright: 0x007d, bracerightbt: 0xf8fe, bracerightmid: 0xf8fd,
  bracerighttp: 0xf8fc, bracketleft: 0x005b, bracketleftbt: 0xf8f0, bracketleftex: 0xf8ef, bracketlefttp: 0xf8ee, bracketright: 0x005d,
  bracketrightbt: 0xf8fb, bracketrightex: 0xf8fa, bracketrighttp: 0xf8f9, brokenbar: 0x00a6, bullet: 0x2022, c: 0x0063,
  carriagereturn: 0x21b5, ccedilla: 0x00e7, cedilla: 0x00b8, cent: 0x00a2, chi: 0x03c7, circlemultiply: 0x2297,
  circleplus: 0x2295, circumflex: 0x02c6, club: 0x2663, colon: 0x003a, comma: 0x002c, congruent: 0x2245,
  copyright: 0x00a9, copyrightsans: 0xf8e9, copyrightserif: 0xf6d9, currency: 0x00a4, d: 0x0064, dagger: 0x2020,
  daggerdbl: 0x2021, degree: 0x00b0, delta: 0x03b4, diamond: 0x2666, dieresis: 0x00a8, divide: 0x00f7,
  dollar: 0x0024, dotmath: 0x22c5, e: 0x0065, eacute: 0x00e9, ecircumflex: 0x00ea, edieresis: 0x00eb,
  egrave: 0x00e8, eight: 0x0038, element: 0x2208, ellipsis: 0x2026, emdash: 0x2014, emptyset: 0x2205,
  endash: 0x2013, epsilon: 0x03b5, equal: 0x003d, equivalence: 0x2261, eta: 0x03b7, eth: 0x00f0,
  exclam: 0x0021, exclamdown: 0x00a1, existential: 0x2203, f: 0x0066, five: 0x0035, florin: 0x0192,
  four: 0x0034, fraction: 0x2044, g: 0x0067, gamma: 0x03b3, germandbls: 0x00df, gradient: 0x2207,
  grave: 0x0060, greater: 0x003e, greaterequal: 0x2265, guillemotleft: 0x00ab, guillemotright: 0x00bb, guilsinglleft: 0x2039,
  guilsinglright: 0x203a, h: 0x0068, heart: 0x2665, hyphen: 0x002d, i: 0x0069, iacute: 0x00ed,
  icircumflex: 0x00ee, idieresis: 0x00ef, igrave: 0x00ec, infinity: 0x221e, integral: 0x222b, integralbt: 0x2321,
  integralex: 0xf8f5, integraltp: 0x2320, intersection: 0x2229, iota: 0x03b9, j: 0x006a, k: 0x006b,
  kappa: 0x03ba, l: 0x006c, lambda: 0x03bb, less: 0x003c, lessequal: 0x2264, logicaland: 0x2227,
  logicalnot: 0x00ac, logicalor: 0x2228, lozenge: 0x25ca, m: 0x006d, macron: 0x00af, minus: 0x2212,
  minute: 0x2032, mu: 0x00b5, multiply: 0x00d7, n: 0x006e, nine: 0x0039, notelement: 0x2209,
  notequal: 0x2260, notsubset: 0x2284, ntilde: 0x00f1, nu: 0x03bd, numbersign: 0x0023, o: 0x006f,
  oacute: 0x00f3, ocircumflex: 0x00f4, odieresis: 0x00f6, oe: 0x0153, ograve: 0x00f2, omega: 0x03c9,
  omega1: 0x03d6, omicron: 0x03bf, one: 0x0031, onehalf: 0x00bd, onequarter: 0x00bc, onesuperior: 0x00b9,
  ordfeminine: 0x00aa, ordmasculine: 0x00ba, oslash: 0x00f8, otilde: 0x00f5, p: 0x0070, paragraph: 0x00b6,
  parenleft: 0x0028, parenleftbt: 0xf8ed, parenleftex: 0xf8ec, parenlefttp: 0xf8eb, parenright: 0x0029, parenrightbt: 0xf8f8,
  parenrightex: 0xf8f7, parenrighttp: 0xf8f6, partialdiff: 0x2202, percent: 0x0025, period: 0x002e, periodcentered: 0x00b7,
  perpendicular: 0x22a5, perthousand: 0x2030, phi: 0x03c6, phi1: 0x03d5, pi: 0x03c0, plus: 0x002b,
  plusminus: 0x00b1, product: 0x220f, propersubset: 0x2282, propersuperset: 0x2283, proportional: 0x221d, psi: 0x03c8,
  q: 0x0071, question: 0x003f, questiondown: 0x00bf, quotedbl: 0x0022, quotedblbase: 0x201e, quotedblleft: 0x201c,
  quotedblright: 0x201d, quoteleft: 0x2018, quoteright: 0x2019, quotesinglbase: 0x201a, quotesingle: 0x0027, r: 0x0072,
  radical: 0x221a, radicalex: 0xf8e5, reflexsubset: 0x2286, reflexsuperset: 0x2287, registered: 0x00ae, registersans: 0xf8e8,
  registerserif: 0xf6da, rho: 0x03c1, s: 0x0073, scaron: 0x0161, second: 0x2033, section: 0x00a7,
  semicolon: 0x003b, seven: 0x0037, sigma: 0x03c3, sigma1: 0x03c2, similar: 0x223c, six: 0x0036,
  slash: 0x002f, space: 0x0020, spade: 0x2660, sterling: 0x00a3, suchthat: 0x220b, summation: 0x2211,
  t: 0x0074, tau: 0x03c4, therefore: 0x2234, theta: 0x03b8, theta1: 0x03d1, thorn: 0x00fe,
  three: 0x0033, threequarters: 0x00be, threesuperior: 0x00b3, tilde: 0x02dc, trademark: 0x2122, trademarksans: 0xf8ea,
  trademarkserif: 0xf6db, two: 0x0032, twosuperior: 0x00b2, u: 0x0075, uacute: 0x00fa, ucircumflex: 0x00fb,
  udieresis: 0x00fc, ugrave: 0x00f9, underscore: 0x005f, union: 0x222a, universal: 0x2200, upsilon: 0x03c5,
  v: 0x0076, w: 0x0077, weierstrass: 0x2118, x: 0x0078, xi: 0x03be, y: 0x0079,
  yacute: 0x00fd, ydieresis: 0x00ff, yen: 0x00a5, z: 0x007a, zcaron: 0x017e, zero: 0x0030,
  zeta: 0x03b6,
};

/** Names the WinAnsi/Symbol tables lack but the corpus's pdfTeX and Type1C fonts draw with. */
const EXTRA_NAMES: Record<string, number> = {
  Ydieresis: 0x0178, dotlessi: 0x0131, Lslash: 0x0141, lslash: 0x0142,
  breve: 0x02d8, caron: 0x02c7, dotaccent: 0x02d9, hungarumlaut: 0x02dd, ogonek: 0x02db, ring: 0x02da,
};

/** A ligature name reads as its letters, as pdf.js's text layer normalises it. */
const LIGATURES: Record<string, string> = { ff: 'ff', fi: 'fi', fl: 'fl', ffi: 'ffi', ffl: 'ffl' };

export const WIN_ANSI_NAMES: readonly string[] = [
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
  "space", "exclam", "quotedbl", "numbersign", "dollar", "percent", "ampersand", "quotesingle", "parenleft", "parenright", "asterisk", "plus", "comma", "hyphen", "period", "slash",
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "colon", "semicolon", "less", "equal", "greater", "question",
  "at", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
  "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "bracketleft", "backslash", "bracketright", "asciicircum", "underscore",
  "grave", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
  "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "braceleft", "bar", "braceright", "asciitilde", "",
  "Euro", "", "quotesinglbase", "florin", "quotedblbase", "ellipsis", "dagger", "daggerdbl", "circumflex", "perthousand", "Scaron", "guilsinglleft", "OE", "", "Zcaron", "",
  "", "quoteleft", "quoteright", "quotedblleft", "quotedblright", "bullet", "endash", "emdash", "tilde", "trademark", "scaron", "guilsinglright", "oe", "", "zcaron", "Ydieresis",
  "space", "exclamdown", "cent", "sterling", "currency", "yen", "brokenbar", "section", "dieresis", "copyright", "ordfeminine", "guillemotleft", "logicalnot", "hyphen", "registered", "macron",
  "degree", "plusminus", "twosuperior", "threesuperior", "acute", "mu", "paragraph", "periodcentered", "cedilla", "onesuperior", "ordmasculine", "guillemotright", "onequarter", "onehalf", "threequarters", "questiondown",
  "Agrave", "Aacute", "Acircumflex", "Atilde", "Adieresis", "Aring", "AE", "Ccedilla", "Egrave", "Eacute", "Ecircumflex", "Edieresis", "Igrave", "Iacute", "Icircumflex", "Idieresis",
  "Eth", "Ntilde", "Ograve", "Oacute", "Ocircumflex", "Otilde", "Odieresis", "multiply", "Oslash", "Ugrave", "Uacute", "Ucircumflex", "Udieresis", "Yacute", "Thorn", "germandbls",
  "agrave", "aacute", "acircumflex", "atilde", "adieresis", "aring", "ae", "ccedilla", "egrave", "eacute", "ecircumflex", "edieresis", "igrave", "iacute", "icircumflex", "idieresis",
  "eth", "ntilde", "ograve", "oacute", "ocircumflex", "otilde", "odieresis", "divide", "oslash", "ugrave", "uacute", "ucircumflex", "udieresis", "yacute", "thorn", "ydieresis",
];

function component(name: string): string | null {
  if (name in LIGATURES) return LIGATURES[name];
  const known = NAMES[name] ?? EXTRA_NAMES[name];
  if (known !== undefined) return String.fromCodePoint(known);
  // AGL: uniXXXX[XXXX...], BMP values in groups of four, surrogates excluded.
  let m = /^uni((?:[0-9A-F]{4})+)$/.exec(name);
  if (m) {
    let out = '';
    for (let i = 0; i < m[1].length; i += 4) {
      const cp = parseInt(m[1].slice(i, i + 4), 16);
      if (cp >= 0xd800 && cp <= 0xdfff) return null;
      out += String.fromCodePoint(cp);
    }
    return out;
  }
  // AGL: uXXXX to uXXXXXX, one code point.
  m = /^u([0-9A-F]{4,6})$/.exec(name);
  if (m) {
    const cp = parseInt(m[1], 16);
    return (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff ? null : String.fromCodePoint(cp);
  }
  return null;
}

/**
 * The text a glyph name stands for, or null when the name is unknown. AGL rules: drop everything from the
 * first period (`one.tab` is `one`), then read each `_`-separated component (`f_f_i` is `ffi`). `.notdef`
 * and an empty name are unknown.
 */
export function glyphNameToUnicode(name: string): string | null {
  const base = name.split('.')[0];
  if (!base) return null;
  let out = '';
  for (const part of base.split('_')) {
    const text = component(part);
    if (text === null) return null;
    out += text;
  }
  return out;
}

/** The generated name table, exported only so its test can compare it with the package it came from. */
export const GLYPH_NAME_TABLE: Readonly<Record<string, number>> = NAMES;
