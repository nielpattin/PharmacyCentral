import { useForm } from "@tanstack/react-form";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@pharmacy/ui";
import { useState } from "react";

import { updateProfile, type Customer } from "../../customer-api.ts";
import { initials } from "../../storefront/format.ts";

type ProfileFormCardProps = {
  customer: Customer;
  /** The header renders the account label from the same payload, so a rename has to publish to the whole page. */
  onSaved: (customer: Customer, message: string) => void;
};

/** The identity service accepts a phone of digits and dial punctuation only, so the form asks for the same. */
const PHONE_PATTERN = /^[0-9+()\s-]{8,20}$/;

export const ProfileFormCard = ({ customer, onSaved }: ProfileFormCardProps): React.JSX.Element => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const form = useForm({
    // Re-seeding from the customer prop is what makes the form follow a save the server accepted.
    defaultValues: { displayName: customer.displayName, phoneNumber: customer.phoneNumber ?? "" },
    onSubmit: async ({ value }) => {
      const displayName = value.displayName.trim();
      const phoneNumber = value.phoneNumber.trim();
      if (!displayName) {
        setError("Tên hiển thị không được để trống.");
        return;
      }
      if (phoneNumber && !PHONE_PATTERN.test(phoneNumber)) {
        setError("Số điện thoại chỉ gồm chữ số và các ký tự + ( ) -");
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const saved = await updateProfile({ displayName, phoneNumber: phoneNumber || null });
        form.reset({ displayName: saved.displayName, phoneNumber: saved.phoneNumber ?? "" });
        onSaved(saved, "Đã cập nhật thông tin tài khoản.");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Không lưu được thông tin tài khoản.");
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thông tin cá nhân</CardTitle>
        <CardDescription>
          Tên hiển thị và số điện thoại dùng để liên lạc khi nhà thuốc soạn hoặc giao đơn thuốc của bạn. Email là tên
          đăng nhập nên không sửa ở đây.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary-dark"
            >
              {initials(customer.displayName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{customer.displayName}</p>
              <p className="truncate text-xs text-muted">{customer.email}</p>
            </div>
          </div>

          <form.Field name="displayName">
            {(field) => (
              <Field
                label="Tên hiển thị"
                hint="Tên này xuất hiện trên đơn hàng và trong danh sách của nhà thuốc."
                className="max-w-md"
              >
                <Input
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  autoComplete="name"
                  required
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="phoneNumber">
            {(field) => (
              <Field
                label="Số điện thoại"
                hint="Dùng để nhà thuốc gọi xác nhận đơn thuốc. Để trống nếu bạn không muốn nhận cuộc gọi."
                className="max-w-md"
              >
                <Input
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0901234567"
                />
              </Field>
            )}
          </form.Field>

          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <div>
            <Button type="submit" disabled={busy}>
              {busy ? "Đang lưu…" : "Lưu thay đổi"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
