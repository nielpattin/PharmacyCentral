import { Button } from "@pharmacy/ui";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMountEffect } from "../../hooks/useMountEffect.ts";
import { IconClose, IconMinus, IconPlus } from "./icons.tsx";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const BUTTON_STEP = 1.5;
const DOUBLE_CLICK_SCALE = 2.5;

type Point = { x: number; y: number };
/** `x`/`y` offset the image from the stage centre in screen pixels; `scale` multiplies its fitted size. */
type View = { scale: number } & Point;

const FIT: View = { scale: 1, x: 0, y: 0 };

/** Rescales the view while the stage point `focus` (relative to the stage centre) stays put on screen. */
const zoomAt = (view: View, nextScale: number, focus: Point): View => {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
  if (scale === MIN_SCALE) return FIT;
  const ratio = scale / view.scale;
  return { scale, x: focus.x - ratio * (focus.x - view.x), y: focus.y - ratio * (focus.y - view.y) };
};

const toStage = (stage: HTMLElement, clientX: number, clientY: number): Point => {
  const rect = stage.getBoundingClientRect();
  return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
};

const limit = (value: number, bound: number): number => Math.min(bound, Math.max(-bound, value));

/**
 * Full-screen viewer for one image: buttons, keyboard (+, -, 0, Esc), mouse wheel, double click and pinch zoom,
 * and drag to pan once zoomed. Mount it only while open; it locks page scroll for as long as it is mounted.
 */
export const ImageLightbox = ({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}): React.JSX.Element => {
  const [view, setView] = useState<View>(FIT);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());

  // Panning stops once a zoomed image edge reaches the matching stage edge, so the photo never drifts off screen.
  const update = (next: (current: View) => View): void => {
    setView((current) => {
      const target = next(current);
      const stage = stageRef.current;
      const image = imageRef.current;
      if (!stage || !image || target.scale === MIN_SCALE) return target;
      const boundX = Math.max(0, (image.offsetWidth * target.scale - stage.clientWidth) / 2);
      const boundY = Math.max(0, (image.offsetHeight * target.scale - stage.clientHeight) / 2);
      return { scale: target.scale, x: limit(target.x, boundX), y: limit(target.y, boundY) };
    });
  };

  const zoomBy = (factor: number): void => update((current) => zoomAt(current, current.scale * factor, { x: 0, y: 0 }));

  useMountEffect(() => {
    const stage = stageRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
      else if (event.key === "+" || event.key === "=") zoomBy(BUTTON_STEP);
      else if (event.key === "-") zoomBy(1 / BUTTON_STEP);
      else if (event.key === "0") update(() => FIT);
    };
    // React registers wheel listeners as passive, and only a non-passive one may stop the page from scrolling.
    const onWheel = (event: WheelEvent): void => {
      if (!stage) return;
      event.preventDefault();
      const focus = toStage(stage, event.clientX, event.clientY);
      update((current) => zoomAt(current, current.scale * Math.exp(-event.deltaY * 0.002), focus));
    };
    window.addEventListener("keydown", onKeyDown);
    stage?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      stage?.removeEventListener("wheel", onWheel);
    };
  });

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    const others = [...pointers.current].filter(([id]) => id !== event.pointerId).map(([, point]) => point);
    pointers.current.set(event.pointerId, current);
    const stage = event.currentTarget;
    const [other] = others;
    if (others.length === 1 && other) {
      // Pinch: scale by the change in finger spread around the midpoint, and follow the midpoint as it moves.
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(current.x - other.x, current.y - other.y);
      if (before === 0) return;
      const from = toStage(stage, (previous.x + other.x) / 2, (previous.y + other.y) / 2);
      const to = toStage(stage, (current.x + other.x) / 2, (current.y + other.y) / 2);
      update((view) => {
        const zoomed = zoomAt(view, (view.scale * after) / before, to);
        return zoomed.scale === MIN_SCALE
          ? FIT
          : { ...zoomed, x: zoomed.x + to.x - from.x, y: zoomed.y + to.y - from.y };
      });
      return;
    }
    if (others.length === 0) {
      update((view) =>
        view.scale === MIN_SCALE
          ? view
          : { ...view, x: view.x + current.x - previous.x, y: view.y + current.y - previous.y },
      );
    }
  };

  const releasePointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const focus = toStage(event.currentTarget, event.clientX, event.clientY);
    update((current) => (current.scale > MIN_SCALE ? FIT : zoomAt(current, DOUBLE_CLICK_SCALE, focus)));
  };

  const zoomed = view.scale > MIN_SCALE;

  // A portal keeps the overlay free of the caller's layout, such as the margin a `space-y-*` parent adds.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex flex-col bg-ink/95 text-white"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 sm:px-4">
        <p className="hidden text-xs text-white/70 sm:block">
          Cuộn chuột, chụm hai ngón hoặc bấm đúp để phóng to. Kéo ảnh để di chuyển.
        </p>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/15"
            aria-label="Thu nhỏ"
            disabled={!zoomed}
            onClick={() => zoomBy(1 / BUTTON_STEP)}
          >
            <IconMinus />
          </Button>
          <span className="w-14 text-center text-sm tabular-nums" aria-live="polite">
            {Math.round(view.scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/15"
            aria-label="Phóng to"
            disabled={view.scale >= MAX_SCALE}
            onClick={() => zoomBy(BUTTON_STEP)}
          >
            <IconPlus />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/15"
            disabled={!zoomed}
            onClick={() => update(() => FIT)}
          >
            Vừa màn hình
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/15"
            aria-label="Đóng"
            autoFocus
            onClick={onClose}
          >
            <IconClose />
          </Button>
        </div>
      </div>
      <div
        ref={stageRef}
        className={`relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden select-none ${
          zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onDoubleClick={onDoubleClick}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
    </div>,
    document.body,
  );
};
