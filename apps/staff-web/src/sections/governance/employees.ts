import type { JsonRecord } from "../../staff-api.ts";

/** An employee account as the admin routes answer it. */
export type EmployeeAccount = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  siteIds: string[];
};

export const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const shortId = (id: string): string => id.slice(0, 8);

export const toEmployeeAccount = (row: JsonRecord): EmployeeAccount => ({
  id: typeof row.id === "string" ? row.id : "",
  email: typeof row.email === "string" ? row.email : "",
  displayName: typeof row.displayName === "string" ? row.displayName : "",
  roles: stringList(row.roles),
  siteIds: stringList(row.siteIds),
});

/** The name a person reads: display name, then email, then a short id. */
export const employeeLabel = (account: EmployeeAccount): string =>
  account.displayName || account.email || shortId(account.id);

/** Case-insensitive match of the search text against the display name and the email. A blank query keeps every row. */
export const filterEmployees = (rows: JsonRecord[], query: string): JsonRecord[] => {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return rows;
  return rows.filter((row) => {
    const account = toEmployeeAccount(row);
    return [account.displayName, account.email].some((value) => value.toLocaleLowerCase().includes(needle));
  });
};
