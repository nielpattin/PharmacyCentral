import { buildPagePath } from "../../lib/page-request.ts";
import { requestPage, type JsonRecord } from "../../staff-api.ts";

// Read-back walks every page, so a row beyond the first page is still found after an import.
const READ_BACK_PAGE_SIZE = "100";

export const readAllRows = async (path: string): Promise<JsonRecord[]> => {
  const rows: JsonRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await requestPage(buildPagePath(path, { limit: READ_BACK_PAGE_SIZE, cursor }));
    rows.push(...page.rows);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return rows;
};
