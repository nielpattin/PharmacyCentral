import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { DataTablePaging } from "@pharmacy/ui";

import { buildPagePath } from "../lib/page-request.ts";
import { readAllPages } from "../lib/read-all-pages.ts";
import { requestPage, type JsonRecord } from "../staff-api.ts";

/**
 * Cursor-paged list on top of `useInfiniteQuery`. Pages come from `requestPage`, which reads `X-Next-Cursor`. The query
 * key includes the path and params, so a filter change restarts at page 1. Invalidate with the `key` prefix.
 *
 * Usage:
 *   const orders = usePagedList({
 *     key: ["staff-orders"],
 *     path: "/api/orders",
 *     params: { status: values.status || undefined, q: debouncedQ || undefined },
 *     limit: 100,
 *   });
 *   orders.rows; orders.hasMore; orders.loadMore(); orders.isLoading; orders.isLoadingMore; orders.error; orders.refetch();
 */
export type PagedListOptions = {
  key: readonly unknown[];
  path: string;
  params?: Readonly<Record<string, string | undefined>>;
  limit?: number;
  /** Runs on every row before a CSV export, to load what the table's columns look up per row (product names). */
  prepareExport?: (rows: JsonRecord[]) => Promise<unknown>;
};

export type PagedList = {
  rows: JsonRecord[];
  hasMore: boolean;
  loadMore: () => void;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | undefined;
  refetch: () => void;
  /** The `paging` prop of a DataTable over this list: "Load more", and a CSV export of every page. */
  paging: DataTablePaging<JsonRecord>;
  /**
   * Like `paging`, for a table whose rows are not the raw records (joined, filtered or parsed). `shape` is the same
   * step that builds the table rows, so a CSV of every page has the same columns and rows as the table.
   */
  pagingAs: <T>(shape: (rows: JsonRecord[]) => T[]) => DataTablePaging<T>;
};

export const usePagedList = ({ key, path, params = {}, limit = 100, prepareExport }: PagedListOptions): PagedList => {
  const query = useInfiniteQuery({
    queryKey: [...key, { path, params, limit }],
    queryFn: ({ pageParam }) =>
      requestPage(buildPagePath(path, { ...params, limit: String(limit), cursor: pageParam })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const pages = query.data?.pages;
  const rows = useMemo(() => pages?.flatMap((page) => page.rows) ?? [], [pages]);
  const loadMore = (): void => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  };
  const loadAll = async (): Promise<JsonRecord[]> => {
    const pagesRead = await readAllPages(query, () => query.fetchNextPage());
    const all = pagesRead.flatMap((page) => page.rows);
    await prepareExport?.(all);
    return all;
  };
  const pagingAs = <T,>(shape: (all: JsonRecord[]) => T[]): DataTablePaging<T> => ({
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    onLoadMore: loadMore,
    loadAll: async () => shape(await loadAll()),
  });
  return {
    rows,
    hasMore: query.hasNextPage,
    loadMore,
    isLoading: query.isPending,
    isLoadingMore: query.isFetchingNextPage,
    error: query.error ?? undefined,
    refetch: () => {
      void query.refetch();
    },
    paging: pagingAs((all) => all),
    pagingAs,
  };
};
