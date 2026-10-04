/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Vietmap's tilemap key, used only to render the basemap. It is deliberately not the services key the sales
   * service holds: Vietmap answers `423 Your request is limited` when one is used in place of the other.
   */
  readonly VITE_VIETMAP_TILEMAP_KEY: string;
}
