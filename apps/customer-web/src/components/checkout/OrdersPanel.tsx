import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@pharmacy/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { currentUser, forShopper, listOrders, listStores } from "../../customer-api.ts";
import { useSession } from "../../auth.ts";
import { OrderHistory } from "./OrderHistory.tsx";

/**
 * A SePay webhook or a pharmacy status change lands here while the list is open, so the panel keeps re-reading
 * instead of freezing whichever statuses it saw first. Only the orders are re-read on each tick.
 */
const REFRESH_INTERVAL_MS = 10_000;

/** Store names barely change, so the panel reuses the stores other pages already read and does not re-read them. */
const STORES_STALE_MS = 10 * 60_000;

/**
 * The account type never changes while a session lasts, so it is read once and kept under the `customer-orders`
 * prefix: the checkout invalidation and the sign-out purge reach it like every other order read.
 */
const ACCOUNT_QUERY_KEY = ["customer-orders", "account"] as const;

/** Where a signed-out visitor has to go: the customer sign-in form lives on the account page. */
const ACCOUNT_LOCATION = { to: "/tai-khoan", search: { section: "tong-quan" } } as const;

/** Stands in for the list while the session or the orders are still being read, so the panel keeps its height. */
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
 * The shopper's orders, shown as a tab of the order page. The session comes from `useSession()`, which the root layout
 * resolves for every page, so this panel never probes the session on its own. It is mounted only while its tab is
 * open, so the list is read and refreshed only while someone is looking at it.
 */
export const OrdersPanel = (): React.JSX.Element => {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signedIn = session.resolved && session.authenticated;

  const ordersQuery = useQuery({
    // The account page caches a bare order array under `["customer-orders"]`, so this panel's order list needs its
    // own key under that prefix: sharing one key made it read `.orders` off the array and show an empty list.
    queryKey: ["customer-orders", "history"],
    enabled: signedIn,
    queryFn: async () => {
      const account = await queryClient.ensureQueryData({
        queryKey: ACCOUNT_QUERY_KEY,
        queryFn: currentUser,
        staleTime: Infinity,
        gcTime: Infinity,
      });
      return forShopper(account, listOrders);
    },
    refetchInterval: session.authenticated ? REFRESH_INTERVAL_MS : false,
  });

  const storesQuery = useQuery({
    queryKey: ["stores"],
    queryFn: listStores,
    enabled: signedIn,
    staleTime: STORES_STALE_MS,
  });

  const orders = ordersQuery.data ?? [];
  const stores = storesQuery.data ?? [];

  const body = (): React.JSX.Element => {
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
    if (ordersQuery.data) return <OrderHistory orders={ordersQuery.data} stores={stores} />;
    if (ordersQuery.isError)
      return (
        <Card role="alert">
          <CardHeader>
            <CardTitle>Không tải được đơn hàng</CardTitle>
            <CardDescription>
              Kiểm tra kết nối mạng rồi thử lại. Nếu vẫn lỗi, vui lòng quay lại sau ít phút.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              disabled={ordersQuery.isFetching}
              onClick={() => void ordersQuery.refetch()}
            >
              Thử lại
            </Button>
          </CardContent>
        </Card>
      );
    return <OrdersSkeleton label="Đang tải đơn hàng" />;
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {session.authenticated ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-muted">
            {orders.length > 0
              ? `${orders.length} đơn · trạng thái cập nhật tự động`
              : "Theo dõi việc lấy thuốc, thanh toán và giao hàng của những đơn bạn đã đặt."}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={ordersQuery.isFetching}
            onClick={() => void ordersQuery.refetch()}
          >
            Làm mới
          </Button>
        </div>
      ) : null}

      {ordersQuery.isError && ordersQuery.data ? (
        <Alert variant="danger">Không cập nhật được danh sách đơn hàng. Đang hiển thị dữ liệu lần tải trước.</Alert>
      ) : null}

      {body()}
    </div>
  );
};
