import { describe, expect, it } from "vitest";

import { parseStrengths, rankCandidates, strengthsMatch, stripStrengths, type MatchItem } from "./product-matching.ts";

const product = (
  name: string,
  strength: string | null,
  activeIngredient: string | null = null,
  genericName: string | null = null,
  dosageForm: string | null = null,
) => ({ name, genericName, strength, activeIngredient, dosageForm });

const line = (fields: Partial<MatchItem> & Pick<MatchItem, "name">): MatchItem => ({
  activeIngredients: [],
  strength: null,
  dosageForm: null,
  unit: null,
  ...fields,
});

describe("strengths", () => {
  it("folds grams into milligrams and reads decimal commas", () => {
    expect(parseStrengths("Paracetamol 0,5 g")).toEqual([{ value: 500, unit: "mg" }]);
    expect(parseStrengths("Amoxicillin 500mg + Acid clavulanic 125 mg")).toEqual([
      { value: 500, unit: "mg" },
      { value: 125, unit: "mg" },
    ]);
  });

  it("ignores pack sizes and unit-less numbers", () => {
    expect(parseStrengths("PARACETAMOL QUANG BÌNH 10X10")).toEqual([]);
  });

  it("reports an unknown strength as null, never as a mismatch", () => {
    expect(strengthsMatch(parseStrengths("500mg"), [])).toBeNull();
    expect(strengthsMatch(parseStrengths("500mg"), parseStrengths("650mg"))).toBe(false);
    expect(strengthsMatch(parseStrengths("500mg"), parseStrengths("0.5g"))).toBe(true);
  });

  it("removes strengths so a brand name is looked up on its own", () => {
    expect(stripStrengths("Augmentin 625mg")).toBe("Augmentin");
  });
});

describe("rankCandidates", () => {
  const item = line({ name: "Paracetamol 500mg", activeIngredients: ["Paracetamol"], strength: "500mg" });

  it("puts the prescribed strength ahead of another strength of the same drug", () => {
    const ranked = rankCandidates(
      item,
      [
        { product: product("PARACETAMOL 650MG", "650 mg"), nameScore: 1, ingredientScore: 1 },
        { product: product("PARACETAMOL 500MG", "500 mg"), nameScore: 1, ingredientScore: 1 },
      ],
      5,
    );
    expect(ranked.map((match) => match.product.name)).toEqual(["PARACETAMOL 500MG", "PARACETAMOL 650MG"]);
    expect(ranked.map((match) => match.strengthMatch)).toEqual([true, false]);
  });

  it("labels a match by whichever of name and ingredient fits better", () => {
    const [byIngredient] = rankCandidates(
      line({ name: "Hapacol 650", activeIngredients: ["Paracetamol"] }),
      [{ product: product("PARACETAMOL 500MG", "500 mg"), nameScore: 0.1, ingredientScore: 1 }],
      5,
    );
    expect(byIngredient?.matchType).toBe("ingredient");
  });

  it("does not offer Vitamin D3 for Vitamin C", () => {
    const ranked = rankCandidates(
      line({ name: "Vitamin C" }),
      [
        { product: product("CALCIUM SANDOZ 600+VITAMIN D3", null), nameScore: 0.8, ingredientScore: 0 },
        { product: product("VITAMIN C 500MG KHAPHARCO", "500 mg"), nameScore: 1, ingredientScore: 0 },
      ],
      5,
    );
    expect(ranked.map((match) => match.product.name)).toEqual(["VITAMIN C 500MG KHAPHARCO"]);
  });

  it("applies the same short-word check to the ingredient match", () => {
    const ranked = rankCandidates(
      line({ name: "Vitamin C 500mg", activeIngredients: ["Vitamin C"], strength: "500mg" }),
      [
        {
          product: product(
            "CALCIUM SANDOZ 600+VITAMIN D3",
            null,
            "Calcium 600 mg, vitamin D3 400 IU",
            "Calcium and vitamin D3",
          ),
          nameScore: 0.2,
          ingredientScore: 0.8,
        },
        {
          product: product("ASCORBIC TABLET", "500 mg", "Vitamin C 500mg", "Vitamin C"),
          nameScore: 0.2,
          ingredientScore: 1,
        },
      ],
      5,
    );
    expect(ranked.map((match) => match.product.name)).toEqual(["ASCORBIC TABLET"]);
    expect(ranked[0]?.matchType).toBe("ingredient");
  });

  it("accepts a lettered product line for a bare letter, as Vitamin D for Vitamin D3", () => {
    const ranked = rankCandidates(
      line({ name: "Vitamin D" }),
      [{ product: product("VITAMIN D3 400IU", null), nameScore: 0.9, ingredientScore: 0 }],
      5,
    );
    expect(ranked).toHaveLength(1);
  });

  it("caps the answer at the requested limit", () => {
    const candidates = ["A", "B", "C"].map((suffix) => ({
      product: product(`PARACETAMOL ${suffix}`, null),
      nameScore: 0.9,
      ingredientScore: 0.9,
    }));
    expect(rankCandidates(item, candidates, 2)).toHaveLength(2);
  });

  it("puts a product of another dosage form after every product taken as prescribed", () => {
    const ranked = rankCandidates(
      line({ name: "Paracetamol 250mg", activeIngredients: ["Paracetamol"], strength: "250mg", unit: "Gói" }),
      [
        {
          product: product("PARACETAMOL 250MG VIÊN", "250 mg", "Paracetamol 250mg", "Paracetamol", "Viên nén"),
          nameScore: 1,
          ingredientScore: 1,
        },
        {
          product: product("HAPACOL 250 BỘT SỦI", "250 mg", "Paracetamol 250mg", "Paracetamol", "Thuốc bột sủi bọt"),
          nameScore: 0.2,
          ingredientScore: 0.8,
        },
      ],
      5,
    );
    expect(ranked.map((match) => [match.product.name, match.dosageFormMatch])).toEqual([
      ["HAPACOL 250 BỘT SỦI", true],
      ["PARACETAMOL 250MG VIÊN", false],
    ]);
  });

  it("lets a printed dosage form outrank the unit, and reads nothing from a unit that fits several forms", () => {
    const syrup = product("PARACETAMOL SIRO 120MG/5ML", null, "Paracetamol", "Paracetamol", "Siro");
    const [printed] = rankCandidates(
      line({ name: "Paracetamol", dosageForm: "Siro", unit: "Chai" }),
      [{ product: syrup, nameScore: 1, ingredientScore: 1 }],
      5,
    );
    const [ampoule] = rankCandidates(
      line({ name: "Enterogermina", unit: "Ống" }),
      [{ product: product("ENTEROGERMINA", null, null, null, "Hỗn dịch"), nameScore: 1, ingredientScore: 0 }],
      5,
    );
    expect(printed?.dosageFormMatch).toBe(true);
    expect(ampoule?.dosageFormMatch).toBeNull();
  });

  it("does not offer a product with an extra ingredient as the same active ingredient", () => {
    const ranked = rankCandidates(
      line({ name: "Hapacol 500", activeIngredients: ["Paracetamol"] }),
      [
        {
          product: product("PANADOL EXTRA", null, "Paracetamol 500mg, Caffeine 65mg", "Paracetamol and caffeine"),
          nameScore: 0.2,
          ingredientScore: 1,
        },
      ],
      5,
    );
    expect(ranked).toEqual([]);
  });

  it("flags a name match whose composition has more than was prescribed and ranks it after the exact product", () => {
    const ranked = rankCandidates(
      line({ name: "Panadol", activeIngredients: ["Paracetamol"] }),
      [
        {
          product: product("PANADOL EXTRA", null, "Paracetamol 500mg, Caffeine 65mg"),
          nameScore: 1,
          ingredientScore: 1,
        },
        { product: product("PARACETAMOL 500MG", null, "Paracetamol 500mg"), nameScore: 0.3, ingredientScore: 0.9 },
      ],
      5,
    );
    expect(ranked.map((match) => [match.product.name, match.ingredientsMatch])).toEqual([
      ["PARACETAMOL 500MG", true],
      ["PANADOL EXTRA", false],
    ]);
  });

  it("confirms a combination holding every prescribed ingredient, never splitting a decimal comma", () => {
    const [oresol] = rankCandidates(
      line({ name: "Oresol 245", activeIngredients: ["Natri clorid", "Natri citrat", "Kali clorid", "Glucose"] }),
      [
        {
          product: product(
            "ORESOL 245",
            null,
            "Natri clorid 520mg, Natri citrat 580mg, Glucose 2,7g, Kali clorid 300mg",
          ),
          nameScore: 1,
          ingredientScore: 0.9,
        },
      ],
      5,
    );
    expect(oresol?.ingredientsMatch).toBe(true);
  });

  it("ranks a closer name of another strength after a looser match that differs in nothing", () => {
    const ranked = rankCandidates(
      line({ name: "Hapacol 500mg", activeIngredients: ["Paracetamol"], strength: "500mg" }),
      [
        { product: product("HAPACOL 650", "650 mg", "Paracetamol 650mg"), nameScore: 1, ingredientScore: 1 },
        { product: product("PARACETAMOL 500MG", "500 mg", "Paracetamol 500mg"), nameScore: 0.2, ingredientScore: 0.75 },
      ],
      5,
    );
    expect(ranked.map((match) => match.product.name)).toEqual(["PARACETAMOL 500MG", "HAPACOL 650"]);
  });
});
