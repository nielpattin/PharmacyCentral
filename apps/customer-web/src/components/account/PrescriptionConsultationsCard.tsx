import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@pharmacy/ui";

import type { PrescriptionConsultation } from "../../customer-api.ts";
import { formatDateTime } from "../../storefront/format.ts";
import { Link } from "../storefront/Link.tsx";

type PrescriptionConsultationsCardProps = {
  consultations: PrescriptionConsultation[];
};

/** The shopper's requests for a pharmacist to find what the prescription suggestions could not, with the answers. */
export const PrescriptionConsultationsCard = ({
  consultations,
}: PrescriptionConsultationsCardProps): React.JSX.Element => (
  <Card>
    <CardHeader>
      <CardTitle>Yêu cầu tư vấn đơn thuốc</CardTitle>
      <CardDescription>
        Những đơn bạn đã nhờ dược sĩ tìm giúp từ trang{" "}
        <Link className="font-medium text-primary hover:underline" href="/gui-don-thuoc">
          Gửi đơn thuốc
        </Link>
        , cùng câu trả lời của dược sĩ.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {consultations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface-soft/60 px-6 py-6 text-center text-sm text-muted">
          Bạn chưa gửi yêu cầu tư vấn nào.
        </p>
      ) : (
        <ul className="grid gap-3">
          {consultations.map((consultation) => {
            const helpNames = consultation.lines
              .filter((line) => line.needsHelp)
              .map((line) => line.name ?? line.rawText);
            return (
              <li key={consultation.id} className="rounded-lg border border-line p-4">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {consultation.prescription.code ? `Đơn ${consultation.prescription.code}` : "Đơn thuốc đã gửi"}
                  <Badge variant={consultation.status === "Answered" ? "primary" : "secondary"}>
                    {consultation.status === "Answered" ? "Dược sĩ đã trả lời" : "Đang chờ dược sĩ"}
                  </Badge>
                </p>
                <p className="mt-1 text-xs text-muted-soft">
                  Gửi lúc: {formatDateTime(consultation.createdAt)} · {consultation.lines.length} thuốc
                </p>
                {helpNames.length > 0 ? (
                  <p className="mt-2 text-sm text-muted">Cần tìm giúp: {helpNames.join(", ")}</p>
                ) : null}
                {consultation.note ? (
                  <p className="mt-1 text-sm text-muted">Lời nhắn của bạn: {consultation.note}</p>
                ) : null}
                {consultation.reply ? (
                  <div className="mt-3 rounded-md border border-primary/20 bg-primary-soft/40 px-3 py-2">
                    <p className="text-xs font-medium text-primary">
                      Dược sĩ trả lời
                      {consultation.answeredAt ? ` · ${formatDateTime(consultation.answeredAt)}` : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{consultation.reply}</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </CardContent>
  </Card>
);
