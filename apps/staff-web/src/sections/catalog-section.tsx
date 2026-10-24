import { PricingPage } from "./catalog/pricing-page.tsx";
import { ProductsPage } from "./catalog/products-page.tsx";
import { UnitsPage } from "./catalog/units-page.tsx";

// Each route owns one catalog page, so the list and its drawers mount per route (App keys the section by route).
export type CatalogPage = "products" | "units" | "pricing";

export const CatalogSection = ({ kind }: { kind: CatalogPage }): React.JSX.Element => {
  switch (kind) {
    case "products":
      return <ProductsPage />;
    case "units":
      return <UnitsPage />;
    case "pricing":
      return <PricingPage />;
  }
};
