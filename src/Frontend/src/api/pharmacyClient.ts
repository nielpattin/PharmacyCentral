import { getLanguage, translate } from "../lib/i18n";
import type { SiteTypeValue, StorageLocationTypeValue } from "../pages/shared/pharmacyTypes";

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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
   const { headers: requestHeaders, ...requestInit } = init ?? {};
   const headers = new Headers(requestHeaders);
   headers.set("Content-Type", "application/json");

   const response = await fetch(path, {
      ...requestInit,
      headers,
   });

   if (!response.ok) {
      throw new Error(await readErrorMessage(response));
   }

   return (await response.json()) as T;
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
   const { headers: requestHeaders, ...requestInit } = init ?? {};
   const headers = new Headers(requestHeaders);

   const response = await fetch(path, {
      ...requestInit,
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
