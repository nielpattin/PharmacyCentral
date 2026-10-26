import { Button } from "@pharmacy/ui";

import { scrollToProducts } from "../../storefront/scroll.ts";
import { IconChevronRight, IconQr, IconStore, IconTruck } from "./icons.tsx";

export const HeroPanel = (): React.JSX.Element => (
  <section className="relative mt-6 overflow-hidden rounded-lg bg-sidebar text-white">
    <img
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden size-full object-cover object-[78%_top] lg:block"
      src="/banner-pharmacy.webp"
    />
    <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-sidebar/95 via-sidebar/75 to-sidebar/30 lg:block" />

    <div className="relative p-6 sm:p-10 lg:px-12 lg:py-14">
      <h1 className="max-w-2xl text-2xl font-semibold leading-tight sm:text-3xl lg:text-4xl">
        Thuốc và vật tư y tế, nhận tại nhà thuốc hoặc giao tận nơi
      </h1>
      <p className="mt-3 max-w-xl text-sm text-white/85 sm:text-base">
        Tìm theo tên thuốc, mã SKU hoặc danh mục. Giá do hệ thống tính lại khi bạn đặt hàng; tồn kho hiển thị theo nhà
        thuốc bạn chọn.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          size="lg"
          className="bg-white text-primary-dark hover:bg-white/90 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          onClick={scrollToProducts}
        >
          Xem sản phẩm
        </Button>
        <a
          className="inline-flex h-10 items-center gap-2 rounded-md border border-white/40 px-6 text-sm font-medium text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          href="#nha-thuoc"
        >
          Tìm nhà thuốc gần bạn
          <IconChevronRight className="size-4" />
        </a>
      </div>
    </div>

    <div className="relative grid grid-cols-1 gap-px border-t border-white/15 bg-white/15 sm:grid-cols-3">
      <TrustItem
        icon={<IconTruck className="size-4" />}
        title="Giao hàng tận nơi"
        detail="Phí và lộ trình tính theo khoảng cách"
      />
      <TrustItem
        icon={<IconStore className="size-4" />}
        title="Nhận tại nhà thuốc"
        detail="Chọn nhà thuốc ở bước thanh toán"
      />
      <TrustItem
        icon={<IconQr className="size-4" />}
        title="SePay QR hoặc COD"
        detail="Chuyển khoản hoặc trả khi nhận hàng"
      />
    </div>
  </section>
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
  <div className="flex items-start gap-3 bg-sidebar/80 px-6 py-4">
    <span className="mt-0.5 text-white/80">{icon}</span>
    <span>
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-xs text-white/75">{detail}</span>
    </span>
  </div>
);
