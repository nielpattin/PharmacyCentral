import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  Skeleton,
} from "@pharmacy/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  forShopper,
  listOrders,
  listStores,
  resolveCustomerSession,
  type CatalogStore,
  type CustomerOrder,
} from "../customer-api.ts";
import { useSession } from "../auth.ts";
import { OrderHistory } from "../components/checkout/OrderHistory.tsx";
import { SiteFooter } from "../components/storefront/SiteFooter.tsx";
import { StoreBreadcrumb } from "../components/storefront/StoreBreadcrumb.tsx";
import { SiteHeader } from "../components/storefront/SiteHeader.tsx";

/**
 * A SePay webhook or a pharmacy status change lands here while the list is open, so the page keeps re-reading
 * instead of freezing whichever statuses it saw first.
 */
const REFRESH_INTERVAL_MS = 10_000;

/** Where a signed-out visitor has to go: the customer sign-in form lives on the account page. */
const ACCOUNT_LOCATION = { to: "/tai-khoan", search: { section: "tong-quan" } } as const;

/** Stands in for the table while the session or the list is still being read, so the page keeps its height. */
const OrdersSkeleton = ({ label }: { label: string }): React.JSX.Element => (
  <div role="status" aria-label={label} className="grid gap-px overflow-hidden rounded-lg border border-line">
    {Array.from({ length: 4 }, (_, index) => (
      <div key={index} className="flex items-center gap-6 bg-surface px-4 py-3">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-4 w-24" />
      </div>
    ))}
  </div>
);

/**
 * The shopper's own page for the orders they placed. It resolves the session itself: a deep link or a reload must
 * not depend on another page having probed `/api/auth/me` first.
 */
export const OrdersPage = (): React.JSX.Element => {
  const session = useSession();
  const navigate = useNavigate();
  const ordersQuery = useQuery({
    // The account page caches a bare order array under `["customer-orders"]`, so this page's `{ orders, stores }`
    // payload needs its own key under that prefix: sharing one key made this page read `.orders` off the array
    // and show an empty list. The prefix keeps the checkout invalidation and the sign-out purge reaching both.
    queryKey: ["customer-orders", "history"],
    queryFn: async () => {
      const customer = await resolveCustomerSession();
      if (!customer) return { orders: [] as CustomerOrder[], stores: [] as CatalogStore[] };
      const [orders, stores] = await Promise.all([forShopper(customer, listOrders), listStores()]);
      return { orders, stores };
    },
    refetchInterval: session.authenticated ? REFRESH_INTERVAL_MS : false,
  });
  const orders = ordersQuery.data?.orders ?? [];
  const stores = ordersQuery.data?.stores ?? [];
  const loadError = ordersQuery.error instanceof Error ? ordersQuery.error.message : undefined;
  const loading = ordersQuery.isPending && !ordersQuery.data;

  const ordersBody = (): React.JSX.Element => {
    if (!session.resolved) return <OrdersSkeleton label="Đang kiểm tra đăng nhập" />;
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
    if (loading) return <OrdersSkeleton label="Đang tải đơn hàng" />;
    return <OrderHistory orders={orders} stores={stores} />;
  };

  return (
    <div className="min-h-screen bg-background text-ink">
      <SiteHeader
        storeCount={stores.length || undefined}
        onSearch={(term) => void navigate({ to: "/", search: { q: term } })}
      />

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <PageHeader
          className="mb-0"
          breadcrumb={<StoreBreadcrumb items={[{ label: "Trang chủ", href: "/" }, { label: "Đơn hàng của tôi" }]} />}
          title="Đơn hàng của tôi"
          subtitle={
            session.authenticated && orders.length > 0
              ? `${orders.length} đơn · trạng thái cập nhật tự động`
              : "Theo dõi việc lấy thuốc, thanh toán và giao hàng của những đơn bạn đã đặt."
          }
          actions={
            session.authenticated ? (
              <Button
                type="button"
                variant="outline"
                disabled={ordersQuery.isFetching}
                onClick={() => void ordersQuery.refetch()}
              >
                Làm mới
              </Button>
            ) : null
          }
        />

        {loadError ? <Alert variant="danger">{loadError}</Alert> : null}

        {ordersBody()}
      </main>

      <SiteFooter />
    </div>
  );
};
