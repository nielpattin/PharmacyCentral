import { useState } from "react";

import { useDebounced } from "./useDebounced.ts";

/**
 * Local text for a search box that commits to the URL after a pause. When the URL value changes from outside (a saved
 * view, Back), the box shows that value; typing never resets the box, because the URL only changes after a commit.
 *
 * Usage:
 *   const [draft, setDraft] = useSearchDraft(values.q, (text) => setValues({ q: text }));
 *   <DataTable search={{ value: draft, onChange: setDraft }} />
 */
export const useSearchDraft = (
  urlValue: string,
  commit: (text: string) => void,
  delayMs = 250,
): [string, (text: string) => void] => {
  const [seen, setSeen] = useState(urlValue);
  const [draft, setDraft] = useState(urlValue);
  if (urlValue !== seen) {
    setSeen(urlValue);
    setDraft(urlValue);
  }
  const schedule = useDebounced(commit, delayMs);
  return [
    draft,
    (text) => {
      setDraft(text);
      schedule(text);
    },
  ];
};
