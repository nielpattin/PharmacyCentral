import { useSyncExternalStore } from "react";

function subscribe(notify: () => void) {
   window.addEventListener("popstate", notify);
   window.addEventListener("app-navigate", notify);
   return () => {
      window.removeEventListener("popstate", notify);
      window.removeEventListener("app-navigate", notify);
   };
}

function getSnapshot() {
   return window.location.pathname;
}

export function usePathname() {
   return useSyncExternalStore(subscribe, getSnapshot);
}

export function navigate(path: string) {
   if (window.location.pathname === path) {
      return;
   }

   window.history.pushState(null, "", path);
   window.dispatchEvent(new CustomEvent("app-navigate"));
}
