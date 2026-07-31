/**
 * Locale-aware tokenizer.
 *
 * Turkish needs special care: `I`.toLowerCase() is `i` in English but `ı` in
 * Turkish, and users routinely type ASCII (`cocuk`) when searching for `çocuk`.
 * We therefore lowercase with the active locale *and* fold diacritics so both
 * spellings hit the same token.
 */
const FOLD_MAP: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  i̇: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
  é: 'e',
  è: 'e',
  á: 'a',
  ñ: 'n',
};

export function foldText(value: string, language = 'en'): string {
  const lowered = value.toLocaleLowerCase(language === 'tr' ? 'tr' : language);
  let out = '';
  for (const char of lowered.normalize('NFC')) {
    out += FOLD_MAP[char] ?? char;
  }
  return out;
}

export function tokenize(value: string, language = 'en'): string[] {
  return foldText(value, language)
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter(token => token.length > 0);
}

/** True when `token` starts with `query` (prefix matching) or contains it. */
export function tokenMatches(token: string, query: string): 'prefix' | 'contains' | null {
  if (token === query || token.startsWith(query)) return 'prefix';
  if (query.length >= 3 && token.includes(query)) return 'contains';
  return null;
}
