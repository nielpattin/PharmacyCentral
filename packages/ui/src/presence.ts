import { useCallback, useState } from "react";

export type Presence = {
  /** False once the exit animation has finished (or at once when there is none): render nothing. */
  mounted: boolean;
  /** `closed` while the exit animation plays. Put it on the animated element as `data-state`. */
  state: "open" | "closed";
  /** Ref for the animated element. */
  ref: (element: HTMLElement | null) => void;
  /** Handler for the animated element. The end of its exit animation unmounts it. */
  onAnimationEnd: (event: React.AnimationEvent<HTMLElement>) => void;
};

/**
 * Keeps an element mounted while its exit animation plays, so a panel leaves the way it arrived instead of vanishing.
 * The animation itself lives in CSS (`weight.css` names the exit keyframes `*-out`). When the element has no exit
 * animation, because the app does not load `weight.css` or the user asked for reduced motion, it unmounts at once, so
 * the closing state can never get stuck.
 */
export const usePresence = (open: boolean): Presence => {
  const [rendered, setRendered] = useState(open);
  if (open && !rendered) setRendered(true);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (element === null || open) return;
      if (getComputedStyle(element).animationName === "none") setRendered(false);
    },
    [open],
  );

  return {
    mounted: open || rendered,
    state: open ? "open" : "closed",
    ref,
    onAnimationEnd: (event) => {
      if (open || event.target !== event.currentTarget || !event.animationName.endsWith("-out")) return;
      setRendered(false);
    },
  };
};
