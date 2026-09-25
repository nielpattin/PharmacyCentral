import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@pharmacy/ui";

import {
  addCartLine,
  calculateDelivery,
  clearCart,
  createOrder,
  createPaymentInvoice,
  getCart,
  getPaymentInvoice,
  listAvailability,
  listDeliveryAddresses,
  listProducts,
  listPublishedPrices,
  listStores,
  loginCustomer,
  mergeGuestCart,
  registerCustomer,
  resolveCustomerSession,
  searchAddress,
  setIdentityContextsEnabled,
  updateCartLine,
  type CatalogProduct,
  type CatalogUnit,
  type Customer,
  type CustomerOrderDetail,
  type DeliveryAddress,
  type DeliveryCalculation,
  type PaymentInvoice,
} from "../customer-api.ts";
import { setSessionSnapshot, useSession } from "../auth.ts";
import { CartItems } from "../components/checkout/CartItems.tsx";
import { CheckoutSteps, type CheckoutStep } from "../components/checkout/CheckoutSteps.tsx";
import { DeliveryPointPanel, type AddressResult, type Point } from "../components/checkout/DeliveryPointPanel.tsx";
import { FulfillmentPanel } from "../components/checkout/FulfillmentPanel.tsx";
import { OrderSummary } from "../components/checkout/OrderSummary.tsx";
import { PaymentPanel } from "../components/checkout/PaymentPanel.tsx";
import { ProductPicker } from "../components/checkout/ProductPicker.tsx";
import { CartFeedback } from "../components/storefront/CartFeedback.tsx";
import { Link } from "../components/storefront/Link.tsx";
import { SiteFooter } from "../components/storefront/SiteFooter.tsx";
import { SiteHeader } from "../components/storefront/SiteHeader.tsx";
import { IconChevronRight, IconUser } from "../components/storefront/icons.tsx";
import { checkoutQueryKey, writeCart } from "../storefront/cart-cache.ts";
import { buildPriceIndex, buildStockIndex, uniqueCategories } from "../storefront/catalog.ts";
import { buildCheckoutLines, checkoutTotals, type CheckoutLine } from "../storefront/checkout.ts";
import { formatMoney, initials } from "../storefront/format.ts";
import { invoicePending } from "../storefront/order-status.ts";
import { scrollToSection } from "../storefront/scroll.ts";

type FulfillmentType = "pickup" | "delivery";
type PaymentMethod = "sepay_qr" | "cash_on_delivery";

const defaultDestination: Point = { latitude: 10.7905, longitude: 106.682 };

/** How long a confirmation or failure stays on screen before clearing itself. */
const FEEDBACK_TIMEOUT_MS = 4000;

/**
 * The SePay webhook reaches the payment service a moment after the shopper transfers, so the panel re-reads the
 * invoice while it is still open instead of trusting the status the create call answered with.
 */
const PAYMENT_POLL_INTERVAL_MS = 4000;

const PRODUCTS_SECTION_ID = "chon-thuoc";
const RESULT_SECTION_ID = "ket-qua-dat-hang";

type Feedback = { kind: "notice" | "error"; message: string };

type PlacedOrder = { order: CustomerOrderDetail; invoice: PaymentInvoice; paymentMethod: PaymentMethod };

/**
 * The order form is plain component state rather than a form library: every field is a single choice with no
 * validation, and the values are read while rendering (cart totals, delivery panel, summary) rather than only at
 * submit time.
 */
export const CheckoutPage = (): React.JSX.Element => {
  const session = useSession();
  const navigate = useNavigate();
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("delivery");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("sepay_qr");
  const [selectedStoreId, setSelectedStoreId] = useState<string>();
  const [addressNote, setAddressNote] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [destination, setDestination] = useState(defaultDestination);
  const [delivery, setDelivery] = useState<DeliveryCalculation>();
  const [submittedSearch, setSubmittedSearch] = useState<string>();
  const [addressResults, setAddressResults] = useState<AddressResult[]>([]);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pendingLineId, setPendingLineId] = useState<string>();
  const [addingProductId, setAddingProductId] = useState<string>();
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [placed, setPlaced] = useState<PlacedOrder>();
  const queryClient = useQueryClient();
  // Newest cart message wins: a timer only clears the feedback it was scheduled for.
  const feedbackToken = useRef(0);

  const showFeedback = (next: Feedback): void => {
    feedbackToken.current += 1;
    const token = feedbackToken.current;
    setFeedback(next);
    setTimeout(() => {
      setFeedback((current) => (token === feedbackToken.current ? undefined : current));
    }, FEEDBACK_TIMEOUT_MS);
  };

  const checkoutQuery = useQuery({
    queryKey: checkoutQueryKey,
    queryFn: async () => {
      const [products, stores, loadedCart, customer] = await Promise.all([
        listProducts(),
        listStores(),
        getCart(),
        resolveCustomerSession(),
      ]);
      let cart = loadedCart;
      let addresses: DeliveryAddress[] = [];
      if (customer) {
        [addresses, cart] = await Promise.all([listDeliveryAddresses(), mergeGuestCart().catch(() => loadedCart)]);
      }
      return {
        products,
        stores,
        cart,
        addresses,
        profile: customer ? { displayName: customer.displayName, email: customer.email } : undefined,
      };
    },
  });
  const productsQuery = useQuery({
    queryKey: ["checkout-products", submittedSearch],
    queryFn: () => listProducts({ search: submittedSearch }),
    enabled: submittedSearch !== undefined,
  });
  const pricesQuery = useQuery({ queryKey: ["published-prices"], queryFn: listPublishedPrices });
  const placedInvoiceId = placed?.invoice.id;
  const placedInvoiceQuery = useQuery({
    queryKey: ["payment-invoice", placedInvoiceId],
    queryFn: async () => {
      if (!placedInvoiceId) throw new Error("Không có hóa đơn để theo dõi");
      return getPaymentInvoice(placedInvoiceId);
    },
    enabled: placedInvoiceId !== undefined,
    // Keep re-reading until the money lands, which is what lets the panel stop showing the QR code.
    refetchInterval: (query) => (invoicePending(query.state.data?.status) ? PAYMENT_POLL_INTERVAL_MS : false),
  });
  const products = submittedSearch === undefined ? (checkoutQuery.data?.products ?? []) : (productsQuery.data ?? []);
  const bootstrapProducts = checkoutQuery.data?.products;
  const stores = checkoutQuery.data?.stores ?? [];
  const cart = checkoutQuery.data?.cart;
  const addresses = checkoutQuery.data?.addresses ?? [];
  const profile = checkoutQuery.data?.profile;
  const queryError = checkoutQuery.error ?? productsQuery.error;
  const loadError = queryError instanceof Error ? queryError.message : undefined;
  const visibleError = error ?? loadError;
  /** The invoice the shopper pays against: the live one once it is read, the create response before that. */
  const placedInvoice = placedInvoiceQuery.data ?? placed?.invoice;

  const authForm = useForm({
    defaultValues: { email: "", password: "", displayName: "" },
    onSubmit: async ({ value }) => {
      setBusy(true);
      setError(undefined);
      try {
        if (authMode === "register") {
          await registerCustomer(value.email, value.password, value.displayName);
          showFeedback({
            kind: "notice",
            message: "Đã tạo tài khoản. Kiểm tra email để xác thực rồi đăng nhập để đặt hàng.",
          });
        } else {
          const customer = (await loginCustomer(value.email, value.password)) as Customer;
          setSessionSnapshot({ authenticated: true, resolved: true, userId: customer.id });
          setIdentityContextsEnabled(true);
          const [nextCart, nextAddresses] = await Promise.all([mergeGuestCart(), listDeliveryAddresses()]);
          writeCart(queryClient, nextCart);
          queryClient.setQueryData(checkoutQueryKey, (current) =>
            current && typeof current === "object"
              ? {
                  ...current,
                  addresses: nextAddresses,
                  profile: { displayName: customer.displayName, email: customer.email },
                }
              : current,
          );
          void queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
          showFeedback({
            kind: "notice",
            message: `Xin chào ${customer.displayName}, giỏ thuốc của bạn đã được đồng bộ.`,
          });
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Đăng nhập thất bại");
      } finally {
        setBusy(false);
      }
    },
  });

  const priceIndex = useMemo(
    () => buildPriceIndex(pricesQuery.data ?? [], new Date().toISOString().slice(0, 10)),
    [pricesQuery.data],
  );
  const categories = useMemo(() => uniqueCategories(bootstrapProducts ?? []), [bootstrapProducts]);

  const selectedStore = stores.find((store) => store.id === selectedStoreId) ?? stores[0];
  const availabilityQuery = useQuery({
    queryKey: ["availability", selectedStore?.id],
    queryFn: () => listAvailability(selectedStore?.id),
    enabled: Boolean(selectedStore),
  });
  const stockIndex = useMemo(() => buildStockIndex(availabilityQuery.data ?? []), [availabilityQuery.data]);
  const cartLines = useMemo(
    () => buildCheckoutLines(cart?.lines ?? [], bootstrapProducts ?? [], priceIndex, stockIndex),
    [cart, bootstrapProducts, priceIndex, stockIndex],
  );
  const cartQuantities = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const line of cartLines) quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
    return quantities;
  }, [cartLines]);

  const shippingFee = fulfillmentType === "delivery" ? delivery?.fee : undefined;
  const totals = useMemo(() => checkoutTotals(cartLines, shippingFee), [cartLines, shippingFee]);
  const step: CheckoutStep = placed ? 3 : cartLines.length === 0 ? 1 : 2;
  const canSubmit = Boolean(
    cartLines.length && session.authenticated && (fulfillmentType === "pickup" || selectedStore),
  );
  const blockedReason = !session.authenticated
    ? "Đăng nhập tài khoản khách hàng để đặt hàng."
    : cartLines.length === 0
      ? "Thêm thuốc vào giỏ để đặt hàng."
      : !selectedStore
        ? "Chọn nhà thuốc xuất đơn."
        : undefined;

  const changeLineQuantity = async (line: CheckoutLine, quantity: number): Promise<void> => {
    setPendingLineId(line.id);
    setError(undefined);
    try {
      writeCart(queryClient, await updateCartLine(line.id, quantity));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không cập nhật được giỏ hàng");
    } finally {
      setPendingLineId(undefined);
    }
  };

  const removeLine = async (line: CheckoutLine): Promise<void> => {
    setPendingLineId(line.id);
    setError(undefined);
    try {
      writeCart(queryClient, await updateCartLine(line.id, 0));
      showFeedback({ kind: "notice", message: `Đã xoá “${line.productName}” khỏi giỏ thuốc.` });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xoá được sản phẩm khỏi giỏ");
    } finally {
      setPendingLineId(undefined);
    }
  };

  const addProduct = async (product: CatalogProduct, unit: CatalogUnit): Promise<void> => {
    setBusy(true);
    setAddingProductId(product.id);
    setError(undefined);
    try {
      writeCart(queryClient, await addCartLine(product.id, unit.id, 1));
      showFeedback({ kind: "notice", message: `Đã thêm “${product.name}” vào giỏ thuốc.` });
      setPlaced(undefined);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Không thêm được sản phẩm";
      setError(message);
      showFeedback({ kind: "error", message });
    } finally {
      setAddingProductId(undefined);
      setBusy(false);
    }
  };

  const calculateFee = async (): Promise<void> => {
    if (!selectedStore) return;
    setBusy(true);
    setError(undefined);
    try {
      setDelivery(await calculateDelivery(selectedStore.id, destination, addressNote));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tính được phí giao hàng");
    } finally {
      setBusy(false);
    }
  };

  const submitAddressSearch = async (): Promise<void> => {
    setSearching(true);
    setError(undefined);
    try {
      setAddressResults(await searchAddress(addressQuery));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tìm địa chỉ thất bại");
    } finally {
      setSearching(false);
    }
  };

  const submitProductSearch = (): void => {
    setSubmittedSearch(productSearch);
    setError(undefined);
  };

  const chooseFulfillment = (value: FulfillmentType): void => {
    setFulfillmentType(value);
    setDelivery(undefined);
  };

  const chooseStore = (storeId: string): void => {
    setSelectedStoreId(storeId);
    setDelivery(undefined);
  };

  const locateMe = (): void => {
    navigator.geolocation?.getCurrentPosition(
      (position) => {
        setDestination({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setDelivery(undefined);
        setAddressResults([]);
      },
      () => setError("Bạn chưa cho phép truy cập vị trí"),
    );
  };

  const chooseDestination = (point: Point): void => {
    setDestination(point);
    setDelivery(undefined);
    setAddressResults([]);
    setPlaced(undefined);
  };

  const placeOrder = async (): Promise<void> => {
    if (!selectedStore || !cart?.lines.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const order = await createOrder({
        selectedStoreId: selectedStore.id,
        fulfillmentType,
        lines: cart.lines.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          quantity: Number(line.quantity),
        })),
        ...(fulfillmentType === "delivery"
          ? { delivery: { destination, ...(addressNote ? { addressNote } : {}) } }
          : {}),
      });
      const invoice = await createPaymentInvoice({
        invoiceId: order.id,
        orderId: order.id,
        paymentMethod,
        lines: order.lines.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          description: line.productNameSnapshot,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPriceSnapshot),
          currency: order.currency,
        })),
      });
      writeCart(queryClient, await clearCart());
      void queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
      setPlaced({ order, invoice, paymentMethod });
      setDelivery(undefined);
      showFeedback({
        kind: "notice",
        message:
          paymentMethod === "sepay_qr"
            ? `Đã tạo đơn #${order.id.slice(0, 8).toUpperCase()}. Quét mã QR để hoàn tất thanh toán.`
            : `Đã tạo đơn #${order.id.slice(0, 8).toUpperCase()}. Bạn thanh toán khi nhận thuốc.`,
      });
      scrollToSection(RESULT_SECTION_ID);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Đặt hàng thất bại");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-ink">
      <SiteHeader storeCount={stores.length} onSearch={(term) => void navigate({ to: "/", search: { q: term } })} />

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        <nav aria-label="Đường dẫn" className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Link className="hover:text-primary" href="/">
            Trang chủ
          </Link>
          <IconChevronRight className="size-3" />
          <span className="font-medium text-ink">Đặt hàng &amp; thanh toán</span>
        </nav>

        <div className="grid gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink sm:text-2xl">Đặt hàng &amp; thanh toán</h1>
            <p className="mt-1 text-sm text-muted">
              Kiểm tra giỏ thuốc, chọn nhà thuốc xuất đơn, tính phí giao hàng và theo dõi đơn đã đặt.
            </p>
          </div>
          <CheckoutSteps current={step} />
        </div>

        {visibleError ? <Alert variant="danger">{visibleError}</Alert> : null}

        {placed && placedInvoice ? (
          <PaymentPanel
            order={placed.order}
            invoice={placedInvoice}
            paymentMethod={placed.paymentMethod}
            storeName={stores.find((store) => store.id === placed.order.selectedStoreId)?.name}
          />
        ) : null}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <Card id="tai-khoan" className="scroll-mt-24">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <IconUser className="size-4 text-primary" />
                  Tài khoản khách hàng
                </CardTitle>
                <CardDescription>
                  Đơn thuốc gắn với tài khoản của bạn để theo dõi trạng thái và nhận thông báo từ nhà thuốc.
                </CardDescription>
              </CardHeader>
              {session.authenticated ? (
                <CardContent className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary-dark"
                  >
                    {initials(profile?.displayName ?? "Khách hàng")}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{profile?.displayName ?? "Khách hàng"}</p>
                    {profile?.email ? <p className="truncate text-xs text-muted">{profile.email}</p> : null}
                  </div>
                </CardContent>
              ) : session.resolved ? (
                <CardContent>
                  <form
                    className="grid max-w-md gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void authForm.handleSubmit();
                    }}
                  >
                    {authMode === "register" ? (
                      <authForm.Field name="displayName">
                        {(field) => (
                          <Field label="Tên hiển thị">
                            <Input
                              value={field.state.value}
                              onChange={(event) => field.handleChange(event.target.value)}
                              placeholder="Nguyễn Văn A"
                              required
                            />
                          </Field>
                        )}
                      </authForm.Field>
                    ) : null}
                    <authForm.Field name="email">
                      {(field) => (
                        <Field label="Email">
                          <Input
                            type="email"
                            value={field.state.value}
                            onChange={(event) => field.handleChange(event.target.value)}
                            placeholder="ban@email.com"
                            required
                          />
                        </Field>
                      )}
                    </authForm.Field>
                    <authForm.Field name="password">
                      {(field) => (
                        <Field
                          label="Mật khẩu"
                          hint={
                            authMode === "register"
                              ? "Tối thiểu 8 ký tự, nên có chữ và số."
                              : "Mật khẩu của tài khoản khách hàng."
                          }
                        >
                          <Input
                            type="password"
                            value={field.state.value}
                            onChange={(event) => field.handleChange(event.target.value)}
                            placeholder="••••••••"
                            required
                          />
                        </Field>
                      )}
                    </authForm.Field>
                    <div className="flex flex-wrap gap-2">
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
              <CardHeader className="flex items-center justify-between gap-2">
                <CardTitle>Giỏ thuốc</CardTitle>
                <span className="text-xs text-muted">{cartLines.length} sản phẩm</span>
              </CardHeader>
              <CardContent>
                <CartItems
                  lines={cartLines}
                  pendingLineId={pendingLineId}
                  busy={busy}
                  onQuantityChange={(line, quantity) => void changeLineQuantity(line, quantity)}
                  onRemove={(line) => void removeLine(line)}
                  onBrowse={() => scrollToSection(PRODUCTS_SECTION_ID)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Hình thức nhận hàng &amp; thanh toán</CardTitle>
                <CardDescription>
                  Đơn thuốc được soạn tại nhà thuốc bạn chọn và giao hoặc giữ tại quầy theo lựa chọn bên dưới.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FulfillmentPanel
                  fulfillmentType={fulfillmentType}
                  paymentMethod={paymentMethod}
                  disabled={busy}
                  paymentHint={
                    paymentMethod === "sepay_qr"
                      ? "Sau khi đặt hàng, hệ thống hiển thị mã VietQR và nội dung chuyển khoản để bạn thanh toán."
                      : `Vui lòng chuẩn bị ${formatMoney(totals.total, totals.currency)} tiền mặt khi nhận thuốc.`
                  }
                  onFulfillmentChange={chooseFulfillment}
                  onPaymentChange={setPaymentMethod}
                />
              </CardContent>
            </Card>

            <DeliveryPointPanel
              stores={stores}
              selectedStore={selectedStore}
              selectedStoreId={selectedStore?.id ?? ""}
              fulfillmentType={fulfillmentType}
              addresses={addresses}
              destination={destination}
              delivery={delivery}
              addressNote={addressNote}
              query={addressQuery}
              results={addressResults}
              mapKey={`${selectedStore?.id ?? "none"}:${destination.latitude}:${destination.longitude}:${delivery?.route.coordinates.length ?? 0}`}
              busy={busy}
              searching={searching}
              onSelectStore={chooseStore}
              onDestinationChange={chooseDestination}
              onAddressNoteChange={setAddressNote}
              onQueryChange={setAddressQuery}
              onSearchSubmit={() => void submitAddressSearch()}
              onPickResult={(result) => chooseDestination({ latitude: result.latitude, longitude: result.longitude })}
              onPickSavedAddress={(address) =>
                chooseDestination({ latitude: Number(address.latitude), longitude: Number(address.longitude) })
              }
              onLocateMe={locateMe}
              onCalculate={() => void calculateFee()}
            />
          </div>

          <aside className="lg:sticky lg:top-5">
            <OrderSummary
              lines={cartLines}
              totals={totals}
              fulfillmentType={fulfillmentType}
              destinationLabel={delivery?.providerResolvedAddress}
              storeName={selectedStore?.name}
              shippingKnown={Boolean(delivery)}
              busy={busy}
              canSubmit={canSubmit}
              blockedReason={blockedReason}
              onSubmit={() => void placeOrder()}
              onGoToCart={() => scrollToSection(PRODUCTS_SECTION_ID)}
            />
          </aside>

          <div className="grid gap-5 lg:col-start-1">
            <Card id={PRODUCTS_SECTION_ID} className="scroll-mt-24">
              <CardHeader className="flex items-center justify-between gap-2">
                <CardTitle>Chọn thuốc &amp; vật tư y tế</CardTitle>
                {submittedSearch !== undefined ? (
                  <span className="text-xs text-muted">Kết quả cho “{submittedSearch || "tất cả sản phẩm"}”</span>
                ) : null}
              </CardHeader>
              <CardContent>
                <ProductPicker
                  key={submittedSearch ?? "all-products"}
                  products={products}
                  priceIndex={priceIndex}
                  pricesPending={pricesQuery.isPending}
                  stockIndex={stockIndex}
                  cartQuantities={cartQuantities}
                  searchTerm={productSearch}
                  loading={productsQuery.isFetching}
                  addingProductId={addingProductId}
                  busy={busy}
                  onSearchChange={setProductSearch}
                  onSearchSubmit={submitProductSearch}
                  onAdd={(product, unit) => void addProduct(product, unit)}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <SiteFooter categories={categories} />
      <CartFeedback
        notice={feedback?.kind === "notice" ? feedback.message : undefined}
        error={feedback?.kind === "error" ? feedback.message : undefined}
      />
    </div>
  );
};
