import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, DataTable, Input, Select } from "@pharmacy/ui";

import {
  addCartLine,
  calculateDelivery,
  clearCart,
  createOrder,
  createPaymentInvoice,
  currentUser,
  getActivePrice,
  getCart,
  getProductUnits,
  listOrders,
  listProducts,
  listStores,
  listDeliveryAddresses,
  loginCustomer,
  mergeGuestCart,
  request,
  searchAddress,
  type CatalogProduct,
  type CatalogStore,
  type CustomerOrder,
  type DeliveryCalculation,
  type DeliveryAddress,
  registerCustomer,
  setIdentityContextsEnabled,
} from "../customer-api.ts";
import { setSessionSnapshot, useSession } from "../auth.ts";
import { DeliveryMap } from "../components/DeliveryMap.tsx";
import { Link } from "../components/storefront/Link.tsx";
import { formatDateTime, formatQuantity } from "../storefront/format.ts";

type Point = { latitude: number; longitude: number };
const defaultDestination: Point = { latitude: 10.7905, longitude: 106.682 };

const getStorePoint = (store: CatalogStore | undefined): Point | undefined => store?.coordinates ?? undefined;

export const CheckoutPage = (): React.JSX.Element => {
  const session = useSession();
  const [destination, setDestination] = useState(defaultDestination);
  const [delivery, setDelivery] = useState<DeliveryCalculation>();
  const [submittedSearch, setSubmittedSearch] = useState<string>();
  const [addressResults, setAddressResults] = useState<
    Array<{ displayName: string; latitude: number; longitude: number }>
  >([]);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const queryClient = useQueryClient();
  const checkoutQuery = useQuery({
    queryKey: ["checkout-bootstrap"],
    queryFn: async () => {
      await request("/api/auth/csrf");
      const [products, stores, loadedCart, user] = await Promise.all([
        listProducts(),
        listStores(),
        getCart(),
        currentUser().catch(() => undefined),
      ]);
      let cart = loadedCart;
      let orders: CustomerOrder[] = [];
      let addresses: DeliveryAddress[] = [];
      if (user) {
        setSessionSnapshot({ authenticated: true, resolved: true, userId: user.id });
        setIdentityContextsEnabled(true);
        [orders, addresses, cart] = await Promise.all([
          listOrders(),
          listDeliveryAddresses(),
          mergeGuestCart().catch(() => loadedCart),
        ]);
      } else {
        // A failed probe collapses to the safe state: signed out, which is what a form can act on.
        setSessionSnapshot({ authenticated: false, resolved: true });
      }
      return {
        products,
        stores,
        cart,
        orders,
        addresses,
        profile: user ? { displayName: user.displayName, email: user.email } : undefined,
      };
    },
  });
  const productsQuery = useQuery({
    queryKey: ["checkout-products", submittedSearch],
    queryFn: () => listProducts({ search: submittedSearch }),
    enabled: submittedSearch !== undefined,
  });
  const products = submittedSearch === undefined ? (checkoutQuery.data?.products ?? []) : (productsQuery.data ?? []);
  const stores = checkoutQuery.data?.stores ?? [];
  const cart = checkoutQuery.data?.cart;
  const orders = checkoutQuery.data?.orders ?? [];
  const addresses = checkoutQuery.data?.addresses ?? [];
  const profile = checkoutQuery.data?.profile;
  const queryError = checkoutQuery.error ?? productsQuery.error;
  const loadError = queryError instanceof Error ? queryError.message : undefined;
  const visibleError = error ?? loadError;
  const authForm = useForm({
    defaultValues: { email: "", password: "", displayName: "" },
    onSubmit: async ({ value }) => {
      setBusy(true);
      setError(undefined);
      setNotice(undefined);
      try {
        if (authMode === "register") {
          await registerCustomer(value.email, value.password, value.displayName);
          setNotice("Đã tạo tài khoản. Vui lòng xác thực email trước khi đăng nhập.");
        } else {
          const user = (await loginCustomer(value.email, value.password)) as {
            id: string;
            displayName: string;
            email: string;
          };
          setSessionSnapshot({ authenticated: true, resolved: true, userId: user.id });
          setIdentityContextsEnabled(true);
          const [nextCart, nextOrders, nextAddresses] = await Promise.all([
            mergeGuestCart(),
            listOrders(),
            listDeliveryAddresses(),
          ]);
          queryClient.setQueryData(["checkout-bootstrap"], (current) =>
            current && typeof current === "object"
              ? {
                  ...current,
                  cart: nextCart,
                  orders: nextOrders,
                  addresses: nextAddresses,
                  profile: { displayName: user.displayName, email: user.email },
                }
              : current,
          );
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Đăng nhập thất bại");
      } finally {
        setBusy(false);
      }
    },
  });
  const productSearchForm = useForm({
    defaultValues: { search: "" },
    onSubmit: ({ value }) => {
      setSubmittedSearch(value.search);
      setError(undefined);
    },
  });
  const checkoutForm = useForm({
    defaultValues: {
      selectedStoreId: "",
      fulfillmentType: "delivery" as "pickup" | "delivery",
      paymentMethod: "sepay_qr" as "sepay_qr" | "cash_on_delivery",
      addressNote: "",
    },
    onSubmit: async ({ value }) => {
      const selectedStoreForOrder = stores.find((store) => store.id === value.selectedStoreId) ?? stores[0];
      if (!selectedStoreForOrder || !cart?.lines.length) return;
      setBusy(true);
      setError(undefined);
      try {
        const lines = await Promise.all(
          cart.lines.map(async (line) => {
            const price = await getActivePrice(line.productId, line.productUnitId);
            return {
              productId: line.productId,
              productUnitId: line.productUnitId,
              quantity: Number(line.quantity),
              unitPrice: Number(price.unitPrice),
            };
          }),
        );
        const order = await createOrder({
          selectedStoreId: selectedStoreForOrder.id,
          fulfillmentType: value.fulfillmentType,
          lines: lines.map(({ productId, productUnitId, quantity }) => ({ productId, productUnitId, quantity })),
          ...(value.fulfillmentType === "delivery"
            ? { delivery: { destination, ...(value.addressNote ? { addressNote: value.addressNote } : {}) } }
            : {}),
        });
        const invoice = await createPaymentInvoice({
          invoiceId: order.id,
          orderId: order.id,
          paymentMethod: value.paymentMethod,
          lines: order.lines.map((line) => ({
            productId: line.productId,
            productUnitId: line.productUnitId,
            description: line.productNameSnapshot,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPriceSnapshot),
            currency: order.currency,
          })),
        });
        const nextCart = await clearCart();
        queryClient.setQueryData(["checkout-bootstrap"], (current) =>
          current && typeof current === "object" ? { ...current, cart: nextCart, orders: [order, ...orders] } : current,
        );
        queryClient.setQueryData(["cart"], nextCart);
        setNotice(
          `Đã tạo đơn hàng. Thanh toán ${invoice.paymentCode} đang ở trạng thái ${invoice.status}.${value.fulfillmentType === "delivery" ? " Lộ trình giao hàng đã được tính lại theo điểm giao bạn chọn." : ""}`,
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Đặt hàng thất bại");
      } finally {
        setBusy(false);
      }
    },
  });
  const addressSearchForm = useForm({
    defaultValues: { query: "" },
    onSubmit: async ({ value }) => {
      try {
        setAddressResults(await searchAddress(value.query));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Tìm địa chỉ thất bại");
      }
    },
  });
  const selectedStore = stores.find((store) => store.id === checkoutForm.state.values.selectedStoreId) ?? stores[0];
  const storePoint = getStorePoint(selectedStore);

  const addProduct = async (product: CatalogProduct): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const unit = (await getProductUnits(product.id))[0];
      if (!unit) throw new Error("Sản phẩm chưa có đơn vị bán");
      const nextCart = await addCartLine(product.id, unit.id, 1);
      queryClient.setQueryData(["checkout-bootstrap"], (current) =>
        current && typeof current === "object" ? { ...current, cart: nextCart } : current,
      );
      queryClient.setQueryData(["cart"], nextCart);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thêm được sản phẩm");
    } finally {
      setBusy(false);
    }
  };

  const calculate = async (): Promise<void> => {
    if (!selectedStore) return;
    setBusy(true);
    setError(undefined);
    try {
      setDelivery(await calculateDelivery(selectedStore.id, destination, checkoutForm.state.values.addressNote));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tính được phí giao hàng");
    } finally {
      setBusy(false);
    }
  };

  const locateMe = (): void => {
    navigator.geolocation?.getCurrentPosition(
      (position) => {
        setDestination({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setDelivery(undefined);
      },
      () => setError("Bạn chưa cho phép truy cập vị trí"),
    );
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 bg-background p-6 text-ink">
      <header>
        <Link className="text-sm font-medium text-primary hover:underline" href="/">
          ← Về trang chủ
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Đặt hàng &amp; thanh toán</h1>
        <p className="mt-1 text-sm text-muted">
          Quản lý giỏ hàng, tính phí giao hàng theo khoảng cách và theo dõi đơn hàng đã đặt.
        </p>
      </header>
      {visibleError ? <Alert variant="danger">{visibleError}</Alert> : null}
      {notice ? <Alert>{notice}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>Tài khoản khách hàng</CardTitle>
        </CardHeader>
        {session.authenticated ? (
          <CardContent>
            <p className="text-sm text-ink">
              <span className="font-medium">{profile?.displayName ?? "Khách hàng"}</span>
              {profile?.email ? <span className="text-muted"> · {profile.email}</span> : null}
            </p>
          </CardContent>
        ) : session.resolved ? (
          <CardContent>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void authForm.handleSubmit();
              }}
              className="grid max-w-md gap-3"
            >
              {authMode === "register" ? (
                <authForm.Field name="displayName">
                  {(field) => (
                    <Input
                      aria-label="Tên hiển thị"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="Tên hiển thị"
                      required
                    />
                  )}
                </authForm.Field>
              ) : null}
              <authForm.Field name="email">
                {(field) => (
                  <Input
                    aria-label="Email"
                    type="email"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Email"
                    required
                  />
                )}
              </authForm.Field>
              <authForm.Field name="password">
                {(field) => (
                  <Input
                    aria-label="Mật khẩu"
                    type="password"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Mật khẩu"
                    required
                  />
                )}
              </authForm.Field>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {authMode === "register" ? "Tạo tài khoản" : "Đăng nhập"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
                >
                  {authMode === "login" ? "Tạo tài khoản mới" : "Dùng tài khoản có sẵn"}
                </Button>
              </div>
            </form>
          </CardContent>
        ) : (
          // Neither the account nor the sign-in form is knowable yet: a returning shopper must not be shown a
          // login screen they are about to lose.
          <CardContent>
            <p role="status" className="text-sm text-muted">
              Đang kiểm tra đăng nhập…
            </p>
          </CardContent>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Danh mục sản phẩm</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void productSearchForm.handleSubmit();
            }}
            className="flex gap-2"
          >
            <productSearchForm.Field name="search">
              {(field) => (
                <Input
                  aria-label="Tìm kiếm sản phẩm"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Tìm theo tên hoặc mã SKU"
                />
              )}
            </productSearchForm.Field>
            <Button type="submit">Tìm kiếm</Button>
          </form>
          <DataTable
            rows={products}
            getKey={(product) => product.id}
            empty="Không có sản phẩm"
            columns={[
              {
                key: "name",
                label: "Sản phẩm",
                render: (product) => (
                  <span>
                    {product.name} <span className="text-muted">({product.sku})</span>
                  </span>
                ),
              },
              {
                key: "action",
                label: "",
                render: (product) => (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void addProduct(product)}
                    disabled={busy}
                  >
                    Thêm vào giỏ
                  </Button>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Giỏ hàng &amp; thanh toán</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y divide-line rounded-md border border-line">
            {(cart?.lines ?? []).map((line) => {
              const product = products.find((item) => item.id === line.productId);
              const unit = product?.units.find((item) => item.id === line.productUnitId);
              return (
                <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate">
                    {product?.name ?? "Sản phẩm không còn bán"}
                    {unit ? <span className="text-muted"> · {unit.unitName}</span> : null}
                  </span>
                  <Badge variant="secondary">{formatQuantity(line.quantity)}</Badge>
                </li>
              );
            })}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <checkoutForm.Field name="fulfillmentType">
              {(field) => (
                <label className="grid gap-1.5 text-sm font-medium">
                  Hình thức nhận hàng
                  <Select
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value as "pickup" | "delivery");
                      setDelivery(undefined);
                    }}
                  >
                    <option value="delivery">Giao tận nơi</option>
                    <option value="pickup">Nhận tại nhà thuốc</option>
                  </Select>
                </label>
              )}
            </checkoutForm.Field>
            <checkoutForm.Field name="paymentMethod">
              {(field) => (
                <label className="grid gap-1.5 text-sm font-medium">
                  Thanh toán
                  <Select
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value as "sepay_qr" | "cash_on_delivery")}
                  >
                    <option value="sepay_qr">SePay QR</option>
                    <option value="cash_on_delivery">Thanh toán khi nhận hàng</option>
                  </Select>
                </label>
              )}
            </checkoutForm.Field>
          </div>
          <Button
            type="button"
            onClick={() => void checkoutForm.handleSubmit()}
            disabled={busy || !cart?.lines.length || !session.authenticated}
          >
            Đặt hàng (giá được hệ thống tính lại)
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Điểm giao hàng</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <checkoutForm.Field name="selectedStoreId">
            {(field) => (
              <label className="grid max-w-md gap-1.5 text-sm font-medium">
                Nhà thuốc
                <Select
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    setDelivery(undefined);
                  }}
                >
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </checkoutForm.Field>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addressSearchForm.handleSubmit();
            }}
            className="flex max-w-md gap-2"
          >
            <addressSearchForm.Field name="query">
              {(field) => (
                <Input
                  aria-label="Tìm địa chỉ"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Tìm địa chỉ giao hàng"
                />
              )}
            </addressSearchForm.Field>
            <Button type="submit">Tìm</Button>
          </form>
          {addressResults.length ? (
            <ul className="divide-y divide-line rounded-md border border-line">
              {addressResults.map((result) => (
                <li key={`${result.latitude}:${result.longitude}`}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-soft"
                    onClick={() => {
                      setDestination({ latitude: result.latitude, longitude: result.longitude });
                      setAddressResults([]);
                    }}
                  >
                    {result.displayName}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <checkoutForm.Field name="addressNote">
            {(field) => (
              <Input
                aria-label="Ghi chú địa chỉ"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Số nhà, toà nhà, hẻm..."
              />
            )}
          </checkoutForm.Field>
          <p className="text-sm text-muted">Chọn điểm giao trên bản đồ, tìm theo địa chỉ, hoặc dùng vị trí hiện tại.</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={locateMe}>
              Dùng vị trí hiện tại
            </Button>
            <Button type="button" onClick={() => void calculate()} disabled={busy || !selectedStore}>
              Tính phí giao hàng
            </Button>
          </div>
          {storePoint ? (
            <DeliveryMap
              key={`${selectedStore?.id ?? "none"}:${destination.latitude}:${destination.longitude}:${delivery?.route.coordinates.length ?? 0}`}
              store={storePoint}
              destination={destination}
              onDestinationChange={(point) => {
                setDestination(point);
                setDelivery(undefined);
              }}
              {...(delivery ? { route: delivery.route.coordinates } : {})}
            />
          ) : (
            <div className="grid min-h-[320px] place-items-center rounded-md border border-dashed border-line bg-surface-soft p-8 text-center">
              <p className="max-w-xs text-sm text-muted">
                Nhà thuốc đang chọn chưa có toạ độ trên bản đồ. Dùng tìm kiếm địa chỉ hoặc vị trí hiện tại để chọn điểm
                giao hàng.
              </p>
            </div>
          )}
          {delivery ? (
            <p className="rounded-md bg-surface-soft p-3 text-sm">
              Địa chỉ: {delivery.providerResolvedAddress}. Khoảng cách: {(delivery.distanceMeters / 1000).toFixed(2)}{" "}
              km. Thời gian: {Math.ceil(delivery.durationSeconds / 60)} phút. Phí:{" "}
              {delivery.fee.toLocaleString("vi-VN")} {delivery.currency}.
            </p>
          ) : null}
        </CardContent>
      </Card>
      {session.authenticated ? (
        <Card>
          <CardHeader>
            <CardTitle>Đơn hàng của tôi</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={orders}
              getKey={(order) => order.id}
              empty="Chưa có đơn hàng"
              columns={[
                {
                  key: "createdAt",
                  label: "Ngày đặt",
                  render: (order) => <span className="text-muted">{formatDateTime(order.createdAt)}</span>,
                },
                { key: "status", label: "Trạng thái", render: (order) => <Badge>{order.status}</Badge> },
                { key: "fulfillmentType", label: "Nhận hàng" },
                {
                  key: "total",
                  label: "Tổng cộng",
                  render: (order) => `${Number(order.subtotal) + Number(order.deliveryFee)} ${order.currency}`,
                },
                {
                  key: "delivery",
                  label: "Địa chỉ giao",
                  render: (order) => order.delivery?.providerResolvedAddress ?? "",
                },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}
      {session.authenticated && addresses.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Địa chỉ đã lưu</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-line rounded-md border border-line">
              {addresses.map((address) => (
                <li key={address.id} className="px-3 py-2 text-sm">
                  <span className="font-medium">{address.label}:</span> {address.providerResolvedAddress}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
};
