import { describe, expect, it } from "vitest";

import { withActionColumn } from "./action-column.ts";

const columns = [{ key: "name" }, { key: "status" }, { key: "actions" }];

describe("withActionColumn", () => {
  it("removes the actions column when no row has an action", () => {
    expect(withActionColumn(columns, false).map((column) => column.key)).toEqual(["name", "status"]);
  });

  it("keeps every column, in order, when at least one row has an action", () => {
    expect(withActionColumn(columns, true)).toEqual(columns);
  });

  it("leaves a table without an actions column unchanged", () => {
    const plain = [{ key: "name" }];
    expect(withActionColumn(plain, false)).toEqual(plain);
  });
});
