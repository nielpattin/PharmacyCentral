import { useQuery } from "@tanstack/react-query";

import { readOne, readRows, type JsonRecord } from "../../staff-api.ts";
import { isEmployeeRow, stringList } from "./employees.ts";

/** Invalidate with this key after any write that changes an employee account. */
export const employeesQueryKey = ["governance-users"] as const;

/** The employees, all of them or only the active or the deactivated ones. */
export const useEmployees = (status?: "active" | "deactivated") =>
  useQuery({
    queryKey: [...employeesQueryKey, status ?? "all"],
    queryFn: async () =>
      (await readRows(status ? `/api/admin/users?status=${status}` : "/api/admin/users")).filter(isEmployeeRow),
  });

export const useRoles = () =>
  useQuery({
    queryKey: ["governance-roles"],
    queryFn: async () => stringList((await readOne<JsonRecord>("/api/admin/roles")).roles),
  });
