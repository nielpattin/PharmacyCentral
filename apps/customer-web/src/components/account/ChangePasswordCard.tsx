import { useForm } from "@tanstack/react-form";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@pharmacy/ui";
import { useState } from "react";

import { changePassword } from "../../customer-api.ts";

/** The identity service rejects a shorter password, so the form never asks for one it would refuse. */
const MIN_PASSWORD_LENGTH = 12;

type ChangePasswordCardProps = {
  /** Called once the new password is saved; the fresh token it came with is already stored. */
  onChanged: () => void;
};

export const ChangePasswordCard = ({ onChanged }: ChangePasswordCardProps): React.JSX.Element => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const form = useForm({
    defaultValues: { currentPassword: "", nextPassword: "", confirmPassword: "" },
    onSubmit: async ({ value }) => {
      if (value.nextPassword !== value.confirmPassword) {
        setError("Mật khẩu mới chưa khớp với xác nhận.");
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        await changePassword(value.currentPassword, value.nextPassword);
        form.reset();
        onChanged();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Không đổi được mật khẩu");
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Đổi mật khẩu</CardTitle>
        <CardDescription>
          Mật khẩu mới có hiệu lực ngay cho lần đăng nhập sau. Bạn vẫn đăng nhập trên trình duyệt này.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-md gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="currentPassword">
            {(field) => (
              <Field label="Mật khẩu hiện tại">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="••••••••"
                  required
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="nextPassword">
            {(field) => (
              <Field label="Mật khẩu mới" hint={`Tối thiểu ${MIN_PASSWORD_LENGTH} ký tự, nên có chữ và số.`}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="••••••••"
                  required
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="confirmPassword">
            {(field) => (
              <Field label="Xác nhận mật khẩu mới">
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="••••••••"
                  required
                />
              </Field>
            )}
          </form.Field>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
            >
              {error}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? "Đang đổi…" : "Đổi mật khẩu"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
