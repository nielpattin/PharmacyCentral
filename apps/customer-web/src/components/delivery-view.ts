import * as vietmapgl from "@vietmap/vietmap-gl-js/dist/vietmap-gl.js";

type Point = { latitude: number; longitude: number };
type RoutePath = Array<[number, number]>;

/**
 * The camera that frames a pick-up store, its delivery destination, and the route between them.
 *
 * `LngLatBounds` reads its two arguments as a fixed south-west/north-east pair, so handing it
 * `(store, destination)` wraps the box the long way around the globe whenever the store sits east
 * of the destination. Folding both points in with `extend` orders each axis instead.
 */
export const deliveryView = (store: Point, destination: Point, route?: RoutePath): vietmapgl.LngLatBounds => {
  const bounds = new vietmapgl.LngLatBounds(
    [store.longitude, store.latitude],
    [store.longitude, store.latitude],
  ).extend([destination.longitude, destination.latitude]);
  for (const coordinate of route ?? []) bounds.extend(coordinate);
  return bounds;
};
