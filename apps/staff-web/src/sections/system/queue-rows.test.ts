import { describe, expect, it } from "vitest";

import type { SystemQueue } from "../../staff-api.ts";
import { buildQueueRows, queueTotals } from "./queue-rows.ts";

const queue = (overrides: Partial<SystemQueue> = {}): SystemQueue => ({
  name: "orders",
  ready: 4,
  unacknowledged: 2,
  consumers: 1,
  deadLetter: false,
  ...overrides,
});

describe("buildQueueRows", () => {
  it("treats a consumed queue as ok whatever its backlog", () => {
    const [row] = buildQueueRows([queue({ ready: 5000 })]);
    expect(row).toMatchObject({ status: "ok", tone: "ok" });
  });

  it("warns on a queue with no consumers, even when it is empty, because nothing can process it", () => {
    const [row] = buildQueueRows([queue({ consumers: 0, ready: 0, unacknowledged: 0 })]);
    expect(row).toMatchObject({ status: "no_consumers", tone: "warning" });
  });

  it("is danger for a dead letter queue holding messages, and ok for an empty one", () => {
    const [full, empty] = buildQueueRows([
      queue({ name: "a.dead", deadLetter: true, consumers: 0, ready: 3, unacknowledged: 0 }),
      queue({ name: "b.dead", deadLetter: true, consumers: 0, ready: 0, unacknowledged: 0 }),
    ]);
    expect(full).toMatchObject({ name: "a.dead", status: "dead_letter", tone: "danger" });
    expect(empty).toMatchObject({ name: "b.dead", status: "ok", tone: "ok" });
  });

  it("puts the rows that need attention first, then orders by name", () => {
    const rows = buildQueueRows([
      queue({ name: "b" }),
      queue({ name: "a" }),
      queue({ name: "c", consumers: 0 }),
      queue({ name: "d.dead", deadLetter: true, consumers: 0, ready: 1 }),
    ]);
    expect(rows.map((row) => row.name)).toEqual(["d.dead", "c", "a", "b"]);
  });
});

describe("queueTotals", () => {
  it("counts the rows that need attention", () => {
    const rows = buildQueueRows([queue(), queue({ name: "x", consumers: 0, ready: 1, unacknowledged: 0 })]);
    expect(queueTotals(rows)).toEqual({ needAttention: 1 });
  });
});
