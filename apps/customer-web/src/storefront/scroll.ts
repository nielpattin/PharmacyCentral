const SETTLE_FRAMES = 2;
const MAX_FRAMES = 120;

export const scrollToSection = (id: string, behavior: ScrollBehavior = "smooth"): void => {
  document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
};

// Sections above the target grow when catalog data renders, so the scroll waits for a still layout.
export const scrollToSettledSection = (id: string, behavior: ScrollBehavior = "auto"): void => {
  let previousOffset = Number.NaN;
  let stableFrames = 0;
  let frames = 0;

  const step = (): void => {
    const target = document.getElementById(id);
    const offset = target ? target.getBoundingClientRect().top + window.scrollY : Number.NaN;
    stableFrames = offset === previousOffset ? stableFrames + 1 : 0;
    previousOffset = offset;

    if (target && stableFrames >= SETTLE_FRAMES) {
      target.scrollIntoView({ behavior, block: "start" });
      return;
    }

    frames += 1;
    if (frames < MAX_FRAMES) {
      window.requestAnimationFrame(step);
      return;
    }

    target?.scrollIntoView({ behavior, block: "start" });
  };

  window.requestAnimationFrame(step);
};

export const scrollToProducts = (): void => scrollToSection("san-pham");
