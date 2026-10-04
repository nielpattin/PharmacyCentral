import "@vietmap/vietmap-gl-js/dist/vietmap-gl.css";

import * as vietmapgl from "@vietmap/vietmap-gl-js/dist/vietmap-gl.js";
import { useRef } from "react";

import { useMountEffect } from "../hooks/useMountEffect.ts";
import { VIETMAP_STYLE_URL } from "./vietmap-style.ts";

export type Point = { latitude: number; longitude: number };

type AddressPickerMapProps = {
  /** Where the pin starts. The picker only has a delivery point to frame, so there is no store to fit against. */
  point: Point;
  onPointChange: (point: Point) => void;
  /** Echoed under the map so the shopper can confirm the text matches the pin they just moved. */
  addressLabel: string | undefined;
  /** True while a dragged pin is being named, so the map can say the label has not caught up yet. */
  resolving: boolean;
};

/**
 * The map half of the delivery-address form: a single draggable pin, no store, no route.
 *
 * Vietnamese addresses are the reason this exists as its own component. A geocoder resolves "12 Nguyễn Trãi" to
 * a point in the middle of the street, and in an alley or a tower that point can be tens of metres from the door
 * the rider has to reach. The delivery fee is computed from exactly this coordinate, so the shopper has to be
 * able to move the pin to the gate and see the result before saving.
 *
 * The map reads its point once, so a caller that changes where the pin belongs remounts this with `key`: that
 * rebuilds the map centred on the new point rather than chasing a marker across the DOM after mount.
 */
export const AddressPickerMap = ({
  point,
  onPointChange,
  addressLabel,
  resolving,
}: AddressPickerMapProps): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  useMountEffect(() => {
    if (!containerRef.current) return;
    const map = new vietmapgl.Map({
      container: containerRef.current,
      style: VIETMAP_STYLE_URL,
      center: [point.longitude, point.latitude],
      zoom: 16,
    });
    const pin = new vietmapgl.Marker({ color: "#c62828", draggable: true })
      .setLngLat([point.longitude, point.latitude])
      .addTo(map);
    pin.on("dragend", () => {
      const position = pin.getLngLat();
      onPointChange({ latitude: position.lat, longitude: position.lng });
    });
    map.addControl(new vietmapgl.NavigationControl(), "top-right");
    return () => {
      pin.remove();
      map.remove();
    };
  });
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div
        ref={containerRef}
        aria-label="Bản đồ xác nhận điểm giao. Kéo điểm đỏ đến đúng cổng, hẻm hoặc lối vào."
        style={{ minHeight: 300, width: "100%" }}
      />
      <p className="border-t border-line bg-surface-soft px-3.5 py-2 text-xs text-muted">
        Kéo điểm đỏ về đúng cổng, hẻm hoặc lối vào — phí giao được tính theo đúng vị trí này.
        {resolving ? (
          <span className="mt-0.5 block truncate text-muted-soft">Đang xác định địa chỉ tại điểm mới…</span>
        ) : addressLabel ? (
          <span className="mt-0.5 block truncate">{addressLabel}</span>
        ) : null}
      </p>
    </div>
  );
};
