import { useCallback, useRef } from "react";

const END_SLACK_PX = 24;

export const useStickToBottom = (): {
  container: (element: HTMLElement | null) => (() => void) | undefined;
  content: (element: HTMLElement | null) => (() => void) | undefined;
  follow: () => void;
} => {
  const containerRef = useRef<HTMLElement | null>(null);
  const followingRef = useRef(true);

  const scrollToEnd = useCallback((): void => {
    // Smooth scrolling fires scroll events mid-way, which the listener would read as the reader leaving.
    const element = containerRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  const container = useCallback((element: HTMLElement | null) => {
    containerRef.current = element;
    if (!element) return undefined;
    const onScroll = (): void => {
      followingRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= END_SLACK_PX;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      containerRef.current = null;
    };
  }, []);

  const content = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return undefined;
      const observer = new ResizeObserver(() => {
        if (followingRef.current) scrollToEnd();
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
    [scrollToEnd],
  );

  const follow = useCallback((): void => {
    followingRef.current = true;
    scrollToEnd();
  }, [scrollToEnd]);

  return { container, content, follow };
};
