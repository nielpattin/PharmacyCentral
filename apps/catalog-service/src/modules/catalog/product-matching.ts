/** Trigram similarity floors the SQL candidate query applies; the ranking below trusts them. */
export const NAME_SIMILARITY_FLOOR = 0.6;
export const INGREDIENT_SIMILARITY_FLOOR = 0.7;

/** Shifts applied to a candidate's score when its strength or dosage form equals (+) or differs from (-) the prescribed one. */
const STRENGTH_ADJUSTMENT = 0.1;
const DOSAGE_FORM_ADJUSTMENT = 0.05;

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

export type MatchItem = {
  name: string | null;
  activeIngredients: string[];
  strength: string | null;
  dosageForm: string | null;
  /** The printed dispensing unit ("Viên", "Gói"), which hints at the dosage form when none is printed. */
  unit: string | null;
};

export type MatchCandidate<Product> = {
  product: Product;
  nameScore: number;
  ingredientScore: number;
};

export type RankedMatch<Product> = {
  matchType: "name" | "ingredient";
  strengthMatch: boolean | null;
  dosageFormMatch: boolean | null;
  ingredientsMatch: boolean | null;
  score: number;
  product: Product;
};

type ComparedProduct = {
  name: string;
  genericName: string | null;
  strength: string | null;
  activeIngredient: string | null;
  dosageForm: string | null;
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

type DosageFamily =
  | "injection"
  | "eye-ear-nose"
  | "inhaled"
  | "topical"
  | "rectal-vaginal"
  | "oral-liquid"
  | "oral-solid";

/**
 * Dosage forms grouped by how the medicine is taken, as accent-folded phrases. Forms of one group stand in for each
 * other (a film-coated tablet for a plain one, an oral powder for a suspension); forms of different groups do not.
 * Groups are tried in order, so "Bột pha tiêm" is an injection and "Bột pha hỗn dịch uống" an oral liquid. Units
 * read the same way: "Viên" is a tablet and "Gói" a sachet, while "Ống" or "Chai" could be either and say nothing.
 */
const DOSAGE_FAMILIES: ReadonlyArray<readonly [DosageFamily, readonly string[]]> = [
  ["injection", ["tiem", "truyen", "injection", "infusion"]],
  ["eye-ear-nose", ["nho mat", "tra mat", "nho tai", "nho mui", "xit mui", "eye drops", "ear drops", "nasal spray"]],
  ["inhaled", ["hit", "khi dung", "inhaler", "inhalation", "nebuliser", "nebulizer"]],
  ["topical", ["dung ngoai", "boi", "kem", "thuoc mo", "dau goi", "cream", "ointment", "lotion", "shampoo"]],
  ["rectal-vaginal", ["dat", "thuoc dan", "suppository", "pessary"]],
  [
    "oral-liquid",
    [
      "siro",
      "hon dich",
      "dung dich uong",
      "nhu dich",
      "ong uong",
      "bot",
      "com",
      "goi",
      "syrup",
      "suspension",
      "powder",
      "granules",
      "sachet",
    ],
  ],
  ["oral-solid", ["vien", "nang", "tablet", "capsule"]],
];

const dosageFamily = (text: string | null): DosageFamily | null => {
  const folded = ` ${words(text ?? "").join(" ")} `;
  return DOSAGE_FAMILIES.find(([, phrases]) => phrases.some((phrase) => folded.includes(` ${phrase} `)))?.[0] ?? null;
};

/** `null` when either side gives no recognisable form, so a missing value is never reported as a mismatch. */
const dosageFormsMatch = (item: MatchItem, offered: string | null): boolean | null => {
  const prescribedFamily = dosageFamily(item.dosageForm) ?? dosageFamily(item.unit);
  const offeredFamily = dosageFamily(offered);
  return prescribedFamily && offeredFamily ? prescribedFamily === offeredFamily : null;
};

/** The ingredients of a composition, "Natri clorid 520mg, Natri citrat 580mg" being two; a decimal comma never splits. */
const compositionParts = (text: string | null): string[] =>
  (text ?? "")
    .split(/,(?!\d)|[+;]/)
    .map(stripStrengths)
    .filter((part) => part.length > 0);

/**
 * Whether the product holds the prescribed ingredients and nothing else. A product listing more ingredients than the
 * line is another medicine, as paracetamol with caffeine is for paracetamol, however similar the texts are. `null`
 * when either side states no composition, or when the similarity cannot confirm every prescribed ingredient.
 */
const ingredientsMatch = (item: MatchItem, ingredientScore: number, composition: string | null): boolean | null => {
  const confirmed = ingredientScore >= INGREDIENT_SIMILARITY_FLOOR;
  // A line printing no ingredient states its composition only when its name reads as one ("Paracetamol 500mg").
  const prescribed = item.activeIngredients.length > 0 ? item.activeIngredients : confirmed ? [item.name ?? ""] : [];
  const prescribedCount = prescribed.flatMap(compositionParts).length;
  const offeredCount = compositionParts(composition).length;
  if (prescribedCount === 0 || offeredCount === 0) return null;
  if (offeredCount > prescribedCount) return false;
  return confirmed ? true : null;
};

const nudge = (match: boolean | null, amount: number): number =>
  match === true ? amount : match === false ? -amount : 0;

/**
 * Orders candidates for one prescription line. A product known to differ from the line in strength, dosage form or
 * composition cannot fill it as written, so it comes after every product that does not; within each group the better
 * of the name and ingredient similarity decides, nudged up for a confirmed strength or dosage form and down for a
 * different one, so the exact tablet always precedes a different strength of the same drug.
 */
export const rankCandidates = <Product extends ComparedProduct>(
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
      // A generic-only line carries no ingredient list, so its name is what the ingredient columns were compared with.
      const similarIngredients = (item.activeIngredients.length > 0 ? item.activeIngredients : [item.name]).every(
        (text) => shortWordsPresent(text, productText),
      )
        ? candidate.ingredientScore
        : 0;
      const composition = ingredientsMatch(item, similarIngredients, candidate.product.activeIngredient);
      return {
        candidate,
        composition,
        nameScore: shortWordsPresent(item.name, candidate.product.name) ? candidate.nameScore : 0,
        // An ingredient the line does not prescribe makes the product another medicine, not the same active ingredient.
        ingredientScore: composition === false ? 0 : similarIngredients,
      };
    })
    .filter(
      ({ nameScore, ingredientScore }) =>
        nameScore >= NAME_SIMILARITY_FLOOR || ingredientScore >= INGREDIENT_SIMILARITY_FLOOR,
    )
    .map(({ candidate, composition, nameScore, ingredientScore }) => {
      const offered = [
        ...parseStrengths(candidate.product.strength),
        ...parseStrengths(candidate.product.activeIngredient),
        ...parseStrengths(candidate.product.name),
      ];
      const strengthMatch = strengthsMatch(prescribed, offered);
      const dosageFormMatch = dosageFormsMatch(item, candidate.product.dosageForm);
      const adjusted =
        Math.max(nameScore, ingredientScore) +
        nudge(strengthMatch, STRENGTH_ADJUSTMENT) +
        nudge(dosageFormMatch, DOSAGE_FORM_ADJUSTMENT);
      return {
        adjusted,
        differs: strengthMatch === false || dosageFormMatch === false || composition === false,
        match: {
          matchType: nameScore >= ingredientScore ? ("name" as const) : ("ingredient" as const),
          strengthMatch,
          dosageFormMatch,
          ingredientsMatch: composition,
          score: Math.round(Math.min(Math.max(adjusted, 0), 1) * 100) / 100,
          product: candidate.product,
        },
      };
    })
    .sort((left, right) => Number(left.differs) - Number(right.differs) || right.adjusted - left.adjusted)
    .slice(0, limit)
    .map((entry) => entry.match);
};
