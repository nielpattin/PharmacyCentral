import { requiredEnv } from "./env.mjs";

// The default vhost "/" is `%2F` in the management API path.
const VHOST = "%2F";

async function call(method, path, body) {
  const token = Buffer.from(`${requiredEnv("RABBITMQ_USER")}:${requiredEnv("RABBITMQ_PASSWORD")}`).toString("base64");
  const response = await fetch(`http://127.0.0.1:${requiredEnv("RABBITMQ_MANAGEMENT_PORT")}/api${path}`, {
    method,
    headers: { Authorization: `Basic ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`RabbitMQ ${method} ${path.split("?")[0]} answered HTTP ${response.status}`);
  const text = await response.text();
  return text === "" ? undefined : JSON.parse(text);
}

const queuePath = (name) => `/queues/${VHOST}/${encodeURIComponent(name)}`;

/**
 * Peeks at up to `count` messages without consuming them: they are rejected with requeue, so they stay in place.
 * Quorum queues may reorder a peeked batch, which is harmless for a dead-letter queue.
 */
async function peek(name, count) {
  return call("POST", `${queuePath(name)}/get`, {
    count,
    ackmode: "reject_requeue_true",
    encoding: "auto",
    truncate: 50_000,
  });
}

export const rabbit = {
  queues: () => call("GET", `/queues/${VHOST}`),
  queue: (name) => call("GET", queuePath(name)),

  /** Publishes one persistent message as `messageId`; resolves with whether any queue took it. */
  async publish(exchange, routingKey, payload, { messageId }) {
    const response = await call("POST", `/exchanges/${VHOST}/${encodeURIComponent(exchange)}/publish`, {
      properties: { message_id: messageId, delivery_mode: 2, content_type: "application/json" },
      routing_key: routingKey,
      payload,
      payload_encoding: "string",
    });
    return response.routed === true;
  },

  /**
   * Empties a queue, but only when every message in it is one this run published (`messageIds`). The management API
   * cannot delete single messages, so the queue must hold nothing else; otherwise nothing is removed and it throws.
   */
  async purge(name, { messageIds }) {
    const ids = new Set(messageIds);
    const { messages } = await rabbit.queue(name);
    if (messages === 0) return 0;
    const held = await peek(name, messages);
    if (held.length !== messages) throw new Error(`${name}: could not read all ${messages} messages; not purged`);
    const foreign = held.filter((message) => !ids.has(message.properties?.message_id));
    if (foreign.length > 0) {
      throw new Error(`${name} holds ${foreign.length} messages this run did not publish; not purged`);
    }
    await call("DELETE", `${queuePath(name)}/contents`);
    return messages;
  },
};
