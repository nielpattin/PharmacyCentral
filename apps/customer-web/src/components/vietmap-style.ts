/**
 * Where the map tiles come from.
 *
 * The app draws a Vietnamese address with a Vietnamese pin on it, and a general-purpose world basemap labels
 * Vietnamese streets for the world rather than for a rider standing on the pavement. Vietmap's own basemap names
 * the streets the way they are written here, and draws the house numbers with them, so a shopper can check that
 * the pin sits on the door they wrote down.
 *
 * The tilemap key is a separate credential from the services key the sales service holds. Vietmap answers
 * `423 Your request is limited` when one is used in place of the other, so they are not interchangeable and
 * this file deliberately reads only the client-side one.
 */

const TILEMAP_KEY: string | undefined = import.meta.env.VITE_VIETMAP_TILEMAP_KEY;

/**
 * Vite replaces `import.meta.env` with literals at build time, so a missing key has to fail here rather than
 * quietly paint an empty map: this is the one place the browser is about to spend a metered request.
 */
if (typeof TILEMAP_KEY !== "string" || TILEMAP_KEY === "") {
  throw new Error("Missing required environment variable: VITE_VIETMAP_TILEMAP_KEY");
}

/** A MapLibre style document; MapLibre accepts a URL and fetches the style and its glyphs itself. */
export const VIETMAP_STYLE_URL = `https://maps.vietmap.vn/maps/styles/tm/style.json?apikey=${TILEMAP_KEY}`;
