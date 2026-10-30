import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@pharmacy/ui";

import { useConfirm, usePrompt } from "../../components/confirm.tsx";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { useSession } from "../../auth.ts";
import { canAtSite } from "../../permissions/staff-permissions.ts";
import { translateText } from "../../i18n.ts";
import { idOf, text, type JsonRecord } from "../../staff-api.ts";
import { FINANCE_SUMMARY_KEY, INVOICES_KEY } from "../finance/query-keys.ts";
import { canRecordOrderCash, canRefundOrder, orderFacts, orderMoves } from "./rules.ts";

const ORDERS_KEY = ["staff-orders"] as const;
const AUDIT_KEY = ["staff-audit-history"] as const;
const ORDER_INVOICE_KEY = [...INVOICES_KEY, "order"] as const;

/** Payment-service tells sales-service about a payment through the message bus, so the order catches up a moment later. */
const ORDER_CATCH_UP_MS = [1500, 4000] as const;

/**
 * What a Pharmacist or Pharmacy Manager does with an online order from its drawer: the next status, the cash taken on
 * delivery (Pharmacist), and the refund of a paid order (Pharmacy Manager). Each control is offered only when the order's
 * status, its payment and the signed-in role allow it, so the server's 409 answers are rare. It renders nothing otherwise.
 */
export const OrderActions = ({ order }: { order: JsonRecord }): React.JSX.Element | null => {
  const session = useSession();
  const siteId = text(order.selectedStoreId, "") || undefined;
  const moveGate = canAtSite("order.transition", session, siteId);
  const cashGate = canAtSite("payment.confirmCash", session, siteId);
  const refundGate = canAtSite("payment.refund", session, siteId);
  const orderId = idOf(order);
  const invoices = usePagedList({
    key: ORDER_INVOICE_KEY,
    path: "/api/payments/invoices",
    params: { q: orderId },
    limit: 20,
  });
  const run = useStaffAction();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const prompt = usePrompt();
  if (!moveGate.allowed) return null;

  const facts = orderFacts(order);
  const invoice = invoices.rows.find(
    (row) => text(row.orderId, "") === orderId && ["Pending", "Paid"].includes(text(row.status, "")),
  );
  const invoiceStatus = text(invoice?.status, "");
  const invalidate = [ORDERS_KEY, AUDIT_KEY, INVOICES_KEY, FINANCE_SUMMARY_KEY];

  const move = async (status: string, label: string): Promise<void> => {
    if (
      status === "Cancelled" &&
      !(await confirm({ title: "Cancel this order?", tone: "danger", confirmLabel: label }))
    )
      return;
    await run({
      path: `/api/orders/${encodeURIComponent(orderId)}/transition`,
      body: { status },
      invalidate,
      success: "Order updated.",
    });
  };

  // The order's payment status follows a cash or refund write through the bus; read the order again once it has.
  const refreshOrderLater = (): void => {
    for (const delay of ORDER_CATCH_UP_MS)
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
        void queryClient.invalidateQueries({ queryKey: AUDIT_KEY });
      }, delay);
  };

  const recordCash = async (): Promise<void> => {
    if (!invoice) return;
    const accepted = await confirm({
      title: "Confirm cash payment?",
      description: "Confirm only once the cash is in the drawer.",
      confirmLabel: "Confirm cash",
    });
    if (!accepted) return;
    const done = await run({
      path: `/api/payments/${encodeURIComponent(idOf(invoice))}/confirm-counter`,
      invalidate,
      success: "Cash payment confirmed.",
    });
    if (done) refreshOrderLater();
  };

  const refund = async (): Promise<void> => {
    if (!invoice) return;
    const reason = await prompt({
      title: "Refund payment",
      label: "Refund reason:",
      required: true,
      defaultValue: translateText("Operational correction"),
      confirmLabel: "Refund",
    });
    if (reason === null) return;
    const done = await run({
      path: `/api/payments/${encodeURIComponent(idOf(invoice))}/refund`,
      body: { reason },
      invalidate,
      success: "Payment refunded.",
    });
    if (done) refreshOrderLater();
  };

  const moves = orderMoves(facts);
  const showCash = cashGate.allowed && invoice !== undefined && canRecordOrderCash(facts, invoiceStatus);
  const showRefund = refundGate.allowed && invoice !== undefined && canRefundOrder(facts, invoiceStatus);
  if (moves.length === 0 && !showCash && !showRefund) return null;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={translateText("Order actions")}>
      {moves.map((next) => (
        <Button
          key={next.status}
          variant={next.status === "Cancelled" ? "danger-ghost" : "primary"}
          onClick={() => void move(next.status, translateText(next.label))}
        >
          {translateText(next.label)}
        </Button>
      ))}
      {showCash ? (
        <Button variant="secondary" onClick={() => void recordCash()}>
          {translateText("Confirm cash received")}
        </Button>
      ) : null}
      {showRefund ? (
        <Button variant="danger-ghost" onClick={() => void refund()}>
          {translateText("Refund and cancel order")}
        </Button>
      ) : null}
    </div>
  );
};
