import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatusCell, type StatusTone } from "@pharmacy/ui";

import type { CustomerPrescription } from "../../customer-api.ts";
import { formatDateTime } from "../../storefront/format.ts";
import { IconReceipt, IconShield } from "../storefront/icons.tsx";
import { Link } from "../storefront/Link.tsx";

type PrescriptionsCardProps = {
  prescriptions: CustomerPrescription[];
};

/** The sales service owns this vocabulary, so the label follows its own status values rather than inventing new ones. */
const STATUS_LABELS: Record<string, string> = {
  Draft: "Bản nháp",
  Pending: "Chờ xử lý",
  PartiallyDispensed: "Đã bán một phần",
  Dispensed: "Đã bán đủ",
  Cancelled: "Đã huỷ",
};

const statusTone = (status: string): StatusTone => {
  if (status === "Dispensed") return "success";
  if (status === "PartiallyDispensed") return "info";
  if (status === "Pending") return "warning";
  return "neutral";
};

export const PrescriptionsCard = ({ prescriptions }: PrescriptionsCardProps): React.JSX.Element => (
  <Card>
    <CardHeader>
      <CardTitle>Đơn thuốc của tôi</CardTitle>
      <CardDescription>
        Những đơn thuốc nhà thuốc đã ghi vào tài khoản của bạn. Đơn của khách vãng lai, không có tài khoản, không hiện ở
        đây.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {prescriptions.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-line bg-surface-soft/60 px-6 py-8 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-surface text-muted-soft">
            <IconReceipt className="size-5" />
          </span>
          <p className="text-sm font-medium text-ink">Chưa có đơn thuốc nào</p>
          <p className="max-w-sm text-sm text-muted">
            Khi dược sĩ ghi đơn cho bạn tại quầy, hãy nói họ chọn tài khoản của bạn để đơn hiện ở đây.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {prescriptions.map((prescription) => (
            <li key={prescription.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    <IconShield className="size-4 text-primary" />
                    {prescription.prescriptionNumber}
                    <StatusCell tone={statusTone(prescription.status)}>
                      {STATUS_LABELS[prescription.status] ?? prescription.status}
                    </StatusCell>
                  </p>
                  <p className="mt-1 text-xs text-muted-soft">
                    Ngày ghi: {formatDateTime(prescription.createdAt)}
                    {prescription.dispensedAt ? ` · Đã bán: ${formatDateTime(prescription.dispensedAt)}` : ""}
                  </p>
                  {prescription.doctorName ? (
                    <p className="mt-1 text-sm text-muted">Bác sĩ: {prescription.doctorName}</p>
                  ) : null}
                </div>
              </div>
              {prescription.lines.length > 0 ? (
                <ul className="mt-3 grid gap-1 border-t border-line pt-3 text-sm text-muted">
                  {prescription.lines.map((line) => (
                    <li key={line.id} className="flex flex-wrap gap-2">
                      <span>
                        {[line.dosage, line.frequency, line.duration].filter(Boolean).join(" · ") ||
                          "Liều dùng chưa ghi"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">
        Muốn xem thuốc đã mua và trạng thái giao hàng?{" "}
        <Link className="font-medium text-primary hover:underline" href="/don-hang?tab=don-cua-toi">
          Đơn hàng của tôi
        </Link>
      </p>
    </CardContent>
  </Card>
);
