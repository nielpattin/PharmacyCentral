/** What a paged query reports after a fetch: the pages read so far, and whether another page follows. */
export type PagedState<P> = { data: { pages: readonly P[] } | undefined; hasNextPage: boolean };

/** A failed page fetch, as `useInfiniteQuery` reports it. */
export type PagedResult<P> = PagedState<P> & { isError: boolean; error: unknown };

/**
 * Reads page after page until none follows, then resolves with every page, in order. A page that fails stops the read and
 * rejects, so a CSV export never silently holds half a list. No React imports, so node can test it.
 */
export const readAllPages = async <P>(start: PagedState<P>, fetchNext: () => Promise<PagedResult<P>>): Promise<P[]> => {
  let state: PagedState<P> = start;
  while (state.hasNextPage) {
    const next = await fetchNext();
    if (next.isError) throw next.error instanceof Error ? next.error : new Error("A page could not be loaded");
    state = next;
  }
  return [...(state.data?.pages ?? [])];
};
