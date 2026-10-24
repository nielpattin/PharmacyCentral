import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useToast } from "@pharmacy/ui";
import { useCallback } from "react";

import { translateText } from "../i18n.ts";
import { writeJson, type JsonRecord } from "../staff-api.ts";

/**
 * Runs one write: sends it, invalidates the listed queries, and reports the outcome as a toast. Success text must be a
 * whole English sentence (translated here). Errors show the API's own message. Returns true when the write succeeded.
 *
 * Usage:
 *   const run = useStaffAction();
 *   const ok = await run({
 *     path: `/api/procurement/purchase-orders/${id}/approve`,
 *     body: { notes },
 *     invalidate: [["staff-purchase-orders"]],
 *     success: "Purchase order approved.",
 *   });
 *   if (!ok) return; // the error toast is already shown; keep the form as it is
 */
export type StaffActionInput = {
  path: string;
  method?: "POST" | "PUT" | "DELETE";
  body?: JsonRecord;
  invalidate?: readonly QueryKey[];
  success?: string;
};

export type StaffAction = (input: StaffActionInput) => Promise<boolean>;

export const useStaffAction = (): StaffAction => {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useCallback<StaffAction>(
    async (input) => {
      try {
        await writeJson(input.path, input.method ?? "POST", input.body);
      } catch (reason) {
        toast.error(translateText(reason instanceof Error ? reason.message : "The request failed."));
        return false;
      }
      await Promise.all((input.invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      if (input.success) toast.success(translateText(input.success));
      return true;
    },
    [queryClient, toast],
  );
};
