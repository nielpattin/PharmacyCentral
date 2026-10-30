import { useRef } from "react";

/**
 * A number that goes up by one each time `open` turns true. Pass it as the `key` of a drawer that stays mounted after it
 * closes (so it can play its exit animation): every opening then starts from a fresh drawer, with none of the state the
 * last one left behind.
 */
export const useOpenKey = (open: boolean): number => {
  const openings = useRef(0);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) openings.current += 1;
  wasOpen.current = open;
  return openings.current;
};
