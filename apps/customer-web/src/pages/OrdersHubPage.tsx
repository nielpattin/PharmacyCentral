import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

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
  Tabs,
  tabId,
  tabPanelId,
} from "@pharmacy/ui";

import {
  addCartLine,
  ApiError,
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
  mergeGuestCart,
  resolveAddressSuggestion,
  resolveCustomerSession,
  saveDeliveryAddress,
  updateCartLine,
  type CatalogProduct,
  type CatalogUnit,
  type CustomerOrderDetail,
  type DeliveryAddress,
  type DeliveryCalculation,
  type PaymentInvoice,
} from "../customer-api.ts";
import { useSession } from "../auth.ts";
import { useAddressSearch } from "../hooks/useAddressSearch.ts";
import { CartItems } from "../components/checkout/CartItems.tsx";
import { CheckoutSteps, type CheckoutStep } from "../components/checkout/CheckoutSteps.tsx";
import { DeliveryPointPanel, type AddressResult, type Point } from "../components/checkout/DeliveryPointPanel.tsx";
import { FulfillmentPanel } from "../components/checkout/FulfillmentPanel.tsx";
import { OrderSummary, type CartState } from "../components/checkout/OrderSummary.tsx";
import { OrdersPanel } from "../components/checkout/OrdersPanel.tsx";
import { PaymentPanel } from "../components/checkout/PaymentPanel.tsx";
import { ProductPicker } from "../components/checkout/ProductPicker.tsx";
import { CartFeedback } from "../components/storefront/CartFeedback.tsx";
import { StoreBreadcrumb } from "../components/storefront/StoreBreadcrumb.tsx";
import { SiteFooter } from "../components/storefront/SiteFooter.tsx";
import { SiteHeader } from "../components/storefront/SiteHeader.tsx";
import { checkoutQueryKey, writeCart, writeDeliveryAddresses } from "../storefront/cart-cache.ts";
import { buildPriceIndex, buildStockIndex, uniqueCategories } from "../storefront/catalog.ts";
import { buildCheckoutLines, checkoutTotals, type CheckoutLine } from "../storefront/checkout.ts";
import { formatMoney } from "../storefront/format.ts";
import { invoicePending } from "../storefront/order-status.ts";
import { scrollToSection, scrollToSettledSection } from "../storefront/scroll.ts";
import { ORDER_TABS, type OrderTab } from "../storefront/order-tabs.ts";

type FulfillmentType = "pickup" | "delivery";
type PaymentMethod = "sepay_qr" | "cash_on_delivery";

const defaultDestination: Point = { latitude: 10.7905, longitude: 106.682 };

/** How long a confirmation or failure stays on screen before clearing itself. */
const FEEDBACK_TIMEOUT_MS = 4000;

/** A route longer than the store delivers is refused by the service; tell the shopper what they can do instead. */
const deliveryErrorMessage = (reason: unknown, fallback: string): string => {
  if (reason instanceof ApiError && reason.code === "delivery_out_of_range")
    return "Điểm giao nằm ngoài phạm vi giao hàng của cửa hàng này. Hãy chọn cửa hàng gần hơn hoặc nhận tại cửa hàng.";
  if (reason instanceof ApiError && reason.code === "insufficient_stock")
    return "Cửa hàng này không còn đủ hàng cho đơn của bạn. Hãy giảm số lượng hoặc chọn cửa hàng khác.";
  if (reason instanceof ApiError && reason.code === "stock_unavailable")
    return "Chưa kiểm tra được tồn kho. Vui lòng thử đặt lại sau ít phút.";
  return reason instanceof Error ? reason.message : fallback;
};

/**
 * The SePay webhook reaches the payment service a moment after the shopper transfers, so the panel re-reads the
 * invoice while a QR payment is still open and the shopper is on this tab.
 */
const PAYMENT_POLL_INTERVAL_MS = 4000;

/** Two rows the height of cart lines, so the card keeps its size while the cart is still being read. */
const CartSkeleton = (): React.JSX.Element => (
  <div role="status" aria-label="Đang tải giỏ thuốc" className="grid divide-y divide-line">
    {[0, 1].map((index) => (
      <div key={index} className="flex items-center gap-3 py-4">
        <Skeleton className="size-16 shrink-0" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="h-9 w-28 shrink-0" />
      </div>
    ))}
  </div>
);

const PRODUCTS_SECTION_ID = "chon-thuoc";
const RESULT_SECTION_ID = "ket-qua-dat-hang";

const TAB_ID_BASE = "don-hang";
const ORDER_TAB_ITEMS = [
  { id: "dat-hang", label: "Đặt hàng" },
  { id: "don-cua-toi", label: "Đơn của tôi" },
] as const satisfies ReadonlyArray<{ id: OrderTab; label: string }>;

type Feedback = { kind: "notice" | "error"; message: string };

type PlacedOrder = { order: CustomerOrderDetail; invoice: PaymentInvoice; paymentMethod: PaymentMethod };

/**
 * One page for everything about orders, in two tabs: placing an order, and following the orders already placed.
 *
 * The order form is plain component state rather than a form library: every field is a single choice with no
 * validation, and the values are read while rendering (cart totals, delivery panel, summary) rather than only at
 * submit time. That state, and the payment panel of an order just placed, would be lost if the form unmounted, so
 * switching to the other tab only hides it; the orders tab mounts when opened, so it reads and refreshes only while
 * someone is looking at it.
 */
export const OrdersHubPage = (): React.JSX.Element => {
  const session = useSession();
  const navigate = useNavigate();
  const { tab = "dat-hang" } = useSearch({ from: "/don-hang" });
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("delivery");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("sepay_qr");
  const [selectedStoreId, setSelectedStoreId] = useState<string>();
  const [addressNote, setAddressNote] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [productSearch, setProductSearch] = useState("");
  /**
   * Only an explicit choice by the shopper lives in state. Until then the delivery point is the account's default
   * address, which arrives with the same query that loads the rest of the checkout, so deriving it here means
   * the fee and the map start on the address the account page says is the default.
   */
  const [chosenDestination, setDestination] = useState<Point>();
  const [delivery, setDelivery] = useState<DeliveryCalculation>();
  const [submittedSearch, setSubmittedSearch] = useState<string>();
  const addressSearch = useAddressSearch();
  const [busy, setBusy] = useState(false);
  const [pendingLineId, setPendingLineId] = useState<string>();
  const [addingProductId, setAddingProductId] = useState<string>();
  const [savingDestination, setSavingDestination] = useState(false);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [placed, setPlaced] = useState<PlacedOrder>();
  /**
   * The medicine picker sits right under the cart and stays put. With an empty cart it is open, since choosing
   * medicine is the only thing to do; once the cart has lines it folds into an "add medicine" button so the forms
   * that follow are not pushed far down. Adding from it keeps it open, so the shopper can add a second medicine.
   */
  const [browsing, setBrowsing] = useState(false);
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
    // Only a SePay QR payment waits on the webhook, and only while the shopper is on this tab. Cash on delivery stays
    // pending until the counter takes the money, so re-reading it would only spin.
    refetchInterval: (query) =>
      placed?.paymentMethod === "sepay_qr" && tab === "dat-hang" && invoicePending(query.state.data?.status)
        ? PAYMENT_POLL_INTERVAL_MS
        : false,
  });
  const products = submittedSearch === undefined ? (checkoutQuery.data?.products ?? []) : (productsQuery.data ?? []);
  const bootstrapProducts = checkoutQuery.data?.products;
  const stores = checkoutQuery.data?.stores ?? [];
  const cart = checkoutQuery.data?.cart;
  const cartState: CartState = checkoutQuery.data ? "ready" : checkoutQuery.isPending ? "loading" : "failed";
  const addresses = checkoutQuery.data?.addresses ?? [];
  const defaultAddress = addresses.find((address) => address.isDefault);
  const destination: Point =
    chosenDestination ??
    (defaultAddress
      ? { latitude: Number(defaultAddress.latitude), longitude: Number(defaultAddress.longitude) }
      : defaultDestination);
  /** The address the current point came from, so the panel can offer to save a point the account does not have. */
  const activeAddress = addresses.find(
    (address) =>
      Number(address.latitude) === destination.latitude && Number(address.longitude) === destination.longitude,
  );
  const queryError = checkoutQuery.error ?? productsQuery.error;
  const loadError = queryError instanceof Error ? queryError.message : undefined;
  const visibleError = error ?? addressSearch.error ?? loadError;
  /** The invoice the shopper pays against: the live one once it is read, the create response before that. */
  const placedInvoice = placedInvoiceQuery.data ?? placed?.invoice;

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
  // A delivery order needs the fee of the point the shopper picked; without it the order would fall back to the default point.
  const deliveryPending = fulfillmentType === "delivery" && !delivery;
  const canSubmit = Boolean(
    cartLines.length &&
    session.authenticated &&
    (fulfillmentType === "pickup" || selectedStore) &&
    !deliveryPending &&
    totals.unpricedCount === 0,
  );
  // Ordering is tied to the account, and the sign-in form now lives on the account page, so the reason names where
  // to go rather than describing a form that is not on this page.
  const blockedReason = !session.authenticated
    ? "Đăng nhập tài khoản khách hàng để đặt hàng."
    : cartLines.length === 0
      ? "Thêm thuốc vào giỏ để đặt hàng."
      : !selectedStore
        ? "Chọn nhà thuốc xuất đơn."
        : deliveryPending
          ? "Chọn điểm giao và bấm “Tính phí giao hàng” trước khi đặt."
          : totals.unpricedCount > 0
            ? "Gỡ các sản phẩm chưa có giá khỏi giỏ hoặc nhờ dược sĩ tư vấn."
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
      const cartAfter = await updateCartLine(line.id, 0);
      writeCart(queryClient, cartAfter);
      // With no lines left there is nothing for the picker to fold around, so its browsing state starts over.
      if (cartAfter.lines.length === 0) setBrowsing(false);
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
      setBrowsing(true);
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
      setError(deliveryErrorMessage(reason, "Không tính được phí giao hàng"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Shoppers rarely add an address from the account page; they add it from the checkout they are already in,
   * so the point they just pinned is offered to be saved right here.
   *
   * A point dragged on the map or read from the browser's geolocation has no address text of its own, and the
   * service refuses a blank one. The route calculation reverse-geocodes whatever point it is given, so saving
   * asks for it first: the stored row then carries the same wording the fee summary and the receipt show.
   */
  const saveDestination = async (): Promise<void> => {
    if (!selectedStore) return;
    setSavingDestination(true);
    setError(undefined);
    try {
      const calculation = await calculateDelivery(selectedStore.id, destination, addressNote);
      setDelivery(calculation);
      await saveDeliveryAddress({
        label: calculation.providerResolvedAddress.split(",")[0]?.trim() || "Điểm giao",
        latitude: destination.latitude,
        longitude: destination.longitude,
        providerResolvedAddress: calculation.providerResolvedAddress,
        ...(addressNote.trim() ? { addressNote: addressNote.trim() } : {}),
        // The first address a shopper saves is the one they will want next time, and the service would
        // promote it server-side anyway; sending it keeps the two paths agreeing.
        isDefault: addresses.length === 0,
      });
      // The service owns which row is the default, so the list is re-read rather than patched here.
      writeDeliveryAddresses(queryClient, await listDeliveryAddresses());
      showFeedback({
        kind: "notice",
        message: "Đã lưu điểm giao này. Bạn có thể đổi tên trong Tài khoản › Địa chỉ giao hàng.",
      });
    } catch (reason) {
      setError(deliveryErrorMessage(reason, "Không lưu được điểm giao này."));
    } finally {
      setSavingDestination(false);
    }
  };

  const submitAddressSearch = (): void => {
    setError(undefined);
    addressSearch.search(addressQuery);
  };

  const clearAddressSearch = (): void => {
    setAddressQuery("");
    addressSearch.clear();
  };

  /**
   * A suggestion carries a label and an opaque handle, not a point, so picking one has to resolve it first.
   * The shopper waits on one call per address here, and the fee is recalculated from the resolved point.
   */
  const pickAddressResult = async (result: AddressResult): Promise<void> => {
    setError(undefined);
    try {
      const resolved = await resolveAddressSuggestion(result.refId);
      chooseDestination(resolved.destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lấy được vị trí của địa chỉ đã chọn.");
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
        addressSearch.clear();
      },
      () => setError("Bạn chưa cho phép truy cập vị trí"),
    );
  };

  const chooseDestination = (point: Point): void => {
    setDestination(point);
    setDelivery(undefined);
    addressSearch.clear();
    setPlaced(undefined);
  };

  const placeOrder = async (): Promise<void> => {
    if (!selectedStore || !cart?.lines.length) return;
    setBusy(true);
    setError(undefined);
    let order: CustomerOrderDetail | undefined;
    try {
      const created = await createOrder({
        selectedStoreId: selectedStore.id,
        fulfillmentType,
        paymentMethod,
        lines: cart.lines.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          quantity: Number(line.quantity),
        })),
        ...(fulfillmentType === "delivery"
          ? { delivery: { destination, ...(addressNote ? { addressNote } : {}) } }
          : {}),
      });
      order = created;
      // The order exists from here on: the orders tab is refreshed now rather than after the payment step below, and
      // the cart is emptied now so a failed payment step cannot leave the same items to be ordered a second time.
      void queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
      writeCart(queryClient, await clearCart());
      const invoice = await createPaymentInvoice({
        invoiceId: created.id,
        orderId: created.id,
        paymentMethod,
        lines: created.lines.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          description: line.productNameSnapshot,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPriceSnapshot),
          currency: created.currency,
        })),
      });
      setPlaced({ order: created, invoice, paymentMethod });
      setDelivery(undefined);
      setBrowsing(false);
      showFeedback({
        kind: "notice",
        message:
          paymentMethod === "sepay_qr"
            ? `Đã tạo đơn #${created.id.slice(0, 8).toUpperCase()}. Quét mã QR để hoàn tất thanh toán.`
            : `Đã tạo đơn #${created.id.slice(0, 8).toUpperCase()}. Bạn thanh toán khi nhận thuốc.`,
      });
      scrollToSettledSection(RESULT_SECTION_ID, "smooth");
    } catch (reason) {
      if (order) {
        // The order is real, so the shopper must not place it again: say so and point at the orders tab.
        setError(
          `Đơn #${order.id.slice(0, 8).toUpperCase()} đã được tạo nhưng chưa hoàn tất thanh toán. Xem trong tab Đơn của tôi.`,
        );
        void checkoutQuery.refetch();
      } else {
        setError(deliveryErrorMessage(reason, "Đặt hàng thất bại"));
      }
    } finally {
      setBusy(false);
    }
  };

  const hasLines = cartLines.length > 0;
  const pickerOpen = cartState === "ready" && (!hasLines || browsing);
  const pickerCard = (
    <Card id={PRODUCTS_SECTION_ID} className="scroll-mt-24">
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>Chọn thuốc &amp; vật tư y tế</CardTitle>
        {submittedSearch !== undefined ? (
          <span className="text-xs text-muted">Kết quả cho “{submittedSearch || "tất cả sản phẩm"}”</span>
        ) : null}
        {hasLines ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setBrowsing(false)}>
            Thu gọn
          </Button>
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
  );

  return (
    <div className="min-h-screen bg-background text-ink">
      <SiteHeader storeCount={stores.length} onSearch={(term) => void navigate({ to: "/", search: { q: term } })} />

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        <div className="grid gap-3">
          <PageHeader
            className="mb-0"
            breadcrumb={<StoreBreadcrumb items={[{ label: "Trang chủ", href: "/" }, { label: "Đơn hàng" }]} />}
            title="Đơn hàng"
            subtitle="Đặt thuốc mới hoặc theo dõi những đơn bạn đã đặt."
          />
          <Tabs
            aria-label="Đơn hàng"
            idBase={TAB_ID_BASE}
            className="max-sm:[&_[role=tab]]:min-h-10"
            items={ORDER_TAB_ITEMS}
            value={tab}
            onValueChange={(next) =>
              void navigate({ to: "/don-hang", search: { tab: ORDER_TABS.find((item) => item === next) } })
            }
          />
        </div>

        <div
          role="tabpanel"
          id={tabPanelId(TAB_ID_BASE, "don-cua-toi")}
          aria-labelledby={tabId(TAB_ID_BASE, "don-cua-toi")}
          hidden={tab !== "don-cua-toi"}
        >
          {tab === "don-cua-toi" ? <OrdersPanel /> : null}
        </div>

        <div
          role="tabpanel"
          id={tabPanelId(TAB_ID_BASE, "dat-hang")}
          aria-labelledby={tabId(TAB_ID_BASE, "dat-hang")}
          hidden={tab !== "dat-hang"}
          className="space-y-5"
        >
          <CheckoutSteps current={step} />

          {visibleError ? <Alert variant="danger">{visibleError}</Alert> : null}

          {placed && placedInvoice ? (
            <PaymentPanel
              order={placed.order}
              invoice={placedInvoice}
              paymentMethod={placed.paymentMethod}
              storeName={stores.find((store) => store.id === placed.order.selectedStoreId)?.name}
            />
          ) : null}

          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
              <Card>
                <CardHeader className="flex items-center justify-between gap-2">
                  <CardTitle>Giỏ thuốc</CardTitle>
                  {cartState !== "ready" ? null : hasLines && !pickerOpen ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => setBrowsing(true)}>
                      Thêm thuốc
                    </Button>
                  ) : (
                    <span className="text-xs text-muted">{cartLines.length} sản phẩm</span>
                  )}
                </CardHeader>
                <CardContent>
                  {cartState === "ready" ? (
                    <CartItems
                      lines={cartLines}
                      pendingLineId={pendingLineId}
                      busy={busy}
                      onQuantityChange={(line, quantity) => void changeLineQuantity(line, quantity)}
                      onRemove={(line) => void removeLine(line)}
                      onBrowse={() => scrollToSection(PRODUCTS_SECTION_ID)}
                    />
                  ) : cartState === "loading" ? (
                    <CartSkeleton />
                  ) : null}
                </CardContent>
              </Card>

              {pickerOpen ? pickerCard : null}

              {hasLines ? (
                <>
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
                    activeAddressId={activeAddress?.id}
                    canSaveDestination={session.authenticated && activeAddress === undefined}
                    savingDestination={savingDestination}
                    onSaveDestination={() => void saveDestination()}
                    destination={destination}
                    delivery={delivery}
                    addressNote={addressNote}
                    query={addressQuery}
                    results={addressSearch.results}
                    mapKey={`${tab}:${selectedStore?.id ?? "none"}:${destination.latitude}:${destination.longitude}:${delivery?.route.coordinates.length ?? 0}`}
                    busy={busy}
                    searching={addressSearch.searching}
                    onSelectStore={chooseStore}
                    onDestinationChange={chooseDestination}
                    onAddressNoteChange={setAddressNote}
                    onQueryChange={setAddressQuery}
                    onSearchSubmit={submitAddressSearch}
                    onSearchClear={clearAddressSearch}
                    onPickResult={(result) => void pickAddressResult(result)}
                    onPickSavedAddress={(address) =>
                      chooseDestination({ latitude: Number(address.latitude), longitude: Number(address.longitude) })
                    }
                    onLocateMe={locateMe}
                    onCalculate={() => void calculateFee()}
                  />
                </>
              ) : null}
            </div>

            <aside className="lg:sticky lg:top-5">
              <OrderSummary
                lines={cartLines}
                totals={totals}
                cartState={cartState}
                fulfillmentType={fulfillmentType}
                destinationLabel={delivery?.providerResolvedAddress}
                storeName={selectedStore?.name}
                shippingKnown={Boolean(delivery)}
                busy={busy}
                canSubmit={canSubmit}
                blockedReason={blockedReason}
                needsAccount={!session.authenticated}
                onSubmit={() => void placeOrder()}
                onGoToCart={() => scrollToSection(PRODUCTS_SECTION_ID)}
              />
            </aside>
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
