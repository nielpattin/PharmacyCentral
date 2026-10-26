import { IconQr, IconReceipt, IconStore, IconTruck } from "../storefront/icons.tsx";

type ChoiceOption = { value: string; label: string; description: string; icon: React.ReactNode };

const FULFILLMENT_OPTIONS: ChoiceOption[] = [
  {
    value: "delivery",
    label: "Giao tận nơi",
    description: "Phí giao tính theo khoảng cách từ nhà thuốc bạn chọn tới điểm nhận.",
    icon: <IconTruck />,
  },
  {
    value: "pickup",
    label: "Nhận tại nhà thuốc",
    description: "Nhà thuốc soạn sẵn, bạn ghé lấy và thanh toán tại quầy.",
    icon: <IconStore />,
  },
];

const PAYMENT_OPTIONS: ChoiceOption[] = [
  {
    value: "sepay_qr",
    label: "Chuyển khoản SePay QR",
    description: "Quét mã VietQR bằng app ngân hàng, đơn được xác nhận tự động.",
    icon: <IconQr />,
  },
  {
    value: "cash_on_delivery",
    label: "Thanh toán khi nhận hàng",
    description: "Trả tiền mặt cho nhân viên khi nhận thuốc.",
    icon: <IconReceipt />,
  },
];

const ChoiceGroup = ({
  legend,
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  options: ChoiceOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element => (
  <fieldset className="grid gap-2">
    <legend className="text-sm font-semibold text-ink">{legend}</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((option) => (
        <label
          key={option.value}
          className="group relative flex cursor-pointer rounded-lg border border-line bg-surface p-3.5 text-left shadow-sm transition-colors hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:ring-2 has-[:checked]:ring-primary/20 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          <span className="flex w-full items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary transition-colors group-has-[:checked]:bg-primary group-has-[:checked]:text-white">
              {option.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{option.label}</span>
              <span className="mt-0.5 block text-xs text-muted">{option.description}</span>
            </span>
          </span>
        </label>
      ))}
    </div>
  </fieldset>
);

type FulfillmentPanelProps = {
  fulfillmentType: "pickup" | "delivery";
  paymentMethod: "sepay_qr" | "cash_on_delivery";
  disabled: boolean;
  paymentHint: string;
  onFulfillmentChange: (value: "pickup" | "delivery") => void;
  onPaymentChange: (value: "sepay_qr" | "cash_on_delivery") => void;
};

export const FulfillmentPanel = ({
  fulfillmentType,
  paymentMethod,
  disabled,
  paymentHint,
  onFulfillmentChange,
  onPaymentChange,
}: FulfillmentPanelProps): React.JSX.Element => (
  <div className="grid gap-5">
    <ChoiceGroup
      legend="Hình thức nhận hàng"
      name="fulfillment-type"
      value={fulfillmentType}
      options={FULFILLMENT_OPTIONS}
      disabled={disabled}
      onChange={(value) => onFulfillmentChange(value as "pickup" | "delivery")}
    />
    <ChoiceGroup
      legend="Phương thức thanh toán"
      name="payment-method"
      value={paymentMethod}
      options={PAYMENT_OPTIONS}
      disabled={disabled}
      onChange={(value) => onPaymentChange(value as "sepay_qr" | "cash_on_delivery")}
    />
    <p className="rounded-lg bg-primary-soft/50 px-3.5 py-2.5 text-xs text-muted">{paymentHint}</p>
  </div>
);
