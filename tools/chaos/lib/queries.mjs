// Read-only SQL the scenarios assert on. Every export is a select, so the dry run can call them as they are.
// Databases are the per-service ones from docker-compose.yml (`<service>_service`).
import { sqlJson, sqlNumber } from "./postgres.mjs";

export const INVENTORY = "inventory_service";
export const SALES = "sales_service";
export const PAYMENT = "payment_service";
export const CATALOG = "catalog_service";
export const OPERATIONS = "operations_query_service";

/** Every service with an outbox relays its rows to `pharmacy.events`. */
export const OUTBOX_DATABASES = [INVENTORY, SALES, PAYMENT];
export const DEAD_QUEUES = [
  "catalog.availability.v2.dead",
  "operations-query.events.v2.dead",
  "sales.payment-events.v2.dead",
];
export const AVAILABILITY_EVENT = "inventory.availability.changed.v1";
export const PAID_EVENT = "payment.invoice.paid.v1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_.-]+$/;
const PREFIX = /^[a-z.-]+$/;
const CHUNK = 200;

const uuidLiteral = (value) => {
  if (!UUID.test(value)) throw new Error(`Not a UUID: ${value}`);
  return value;
};
const tokenLiteral = (value) => {
  if (!TOKEN.test(value)) throw new Error(`Not a plain identifier: ${value}`);
  return value;
};
const prefixLiteral = (value) => {
  if (!PREFIX.test(value)) throw new Error(`Invalid event prefix: ${value}`);
  return value;
};

/** A timestamptz literal for a Date or ISO string. */
export const ts = (value) => `'${new Date(value).toISOString()}'::timestamptz`;

const windowFilter = (from, to) => `occurred_at >= ${ts(from)} and occurred_at <= ${ts(to)}`;

/** Count and md5 digest of a set of text keys, sorted, so two databases can be compared without moving the rows. */
const digestOf = (query) =>
  sqlJson(
    query.db,
    `select json_build_object('count', count(*), 'digest', coalesce(md5(string_agg(k, ',' order by k)), 'none'))
     from (${query.keys}) s`,
  );

export const outboxUnpublished = (db) =>
  sqlNumber(db, `select count(*) from outbox_messages where published_at is null`);

/** Unpublished rows older than `seconds`: a backlog the relay should already have sent. */
export const outboxUnpublishedOlderThan = (db, seconds) =>
  sqlNumber(
    db,
    `select count(*) from outbox_messages where published_at is null and occurred_at < now() - interval '${Number(seconds)} seconds'`,
  );

export const outboxWritten = (db, from, to) =>
  sqlNumber(db, `select count(*) from outbox_messages where ${windowFilter(from, to)}`);

/** Rows of one event family, e.g. prefix `sales.`. */
export const outboxWrittenOfType = (db, prefix, from, to) =>
  sqlNumber(
    db,
    `select count(*) from outbox_messages where event_type like '${prefixLiteral(prefix)}%' and ${windowFilter(from, to)}`,
  );

export const outboxUnpublishedWritten = (db, from, to) =>
  sqlNumber(db, `select count(*) from outbox_messages where published_at is null and ${windowFilter(from, to)}`);

export const outboxUnpublishedBefore = (db, before) =>
  sqlNumber(db, `select count(*) from outbox_messages where published_at is null and occurred_at < ${ts(before)}`);

/** Rows the operations read model recorded: one per event it applied, keyed by the event id. */
export const reportRowsWritten = (from, to) =>
  sqlNumber(OPERATIONS, `select count(*) from report_rows where ${windowFilter(from, to)}`);

/** Distinct event ids among those rows: equal to `reportRowsWritten` only when no event was applied twice. */
export const reportRowsDistinctEvents = (from, to) =>
  sqlNumber(OPERATIONS, `select count(distinct event_id) from report_rows where ${windowFilter(from, to)}`);

export const reportRowsWrittenOfPrefix = (prefix, from, to) =>
  sqlNumber(
    OPERATIONS,
    `select count(*) from report_rows where report_type like '${prefixLiteral(prefix)}%' and ${windowFilter(from, to)}`,
  );

export const reportRowsDistinctEventsOfPrefix = (prefix, from, to) =>
  sqlNumber(
    OPERATIONS,
    `select count(distinct event_id) from report_rows where report_type like '${prefixLiteral(prefix)}%' and ${windowFilter(from, to)}`,
  );

/** Order ids named by the paid events written in the window. */
export async function paidOrderIds(from, to) {
  const ids = await sqlJson(
    PAYMENT,
    `select coalesce(json_agg(distinct payload::json->>'orderId'), '[]'::json) from outbox_messages
     where event_type = '${PAID_EVENT}' and ${windowFilter(from, to)} and payload::json->>'orderId' is not null`,
  );
  return ids ?? [];
}

/** How many of the given orders sales-service has marked paid. */
export async function countPaidOrders(ids) {
  let total = 0;
  for (let start = 0; start < ids.length; start += CHUNK) {
    const literal = ids
      .slice(start, start + CHUNK)
      .map((id) => `'${uuidLiteral(id)}'`)
      .join(",");
    total += await sqlNumber(
      SALES,
      `select count(*) from orders where payment_status = 'Paid' and id::text in (${literal})`,
    );
  }
  return total;
}

/** An invoice's status, amount (text), the number of invoices on its order, and what the reconciliation received. */
export const invoiceState = (invoiceId) =>
  sqlJson(
    PAYMENT,
    `select json_build_object('status', i.status, 'amount', i.amount::text,
            'invoicesOnOrder', (select count(*) from payment_invoices x where x.order_id = i.order_id),
            'received', r.received_amount::text)
     from payment_invoices i
     left join payment_reconciliation r on r.payment_invoice_id = i.id
     where i.id = '${uuidLiteral(invoiceId)}'`,
  );

/** Provider transactions recorded for one SePay transfer id; idempotency means this is at most 1. */
export const sepayTransactionCount = (transactionId) =>
  sqlNumber(
    PAYMENT,
    `select count(*) from payment_transactions where provider = 'sepay' and provider_transaction_id = '${tokenLiteral(transactionId)}'`,
  );

export const invoicesForOrder = (orderId) =>
  sqlNumber(PAYMENT, `select count(*) from payment_invoices where order_id = '${uuidLiteral(orderId)}'`);

/**
 * Availability read model: a digest of `productId|siteId|inStock` for every projection row in catalog. Compared with
 * the digest of the latest availability event per pair, so equal digests mean every change was applied.
 */
export const catalogAvailabilityDigest = () =>
  digestOf({
    db: CATALOG,
    keys: `select product_id::text || '|' || site_id::text || '|' || case when in_stock then 'true' else 'false' end as k
           from availability_projections`,
  });

export const inventoryLatestAvailabilityDigest = () =>
  digestOf({
    db: INVENTORY,
    keys: `select distinct on (payload::json->>'productId', payload::json->>'siteId')
             (payload::json->>'productId') || '|' || (payload::json->>'siteId') || '|' || (payload::json->>'inStock') as k
           from outbox_messages where event_type = '${AVAILABILITY_EVENT}'
           order by payload::json->>'productId', payload::json->>'siteId', occurred_at desc`,
  });

/**
 * Pairs whose latest availability event disagrees with the stock now: free stock (on hand minus reserved) over the
 * sellable batches (released and not expired) is above zero exactly when the event says in stock.
 */
export const inventoryAvailabilityMismatches = () =>
  sqlNumber(
    INVENTORY,
    `with latest as (
       select distinct on (payload::json->>'productId', payload::json->>'siteId')
              (payload::json->>'productId')::uuid as product_id,
              (payload::json->>'siteId')::uuid as site_id,
              (payload::json->>'inStock')::boolean as in_stock
       from outbox_messages where event_type = '${AVAILABILITY_EVENT}'
       order by payload::json->>'productId', payload::json->>'siteId', occurred_at desc),
     free as (
       select p.product_id, b.site_id,
              coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0) > 0 as in_stock
       from inventory_balances b
       join product_batches p on p.id = b.product_batch_id
       where p.quality_status = 'Released' and p.expiry_date >= (now() at time zone 'utc')::date
       group by p.product_id, b.site_id)
     select count(*) from latest l
     left join free f on f.product_id = l.product_id and f.site_id = l.site_id
     where coalesce(f.in_stock, false) <> l.in_stock`,
  );

/** Balances whose reserved quantity differs from the lines of active reservations on that batch and location. */
export const reservationDrift = () =>
  sqlNumber(
    INVENTORY,
    `select count(*) from (
       select b.id from inventory_balances b
       left join (stock_reservation_lines l join stock_reservations r on r.id = l.reservation_id and r.status = 'active')
         on l.product_batch_id = b.product_batch_id and l.storage_location_id = b.storage_location_id
       group by b.id, b.quantity_reserved
       having b.quantity_reserved <> coalesce(sum(l.quantity), 0)) d`,
  );

/** Lines that still hold stock although their reservation was released or consumed. */
export const heldLinesOnInactiveReservations = () =>
  sqlNumber(
    INVENTORY,
    `select count(*) from stock_reservation_lines l
     join stock_reservations r on r.id = l.reservation_id
     where r.status <> 'active' and l.quantity > 0`,
  );

/**
 * Orders sales-service holds stock for: `stock_hold = 'held'`, as a count and digest of order ids. With `since`, only
 * orders created from then on, so data left by earlier runs does not count against this one.
 */
export const heldOrderDigest = (since) =>
  digestOf({
    db: SALES,
    keys: `select id::text as k from orders where stock_hold = 'held'${since ? ` and created_at >= ${ts(since)}` : ""}`,
  });

/** Reservations inventory still treats as active, keyed by their owner (the order id), as a count and digest. */
export const activeReservationOwnerDigest = (since) =>
  digestOf({
    db: INVENTORY,
    keys: `select owner_id::text as k from stock_reservations where status = 'active'${since ? ` and created_at >= ${ts(since)}` : ""}`,
  });

export const ordersWithoutLines = () =>
  sqlNumber(
    SALES,
    `select count(*) from orders o where not exists (select 1 from order_lines l where l.order_id = o.id)`,
  );

/** Orders cancelled while still holding stock: the sweep should give every one of them back within a minute. */
export const cancelledOrdersHolding = () =>
  sqlNumber(SALES, `select count(*) from orders where status = 'Cancelled' and stock_hold = 'held'`);

/** Unpaid orders still holding stock from before `before`: they wait for the expiry sweep. */
export const pendingOrdersHoldingSince = (before) =>
  sqlNumber(
    SALES,
    `select count(*) from orders where status = 'Pending' and stock_hold = 'held' and created_at < ${ts(before)}`,
  );
