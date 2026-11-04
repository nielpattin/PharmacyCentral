import { useQuery } from "@tanstack/react-query";

import { request } from "../../staff-api.ts";
import { parseStaffDirectory, STAFF_DIRECTORY_KEY, STAFF_DIRECTORY_PATH } from "./contract.ts";

/**
 * The active employees the owner pickers offer. Only read when `enabled`: the directory answers the Pharmacy Manager,
 * and a refused read would show an error to everyone else.
 */
export const useStaffDirectory = (enabled: boolean) =>
  useQuery({
    queryKey: STAFF_DIRECTORY_KEY,
    queryFn: async () => parseStaffDirectory(await request<unknown>(STAFF_DIRECTORY_PATH)),
    enabled,
  });
