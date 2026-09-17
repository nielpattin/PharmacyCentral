import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";

import { writeJson, type JsonRecord } from "../staff-api.ts";

export type StaffMutationInput = {
  path: string;
  method: "POST" | "PUT" | "DELETE";
  body?: JsonRecord | undefined;
  invalidate?: readonly QueryKey[];
};

export const useStaffMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method, body }: StaffMutationInput) => writeJson(path, method, body),
    onSuccess: async (_data, variables) => {
      await Promise.all((variables.invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
};
