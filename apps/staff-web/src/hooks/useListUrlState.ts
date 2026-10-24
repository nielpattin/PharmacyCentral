import { useNavigate, useSearch } from "@tanstack/react-router";

import { applyListSearch, parseListSearch, type ListDefaults, type ListValues } from "../lib/list-url-state.ts";

/**
 * URL-held list state: search text, status, sort, tab, and page filters live in the route's search params, so refresh
 * and Back restore them. Typing replaces the history entry; tab changes push one. Values equal to their default are
 * left out of the URL. Declare the keys and defaults once per page.
 *
 * Usage:
 *   const LIST_DEFAULTS = { q: "", status: "all", tab: "Lines" } as const;
 *   const { values, setValues } = useListUrlState(LIST_DEFAULTS);
 *   setValues({ q: text });                                  // typing: replaces history
 *   setValues({ tab: "Transfers" }, { history: "push" });    // tab change: new history entry
 *
 * `q`, `status`, `sort`, and `tab` are checked by `listSearchSchema` in router.ts. Other keys pass through unvalidated,
 * so a page that depends on one must check it itself.
 */
export type ListUrlState<D extends ListDefaults> = {
  values: ListValues<D>;
  setValues: (patch: Partial<Record<keyof D & string, string>>, options?: { history?: "push" | "replace" }) => void;
};

export const useListUrlState = <D extends ListDefaults>(defaults: D): ListUrlState<D> => {
  const search = useSearch({ strict: false }) as Readonly<Record<string, unknown>>;
  const navigate = useNavigate();
  const values = parseListSearch(search, defaults);
  const setValues: ListUrlState<D>["setValues"] = (patch, options) => {
    const merged: Record<string, string> = { ...values, ...patch };
    void navigate({
      search: ((previous: Record<string, unknown>) => applyListSearch(previous, merged, defaults)) as never,
      replace: options?.history !== "push",
    });
  };
  return { values, setValues };
};
