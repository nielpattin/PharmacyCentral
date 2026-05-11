import { getLanguage, translate } from "../lib/i18n";
import type { SiteTypeValue, StorageLocationTypeValue } from "../pages/shared/pharmacyTypes";

export type AuthUserDetails = {
   displayName: string;
   email: string;
   roles: string[];
   siteIds: string[];
   isPlatformAdmin: boolean;
};

export type LoginRequest = {
   email: string;
   password: string;
};

type CsrfTokenResponse = {
   token: string;
};

export type SiteDto = {
   id: string;
   code: string;
   name: string;
   siteType: SiteTypeValue;
   status: string;
   address: string | null;
   notes: string | null;
   isActive: boolean;
   createdAtUtc: string;
   updatedAtUtc: string;
};

export type StorageLocationDto = {
   id: string;
   siteId: string;
   code: string;
   name: string;
   locationType: StorageLocationTypeValue;
   status: string;
   capacity: number | null;
   isActive: boolean;
   createdAtUtc: string;
   updatedAtUtc: string;
};

export type SiteUpsertRequest = {
   code: string;
   name: string;
   siteType: SiteTypeValue;
   status: string;
   address: string;
   notes: string;
   isActive: boolean;
};

export type StorageLocationUpsertRequest = {
   siteId: string;
   code: string;
   name: string;
   locationType: StorageLocationTypeValue;
   status: string;
   capacity: number | null;
   isActive: boolean;
};

let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

async function readErrorMessage(response: Response) {
   const contentType = response.headers.get("content-type") ?? "";

   if (contentType.includes("application/json") || contentType.includes("application/problem+json")) {
      const payload = (await response.json().catch(() => null)) as {
         error?: string;
         title?: string;
         detail?: string;
         errors?: Record<string, string[]>;
      } | null;

      if (payload !== null) {
         if (typeof payload.error === "string" && payload.error.trim()) {
            return payload.error;
         }

         if (typeof payload.detail === "string" && payload.detail.trim()) {
            return payload.detail;
         }

         if (typeof payload.title === "string" && payload.title.trim()) {
            return payload.title;
         }

         if (payload.errors !== undefined) {
            const firstEntry = Object.entries(payload.errors)[0];
            if (firstEntry !== undefined) {
               const [, messages] = firstEntry;
               if (messages.length > 0 && messages[0].trim()) {
                  return messages[0];
               }
            }
         }
      }

      return translate(getLanguage(), "errors.requestFailed", { status: response.status });
   }

   const text = await response.text();
   return text || translate(getLanguage(), "errors.requestFailed", { status: response.status });
}

function isUnsafeMethod(method: string) {
   return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

async function getCsrfToken() {
   if (csrfToken !== null) {
      return csrfToken;
   }

   if (csrfTokenPromise !== null) {
      return await csrfTokenPromise;
   }

   csrfTokenPromise = (async () => {
      const response = await fetch("/api/auth/csrf", {
         method: "GET",
         credentials: "include",
      });

      if (!response.ok) {
         throw new Error(await readErrorMessage(response));
      }

      const payload = (await response.json()) as CsrfTokenResponse;
      csrfToken = payload.token;
      return payload.token;
   })();

   try {
      return await csrfTokenPromise;
   } finally {
      csrfTokenPromise = null;
   }
}

async function isCsrfTokenFailure(response: Response) {
   const contentType = response.headers.get("content-type") ?? "";
   if (!contentType.includes("application/json") && !contentType.includes("application/problem+json")) {
      return false;
   }

   const payload = (await response
      .clone()
      .json()
      .catch(() => null)) as { error?: string; detail?: string; title?: string } | null;
   const message = payload?.error ?? payload?.detail ?? payload?.title;
   return message === "Invalid CSRF token.";
}

export function resetCsrfToken() {
   csrfToken = null;
}

async function fetchWithCsrfRetry(path: string, init: RequestInit, canRetry = true) {
   const response = await fetch(path, {
      ...init,
      credentials: "include",
   });

   const method = (init.method ?? "GET").toUpperCase();
   if (canRetry && isUnsafeMethod(method) && response.status === 403 && (await isCsrfTokenFailure(response))) {
      resetCsrfToken();
      return await fetchWithCsrfRetry(path, init, false);
   }

   return response;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
   const { headers: requestHeaders, method, ...requestInit } = init ?? {};
   const headers = new Headers(requestHeaders);
   headers.set("Content-Type", "application/json");

   if (isUnsafeMethod((method ?? "GET").toUpperCase())) {
      headers.set("X-CSRF-TOKEN", await getCsrfToken());
   }

   const response = await fetchWithCsrfRetry(path, {
      ...requestInit,
      method,
      headers,
   });

   if (!response.ok) {
      throw new Error(await readErrorMessage(response));
   }

   return (await response.json()) as T;
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
   const { headers: requestHeaders, method, ...requestInit } = init ?? {};
   const headers = new Headers(requestHeaders);

   if (isUnsafeMethod((method ?? "GET").toUpperCase())) {
      headers.set("X-CSRF-TOKEN", await getCsrfToken());
   }

   const response = await fetchWithCsrfRetry(path, {
      ...requestInit,
      method,
      headers,
   });

   if (!response.ok) {
      throw new Error(await readErrorMessage(response));
   }
}

export async function loadSites() {
   return await requestJson<SiteDto[]>("/api/sites");
}

export async function loadStorageLocations() {
   return await requestJson<StorageLocationDto[]>("/api/storage-locations");
}

export async function loadPharmacyData() {
   const [sites, storageLocations] = await Promise.all([loadSites(), loadStorageLocations()]);
   return { sites, storageLocations };
}

export async function createSite(request: SiteUpsertRequest) {
   return await requestJson<SiteDto>("/api/sites", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function updateSite(id: string, request: SiteUpsertRequest) {
   return await requestJson<SiteDto>(`/api/sites/${id}`, {
      method: "PUT",
      body: JSON.stringify(request),
   });
}

export async function deleteSite(id: string) {
   await requestVoid(`/api/sites/${id}`, {
      method: "DELETE",
   });
}

export async function createStorageLocation(request: StorageLocationUpsertRequest) {
   return await requestJson<StorageLocationDto>("/api/storage-locations", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function updateStorageLocation(id: string, request: StorageLocationUpsertRequest) {
   return await requestJson<StorageLocationDto>(`/api/storage-locations/${id}`, {
      method: "PUT",
      body: JSON.stringify(request),
   });
}

export async function deleteStorageLocation(id: string) {
   await requestVoid(`/api/storage-locations/${id}`, {
      method: "DELETE",
   });
}

export async function login(request: LoginRequest) {
   const user = await requestJson<AuthUserDetails>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(request),
   });

   resetCsrfToken();
   return user;
}

export async function logout() {
   await requestVoid("/api/auth/logout", {
      method: "POST",
   });

   resetCsrfToken();
}

export async function fetchMe() {
   return await requestJson<AuthUserDetails>("/api/auth/me");
}
