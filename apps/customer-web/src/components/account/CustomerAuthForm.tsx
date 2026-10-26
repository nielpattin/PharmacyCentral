import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Field, Input } from "@pharmacy/ui";

import {
  getCart,
  listDeliveryAddresses,
  loginCustomer,
  registerCustomer,
  setIdentityContextsEnabled,
} from "../../customer-api.ts";
import { setSessionSnapshot } from "../../auth.ts";
import { accountQueryKey, checkoutQueryKey, mergeCartIntoCaches } from "../../storefront/cart-cache.ts";

type AuthMode = "login" | "register";

type CustomerAuthFormProps = {
  /** Told what the page gained, so it can announce it without owning the session itself. */
  onSignedIn: (notice: string) => void;
  onSignedUp: (notice: string) => void;
};

/**
 * The sign-in form the account page shows to a signed-out visitor. It is deliberately reachable from more than one
 * route: the checkout page and the order list both send a shopper who has to authenticate here, so the account page is
 * where authentication lives and every other page links to it.
 */
export const CustomerAuthForm = ({ onSignedIn, onSignedUp }: CustomerAuthFormProps): React.JSX.Element => {
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: { email: "", password: "", displayName: "" },
    onSubmit: async ({ value }) => {
      setBusy(true);
      setError(undefined);
      try {
        if (mode === "register") {
          await registerCustomer(value.email, value.password, value.displayName);
          onSignedUp("Đã tạo tài khoản. Kiểm tra email để xác thực rồi đăng nhập để tiếp tục.");
          return;
        }

        const customer = await loginCustomer(value.email, value.password);
        setSessionSnapshot({ authenticated: true, resolved: true, userId: customer.id });
        setIdentityContextsEnabled(true);
        // The cart read sends the lines kept while signed out, so the cart shown after sign-in is the account's.
        const [nextCart, nextAddresses] = await Promise.all([getCart(), listDeliveryAddresses()]);
        mergeCartIntoCaches(queryClient, nextCart, nextAddresses);
        // The header and the account page both read the name from this payload.
        queryClient.setQueryData(accountQueryKey, { customer, addresses: nextAddresses });
        queryClient.setQueryData(checkoutQueryKey, (current) =>
          current && typeof current === "object"
            ? { ...current, profile: { displayName: customer.displayName, email: customer.email } }
            : current,
        );
        onSignedIn(`Xin chào ${customer.displayName}, giỏ thuốc của bạn đã được đồng bộ.`);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Đăng nhập thất bại");
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <form
      className="grid max-w-md gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {mode === "register" ? (
        <form.Field name="displayName">
          {(field) => (
            <Field label="Tên hiển thị">
              <Input
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Nguyễn Văn A"
                required
              />
            </Field>
          )}
        </form.Field>
      ) : null}
      <form.Field name="email">
        {(field) => (
          <Field label="Email">
            <Input
              type="email"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="ban@email.com"
              required
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <Field
            label="Mật khẩu"
            hint={mode === "register" ? "Tối thiểu 8 ký tự, nên có chữ và số." : "Mật khẩu của tài khoản khách hàng."}
          >
            <Input
              type="password"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="••••••••"
              required
            />
          </Field>
        )}
      </form.Field>
      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {mode === "register" ? "Tạo tài khoản" : "Đăng nhập"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Tạo tài khoản mới" : "Dùng tài khoản có sẵn"}
        </Button>
      </div>
    </form>
  );
};
