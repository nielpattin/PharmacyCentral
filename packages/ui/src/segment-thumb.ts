/**
 * Ref callback for the track of a segmented control. It measures the chosen segment and publishes its position as
 * `--thumb-x` and `--thumb-w` on the track, which the thumb element (the raised pill behind the segments) follows, so
 * the pill slides from one segment to the next instead of jumping. Call it from a fresh closure on each render
 * (`ref={(element) => placeThumb(element)}`): React then runs it again after every selection change, and its cleanup
 * disconnects the observer. The first placement is instant; `data-ready` turns the slide on afterwards.
 */
export const placeThumb = (track: HTMLElement | null): (() => void) | undefined => {
  if (track === null) return undefined;
  const place = (): void => {
    const chosen = track.querySelector<HTMLElement>('[aria-selected="true"], [aria-checked="true"]');
    track.style.setProperty("--thumb-x", `${chosen?.offsetLeft ?? 0}px`);
    track.style.setProperty("--thumb-w", `${chosen?.offsetWidth ?? 0}px`);
  };
  place();
  const frame = requestAnimationFrame(() => track.setAttribute("data-ready", ""));
  const observer = new ResizeObserver(place);
  observer.observe(track);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
};
