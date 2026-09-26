import { useForm } from "@tanstack/react-form";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@pharmacy/ui";
import { useState } from "react";

import type { DeliveryAddress } from "../../customer-api.ts";
import { IconCheck, IconPin, IconTrash } from "../storefront/icons.tsx";

type SavedAddressesCardProps = {
  addresses: DeliveryAddress[];
  /** Set while a mutation is in flight so a second click cannot send the same request twice. */
  pendingId: string | undefined;
  onDelete: (address: DeliveryAddress) => void;
  onUpdate: (
    address: DeliveryAddress,
    input: { label: string; addressNote: string | null; isDefault: boolean },
  ) => void;
};

const emptyDraft = { label: "", addressNote: "" };

export const SavedAddressesCard = ({
  addresses,
  pendingId,
  onDelete,
  onUpdate,
}: SavedAddressesCardProps): React.JSX.Element => {
  const [editingId, setEditingId] = useState<string>();
  const [error, setError] = useState<string>();

  const form = useForm({
    defaultValues: emptyDraft,
    onSubmit: async ({ value }) => {
      const target = addresses.find((address) => address.id === editingId);
      if (!target) return;
      const label = value.label.trim();
      if (!label) {
        setError("Tên địa chỉ không được để trống.");
        return;
      }
      setError(undefined);
      // Editing a name must not silently move the shopper's default onto this row.
      onUpdate(target, { label, addressNote: value.addressNote.trim() || null, isDefault: target.isDefault });
      setEditingId(undefined);
      form.reset(emptyDraft);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Địa chỉ giao hàng</CardTitle>
        <CardDescription>
          Những điểm giao bạn đã lưu. Địa chỉ mặc định được chọn trước ở bước thanh toán, và phí giao được tính theo
          đúng vị trí đó.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {addresses.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-line bg-surface-soft/60 px-6 py-8 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-surface text-muted-soft">
              <IconPin className="size-5" />
            </span>
            <p className="text-sm font-medium text-ink">Bạn chưa lưu địa chỉ nào</p>
            <p className="max-w-sm text-sm text-muted">
              Khi chọn điểm giao ở trang đặt hàng, hãy lưu lại địa chỉ để lần sau không phải tìm lại từ đầu.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {addresses.map((address) => {
              const editing = editingId === address.id;
              const busy = pendingId === address.id;
              return (
                <li key={address.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                        <IconPin className="size-4 text-primary" />
                        {address.label}
                        {address.isDefault ? <Badge variant="primary">Mặc định</Badge> : null}
                      </p>
                      <p className="mt-1 text-sm text-muted">{address.providerResolvedAddress}</p>
                      {address.addressNote ? (
                        <p className="mt-1 text-xs text-muted">Ghi chú: {address.addressNote}</p>
                      ) : null}
                      <p className="mt-1.5 text-xs text-muted-soft">
                        {Number(address.latitude).toFixed(5)}, {Number(address.longitude).toFixed(5)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!address.isDefault ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            onUpdate(address, {
                              label: address.label,
                              addressNote: address.addressNote,
                              isDefault: true,
                            })
                          }
                        >
                          <IconCheck className="size-3.5" />
                          {busy ? "Đang đặt…" : "Đặt mặc định"}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(editing ? undefined : address.id);
                          setError(undefined);
                          if (!editing) form.reset({ label: address.label, addressNote: address.addressNote ?? "" });
                        }}
                      >
                        {editing ? "Đóng" : "Sửa"}
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onDelete(address)}>
                        <IconTrash className="size-3.5" />
                        {busy ? "Đang xoá…" : "Xoá"}
                      </Button>
                    </div>
                  </div>

                  {editing ? (
                    <form
                      className="mt-4 grid gap-3 border-t border-line pt-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void form.handleSubmit();
                      }}
                    >
                      <form.Field name="label">
                        {(field) => (
                          <Field label="Tên địa chỉ" hint="Ví dụ: Nhà, Văn phòng." className="max-w-md">
                            <Input
                              value={field.state.value}
                              onChange={(event) => field.handleChange(event.target.value)}
                              onBlur={field.handleBlur}
                              required
                            />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name="addressNote">
                        {(field) => (
                          <Field
                            label="Ghi chú"
                            hint="Số nhà, hướng cổng, thông tin giúp shipper tìm đúng điểm giao."
                            className="max-w-md"
                          >
                            <Input
                              value={field.state.value}
                              onChange={(event) => field.handleChange(event.target.value)}
                              onBlur={field.handleBlur}
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
                        <Button type="submit">Lưu địa chỉ</Button>
                      </div>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {error && addresses.length === 0 ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
