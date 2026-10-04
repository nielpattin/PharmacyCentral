import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@pharmacy/ui";
import { useState } from "react";

import type { DeliveryAddress } from "../../customer-api.ts";
import { AddressFormDialog, type AddressDraft } from "../AddressFormDialog.tsx";
import { Link } from "../storefront/Link.tsx";
import { IconCheck, IconPin, IconPlus, IconTrash } from "../storefront/icons.tsx";

type SavedAddressesCardProps = {
  addresses: DeliveryAddress[];
  /** Set while a mutation is in flight so a second click cannot send the same request twice. */
  pendingId: string | undefined;
  busy: boolean;
  onDelete: (address: DeliveryAddress) => void;
  onCreate: (draft: AddressDraft) => void;
  onUpdate: (address: DeliveryAddress, draft: AddressDraft) => void;
};

const toDraft = (address: DeliveryAddress): AddressDraft => ({
  label: address.label,
  providerResolvedAddress: address.providerResolvedAddress,
  addressNote: address.addressNote ?? "",
  point: { latitude: Number(address.latitude), longitude: Number(address.longitude) },
  isDefault: address.isDefault,
});

export const SavedAddressesCard = ({
  addresses,
  pendingId,
  busy,
  onDelete,
  onCreate,
  onUpdate,
}: SavedAddressesCardProps): React.JSX.Element => {
  /** undefined closes the dialog; an address id edits that row; the empty string creates a new one. */
  const [editingId, setEditingId] = useState<string>();
  const editing = editingId === undefined ? undefined : addresses.find((row) => row.id === editingId);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Địa chỉ giao hàng</CardTitle>
            <CardDescription>
              Địa chỉ mặc định được chọn trước ở bước thanh toán, và phí giao được tính theo đúng vị trí đó.
            </CardDescription>
          </div>
          <Button onClick={() => setEditingId("")}>
            <IconPlus className="size-4" />
            Thêm địa chỉ
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {addresses.length === 0 ? (
          <div className="grid place-items-center gap-3 rounded-lg border border-dashed border-line bg-surface-soft/60 px-6 py-8 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-surface text-muted-soft">
              <IconPin className="size-5" />
            </span>
            <p className="text-sm font-medium text-ink">Bạn chưa lưu địa chỉ nào</p>
            <p className="max-w-sm text-sm text-muted">
              Thêm điểm giao bạn hay dùng. Chọn địa chỉ trên bản đồ, kéo điểm đỏ về đúng cổng, và lần sau bạn chỉ cần
              bấm vào tên là xong.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setEditingId("")}>
                <IconPlus className="size-4" />
                Thêm địa chỉ giao hàng
              </Button>
              <Link
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-soft"
                href="/don-hang"
              >
                Hoặc đặt hàng ngay
              </Link>
            </div>
          </div>
        ) : (
          <ul className="grid gap-3">
            {addresses.map((address) => {
              const rowBusy = pendingId === address.id;
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
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!address.isDefault ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rowBusy || busy}
                          onClick={() => onUpdate(address, { ...toDraft(address), isDefault: true })}
                        >
                          <IconCheck className="size-3.5" />
                          {rowBusy ? "Đang đặt…" : "Đặt mặc định"}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rowBusy || busy}
                        onClick={() => setEditingId(address.id)}
                      >
                        Sửa
                      </Button>
                      <Button size="sm" variant="outline" disabled={rowBusy || busy} onClick={() => onDelete(address)}>
                        <IconTrash className="size-3.5" />
                        {rowBusy ? "Đang xoá…" : "Xoá"}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {editingId !== undefined ? (
          <AddressFormDialog
            // A fresh key per open restarts the form, so a previous draft never leaks into the next one.
            key={editingId}
            address={editing && toDraft(editing)}
            existingCount={addresses.length}
            busy={busy}
            onClose={() => setEditingId(undefined)}
            onSubmit={(draft) => {
              if (editing) onUpdate(editing, draft);
              else onCreate(draft);
              setEditingId(undefined);
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
