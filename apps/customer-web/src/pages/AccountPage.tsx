import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@pharmacy/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import {
  deleteDeliveryAddress,
  forShopper,
  listDeliveryAddresses,
  listOrders,
  listPrescriptionConsultations,
  listPrescriptions,
  logoutCustomer,
  resolveCustomerSession,
  saveDeliveryAddress,
  updateDeliveryAddress,
  type Customer,
  type DeliveryAddress,
} from "../customer-api.ts";
import { useSession } from "../auth.ts";
import { ChangePasswordCard } from "../components/account/ChangePasswordCard.tsx";
import { CustomerAuthForm } from "../components/account/CustomerAuthForm.tsx";
import { PrescriptionConsultationsCard } from "../components/account/PrescriptionConsultationsCard.tsx";
import { PrescriptionsCard } from "../components/account/PrescriptionsCard.tsx";
import { ProfileFormCard } from "../components/account/ProfileFormCard.tsx";
import { SavedAddressesCard } from "../components/account/SavedAddressesCard.tsx";
import type { AddressDraft } from "../components/AddressFormDialog.tsx";
import { Link } from "../components/storefront/Link.tsx";
import { StoreBreadcrumb } from "../components/storefront/StoreBreadcrumb.tsx";
import { SiteFooter } from "../components/storefront/SiteFooter.tsx";
import { SiteHeader } from "../components/storefront/SiteHeader.tsx";
import { IconPin, IconReceipt, IconShield, IconUser } from "../components/storefront/icons.tsx";
import type { AccountSection } from "../router.ts";
import { accountQueryKey, checkoutQueryKey, writeDeliveryAddresses } from "../storefront/cart-cache.ts";
import { formatDateTime, formatMoney, initials } from "../storefront/format.ts";

/** Both states the page shows before it can answer: an empty list must never stand in for either of them. */
const NoticeCard = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <Card>
    <CardContent className="py-10 text-center text-sm text-muted" role="status">
      {children}
    </CardContent>
  </Card>
);

type AccountNotice = { kind: "notice" | "error"; message: string };

/** The address form always submits the whole point, so an edit can move a delivery as well as rename it. */
type AddressSave = AddressDraft & { id?: string };

/** Recent orders on the overview are a preview; the full list lives on its own page. */
const RECENT_ORDER_COUNT = 3;

const SECTIONS: Array<{ id: AccountSection; label: string; icon: (className: string) => React.JSX.Element }> = [
  { id: "tong-quan", label: "Tổng quan", icon: (className) => <IconUser className={className} /> },
  { id: "don-hang", label: "Đơn hàng", icon: (className) => <IconReceipt className={className} /> },
  { id: "don-thuoc", label: "Đơn thuốc", icon: (className) => <IconShield className={className} /> },
  { id: "dia-chi", label: "Địa chỉ giao hàng", icon: (className) => <IconPin className={className} /> },
  { id: "ho-so", label: "Thông tin cá nhân", icon: (className) => <IconUser className={className} /> },
  { id: "mat-khau", label: "Đổi mật khẩu", icon: (className) => <IconShield className={className} /> },
];

const ORDER_STATUS_LABELS: Record<string, string> = {
  Pending: "Chờ xác nhận",
  Confirmed: "Đã xác nhận",
  Preparing: "Đang lấy thuốc",
  Ready: "Sẵn sàng giao",
  Delivering: "Đang giao",
  Completed: "Hoàn tất",
  Cancelled: "Đã huỷ",
};

/**
 * The shopper's own page. It is the one route that resolves the session on its own, so a deep link, a reload, or the
 * header link all land on the same answer rather than depending on another page having probed `/api/auth/me` first.
 */
export const AccountPage = (): React.JSX.Element => {
  const session = useSession();
  const navigate = useNavigate();
  const { section } = useSearch({ from: "/tai-khoan" });
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<AccountNotice>();
  const [pendingAddressId, setPendingAddressId] = useState<string>();
  /** A create has no row to mark, so the form's own submit state is what shows a request is in flight. */
  const [savingAddress, setSavingAddress] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const accountQuery = useQuery({
    // The header renders the account label from this payload, so a sign-out has to take the whole page with it.
    queryKey: accountQueryKey,
    queryFn: async () => {
      const customer = await resolveCustomerSession();
      if (!customer) return { customer: undefined, addresses: [] as DeliveryAddress[] };
      const addresses = await listDeliveryAddresses();
      return { customer, addresses };
    },
  });
  const customer = accountQuery.data?.customer;
  const addresses = accountQuery.data?.addresses ?? [];

  // Only the panels the shopper actually opens cost a request, and both are behind the session check above.
  const ordersQuery = useQuery({
    queryKey: ["customer-orders"],
    enabled: Boolean(customer) && (section === "tong-quan" || section === "don-hang"),
    queryFn: async () => forShopper(customer, listOrders),
  });
  const prescriptionsQuery = useQuery({
    queryKey: ["customer-prescriptions"],
    // The overview tile shows this count, so the panel is not the only thing that needs it.
    enabled: Boolean(customer) && (section === "don-thuoc" || section === "tong-quan"),
    queryFn: async () => forShopper(customer, listPrescriptions),
  });
  const consultationsQuery = useQuery({
    queryKey: ["customer-prescription-consultations"],
    enabled: Boolean(customer) && section === "don-thuoc",
    queryFn: () => forShopper(customer, listPrescriptionConsultations),
  });

  const orders = ordersQuery.data ?? [];
  const prescriptions = prescriptionsQuery.data ?? [];
  const panelError = [ordersQuery.error, prescriptionsQuery.error, consultationsQuery.error].find(
    (reason): reason is Error => reason instanceof Error,
  );
  const loadError = accountQuery.error instanceof Error ? accountQuery.error.message : undefined;
  const visibleError = loadError ?? panelError?.message ?? (notice?.kind === "error" ? notice.message : undefined);

  const announce = (next: AccountNotice): void => setNotice(next);

  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await logoutCustomer();
      // Everything the signed-in shopper was reading belongs to that shopper: the account and order lists must not
      // survive the sign-out in the cache for the next visitor to render from.
      queryClient.removeQueries({ queryKey: accountQueryKey });
      queryClient.removeQueries({ queryKey: ["customer-orders"] });
      queryClient.removeQueries({ queryKey: ["customer-prescriptions"] });
      queryClient.removeQueries({ queryKey: ["customer-prescription-consultations"] });
      queryClient.removeQueries({ queryKey: checkoutQueryKey });
      void navigate({ to: "/" });
    } catch (reason) {
      announce({
        kind: "error",
        message: reason instanceof Error ? reason.message : "Không đăng xuất được, thử lại sau.",
      });
      setSigningOut(false);
    }
  };

  const replaceAddresses = (next: DeliveryAddress[]): void => {
    // The checkout page offers the same saved addresses, so an edit there has to land too.
    queryClient.setQueryData(accountQueryKey, (current) =>
      current && typeof current === "object" ? { ...(current as object), addresses: next } : current,
    );
    writeDeliveryAddresses(queryClient, next);
  };

  const removeAddress = async (address: DeliveryAddress): Promise<void> => {
    setPendingAddressId(address.id);
    setNotice(undefined);
    try {
      await deleteDeliveryAddress(address.id);
      // Deleting the default promotes a survivor, so which row carries the flag is the service's answer,
      // not something this page can work out by removing one row from the list it already had.
      replaceAddresses(await listDeliveryAddresses());
      announce({
        kind: "notice",
        message: address.isDefault
          ? `Đã xoá địa chỉ mặc định “${address.label}”.`
          : `Đã xoá địa chỉ “${address.label}”.`,
      });
    } catch (reason) {
      announce({
        kind: "error",
        message: reason instanceof Error ? reason.message : "Không xoá được địa chỉ giao hàng.",
      });
    } finally {
      setPendingAddressId(undefined);
    }
  };

  const saveAddress = async (input: AddressSave): Promise<void> => {
    setSavingAddress(true);
    setPendingAddressId(input.id);
    setNotice(undefined);
    try {
      const body = {
        label: input.label,
        latitude: input.point.latitude,
        longitude: input.point.longitude,
        providerResolvedAddress: input.providerResolvedAddress,
        addressNote: input.addressNote,
        isDefault: input.isDefault,
      };
      if (input.id) await updateDeliveryAddress(input.id, body);
      else await saveDeliveryAddress(body);
      // The service moves the default flag across rows in one transaction, so the list is re-read, not patched.
      replaceAddresses(await listDeliveryAddresses());
      announce({
        kind: "notice",
        message: input.id ? `Đã cập nhật địa chỉ “${input.label}”.` : `Đã thêm địa chỉ “${input.label}”.`,
      });
    } catch (reason) {
      announce({
        kind: "error",
        message: reason instanceof Error ? reason.message : "Không lưu được địa chỉ giao hàng.",
      });
    } finally {
      setSavingAddress(false);
      setPendingAddressId(undefined);
    }
  };

  const saveProfile = (saved: Customer, message: string): void => {
    queryClient.setQueryData(accountQueryKey, (current) =>
      current && typeof current === "object" ? { ...(current as object), customer: saved } : current,
    );
    announce({ kind: "notice", message });
  };

  const orderRows = (limit: number) => (
    <ul className="grid gap-3">
      {orders.slice(0, limit).map((order) => (
        <li key={order.id} className="rounded-lg border border-line p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {ORDER_STATUS_LABELS[order.status] ?? order.status}
                <span className="ml-2 text-xs font-normal text-muted-soft">{formatDateTime(order.createdAt)}</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                {order.fulfillmentType === "pickup" ? "Nhận tại nhà thuốc" : "Giao đến địa chỉ"} ·{" "}
                {order.paymentStatus === "Paid" ? "Đã thanh toán" : "Chờ thanh toán"}
              </p>
            </div>
            <p className="text-sm font-semibold text-ink">
              {formatMoney(Number(order.subtotal) + Number(order.deliveryFee), order.currency)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );

  const panel = (account: Customer): React.JSX.Element => {
    if (section === "don-hang") {
      if (ordersQuery.isPending) return <NoticeCard>Đang tải đơn hàng…</NoticeCard>;
      if (orders.length === 0) {
        return (
          <Card>
            <CardHeader>
              <CardTitle>Đơn hàng của tôi</CardTitle>
              <CardDescription>Chưa có đơn nào trên tài khoản này.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link className="font-medium text-primary hover:underline" href="/don-hang">
                Đặt hàng ngay
              </Link>
            </CardContent>
          </Card>
        );
      }
      return (
        <Card>
          <CardHeader>
            <CardTitle>Đơn hàng của tôi</CardTitle>
            <CardDescription>
              {orders.length} đơn trên tài khoản này.{" "}
              <Link className="font-medium text-primary hover:underline" href="/don-hang-cua-toi">
                Xem chi tiết và theo dõi giao hàng
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>{orderRows(orders.length)}</CardContent>
        </Card>
      );
    }

    if (section === "don-thuoc") {
      if (prescriptionsQuery.isPending || consultationsQuery.isPending) {
        return <NoticeCard>Đang tải đơn thuốc…</NoticeCard>;
      }
      return (
        <div className="space-y-4">
          <PrescriptionConsultationsCard consultations={consultationsQuery.data ?? []} />
          <PrescriptionsCard prescriptions={prescriptions} />
        </div>
      );
    }

    if (section === "dia-chi") {
      return (
        <SavedAddressesCard
          addresses={addresses}
          pendingId={pendingAddressId}
          busy={savingAddress}
          onDelete={(address) => void removeAddress(address)}
          onCreate={(draft) => void saveAddress(draft)}
          onUpdate={(address, draft) => void saveAddress({ ...draft, id: address.id })}
        />
      );
    }

    if (section === "ho-so") return <ProfileFormCard customer={account} onSaved={saveProfile} />;

    if (section === "mat-khau") {
      return (
        <ChangePasswordCard
          onChanged={() => announce({ kind: "notice", message: "Đã đổi mật khẩu. Hãy đăng nhập lại." })}
        />
      );
    }

    if (ordersQuery.isPending) return <NoticeCard>Đang tải đơn hàng gần đây…</NoticeCard>;
    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconUser className="size-4 text-primary" />
              Xin chào, {account.displayName}
            </CardTitle>
            <CardDescription>
              Email đăng nhập: {account.email}
              {account.phoneNumber ? ` · Số điện thoại: ${account.phoneNumber}` : " · Chưa có số điện thoại"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-4">
              <p className="text-xs text-muted">Địa chỉ đã lưu</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{addresses.length}</p>
              <p className="mt-1 text-xs text-muted-soft">
                {addresses.find((address) => address.isDefault)?.label ?? "Chưa đặt địa chỉ mặc định"}
              </p>
            </div>
            <div className="rounded-lg border border-line p-4">
              <p className="text-xs text-muted">Đơn thuốc trên tài khoản</p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {prescriptionsQuery.isPending ? "…" : prescriptions.length}
              </p>
              <p className="mt-1 text-xs text-muted-soft">Đơn nhà thuốc đã ghi cho bạn</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Đơn hàng gần đây</CardTitle>
            <CardDescription>
              {orders.length > 0 ? (
                <Link className="font-medium text-primary hover:underline" href="/don-hang-cua-toi">
                  Xem tất cả {orders.length} đơn
                </Link>
              ) : (
                "Chưa có đơn nào."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {orders.length > 0 ? (
              orderRows(RECENT_ORDER_COUNT)
            ) : (
              <p className="text-sm text-muted">
                Bạn chưa đặt đơn nào.{" "}
                <Link className="font-medium text-primary hover:underline" href="/don-hang">
                  Xem sản phẩm
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </>
    );
  };

  const body = (): React.JSX.Element => {
    if (!session.resolved || (accountQuery.isPending && !accountQuery.data)) {
      return <NoticeCard>Đang kiểm tra đăng nhập…</NoticeCard>;
    }
    if (!session.authenticated || !customer) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Đăng nhập để quản lý tài khoản</CardTitle>
            <CardDescription>
              Đơn thuốc và địa chỉ giao hàng gắn với tài khoản khách hàng, nên hãy đăng nhập trước khi xem và chỉnh sửa
              chúng.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CustomerAuthForm
              onSignedIn={(message) => announce({ kind: "notice", message })}
              onSignedUp={(message) => announce({ kind: "notice", message })}
            />
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Mục tài khoản" className="lg:sticky lg:top-4 lg:self-start">
          <ul className="grid gap-1 rounded-lg border border-line bg-surface-soft p-2">
            {SECTIONS.map((entry) => {
              const active = section === entry.id;
              return (
                <li key={entry.id}>
                  <RouterLink
                    to="/tai-khoan"
                    search={{ section: entry.id }}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2 text-sm font-medium text-primary-dark"
                        : "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink transition hover:bg-surface"
                    }
                  >
                    {entry.icon("size-4 shrink-0")}
                    {entry.label}
                  </RouterLink>
                </li>
              );
            })}
            <li className="mt-1 border-t border-line pt-1">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={signingOut}
                onClick={() => void signOut()}
              >
                {signingOut ? "Đang đăng xuất…" : "Đăng xuất"}
              </Button>
            </li>
          </ul>
        </nav>

        <div className="grid gap-5">
          {panel(customer)}
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-soft px-3 py-1.5 text-xs font-medium text-ink transition hover:border-primary hover:text-primary"
              href="/don-hang"
            >
              <IconPin className="size-3.5 text-primary" />
              Đặt hàng &amp; thanh toán
            </Link>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background text-ink">
      <SiteHeader onSearch={(term) => void navigate({ to: "/", search: { q: term } })} />

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <StoreBreadcrumb items={[{ label: "Trang chủ", href: "/" }, { label: "Tài khoản" }]} />

        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary-dark"
          >
            {initials(customer?.displayName ?? "?")}
          </span>
          <div>
            <h1 className="text-xl font-semibold text-ink sm:text-2xl">Tài khoản của tôi</h1>
            <p className="mt-1 text-sm text-muted">
              Đơn hàng, đơn thuốc, địa chỉ giao hàng và thông tin liên lạc của bạn.
            </p>
          </div>
        </div>

        {visibleError ? <Alert variant="danger">{visibleError}</Alert> : null}
        {notice?.kind === "notice" ? <Alert>{notice.message}</Alert> : null}

        {body()}
      </main>

      <SiteFooter />
    </div>
  );
};
