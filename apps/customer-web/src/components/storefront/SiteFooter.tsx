import { categoryLabel, type CategoryOption } from "../../storefront/catalog.ts";
import { BrandMark } from "./BrandMark.tsx";
import { Link } from "./Link.tsx";
import { IconChevronRight, IconQr, IconShield, IconStore, IconTruck } from "./icons.tsx";

const SERVICE_LINKS = [
  { label: "Tìm nhà thuốc gần bạn", href: "/#nha-thuoc" },
  { label: "Giỏ hàng và thanh toán", href: "/don-hang" },
  { label: "Đơn hàng của tôi", href: "/don-hang" },
];

const PAYMENT_METHODS = [
  { label: "Chuyển khoản SePay QR", icon: <IconQr /> },
  { label: "Thanh toán khi nhận hàng", icon: <IconTruck /> },
];

export const SiteFooter = ({ categories = [] }: { categories?: CategoryOption[] | undefined }): React.JSX.Element => (
  <footer className="mt-10 border-t border-line bg-surface">
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-10" />
          <span className="leading-tight">
            <span className="block text-base font-semibold text-ink">Pharmacy Central</span>
            <span className="block text-xs text-muted">Nhà thuốc trực tuyến</span>
          </span>
        </div>
        <p className="mt-4 text-sm text-muted">
          Đặt thuốc và vật tư y tế trực tuyến, nhận tại nhà thuốc hoặc giao tận nơi. Giá hiển thị được tính lại bởi hệ
          thống khi đặt hàng.
        </p>
      </div>

      <nav aria-labelledby="footer-categories">
        <h2 id="footer-categories" className="text-sm font-semibold text-ink">
          Danh mục
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {categories.length === 0 ? (
            <li className="text-muted">Đang cập nhật danh mục</li>
          ) : (
            categories.map((category) => (
              <li key={category.value}>
                <Link
                  className="flex items-center gap-1.5 text-muted hover:text-primary"
                  href={`/?danh-muc=${encodeURIComponent(category.value)}`}
                >
                  <IconChevronRight className="size-3.5 text-muted-soft" />
                  {categoryLabel(category.value)}
                </Link>
              </li>
            ))
          )}
        </ul>
      </nav>

      <nav aria-labelledby="footer-services">
        <h2 id="footer-services" className="text-sm font-semibold text-ink">
          Dịch vụ
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {SERVICE_LINKS.map((link) => (
            <li key={link.label}>
              <Link className="flex items-center gap-1.5 text-muted hover:text-primary" href={link.href}>
                <IconChevronRight className="size-3.5 text-muted-soft" />
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div>
        <h2 className="text-sm font-semibold text-ink">Thanh toán &amp; an toàn</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          {PAYMENT_METHODS.map((method) => (
            <li key={method.label} className="flex items-center gap-2">
              <span className="text-primary">{method.icon}</span>
              {method.label}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="text-primary">
              <IconStore />
            </span>
            Nhận tại nhà thuốc
          </li>
        </ul>
        <p className="mt-4 flex items-start gap-2 text-xs text-muted-soft">
          <IconShield className="size-4 shrink-0 text-primary" />
          Thanh toán được xác thực và đối soát tự động cho mọi đơn hàng.
        </p>
      </div>
    </div>

    <div className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Pharmacy Central.</p>
        <p>Giá thống nhất; tồn kho theo nhà thuốc bạn chọn.</p>
      </div>
    </div>
  </footer>
);
