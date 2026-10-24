// View-models for the Queues card. Pure.
//
// Queues follow the usual RabbitMQ monitoring guidance: messages waiting or unacknowledged are read against the number
// of consumers, a queue that nobody consumes is a fault, and a dead letter queue is a fault only while it holds messages.
import type { SystemQueue } from "../../staff-api.ts";
import type { HealthTone } from "./health.ts";

const TONE_RANK: Record<HealthTone, number> = { ok: 0, warning: 1, danger: 2 };

/** Worst first, then by name, so the rows that need attention are on top. */
const byAttention = <Row extends { name: string; tone: HealthTone }>(a: Row, b: Row): number =>
  TONE_RANK[b.tone] - TONE_RANK[a.tone] || a.name.localeCompare(b.name);

export type QueueStatus = "ok" | "no_consumers" | "dead_letter";

export type QueueRow = {
  name: string;
  ready: number;
  unacknowledged: number;
  consumers: number;
  status: QueueStatus;
  tone: HealthTone;
};

export const buildQueueRows = (queues: ReadonlyArray<SystemQueue>): QueueRow[] =>
  queues
    .map((queue): QueueRow => {
      const holdsMessages = queue.ready + queue.unacknowledged > 0;
      const base = {
        name: queue.name,
        ready: queue.ready,
        unacknowledged: queue.unacknowledged,
        consumers: queue.consumers,
      };
      if (queue.deadLetter) {
        return holdsMessages
          ? { ...base, status: "dead_letter", tone: "danger" }
          : { ...base, status: "ok", tone: "ok" };
      }
      if (queue.consumers === 0) return { ...base, status: "no_consumers", tone: "warning" };
      return { ...base, status: "ok", tone: "ok" };
    })
    .sort(byAttention);

export type QueueTotals = { needAttention: number };

export const queueTotals = (rows: ReadonlyArray<QueueRow>): QueueTotals => ({
  needAttention: rows.filter((row) => row.tone !== "ok").length,
});
