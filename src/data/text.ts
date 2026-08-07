/**
 * String canonicalization shared by every CSV normalizer in this directory.
 *
 * Kept in its own module (rather than in one normalizer that the others import) so that
 * `normalize.ts` and `normalizeCapabilities.ts` stay siblings with no dependency between them.
 */

/** Trims surrounding whitespace and collapses internal runs to a single space. */
export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Generates a stable, URL-safe slug id from free text. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
