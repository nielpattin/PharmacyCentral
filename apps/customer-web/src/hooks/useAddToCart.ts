import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { addCartLine, setCartSelection } from "../customer-api.ts";
import { writeCart } from "../storefront/cart-cache.ts";

type AddToCartInput = {
  productId: string;
  productUnitId: string;
  quantity: number;
  /** Only used for the confirmation message shown to the shopper. */
  productName: string;
  /** Tick the line once it is in the cart, for a shopper who means to order it now ("Mua ngay"). */
  selectAfterAdding?: boolean;
};

type Feedback = { kind: "notice" | "error"; message: string };

/** How long a confirmation or failure stays on screen before clearing itself. */
const FEEDBACK_TIMEOUT_MS = 4000;

/**
 * A cart round trip on a fast connection lands in tens of milliseconds. Painting "Đang thêm..." for that long
 * turns every click into a flicker, so a request only gets the working affordance once it outlives this delay.
 */
const WORKING_VISIBLE_AFTER_MS = 350;

export type AddToCart = {
  /** Returns whether the cart accepted the line; the cart cache is refreshed on success. */
  add: (input: AddToCartInput) => Promise<boolean>;
  /** Set only when a request is slow enough to be worth showing, so fast adds never repaint the button. */
  pendingProductId: string | undefined;
  error: string | undefined;
  notice: string | undefined;
};

export const useAddToCart = (): AddToCart => {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<Feedback>();
  const [pendingProductId, setPendingProductId] = useState<string>();
  // Newest message wins: a timer only clears the feedback it was scheduled for.
  const latestFeedback = useRef(0);
  // Repeat clicks land before any pending button can appear, so they are refused here rather than by disabling.
  const inFlightProductId = useRef<string | undefined>(undefined);

  const mutation = useMutation({
    mutationFn: async ({ productId, productUnitId, quantity, selectAfterAdding }: AddToCartInput) => {
      const cart = await addCartLine(productId, productUnitId, quantity);
      const line = selectAfterAdding
        ? cart.lines.find((candidate) => candidate.productId === productId && candidate.productUnitId === productUnitId)
        : undefined;
      if (!line) return cart;
      // The product is already in the cart. If ticking it fails, the shopper still reaches the order page with the
      // line unticked and can tick it there, so the add is not reported as failed.
      return setCartSelection(true, [line.id]).catch(() => cart);
    },
    onSuccess: (cart) => {
      writeCart(queryClient, cart);
    },
  });

  const showFeedback = (next: Feedback): void => {
    latestFeedback.current += 1;
    const token = latestFeedback.current;
    setFeedback(next);
    setTimeout(() => {
      setFeedback((current) => (token === latestFeedback.current ? undefined : current));
    }, FEEDBACK_TIMEOUT_MS);
  };

  const add = async (input: AddToCartInput): Promise<boolean> => {
    if (inFlightProductId.current === input.productId) return false;
    inFlightProductId.current = input.productId;
    const showWorking = setTimeout(() => setPendingProductId(input.productId), WORKING_VISIBLE_AFTER_MS);

    try {
      await mutation.mutateAsync(input);
      showFeedback({ kind: "notice", message: `Đã thêm “${input.productName}” vào giỏ hàng` });
      return true;
    } catch (reason) {
      showFeedback({
        kind: "error",
        message: reason instanceof Error ? reason.message : "Không thêm được sản phẩm vào giỏ hàng",
      });
      return false;
    } finally {
      clearTimeout(showWorking);
      inFlightProductId.current = undefined;
      setPendingProductId(undefined);
    }
  };

  return {
    add,
    pendingProductId,
    notice: feedback?.kind === "notice" ? feedback.message : undefined,
    error: feedback?.kind === "error" ? feedback.message : undefined,
  };
};
