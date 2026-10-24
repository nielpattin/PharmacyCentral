import "@vietmap/vietmap-gl-js/dist/vietmap-gl.css";

import * as vietmapgl from "@vietmap/vietmap-gl-js/dist/vietmap-gl.js";
import { useRef, useState } from "react";

import { useMountEffect } from "../hooks/useMountEffect.ts";
import { deliveryView } from "./delivery-view.ts";
import { MapUnavailable, webglSupported } from "./map-support.tsx";
import { VIETMAP_STYLE_URL } from "./vietmap-style.ts";

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
  const [unavailable, setUnavailable] = useState(() => !webglSupported());
  useMountEffect(() => {
    if (!containerRef.current) return;
    let map: vietmapgl.Map;
    try {
      map = new vietmapgl.Map({
        container: containerRef.current,
        style: VIETMAP_STYLE_URL,
        center: [store.longitude, store.latitude],
        zoom: 11,
      });
    } catch {
      setUnavailable(true);
      return;
    }
    const storeMarker = new vietmapgl.Marker({ color: "#1769aa" })
      .setLngLat([store.longitude, store.latitude])
      .addTo(map);
    const destinationMarker = destination
      ? new vietmapgl.Marker({ color: "#c62828", draggable: true })
          .setLngLat([destination.longitude, destination.latitude])
          .addTo(map)
      : undefined;
    destinationMarker?.on("dragend", () => {
      const position = destinationMarker.getLngLat();
      onDestinationChange?.({ latitude: position.lat, longitude: position.lng });
    });
    map.addControl(new vietmapgl.NavigationControl(), "top-right");
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
  if (unavailable) return <MapUnavailable minHeight={360} />;
  return (
    <div
      ref={containerRef}
      aria-label={destination ? "Bản đồ lộ trình giao hàng. Kéo điểm đỏ để đổi điểm giao." : "Bản đồ vị trí nhà thuốc."}
      style={{ minHeight: 360, width: "100%" }}
    />
  );
};
