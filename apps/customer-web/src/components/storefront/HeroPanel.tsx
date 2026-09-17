import { Button, Select } from "@pharmacy/ui";

import type { CatalogStore } from "../../customer-api.ts";
import { scrollToProducts } from "../../storefront/scroll.ts";
import { IconChevronRight, IconCross, IconQr, IconStore, IconTruck } from "./icons.tsx";

export const HeroPanel = ({
  productCount,
  storeCount,
  stores,
  selectedStore,
  onSelectStore,
}: {
  productCount: number | undefined;
  storeCount: number | undefined;
  stores: CatalogStore[];
  selectedStore: CatalogStore | undefined;
  onSelectStore: (storeId: string) => void;
}): React.JSX.Element => (
  <section className="overflow-hidden rounded-lg bg-gradient-to-br from-primary via-primary to-primary-dark text-white">
    <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
      <div>
        <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
          <IconCross className="size-3.5" />
          Nhà thuốc trực tuyến
        </p>
        <h1 className="mt-4 text-2xl font-semibold leading-tight sm:text-3xl lg:text-4xl">
          Đặt thuốc và vật tư y tế, nhận tại nhà thuốc hoặc giao tận nơi
        </h1>
        <p className="mt-3 max-w-xl text-sm text-white/85 sm:text-base">
          Tìm theo tên thuốc, mã SKU hoặc danh mục. Giá thống nhất tại mọi nhà thuốc; tồn kho được kiểm tra lại khi bạn
          đặt hàng.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" className="bg-white text-primary-dark hover:bg-white/90" onClick={scrollToProducts}>
            Xem sản phẩm
          </Button>
          <a
            className="inline-flex h-10 items-center gap-2 rounded-md border border-white/40 px-6 text-sm font-medium text-white hover:bg-white/10"
            href="#nha-thuoc"
          >
            Tìm nhà thuốc gần bạn
            <IconChevronRight className="size-4" />
          </a>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Stat label="Sản phẩm" value={productCount === undefined ? "—" : String(productCount)} />
        <Stat label="Nhà thuốc" value={storeCount === undefined ? "—" : String(storeCount)} />
        <div className="col-span-2 rounded-lg bg-white/10 p-3">
          <dt className="text-xs uppercase tracking-wide text-white/70">Chọn nhà thuốc nhận hàng</dt>
          <dd className="mt-1.5">
            <Select
              aria-label="Chọn nhà thuốc"
              className="h-10"
              value={selectedStore?.id ?? ""}
              onChange={(event) => onSelectStore(event.target.value)}
              disabled={stores.length === 0}
            >
              {stores.length === 0 ? <option value="">Đang tải nhà thuốc...</option> : null}
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </Select>
          </dd>
          {selectedStore?.address ? <dd className="mt-1.5 text-xs text-white/75">{selectedStore.address}</dd> : null}
        </div>
      </dl>
    </div>

    <div className="grid grid-cols-1 gap-px border-t border-white/15 bg-white/15 sm:grid-cols-3">
      <TrustItem
        icon={<IconTruck className="size-4" />}
        title="Giao hàng tận nơi"
        detail="Phí và lộ trình tính theo khoảng cách"
      />
      <TrustItem
        icon={<IconStore className="size-4" />}
        title="Nhận tại nhà thuốc"
        detail="Chọn nhà thuốc khi thanh toán"
      />
      <TrustItem
        icon={<IconQr className="size-4" />}
        title="SePay QR hoặc COD"
        detail="Thanh toán minh bạch, có mã đối soát"
      />
    </div>
  </section>
);

const Stat = ({ label, value }: { label: string; value: string }): React.JSX.Element => (
  <div className="rounded-lg bg-white/10 p-3">
    <dt className="text-xs uppercase tracking-wide text-white/70">{label}</dt>
    <dd className="mt-1 text-2xl font-semibold">{value}</dd>
  </div>
);

const TrustItem = ({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}): React.JSX.Element => (
  <div className="flex items-start gap-3 bg-primary-dark/40 px-6 py-4">
    <span className="mt-0.5 text-white/80">{icon}</span>
    <span>
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-xs text-white/75">{detail}</span>
    </span>
  </div>
);
