import { categoryLabel, type CategoryOption } from "./catalog.ts";

/** Top-level menu groups, mirroring how a pharmacy counter groups its shelves. Keys are labels, values are
    the catalog category values inside each group; insertion order is the menu order. */
const NAV_GROUPS: Record<string, string[]> = {
  Thuốc: ["Medicine", "Allergy relief", "Cardiovascular care", "Diabetes care", "Digestive health", "Respiratory care"],
  "Thực phẩm chức năng": ["Supplement", "Vitamin and supplement"],
  "Dược mỹ phẩm": ["Cosmetic"],
  "Chăm sóc cá nhân": ["Personal care", "Family planning"],
  "Thiết bị y tế": ["Medical device", "Medical supply", "Wound care"],
  "Chăm sóc tại nhà": ["Home care"],
};

export type CategoryPage = {
  slug: string;
  label: string;
  /** Category values whose products the page lists. */
  categories: string[];
  /** Sub-categories, each with its own page, shown in the menu dropdown and as tiles. */
  children: CategoryPage[];
};

export const categorySlug = (label: string): string =>
  label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/** Builds the menu tree from the categories the catalog actually carries, so empty groups stay hidden. */
export const buildCategoryPages = (categories: CategoryOption[]): CategoryPage[] => {
  const present = new Set(categories.map((category) => category.value));

  return Object.entries(NAV_GROUPS).flatMap(([label, group]) => {
    const members = group.filter((value) => present.has(value));
    if (members.length === 0) return [];
    return [
      {
        slug: categorySlug(label),
        label,
        categories: members,
        // The member a group is named after is the group page itself; the rest get their own pages.
        children: members
          .filter((value) => categoryLabel(value) !== label)
          .map((value) => ({
            slug: categorySlug(categoryLabel(value)),
            label: categoryLabel(value),
            categories: [value],
            children: [],
          })),
      },
    ];
  });
};
