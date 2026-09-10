import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import { useRef } from "react";

import { useMountEffect } from "../hooks/useMountEffect.ts";

type Point = { latitude: number; longitude: number };

type DeliveryMapProps = {
  store: Point;
  destination: Point;
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
    const destinationMarker = new maplibregl.Marker({ color: "#c62828", draggable: true })
      .setLngLat([destination.longitude, destination.latitude])
      .addTo(map);
    destinationMarker.on("dragend", () => {
      const position = destinationMarker.getLngLat();
      onDestinationChange?.({ latitude: position.lat, longitude: position.lng });
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => {
      const bounds = new maplibregl.LngLatBounds(
        [store.longitude, store.latitude],
        [destination.longitude, destination.latitude],
      );
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
        for (const coordinate of route) bounds.extend(coordinate);
      }
      map.fitBounds(bounds, { padding: 48, maxZoom: 14 });
    });
    return () => {
      storeMarker.remove();
      destinationMarker.remove();
      map.remove();
    };
  });
  return (
    <div
      ref={containerRef}
      aria-label="Delivery route map. Drag the red destination marker."
      style={{ minHeight: 360, width: "100%" }}
    />
  );
};
