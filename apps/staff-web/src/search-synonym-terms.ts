// Client-side hints for search synonym terms. The catalog service validates the same rules and stays authoritative.
// staff-web cannot import service code, so foldSearchText mirrors catalog-service search-text.ts. It keeps the
// duplicate check in step with the server.
export const foldSearchText = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ|Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();

export const parseSearchSynonymTerms = (raw: string): string[] =>
  raw
    .split(/[\n,]/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);

export const MIN_SYNONYM_TERMS = 2;
export const MAX_SYNONYM_TERMS = 20;
export const MAX_SYNONYM_TERM_LENGTH = 60;

// Returns the first rule the terms break, as an English message for translateText, or undefined when they pass.
export const searchSynonymTermsProblem = (terms: readonly string[]): string | undefined => {
  if (terms.length < MIN_SYNONYM_TERMS || terms.length > MAX_SYNONYM_TERMS) {
    return "Enter 2 to 20 terms.";
  }
  if (terms.some((term) => term.length > MAX_SYNONYM_TERM_LENGTH)) {
    return "Each term must be 60 characters or fewer.";
  }
  if (new Set(terms.map(foldSearchText)).size !== terms.length) {
    return "Terms must differ after ignoring accents and capitals.";
  }
  return undefined;
};
