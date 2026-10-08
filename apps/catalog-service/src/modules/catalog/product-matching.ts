/** Trigram similarity floors the SQL candidate query applies; the ranking below trusts them. */
export const NAME_SIMILARITY_FLOOR = 0.6;
export const INGREDIENT_SIMILARITY_FLOOR = 0.7;

/** Shift applied to a candidate's score when its strength equals (+) or differs from (-) the prescribed one. */
const STRENGTH_ADJUSTMENT = 0.1;

type Strength = { value: number; unit: "mg" | "ml" | "iu" | "%" };

const STRENGTH_PATTERN = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|μg|ug|g|ml|iu|ui|%)(?!\p{L})/giu;

/**
 * Reads every "500 mg" / "1,5g" / "400 IU" in a text. Mass is folded into milligrams so "0.5 g" equals "500 mg";
 * the unit-less pack sizes of a product name ("10X10") never match.
 */
export const parseStrengths = (text: string | null | undefined): Strength[] => {
  if (!text) return [];
  const strengths: Strength[] = [];
  for (const match of text.matchAll(STRENGTH_PATTERN)) {
    const amount = Number((match[1] ?? "").replace(",", "."));
    const unit = (match[2] ?? "").toLowerCase();
    if (!Number.isFinite(amount)) continue;
    if (unit === "g") strengths.push({ value: amount * 1000, unit: "mg" });
    else if (unit === "mg") strengths.push({ value: amount, unit: "mg" });
    else if (unit === "ml" || unit === "%") strengths.push({ value: amount, unit });
    else if (unit === "iu" || unit === "ui") strengths.push({ value: amount, unit: "iu" });
    else strengths.push({ value: amount / 1000, unit: "mg" });
  }
  return strengths;
};

/** The text without its strengths, so "Augmentin 625mg" is looked up as "Augmentin" and the strength is judged apart. */
export const stripStrengths = (text: string | null | undefined): string =>
  (text ?? "").replace(STRENGTH_PATTERN, " ").replace(/\s+/g, " ").trim();

/** `null` when either side states no strength, so a missing value is never reported as a mismatch. */
export const strengthsMatch = (prescribed: Strength[], offered: Strength[]): boolean | null => {
  if (prescribed.length === 0 || offered.length === 0) return null;
  return prescribed.every((wanted) =>
    offered.some((candidate) => candidate.unit === wanted.unit && Math.abs(candidate.value - wanted.value) < 1e-9),
  );
};

export type MatchItem = { name: string | null; activeIngredients: string[]; strength: string | null };

export type MatchCandidate<Product> = {
  product: Product;
  nameScore: number;
  ingredientScore: number;
};

export type RankedMatch<Product> = {
  matchType: "name" | "ingredient";
  strengthMatch: boolean | null;
  score: number;
  product: Product;
};

type StrengthSource = {
  name: string;
  genericName: string | null;
  strength: string | null;
  activeIngredient: string | null;
};

const words = (text: string): string[] =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);

/**
 * Trigram similarity barely notices a one-letter word, so "Vitamin C" scores 0.8 against "Vitamin D3". A short word
 * of what was prescribed therefore has to appear in the product text itself, either as written or with a number
 * after it ("D" in "D3"); the rest of the text is left to the similarity score, which tolerates typos.
 */
const shortWordsPresent = (prescribed: string | null, productText: string): boolean => {
  const productWords = words(productText);
  return words(stripStrengths(prescribed))
    .filter((word) => /^[a-z]{1,2}$/.test(word))
    .every((word) =>
      productWords.some((candidate) => candidate === word || new RegExp(`^${word}\\d+$`).test(candidate)),
    );
};

/**
 * Orders candidates for one prescription line: the better of the name and ingredient similarity, nudged up when
 * the strength is the prescribed one and down when it is not, so the exact tablet always precedes a different
 * strength of the same drug.
 */
export const rankCandidates = <Product extends StrengthSource>(
  item: MatchItem,
  candidates: Array<MatchCandidate<Product>>,
  limit: number,
): Array<RankedMatch<Product>> => {
  const prescribed = parseStrengths(item.strength?.trim() || item.name);
  return candidates
    .map((candidate) => {
      const productText = [
        candidate.product.name,
        candidate.product.genericName,
        candidate.product.activeIngredient,
      ].join(" ");
      return {
        candidate,
        nameScore: shortWordsPresent(item.name, candidate.product.name) ? candidate.nameScore : 0,
        // A generic-only line carries no ingredient list, so its name is what the ingredient columns were compared with.
        ingredientScore: (item.activeIngredients.length > 0 ? item.activeIngredients : [item.name]).every((text) =>
          shortWordsPresent(text, productText),
        )
          ? candidate.ingredientScore
          : 0,
      };
    })
    .filter(
      ({ nameScore, ingredientScore }) =>
        nameScore >= NAME_SIMILARITY_FLOOR || ingredientScore >= INGREDIENT_SIMILARITY_FLOOR,
    )
    .map(({ candidate, nameScore, ingredientScore }) => {
      const offered = [
        ...parseStrengths(candidate.product.strength),
        ...parseStrengths(candidate.product.activeIngredient),
        ...parseStrengths(candidate.product.name),
      ];
      const strengthMatch = strengthsMatch(prescribed, offered);
      const base = Math.max(nameScore, ingredientScore);
      const adjusted =
        base + (strengthMatch === true ? STRENGTH_ADJUSTMENT : strengthMatch === false ? -STRENGTH_ADJUSTMENT : 0);
      return {
        adjusted,
        match: {
          matchType: nameScore >= ingredientScore ? ("name" as const) : ("ingredient" as const),
          strengthMatch,
          score: Math.round(Math.min(Math.max(adjusted, 0), 1) * 100) / 100,
          product: candidate.product,
        },
      };
    })
    .sort((left, right) => right.adjusted - left.adjusted)
    .slice(0, limit)
    .map((entry) => entry.match);
};
