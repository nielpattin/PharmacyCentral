// payment-service stopped for 60 s mid-checkout. The SePay webhook is refused while it is down and orders wait. After
// restart the transfer is replayed twice: payment-service answers 200 to both (duplicates are absorbed), yet only one
// provider transaction is recorded, the invoice is paid once at its unchanged amount, and sales catches up.
import * as q from "../lib/queries.mjs";
import { ACCOUNTS } from "../lib/gateway.mjs";
import { openInvoice, placeOrder, sellableLine, transferFor } from "../lib/shop.mjs";

const VUS = 10;
const OUTAGE_MS = 60_000;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const orderTotal = (order) => Number(order.subtotal) + Number(order.deliveryFee);

export default {
  name: "payment-outage",
  description: "payment-service down 60 s mid-checkout: webhook refused, orders wait, replay pays exactly once",
  plan: [
    "t+0 start k6 checkout load; place order A and open its invoice while payment is up",
    "t+20s stop payment-service; send order A's transfer (expect refusal); place order B and try to open its invoice",
    "after 60 s restart payment-service; replay order A's transfer twice (both answer 200 on a valid signature)",
    "check one provider transaction, one paid invoice at the unchanged amount, and that sales marks order A paid",
  ],

  async preflight(ctx) {
    const invoices = await ctx.sqlNumber(q.PAYMENT, "select count(*) from payment_invoices");
    ctx.check("dry run: invoice table readable", true, `${invoices} invoices`);
    ctx.check("dry run: invoice state query", (await q.invoiceState(ZERO_UUID)) === null, "no row for an unknown id");
    ctx.check("dry run: transaction count query", (await q.sepayTransactionCount("chaos-dry-run")) === 0);
    ctx.check("dry run: invoices per order query", (await q.invoicesForOrder(ZERO_UUID)) === 0);
    ctx.check(
      "dry run: reconciliation table readable",
      true,
      `${await ctx.sqlNumber(q.PAYMENT, "select count(*) from payment_reconciliation")} rows`,
    );
  },

  async run(ctx) {
    const runId = Date.now().toString(36);
    const transactionId = `chaos-pay-${runId}`;
    try {
      ctx.load.start({ duration: ctx.duration, vus: VUS });
      const customer = await ctx.gateway.login(ACCOUNTS.customer);
      await ctx.sleep(20_000);

      const { store, line } = await sellableLine(customer);
      const orderA = await placeOrder(customer, store.id, "sepay_qr", [line]);
      if (orderA.status !== 201) throw new Error(`order A was not placed (status ${orderA.status})`);
      const invoiceA = await openInvoice(customer, orderA.body, "sepay_qr");
      if (invoiceA.status !== 201) throw new Error(`invoice A was not created (status ${invoiceA.status})`);
      const amountA = Number(invoiceA.body.amount);
      const transfer = transferFor(invoiceA.body, transactionId);

      await ctx.compose.stop("payment-service");
      const stoppedAt = Date.now();
      const refused = await ctx.webhook(transfer);
      ctx.check(
        "SePay webhook is refused while payment-service is down",
        refused.status !== 200,
        `status ${refused.status}`,
      );

      const { store: storeB, line: lineB } = await sellableLine(customer);
      const orderB = await placeOrder(customer, storeB.id, "sepay_qr", [lineB]);
      const invoiceB = orderB.status === 201 ? await openInvoice(customer, orderB.body, "sepay_qr") : undefined;
      ctx.check("order placed during the outage", orderB.status === 201, `status ${orderB.status}`);
      ctx.check(
        "no invoice is created for an order during the outage",
        invoiceB !== undefined && invoiceB.status !== 201,
        `status ${invoiceB?.status ?? "-"}`,
      );

      const during = await customer.get(`/api/orders/${orderA.body.id}`);
      ctx.check(
        "order A stays pending while payment-service is down",
        during.body?.paymentStatus === "Pending",
        `paymentStatus ${during.body?.paymentStatus}`,
      );

      const remaining = OUTAGE_MS - (Date.now() - stoppedAt);
      if (remaining > 0) await ctx.sleep(remaining);
      await ctx.compose.start("payment-service");
      await ctx.compose.waitHealthy("payment-service", 180_000);

      const first = await ctx.webhook(transfer);
      const replay = await ctx.webhook(transfer);
      ctx.check(
        "first replay after restart is accepted",
        first.status === 200 && first.body?.success === true,
        `status ${first.status}`,
      );
      ctx.check(
        "second replay of the same transfer is absorbed (200, no second payment)",
        replay.status === 200 && replay.body?.success === true,
        `status ${replay.status}`,
      );

      const transactions = await q.sepayTransactionCount(transactionId);
      ctx.check("exactly one provider transaction recorded for the transfer", transactions === 1, `${transactions}`);

      const invoice = await q.invoiceState(invoiceA.body.id);
      ctx.check("invoice A is paid", invoice?.status === "Paid", `status ${invoice?.status}`);
      ctx.check(
        "invoice A amount equals the order total and is unchanged",
        Number(invoice?.amount) === amountA && amountA === orderTotal(orderA.body),
        `${invoice?.amount} vs order ${orderTotal(orderA.body)}`,
      );
      ctx.check("invoice A received exactly its amount", Number(invoice?.received) === amountA, `${invoice?.received}`);
      ctx.check("order A has exactly one invoice", invoice?.invoicesOnOrder === 1, `${invoice?.invoicesOnOrder}`);

      await ctx.waitFor(
        "sales marks order A paid",
        async () => (await customer.get(`/api/orders/${orderA.body.id}`)).body?.paymentStatus === "Paid",
        {
          timeoutMs: 120_000,
          intervalMs: 3_000,
        },
      );
      ctx.check("sales caught up with the payment event for order A", true);

      ctx.check(
        "order B has no invoice at payment-service",
        (await q.invoicesForOrder(orderB.body?.id ?? ZERO_UUID)) === 0,
      );
    } finally {
      await ctx.load.stop();
      await ctx.restoreAll();
    }
  },
};
