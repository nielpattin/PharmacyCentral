import { Outlet } from "@tanstack/react-router";

import { useQuery } from "@tanstack/react-query";

import { resolveCustomerSession } from "../customer-api.ts";
import { ChatbotWidget } from "./storefront/ChatbotWidget.tsx";

/**
 * The assistant sits outside the routed page so its conversation survives navigation, e.g. opening a product card.
 * The bottom padding keeps the last content clear of the fixed launcher when the page is scrolled to the end.
 */
export const RootLayout = (): React.JSX.Element => {
  useQuery({ queryKey: ["customer-session"], queryFn: resolveCustomerSession });
  return (
    <>
      <div className="pb-24">
        <Outlet />
      </div>
      <ChatbotWidget />
    </>
  );
};
