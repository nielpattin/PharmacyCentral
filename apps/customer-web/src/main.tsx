import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

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
  type Cart,
  type CustomerOrder,
  type DeliveryCalculation,
  type DeliveryAddress,
  registerCustomer,
} from "./customer-api.ts";
import { setSessionSnapshot, useSession } from "./auth.ts";

import "./index.css";
import { setIdentityContextsEnabled } from "./customer-api.ts";

import { DeliveryMap } from "./components/DeliveryMap.tsx";
import { useMountEffect } from "./hooks/useMountEffect.ts";

type Point = { latitude: number; longitude: number };
const defaultDestination: Point = { latitude: 10.7905, longitude: 106.682 };

const CustomerApp = (): React.JSX.Element => {
  const session = useSession();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [stores, setStores] = useState<CatalogStore[]>([]);
  const [cart, setCart] = useState<Cart>();
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
  const [destination, setDestination] = useState(defaultDestination);
  const [addressNote, setAddressNote] = useState("");
  const [delivery, setDelivery] = useState<DeliveryCalculation>();
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [search, setSearch] = useState("");
  const [addressSearch, setAddressSearch] = useState("");
  const [addressResults, setAddressResults] = useState<
    Array<{ displayName: string; latitude: number; longitude: number }>
  >([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [fulfillmentType, setFulfillmentType] = useState<"pickup" | "delivery">("delivery");
  const [paymentMethod, setPaymentMethod] = useState<"sepay_qr" | "cash_on_delivery">("sepay_qr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useMountEffect(() => {
    let active = true;
    void request("/api/auth/csrf")
      .then(() => Promise.all([listProducts(), listStores(), getCart(), currentUser().catch(() => undefined)]))
      .then(async ([loadedProducts, loadedStores, loadedCart, user]) => {
        if (!active) return;
        setProducts(loadedProducts);
        setStores(loadedStores);
        setCart(loadedCart);
        if (loadedStores[0]) setSelectedStoreId(loadedStores[0].id);
        if (user) {
          setSessionSnapshot({ authenticated: true, userId: user.id });
          setIdentityContextsEnabled(true);
          await Promise.all([
            listOrders().then(setOrders),
            listDeliveryAddresses().then(setAddresses),
            mergeGuestCart()
              .then(setCart)
              .catch(() => undefined),
          ]);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load the catalog");
      });
    return () => {
      active = false;
    };
  });

  const selectedStore = stores.find((store) => store.id === selectedStoreId) ?? stores[0];
  const storePoint = selectedStore ? getStorePoint(selectedStore) : { latitude: 10.7769, longitude: 106.7009 };

  const submitAuth = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (authMode === "register") {
        await registerCustomer(email, password, displayName);
        setNotice("Account created. Verify the email before signing in.");
      } else {
        const user = (await loginCustomer(email, password)) as { id: string };
        setSessionSnapshot({ authenticated: true, userId: user.id });
        setIdentityContextsEnabled(true);
        await Promise.all([
          mergeGuestCart().then(setCart),
          listOrders().then(setOrders),
          listDeliveryAddresses().then(setAddresses),
        ]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const addProduct = async (product: CatalogProduct): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const unit = (await getProductUnits(product.id))[0];
      if (!unit) throw new Error("Product has no sale unit");
      setCart(await addCartLine(product.id, unit.id, 1));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add product");
    } finally {
      setBusy(false);
    }
  };

  const calculate = async (): Promise<void> => {
    if (!selectedStore) return;
    setBusy(true);
    setError(undefined);
    try {
      setDelivery(await calculateDelivery(selectedStore.id, destination, addressNote));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to calculate delivery");
    } finally {
      setBusy(false);
    }
  };

  const checkout = async (): Promise<void> => {
    if (!selectedStore || !cart?.lines.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const lines = await Promise.all(
        cart.lines.map(async (line) => {
          const price = await getActivePrice(line.productId, line.productUnitId, selectedStore.id);
          return {
            productId: line.productId,
            productUnitId: line.productUnitId,
            quantity: Number(line.quantity),
            unitPrice: Number(price.unitPrice),
          };
        }),
      );
      const order = await createOrder({
        selectedStoreId: selectedStore.id,
        fulfillmentType,
        lines: lines.map(({ productId, productUnitId, quantity }) => ({ productId, productUnitId, quantity })),
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
      setOrders((current) => [order, ...current]);
      setCart(await clearCart());
      setNotice(
        `Order ${order.id} created. Payment ${invoice.paymentCode} is ${invoice.status}.${fulfillmentType === "delivery" ? " Delivery route was recalculated by the server." : ""}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout failed");
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
      () => setError("Location permission was not granted"),
    );
  };

  const findAddress = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      setAddressResults(await searchAddress(addressSearch));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Address search failed");
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 bg-background p-6 text-ink">
      <header>
        <h1 className="text-2xl font-bold">Pharmacy Central</h1>
        <p className="mt-1 text-sm text-muted">
          Browse products, merge guest carts after sign-in, and track pickup or delivery orders.
        </p>
      </header>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {notice ? <Alert>{notice}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>{session.authenticated ? `Signed in as ${session.userId}` : "Customer account"}</CardTitle>
        </CardHeader>
        {!session.authenticated ? (
          <CardContent>
            <form onSubmit={submitAuth} className="grid max-w-md gap-3">
              {authMode === "register" ? (
                <Input
                  aria-label="Display name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Display name"
                  required
                />
              ) : null}
              <Input
                aria-label="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                required
              />
              <Input
                aria-label="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                required
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {authMode === "register" ? "Create account" : "Sign in"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
                >
                  {authMode === "login" ? "Create an account" : "Use existing account"}
                </Button>
              </div>
            </form>
          </CardContent>
        ) : null}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Catalog</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void listProducts(search)
                .then(setProducts)
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Search failed"));
            }}
            className="flex gap-2"
          >
            <Input
              aria-label="Search products"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or SKU"
            />
            <Button type="submit">Search</Button>
          </form>
          <DataTable
            rows={products}
            getKey={(product) => product.id}
            empty="No products found"
            columns={[
              {
                key: "name",
                label: "Product",
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
                    Add to cart
                  </Button>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cart and checkout</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y divide-line rounded-md border border-line">
            {(cart?.lines ?? []).map((line) => (
              <li key={line.id} className="flex justify-between px-3 py-2 text-sm">
                <span className="truncate">{line.productId}</span>
                <Badge variant="secondary">{line.quantity}</Badge>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Fulfillment
              <Select
                value={fulfillmentType}
                onChange={(event) => setFulfillmentType(event.target.value as "pickup" | "delivery")}
              >
                <option value="delivery">Delivery</option>
                <option value="pickup">Pickup</option>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Payment
              <Select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as "sepay_qr" | "cash_on_delivery")}
              >
                <option value="sepay_qr">SePay QR</option>
                <option value="cash_on_delivery">Cash on delivery</option>
              </Select>
            </label>
          </div>
          <Button
            type="button"
            onClick={() => void checkout()}
            disabled={busy || !cart?.lines.length || !session.authenticated}
          >
            Checkout with server recalculation
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Delivery destination</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="grid max-w-md gap-1.5 text-sm font-medium">
            Retail store
            <Select
              value={selectedStoreId}
              onChange={(event) => {
                setSelectedStoreId(event.target.value);
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
          <form onSubmit={findAddress} className="flex max-w-md gap-2">
            <Input
              aria-label="Address search"
              value={addressSearch}
              onChange={(event) => setAddressSearch(event.target.value)}
              placeholder="Search an address"
            />
            <Button type="submit">Search</Button>
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
          <Input
            aria-label="Address note"
            value={addressNote}
            onChange={(event) => setAddressNote(event.target.value)}
            placeholder="Floor, landmark, or alley"
          />
          <p className="text-sm text-muted">
            Destination: {destination.latitude.toFixed(5)}, {destination.longitude.toFixed(5)}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={locateMe}>
              Use current location
            </Button>
            <Button type="button" onClick={() => void calculate()} disabled={busy || !selectedStore}>
              Calculate delivery
            </Button>
          </div>
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
          {delivery ? (
            <p className="rounded-md bg-surface-soft p-3 text-sm">
              Resolved address: {delivery.providerResolvedAddress}. Distance:{" "}
              {(delivery.distanceMeters / 1000).toFixed(2)} km. Duration: {Math.ceil(delivery.durationSeconds / 60)}{" "}
              minutes. Fee: {delivery.fee.toLocaleString()} {delivery.currency}.
            </p>
          ) : null}
        </CardContent>
      </Card>
      {session.authenticated ? (
        <Card>
          <CardHeader>
            <CardTitle>Order history and tracking</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={orders}
              getKey={(order) => order.id}
              empty="No orders yet"
              columns={[
                {
                  key: "id",
                  label: "Order",
                  render: (order) => <span className="font-mono text-xs">#{order.id}</span>,
                },
                { key: "status", label: "Status", render: (order) => <Badge>{order.status}</Badge> },
                { key: "fulfillmentType", label: "Fulfillment" },
                {
                  key: "total",
                  label: "Total",
                  render: (order) => `${Number(order.subtotal) + Number(order.deliveryFee)} ${order.currency}`,
                },
                {
                  key: "delivery",
                  label: "Delivery",
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
            <CardTitle>Saved delivery addresses</CardTitle>
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

const getStorePoint = (store: CatalogStore): Point =>
  store.coordinates ?? { latitude: store.latitude ?? 10.7769, longitude: store.longitude ?? 106.7009 };
const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Customer application root was not found");
createRoot(root).render(
  <StrictMode>
    <CustomerApp />
  </StrictMode>,
);
