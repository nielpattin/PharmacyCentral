import type { Section } from "../../router.ts";
import { canAccessSection } from "../../permissions/section-access.ts";
import type { ActionPlanSourceType } from "./contract.ts";

/**
 * What the owner of a plan does about it, and the page where the work happens. The text is the English literal,
 * translated where it is shown. `section` is a page every role that can own a plan may open, except the price warning:
 * only a Pharmacy Manager sets a price, and the text says so.
 */
export const PLAN_NEXT_STEPS: Record<ActionPlanSourceType, { text: string; section: Section; pageLabel: string }> = {
  replenishment: {
    text: "Check the stock and request more of this product.",
    section: "replenishment",
    pageLabel: "Replenishment",
  },
  expiry: {
    text: "Deal with this batch before it expires: sell it first, move it to another site or have it written off.",
    section: "inventory",
    pageLabel: "Inventory",
  },
  dead_stock: {
    text: "This stock has not moved for a long time: review it, then move it, discount it or return it to the supplier.",
    section: "inventory",
    pageLabel: "Inventory",
  },
  price_warning: {
    text: "This product has stock but no published price. Only a Pharmacy Manager can set the price.",
    section: "pricing",
    pageLabel: "Prices",
  },
};

/** The page to open for a plan, or undefined when the viewer's roles may not open it. */
export const nextStepSection = (sourceType: ActionPlanSourceType, roles: readonly string[]): Section | undefined => {
  const { section } = PLAN_NEXT_STEPS[sourceType];
  return canAccessSection(section, roles) ? section : undefined;
};
