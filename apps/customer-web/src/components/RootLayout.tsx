import { Outlet } from "@tanstack/react-router";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { currentSession, useSession } from "../auth.ts";
import { endCustomerSessionAfter401, resolveCustomerSession, setSessionEndedListener } from "../customer-api.ts";
import { useMountEffect } from "../hooks/useMountEffect.ts";
import { cartQueryKey, checkoutQueryKey } from "../storefront/cart-cache.ts";
import { GUEST_CART_STORAGE_KEY } from "../storefront/guest-cart.ts";
import { SessionEndedDialog } from "./account/SessionEndedDialog.tsx";
import { ChatbotWidget } from "./storefront/ChatbotWidget.tsx";

/**
 * The assistant sits outside the routed page so its conversation survives navigation, e.g. opening a product card.
 * The bottom padding keeps the last content clear of the fixed launcher when the page is scrolled to the end.
 */
export const RootLayout = (): React.JSX.Element => {
  const queryClient = useQueryClient();
  const session = useSession();
  useQuery({ queryKey: ["customer-session"], queryFn: resolveCustomerSession });
  // A 401 from a service route ends the session: every shopper query goes, so the next
  // shopper on this browser sees none of this one's data. The session probe stays, or the notice would be lost.
  useMountEffect(() => {
    setSessionEndedListener(() => {
      if (!currentSession().authenticated) return;
      endCustomerSessionAfter401();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "customer-session" });
    });
    return () => setSessionEndedListener(undefined);
  });
  // Another tab changed the signed-out cart. Only that key matters here: other storage changes leave the carts alone.
  useMountEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== GUEST_CART_STORAGE_KEY) return;
      void queryClient.invalidateQueries({ queryKey: cartQueryKey });
      void queryClient.invalidateQueries({ queryKey: checkoutQueryKey });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  });
  return (
    <>
      <div className="pb-24">
        <Outlet />
      </div>
      {/* Keyed on the shopper, so signing out or into another account starts with an empty assistant. */}
      <ChatbotWidget key={session.userId ?? "signed-out"} />
      <SessionEndedDialog />
    </>
  );
};
