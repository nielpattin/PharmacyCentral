import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { buildPagePath } from "../lib/page-request.ts";
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
};

export type PagedList = {
  rows: JsonRecord[];
  hasMore: boolean;
  loadMore: () => void;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | undefined;
  refetch: () => void;
};

export const usePagedList = ({ key, path, params = {}, limit = 100 }: PagedListOptions): PagedList => {
  const query = useInfiniteQuery({
    queryKey: [...key, { path, params, limit }],
    queryFn: ({ pageParam }) =>
      requestPage(buildPagePath(path, { ...params, limit: String(limit), cursor: pageParam })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const pages = query.data?.pages;
  const rows = useMemo(() => pages?.flatMap((page) => page.rows) ?? [], [pages]);
  return {
    rows,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    isLoading: query.isPending,
    isLoadingMore: query.isFetchingNextPage,
    error: query.error ?? undefined,
    refetch: () => {
      void query.refetch();
    },
  };
};
