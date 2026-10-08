import { describe, expect, it } from "vitest";

import { parseStrengths, rankCandidates, strengthsMatch, stripStrengths } from "./product-matching.ts";

const product = (
  name: string,
  strength: string | null,
  activeIngredient: string | null = null,
  genericName: string | null = null,
) => ({ name, genericName, strength, activeIngredient });

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
  const item = { name: "Paracetamol 500mg", activeIngredients: ["Paracetamol"], strength: "500mg" };

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
      { name: "Hapacol 650", activeIngredients: ["Paracetamol"], strength: null },
      [{ product: product("PARACETAMOL 500MG", "500 mg"), nameScore: 0.1, ingredientScore: 1 }],
      5,
    );
    expect(byIngredient?.matchType).toBe("ingredient");
  });

  it("does not offer Vitamin D3 for Vitamin C", () => {
    const ranked = rankCandidates(
      { name: "Vitamin C", activeIngredients: [], strength: null },
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
      { name: "Vitamin C 500mg", activeIngredients: ["Vitamin C"], strength: "500mg" },
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
      { name: "Vitamin D", activeIngredients: [], strength: null },
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
});
