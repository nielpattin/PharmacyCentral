import { BusinessRuleError } from "../../../shared/business-rule-error.ts";

export type PriceStatus = "Draft" | "Published" | "Archived";

export type PriceWindow = {
  unitPrice: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: PriceStatus;
};

export const validatePriceWindow = (price: PriceWindow): void => {
  if (!(price.unitPrice > 0)) {
    throw new BusinessRuleError("Unit price must be greater than zero");
  }
  if (!/^[A-Za-z]{3}$/.test(price.currency)) {
    throw new BusinessRuleError("Currency must be a three-letter code");
  }
  if (price.effectiveTo && price.effectiveTo < price.effectiveFrom) {
    throw new BusinessRuleError("Effective end date must not precede start date");
  }
};

export const transitionPrice = (current: PriceStatus, action: "publish" | "archive"): PriceStatus => {
  if (action === "publish" && current !== "Draft") {
    throw new BusinessRuleError("Only Draft prices can be published");
  }
  if (action === "archive" && current === "Archived") {
    throw new BusinessRuleError("Archived prices cannot be archived again");
  }
  return action === "publish" ? "Published" : "Archived";
};
