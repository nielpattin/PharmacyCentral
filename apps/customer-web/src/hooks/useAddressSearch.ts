import { useRef, useState } from "react";

import { ADDRESS_SEARCH_MIN_LENGTH, searchAddress, type AddressSearchResult } from "../customer-api.ts";
import { useMountEffect } from "./useMountEffect.ts";

/** The suggestions only follow typing once the shopper pauses, because every lookup is a metered call. */
const SEARCH_DEBOUNCE_MS = 350;

export type AddressSearch = {
  results: AddressSearchResult[];
  searching: boolean;
  /** Why the last search produced nothing usable; cleared by the next search or by `clear`. */
  error: string | undefined;
  /** Searches now; a short query just empties the list. */
  search: (query: string) => void;
  /** Searches once the shopper stops typing, dropping any search still waiting. */
  searchSoon: (query: string) => void;
  /** Empties the list and abandons any search still in flight. */
  clear: () => void;
};

/**
 * The state machine behind an address search box, shared by the checkout and the address dialog.
 *
 * Each search is stamped and only the newest may write: a slow answer for a prefix the shopper has already typed
 * past would otherwise replace the results of the one they are looking at.
 */
export const useAddressSearch = (): AddressSearch => {
  const [results, setResults] = useState<AddressSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Closing the form must not leave a lookup behind to run, bill, and then write into nothing.
  useMountEffect(() => () => {
    token.current += 1;
    clearTimeout(timer.current);
  });

  const clear = (): void => {
    token.current += 1;
    clearTimeout(timer.current);
    setResults([]);
    setSearching(false);
    setError(undefined);
  };

  const search = (query: string): void => {
    clearTimeout(timer.current);
    const current = token.current + 1;
    token.current = current;
    setError(undefined);
    if (query.trim().length < ADDRESS_SEARCH_MIN_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    void searchAddress(query)
      .then((found) => {
        if (token.current !== current) return;
        setResults(found);
        if (found.length === 0) setError("Không tìm thấy địa chỉ này. Thử thêm tên phường hoặc tên đường.");
      })
      .catch((reason: unknown) => {
        if (token.current !== current) return;
        setResults([]);
        setError(reason instanceof Error ? reason.message : "Tìm địa chỉ thất bại.");
      })
      .finally(() => {
        if (token.current === current) setSearching(false);
      });
  };

  const searchSoon = (query: string): void => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(query), SEARCH_DEBOUNCE_MS);
  };

  return { results, searching, error, search, searchSoon, clear };
};
