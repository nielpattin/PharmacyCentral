import type { Response } from "express";
import { z } from "zod";

import type { Page } from "../page-cursor.ts";

/**
 * The query every paged list shares. `limit` falls back to the endpoint default and the repository clamps it, so a
 * malformed value never fails a request that worked before. `q` is a case-insensitive substring match; each list names
 * the columns it searches in its own schema.
 */
export const pagedListQuery = z.object({
  limit: z.coerce.number().catch(100),
  q: z.string().trim().max(200).optional(),
});

/** The body is the plain array of the page; the cursor of the next page travels in `X-Next-Cursor`, and only then. */
export const sendPage = <T>(response: Response, page: Page<T>) => {
  if (page.nextCursor !== undefined) response.set("X-Next-Cursor", page.nextCursor);
  return response.json(page.rows);
};

export const invalidCursor = (response: Response) =>
  response
    .status(400)
    .type("application/problem+json")
    .json({ title: "Invalid cursor", status: 400, code: "invalid_cursor" });
