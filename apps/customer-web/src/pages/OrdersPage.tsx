import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@pharmacy/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  listOrders,
  listStores,
  resolveCustomerSession,
  type CatalogStore,
  type CustomerOrder,
} from "../customer-api.ts";
import { useSession } from "../auth.ts";
import { OrderHistory } from "../components/checkout/OrderHistory.tsx";
import { Link } from "../components/storefront/Link.tsx";
import { SiteFooter } from "../components/storefront/SiteFooter.tsx";
import { SiteHeader } from "../components/storefront/SiteHeader.tsx";
import { IconChevronRight } from "../components/storefront/icons.tsx";

/**
 * A SePay webhook or a pharmacy status change lands here while the list is open, so the page keeps re-reading
 * instead of freezing whichever statuses it saw first.
 */
const REFRESH_INTERVAL_MS = 10_000;

/** Where a signed-out visitor has to go: the customer sign-in form lives on the account page. */
const ACCOUNT_LOCATION = { to: "/tai-khoan", search: { section: "tong-quan" } } as const;

/** Both states the page shows before it can answer: an empty list must never stand in for either of them. */
const NoticeCard = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <Card>
    <CardContent className="py-10 text-center text-sm text-muted" role="status">
      {children}
    </CardContent>
  </Card>
);

/**
 * The shopper's own page for the orders they placed. It resolves the session itself: a deep link or a reload must
 * not depend on another page having probed `/api/auth/me` first.
 */
export const OrdersPage = (): React.JSX.Element => {
  const session = useSession();
  const navigate = useNavigate();
  const ordersQuery = useQuery({
    // This page is the only owner of the shopper's order list: the checkout page invalidates this key after an order.
    queryKey: ["customer-orders"],
    queryFn: async () => {
      const customer = await resolveCustomerSession();
      if (!customer) return { orders: [] as CustomerOrder[], stores: [] as CatalogStore[] };
      const [orders, stores] = await Promise.all([listOrders(), listStores()]);
      return { orders, stores };
    },
    refetchInterval: session.authenticated ? REFRESH_INTERVAL_MS : false,
  });
  const orders = ordersQuery.data?.orders ?? [];
  const stores = ordersQuery.data?.stores ?? [];
  const loadError = ordersQuery.error instanceof Error ? ordersQuery.error.message : undefined;
  const loading = ordersQuery.isPending && !ordersQuery.data;

  const ordersBody = (): React.JSX.Element => {
    if (!session.resolved) return <NoticeCard>Đang kiểm tra đăng nhập…</NoticeCard>;
    if (!session.authenticated)
      return (
        <Card>
          <CardHeader>
            <CardTitle>Đăng nhập để xem đơn hàng</CardTitle>
            <CardDescription>
              Đơn hàng gắn với tài khoản khách hàng, nên hãy đăng nhập trước khi theo dõi chúng.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={() => void navigate(ACCOUNT_LOCATION)}>
              Đăng nhập
            </Button>
          </CardContent>
        </Card>
      );
    if (loading) return <NoticeCard>Đang tải đơn hàng…</NoticeCard>;
    return <OrderHistory orders={orders} stores={stores} />;
  };

  return (
    <div className="min-h-screen bg-background text-ink">
      <SiteHeader
        storeCount={stores.length || undefined}
        onSearch={(term) => void navigate({ to: "/", search: { q: term } })}
      />

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <nav aria-label="Đường dẫn" className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Link className="hover:text-primary" href="/">
            Trang chủ
          </Link>
          <IconChevronRight className="size-3" />
          <span className="font-medium text-ink">Đơn hàng của tôi</span>
        </nav>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink sm:text-2xl">Đơn hàng của tôi</h1>
            <p className="mt-1 text-sm text-muted">
              Trạng thái soạn thuốc, thanh toán và giao hàng của những đơn bạn đã đặt.
            </p>
          </div>
          {session.authenticated ? (
            <Button
              type="button"
              variant="outline"
              disabled={ordersQuery.isFetching}
              onClick={() => void ordersQuery.refetch()}
            >
              Làm mới
            </Button>
          ) : null}
        </div>

        {loadError ? <Alert variant="danger">{loadError}</Alert> : null}

        {ordersBody()}
      </main>

      <SiteFooter />
    </div>
  );
};
