import { Link } from "./Link.tsx";
import { IconCart, IconPin, IconQr, IconStore, IconTruck } from "./icons.tsx";

type QuickAction = {
  label: string;
  detail: string;
  icon: React.ReactNode;
  onSelect?: () => void;
  href?: string;
};

export const QuickActions = ({ onFindNearest }: { onFindNearest: () => void }): React.JSX.Element => {
  const actions: QuickAction[] = [
    { label: "Tìm nhà thuốc", detail: "Theo vị trí của bạn", icon: <IconPin />, onSelect: onFindNearest },
    { label: "Giao hàng", detail: "Tính phí theo km", icon: <IconTruck />, href: "/don-hang" },
    { label: "Nhận tại quầy", detail: "Chọn nhà thuốc", icon: <IconStore />, href: "/don-hang" },
    { label: "Thanh toán QR", detail: "SePay hoặc COD", icon: <IconQr />, href: "/don-hang" },
    { label: "Giỏ hàng", detail: "Kiểm tra đơn", icon: <IconCart />, href: "/don-hang" },
  ];

  return (
    <section className="rounded-lg border border-line bg-surface p-2">
      <ul className="grid grid-cols-3 gap-1 sm:grid-cols-5">
        {actions.map((action) => (
          <li key={action.label}>
            <ActionTarget action={action} />
          </li>
        ))}
      </ul>
    </section>
  );
};

const ActionTarget = ({ action }: { action: QuickAction }): React.JSX.Element => {
  const body = (
    <>
      <span className="grid size-11 place-items-center rounded-full bg-primary-soft text-primary-dark [&>svg]:size-6">
        {action.icon}
      </span>
      <span className="mt-2 text-center">
        <span className="block text-xs font-medium text-ink">{action.label}</span>
        <span className="mt-0.5 block text-[11px] text-muted">{action.detail}</span>
      </span>
    </>
  );

  const className = "flex w-full flex-col items-center rounded-md px-2 py-3 transition-colors hover:bg-surface-soft";

  if (action.onSelect) {
    return (
      <button type="button" className={className} onClick={action.onSelect}>
        {body}
      </button>
    );
  }
  return (
    <Link className={className} href={action.href ?? "/"}>
      {body}
    </Link>
  );
};
