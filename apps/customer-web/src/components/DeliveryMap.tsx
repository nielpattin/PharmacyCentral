import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
// MapLibre resolves its worker at runtime from a computed sibling URL, which no bundler can
// follow: Vite pre-bundles the library into `node_modules/.vite/deps/` and never emits
// `maplibre-gl-worker.mjs` next to it, so the map painted its style background but received no
// tiles or glyphs. `?worker&url` hands Vite the worker as an explicit entry, emitting a real
// asset in dev and in the production build.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useRef } from "react";

import { useMountEffect } from "../hooks/useMountEffect.ts";
import { deliveryView } from "./delivery-view.ts";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

type Point = { latitude: number; longitude: number };

type DeliveryMapProps = {
  store: Point;
  destination?: Point | undefined;
  route?: Array<[number, number]>;
  onDestinationChange?: (point: Point) => void;
};

export const DeliveryMap = ({
  store,
  destination,
  route,
  onDestinationChange,
}: DeliveryMapProps): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  useMountEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [store.longitude, store.latitude],
      zoom: 11,
    });
    const storeMarker = new maplibregl.Marker({ color: "#1769aa" })
      .setLngLat([store.longitude, store.latitude])
      .addTo(map);
    const destinationMarker = destination
      ? new maplibregl.Marker({ color: "#c62828", draggable: true })
          .setLngLat([destination.longitude, destination.latitude])
          .addTo(map)
      : undefined;
    destinationMarker?.on("dragend", () => {
      const position = destinationMarker.getLngLat();
      onDestinationChange?.({ latitude: position.lat, longitude: position.lng });
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => {
      if (!destination) return;
      if (route && route.length >= 2) {
        map.addSource("delivery-route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } },
        });
        map.addLayer({
          id: "delivery-route",
          type: "line",
          source: "delivery-route",
          paint: { "line-color": "#1769aa", "line-width": 4 },
        });
      }
      map.fitBounds(deliveryView(store, destination, route), { padding: 48, maxZoom: 14 });
    });
    return () => {
      storeMarker.remove();
      destinationMarker?.remove();
      map.remove();
    };
  });
  return (
    <div
      ref={containerRef}
      aria-label={destination ? "Bản đồ lộ trình giao hàng. Kéo điểm đỏ để đổi điểm giao." : "Bản đồ vị trí nhà thuốc."}
      style={{ minHeight: 360, width: "100%" }}
    />
  );
};
