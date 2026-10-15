const MAX_SLUG_CHARS = 64;
const SIMILARITY_MIN_CHARS = 6;
const SIMILARITY_THRESHOLD = 0.9;

/**
 * Lower-case, `&` becomes `and`, diacritics stripped, every run of characters outside a-z and 0-9 becomes `-`, ends
 * trimmed, cut to 64 characters. An empty result means the concept is dropped.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/g, '');
  return slug;
}

const tokensOf = (slug: string): string[] => slug.split('-').filter((t) => t !== '');

/** Equal, or equal after adding a trailing `s` or `es`. */
function sameToken(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && (long === `${short}s` || long === `${short}es`);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/**
 * Two slugs probably name the same concept when any of these holds: they are equal after allowing a trailing `s` or `es`
 * on each token, their token sets are equal (order does not matter), or their edit similarity is at least 0.90 and both
 * are at least 6 characters long.
 */
export function isProbableDuplicate(slugA: string, slugB: string): boolean {
  if (slugA === '' || slugB === '') return false;
  if (slugA === slugB) return true;
  const a = tokensOf(slugA);
  const b = tokensOf(slugB);

  if (a.length === b.length && a.every((token, i) => sameToken(token, b[i]!))) return true;

  // Same tokens in any order (plural forms allowed).
  if (a.length === b.length) {
    const remaining = [...b];
    const matched = a.every((token) => {
      const index = remaining.findIndex((other) => sameToken(token, other));
      if (index < 0) return false;
      remaining.splice(index, 1);
      return true;
    });
    if (matched) return true;
  }

  if (slugA.length >= SIMILARITY_MIN_CHARS && slugB.length >= SIMILARITY_MIN_CHARS) {
    const longest = Math.max(slugA.length, slugB.length);
    return 1 - editDistance(slugA, slugB) / longest >= SIMILARITY_THRESHOLD;
  }
  return false;
}
