import { Alert, Button, Card, CardDescription, CardHeader, CardTitle, Dialog, Field, Textarea } from "@pharmacy/ui";
import { Link as RouterLink } from "@tanstack/react-router";
import { useState } from "react";

type PharmacistRequestCardProps = {
  /** The prescribed names no suggestion could fill as written at the chosen store. */
  helpNames: string[];
  /** Files the request; rejects when it was not filed. */
  onSend: (input: { requestKey: string; note: string | null }) => Promise<void>;
};

const NOTE_MAX_LENGTH = 1000;

/**
 * Hands the read prescription to the pharmacists when the suggestions cannot fill some of it. One key is kept for
 * the prescription on screen, so sending again after a lost answer files nothing twice.
 */
export const PharmacistRequestCard = ({ helpNames, onSend }: PharmacistRequestCardProps): React.JSX.Element => {
  const [requestKey] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [step, setStep] = useState<"compose" | "sending" | "sent">("compose");
  const [error, setError] = useState<string>();

  const send = async (): Promise<void> => {
    setStep("sending");
    setError(undefined);
    try {
      await onSend({ requestKey, note: note.trim() || null });
      setStep("sent");
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chưa gửi được yêu cầu, vui lòng thử lại sau.");
      setStep("compose");
    }
  };

  if (step === "sent") {
    return (
      <Alert role="status">
        Đã gửi đơn cho dược sĩ. Câu trả lời sẽ hiện trong mục{" "}
        <RouterLink
          className="font-medium text-primary hover:underline"
          to="/tai-khoan"
          search={{ section: "don-thuoc" }}
        >
          Đơn thuốc của tài khoản
        </RouterLink>
        .
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle>Nhờ dược sĩ tìm giúp</CardTitle>
          <CardDescription>
            {helpNames.length} thuốc chưa có sản phẩm đúng đơn tại nhà thuốc đang chọn. Dược sĩ sẽ xem đơn đã đọc và trả
            lời bạn thuốc nên dùng thay thế.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
          Nhờ dược sĩ tìm giúp
        </Button>
      </CardHeader>

      <Dialog open={open} onClose={() => step !== "sending" && setOpen(false)} title="Gửi đơn thuốc cho dược sĩ?">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-0.5">
          <div>
            <p className="text-sm text-muted">Thuốc cần dược sĩ tìm giúp:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">
              {helpNames.map((name, index) => (
                <li key={index}>{name}</li>
              ))}
            </ul>
          </div>
          <Field label="Lời nhắn cho dược sĩ (không bắt buộc)">
            <Textarea
              value={note}
              maxLength={NOTE_MAX_LENGTH}
              placeholder="Ví dụ: tôi cần lấy thuốc trong hôm nay"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <p className="text-xs text-muted">
            Dược sĩ sẽ thấy thông tin đã đọc từ đơn: tên bệnh nhân, bác sĩ, chẩn đoán và danh sách thuốc. Ảnh đơn thuốc
            không được gửi đi.
          </p>
          {error ? <Alert variant="danger">{error}</Alert> : null}
        </div>
        <div className="mt-4 flex shrink-0 justify-end gap-2">
          <Button variant="outline" disabled={step === "sending"} onClick={() => setOpen(false)}>
            Hủy
          </Button>
          <Button disabled={step === "sending"} onClick={() => void send()}>
            {step === "sending" ? "Đang gửi..." : "Gửi yêu cầu"}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
};
