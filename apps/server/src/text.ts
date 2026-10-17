// House style: no em dashes, en dashes or hyphens in anything a family reads.
// Every string from the director or from a user passes through here first.

const HYPHEN_LIKE = /[\u2010\u2011]/g;
const DASH_LIKE = /[\u2012-\u2015\u2212\u2E3A\u2E3B\uFE58\uFE63\uFF0D]/g;
const EM = '\u2014';

export function sanitizeUserText(input: string): string {
  let text = input.normalize('NFC').replace(HYPHEN_LIKE, '-').replace(DASH_LIKE, EM);

  text = text.replace(/-{2,}/g, EM);
  // Numeric ranges read better as words: "ages 3-5" becomes "ages 3 to 5".
  text = text.replace(/(\d)\s*[-\u2014]\s*(?=\d)/g, '$1 to ');
  // A hyphen with space on either side is being used as a dash.
  text = text.replace(/(^|\s)-+(?=\s|$)|(\s)-+(?=\S)|(\S)-+(?=\s)/g, (_match, a = '', b = '', c = '') => `${a}${b}${c} ${EM} `);
  // Whatever hyphens remain join words ("half-dragon"), so split them.
  text = text.replace(/(\S)-+(?=\S)/g, '$1 ');
  text = text.replace(/-/g, ' ');

  text = joinDashSegments(text.split(/\s*\u2014+\s*/));

  return tidyPunctuation(text);
}

function joinDashSegments(parts: string[]): string {
  let out = '';
  for (const raw of parts) {
    const next = raw.trim();
    if (!next) continue;
    if (!out) {
      out = next;
      continue;
    }
    if (/[.,;:!?\u2026]["'\u201D\u2019)]*$/.test(out) || /^[.,;:!?]/.test(next)) {
      out = `${out} ${next}`;
      continue;
    }
    const clause = out.split(/[.!?,;:]/).pop()?.trim() ?? '';
    const words = clause ? clause.split(/\s+/).length : 0;
    const startsSentence = /^["'\u201C\u2018]?[A-Z]/.test(next) && !/^I\b/.test(next);
    out += startsSentence && words >= 3 ? `. ${next}` : `, ${next}`;
  }
  return out;
}

function tidyPunctuation(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])\s*([,.;:!?])/g, '$2')
    .replace(/([.!?])\s*,/g, '$1')
    .replace(/,(?=[A-Za-z])/g, ', ')
    .replace(/^[\s,.;:]+/, '')
    .trim();
}

export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,.;:!?]+$/, '')}\u2026`;
}

export function hasDash(text: string): boolean {
  return /[-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/.test(text);
}

export function titleCase(text: string): string {
  const small = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return text
    .split(' ')
    .filter(Boolean)
    .map((word, i) => (i > 0 && small.has(word.toLowerCase()) ? word.toLowerCase() : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ');
}

export function provisionalTitle(prompt: string): string {
  const words = sanitizeUserText(prompt)
    .replace(/[^\p{L}\p{N}' ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  return words.length ? titleCase(words.join(' ')) : 'A New Story';
}

export function lowerFirst(text: string): string {
  return text ? text[0]!.toLowerCase() + text.slice(1) : text;
}
