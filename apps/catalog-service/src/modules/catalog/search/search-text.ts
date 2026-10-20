/**
 * The one folding function for both indexed text and shopper queries. A query folded differently from the index
 * silently misses, so every path that writes or reads a text field goes through here.
 */
export const foldSearchText = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ|Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();

export type EmbeddingTextSource = {
  name: string;
  category?: string | null | undefined;
  activeIngredient?: string | null | undefined;
  indications?: string | null | undefined;
  dosageForm?: string | null | undefined;
};

/** The text a product is embedded from. Lines keep Vietnamese wording so the model reads the same words a shopper types. */
export const buildEmbeddingText = (product: EmbeddingTextSource): string =>
  [
    product.name,
    product.category ? `Danh mục: ${product.category}` : null,
    product.activeIngredient ? `Hoạt chất: ${product.activeIngredient}` : null,
    product.indications ? `Công dụng: ${product.indications}` : null,
    product.dosageForm ? `Dạng bào chế: ${product.dosageForm}` : null,
  ]
    .filter((line): line is string => line !== null && line.trim() !== "")
    .join("\n");
