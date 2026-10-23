// Three malformed messages on the availability routing key. Two consumers are bound to that key (catalog directly,
// operations-query through "#") and both reject anything without the envelope they need, so the broker dead-letters
// the messages to their `.dead` queues. Valid events keep flowing, the dead-letter alert fires, and cleanup removes
// only the messages this run published.
import * as q from "../lib/queries.mjs";

const VUS = 10;
const EXCHANGE = "pharmacy.events";
const ROUTING_KEY = q.AVAILABILITY_EVENT;
const POISON_QUEUES = ["catalog.availability.v2.dead", "operations-query.events.v2.dead"];
const BYSTANDER = "sales.payment-events.v2.dead";
const MAIN_QUEUES = ["catalog.availability.v2", "operations-query.events.v2"];
const ALERT = "Dead-letter queue not empty";

function poisonMessages(runId) {
  return [
    { messageId: `chaos-poison-${runId}-1`, body: "{not json", label: "invalid JSON" },
    {
      messageId: `chaos-poison-${runId}-2`,
      body: JSON.stringify({ unexpected: true }),
      label: "no event envelope",
    },
    {
      messageId: `chaos-poison-${runId}-3`,
      body: JSON.stringify({
        eventId: `chaos-poison-${runId}-3`,
        eventType: ROUTING_KEY,
        payload: { productId: "not-a-uuid" },
      }),
      label: "availability event without siteId or occurredAt",
    },
  ];
}

async function deadCounts(ctx) {
  const names = [...POISON_QUEUES, BYSTANDER];
  const queues = await Promise.all(names.map((name) => ctx.rabbit.queue(name)));
  return Object.fromEntries(names.map((name, index) => [name, queues[index].messages]));
}

async function mainQueuesIdle(ctx) {
  const queues = await Promise.all(MAIN_QUEUES.map((name) => ctx.rabbit.queue(name)));
  return queues.every((queue) => queue.messages_ready + queue.messages_unacknowledged === 0);
}

export default {
  name: "poison-message",
  description: "Three malformed availability messages: they dead-letter, valid events keep flowing, alert fires",
  plan: [
    "t+0 start k6 checkout load; wait 20 s for steady state and record the dead-letter queue depths",
    "publish 3 malformed messages (invalid JSON, no envelope, incomplete event) to pharmacy.events",
    "wait until both bound dead-letter queues hold all three and the main consumer queues are idle",
    "check the queue bound only to payment keys is untouched, valid events keep being applied, and the alert fires",
    "stop the load, purge only the messages this run published, and confirm the depths are back to baseline",
  ],

  async preflight(ctx) {
    const counts = await deadCounts(ctx);
    ctx.check("dry run: dead-letter queue depths readable", true, JSON.stringify(counts));
    ctx.check("dry run: main consumer queues readable", true, (await mainQueuesIdle(ctx)) ? "idle" : "busy");
    ctx.check("dry run: alert state readable", true, String((await ctx.alerts())[ALERT]));
    ctx.check(
      "dry run: applied-event progress query",
      true,
      `${await q.reportRowsWritten(new Date(0), new Date())} rows`,
    );
    ctx.note(
      `dry run: would publish ${poisonMessages("dry")
        .map((item) => item.label)
        .join("; ")}`,
    );
  },

  async run(ctx) {
    const runId = Date.now().toString(36);
    const messages = poisonMessages(runId);
    let baseline = {};
    try {
      ctx.load.start({ duration: ctx.duration, vus: VUS });
      await ctx.sleep(20_000);
      baseline = await deadCounts(ctx);
      ctx.onCleanup("purge this run's poison messages", async () => {
        for (const name of POISON_QUEUES) {
          const removed = await ctx.rabbit.purge(name);
          ctx.note(`purged ${removed} messages of this run from ${name}`);
        }
      });

      const injectedAt = new Date();
      const routed = [];
      for (const { messageId, body, label } of messages) {
        routed.push(await ctx.rabbit.publish(EXCHANGE, ROUTING_KEY, body, { messageId }));
        ctx.note(`published ${messageId} (${label})`);
      }
      ctx.check("broker routed all three poison messages", routed.every(Boolean), routed.join(","));

      await ctx.waitFor(
        "poison messages parked on both bound dead-letter queues",
        async () => {
          const counts = await deadCounts(ctx);
          return POISON_QUEUES.every((name) => counts[name] - baseline[name] >= messages.length);
        },
        { timeoutMs: 120_000, intervalMs: 3_000 },
      );
      const parked = await deadCounts(ctx);
      ctx.check(
        "each bound dead-letter queue holds exactly the three poison messages",
        POISON_QUEUES.every((name) => parked[name] - baseline[name] === messages.length),
        JSON.stringify(parked),
      );
      ctx.check(
        "queue bound only to payment keys received none",
        parked[BYSTANDER] === baseline[BYSTANDER],
        `${parked[BYSTANDER]}`,
      );

      await ctx.waitFor("main consumer queues idle", () => mainQueuesIdle(ctx), {
        timeoutMs: 120_000,
        intervalMs: 3_000,
      });
      ctx.check("main consumer queues back to zero ready and unacked", true);

      const before = await q.reportRowsWritten(injectedAt, new Date());
      await ctx.sleep(30_000);
      const after = await q.reportRowsWritten(injectedAt, new Date());
      ctx.check(
        "operations read model keeps applying valid events after the poison",
        after > before,
        `${before} -> ${after} rows`,
      );

      await ctx.waitFor(`alert "${ALERT}" firing`, async () => (await ctx.alerts())[ALERT] === "firing", {
        timeoutMs: 300_000,
        intervalMs: 10_000,
      });
      ctx.check(`alert "${ALERT}" reached firing`, true);
    } finally {
      await ctx.load.stop();
      await ctx.restoreAll();
      // The management API refreshes queue depths every few seconds, so a read right after the purge can be stale.
      const atBaseline = (counts) =>
        [...POISON_QUEUES, BYSTANDER].every((name) => counts[name] === (baseline[name] ?? 0));
      let remaining = await deadCounts(ctx);
      for (let attempt = 0; attempt < 6 && !atBaseline(remaining); attempt++) {
        await ctx.sleep(2_000);
        remaining = await deadCounts(ctx);
      }
      ctx.check(
        "dead-letter queues are back to their baseline after cleanup",
        atBaseline(remaining),
        JSON.stringify(remaining),
      );
    }
  },
};
