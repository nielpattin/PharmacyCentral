import { useCallback, useState } from "react";
import { z } from "zod";

import { browserStorage, readStoredJson, writeStoredJson } from "../lib/storage.ts";

/**
 * A browser-persisted UI preference, validated on read. A missing or invalid stored value falls back.
 *
 * Usage:
 *   const [collapsed, setCollapsed] = useStoredState("pharmacy-central:sidebar-collapsed", z.boolean(), false);
 *   setCollapsed(true);
 */
export const useStoredState = <T>(key: string, schema: z.ZodType<T>, fallback: T): [T, (next: T) => void] => {
  const [value, setValue] = useState<T>(() => {
    const parsed = schema.safeParse(readStoredJson(browserStorage(), key));
    return parsed.success ? parsed.data : fallback;
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writeStoredJson(browserStorage(), key, next);
    },
    [key],
  );
  return [value, update];
};
