import type { ConsumeMessage } from "amqplib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../logger.ts";
import { SalesPaymentEventConsumer } from "./payment-event-consumer.ts";
import type { OrderStock } from "./orders/application/order-stock.ts";
import type { SalesRepository } from "./sales-repository.ts";

const broker = vi.hoisted(() => ({
  deliver: undefined as ((message: unknown) => void) | undefined,
  ack: vi.fn(),
  nack: vi.fn(),
}));

vi.mock("node:timers/promises", () => ({ setTimeout: async () => undefined }));
vi.mock("amqplib", () => {
  const channel = {
    on: () => undefined,
    assertExchange: async () => undefined,
    assertQueue: async () => undefined,
    bindQueue: async () => undefined,
    prefetch: async () => undefined,
    consume: async (_queue: string, callback: (message: unknown) => void) => {
      broker.deliver = callback;
    },
    ack: broker.ack,
    nack: broker.nack,
  };
  const connection = { on: () => undefined, close: async () => undefined, createChannel: async () => channel };
  return { default: { connect: async () => connection } };
});

const delivery = (body: string, acquired?: number) =>
  ({
    content: Buffer.from(body),
    properties: { headers: acquired === undefined ? {} : { "x-acquired-count": acquired } },
  }) as unknown as ConsumeMessage;
const paid = JSON.stringify({ eventType: "payment.invoice.paid.v1", payload: { orderId: "order-1" } });
const prescriptionPaid = JSON.stringify({
  eventType: "payment.invoice.paid.v1",
  payload: { orderId: null, prescriptionId: "prescription-1" },
});

/**
 * A payment event that cannot be applied must neither vanish nor loop: it is retried a few times, then rejected so the
 * broker parks it on the dead-letter queue, and a payload that can never be applied is parked at once.
 */
describe("SalesPaymentEventConsumer", () => {
  const applyPaymentStatus = vi.fn();
  const applyPrescriptionPaidAt = vi.fn();
  let consumer: SalesPaymentEventConsumer;

  beforeEach(async () => {
    broker.deliver = undefined;
    broker.ack.mockClear();
    broker.nack.mockClear();
    applyPaymentStatus.mockReset();
    applyPrescriptionPaidAt.mockReset();
    consumer = new SalesPaymentEventConsumer(
      { applyPaymentStatus, applyPrescriptionPaidAt } as unknown as SalesRepository,
      { cancelRefunded: async () => undefined } as unknown as OrderStock,
      createLogger({ level: "silent" }),
      "amqp://broker.test",
    );
    consumer.start();
    await vi.waitFor(() => expect(broker.deliver).toBeDefined());
  });

  afterEach(async () => {
    await consumer.close();
  });

  it("returns a failed event to the queue while attempts remain", async () => {
    applyPaymentStatus.mockRejectedValue(new Error("database down"));
    const message = delivery(paid, 1);

    broker.deliver?.(message);

    await vi.waitFor(() => expect(broker.nack).toHaveBeenCalledWith(message, false, true));
    expect(broker.ack).not.toHaveBeenCalled();
  });

  it("rejects an event without requeueing on its last attempt, so the broker dead-letters it", async () => {
    applyPaymentStatus.mockRejectedValue(new Error("database down"));
    const message = delivery(paid, 4);

    broker.deliver?.(message);

    await vi.waitFor(() => expect(broker.nack).toHaveBeenCalledWith(message, false, false));
  });

  it("dead-letters a payload that is not JSON without trying to apply it", async () => {
    const message = delivery("{not json");

    broker.deliver?.(message);

    await vi.waitFor(() => expect(broker.nack).toHaveBeenCalledWith(message, false, false));
    expect(applyPaymentStatus).not.toHaveBeenCalled();
  });

  it("acknowledges an event once the order is updated", async () => {
    applyPaymentStatus.mockResolvedValue(undefined);
    const message = delivery(paid);

    broker.deliver?.(message);

    await vi.waitFor(() => expect(broker.ack).toHaveBeenCalledWith(message));
    expect(applyPaymentStatus).toHaveBeenCalledWith("order-1", "Paid");
  });

  it("records the first payment of a counter prescription and acknowledges it", async () => {
    applyPrescriptionPaidAt.mockResolvedValue(undefined);
    const message = delivery(prescriptionPaid);

    broker.deliver?.(message);

    await vi.waitFor(() => expect(broker.ack).toHaveBeenCalledWith(message));
    expect(applyPrescriptionPaidAt).toHaveBeenCalledWith("prescription-1");
    expect(applyPaymentStatus).not.toHaveBeenCalled();
  });
});
