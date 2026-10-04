import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select } from "@pharmacy/ui";

import type { AddressSearchResult, CatalogStore, DeliveryAddress, DeliveryCalculation } from "../../customer-api.ts";
import { formatDistance, formatMoney } from "../../storefront/format.ts";
import { DeliveryMap } from "../DeliveryMap.tsx";
import { IconCrosshair, IconPin, IconSearch, IconStore, IconTruck } from "../storefront/icons.tsx";

export type Point = { latitude: number; longitude: number };
export type AddressResult = AddressSearchResult;

type DeliveryPointPanelProps = {
  stores: CatalogStore[];
  selectedStore: CatalogStore | undefined;
  selectedStoreId: string;
  fulfillmentType: "pickup" | "delivery";
  addresses: DeliveryAddress[];
  /** The saved row the current point came from, if any, so the panel knows the point is already kept. */
  activeAddressId: string | undefined;
  /** A signed-in shopper standing on a point their account does not have is offered to keep it. */
  canSaveDestination: boolean;
  savingDestination: boolean;
  onSaveDestination: () => void;
  destination: Point;
  delivery: DeliveryCalculation | undefined;
  addressNote: string;
  query: string;
  results: AddressResult[];
  /** Remount key for the map, so a new route or destination rebuilds it instead of leaving a stale overlay. */
  mapKey: string;
  busy: boolean;
  searching: boolean;
  onSelectStore: (storeId: string) => void;
  onDestinationChange: (point: Point) => void;
  onAddressNoteChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onPickResult: (result: AddressResult) => void;
  onPickSavedAddress: (address: DeliveryAddress) => void;
  onLocateMe: () => void;
  onCalculate: () => void;
};

export const DeliveryPointPanel = ({
  stores,
  selectedStore,
  selectedStoreId,
  fulfillmentType,
  addresses,
  activeAddressId,
  canSaveDestination,
  savingDestination,
  onSaveDestination,
  destination,
  delivery,
  addressNote,
  query,
  results,
  mapKey,
  busy,
  searching,
  onSelectStore,
  onDestinationChange,
  onAddressNoteChange,
  onQueryChange,
  onSearchSubmit,
  onPickResult,
  onPickSavedAddress,
  onLocateMe,
  onCalculate,
}: DeliveryPointPanelProps): React.JSX.Element => {
  const storePoint = selectedStore?.coordinates ?? undefined;
  const pickup = fulfillmentType === "pickup";

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{pickup ? "Nhà thuốc nhận hàng" : "Điểm giao hàng"}</CardTitle>
        <span className="text-muted">
          {pickup ? <IconStore className="size-4" /> : <IconTruck className="size-4" />}
        </span>
      </CardHeader>
      <CardContent className="grid gap-5">
        <Field
          label="Nhà thuốc xuất đơn"
          hint={selectedStore?.address ?? "Đơn được soạn và xuất tại nhà thuốc này."}
          className="max-w-xl"
        >
          <Select value={selectedStoreId} onChange={(event) => onSelectStore(event.target.value)}>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </Select>
        </Field>

        {pickup ? (
          <div className="grid gap-1.5 rounded-lg border border-primary/30 bg-primary-soft/50 p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-ink">
              <IconStore className="size-4 text-primary" />
              {selectedStore?.name ?? "Nhà thuốc đang chọn"}
            </p>
            <p className="text-muted">{selectedStore?.address ?? "Nhà thuốc chưa cập nhật địa chỉ."}</p>
            <p className="text-xs text-muted">
              Nhà thuốc sẽ giữ thuốc cho bạn sau khi đơn được xác nhận. Vui lòng đến trong giờ mở cửa và đọc mã đơn khi
              nhận hàng.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSearchSubmit();
                }}
              >
                <div className="min-w-40 flex-1">
                  <Field
                    label="Tìm địa chỉ giao hàng"
                    hint="Tìm theo số nhà, đường, phường để ghim toạ độ trên bản đồ."
                  >
                    <div className="relative">
                      <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-soft" />
                      <Input
                        className="pl-9"
                        aria-label="Tìm địa chỉ giao hàng"
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        placeholder="Ví dụ: 123 Nguyễn Trãi, Quận 1"
                      />
                    </div>
                  </Field>
                </div>
                <Button type="submit" variant="outline" disabled={searching || !query.trim()}>
                  {searching ? "Đang tìm…" : "Tìm"}
                </Button>
              </form>

              {results.length > 0 ? (
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {results.map((result) => (
                    <li key={result.refId}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-surface-soft"
                        onClick={() => onPickResult(result)}
                      >
                        <IconPin className="size-4 shrink-0 text-primary" />
                        <span className="min-w-0">{result.displayName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {addresses.length > 0 ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium text-ink">Địa chỉ đã lưu</p>
                <p className="text-sm text-muted">Địa chỉ có dấu ★ là địa chỉ mặc định trong tài khoản của bạn.</p>
                <div className="flex flex-wrap gap-2">
                  {addresses.map((address) => {
                    const active = address.id === activeAddressId;
                    return (
                      <Button
                        key={address.id}
                        type="button"
                        size="sm"
                        variant={active ? "primary" : "outline"}
                        aria-pressed={active}
                        onClick={() => onPickSavedAddress(address)}
                      >
                        <IconPin className="size-3.5" />
                        {address.label}
                        {address.isDefault ? " ★" : ""}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <Field
              label="Ghi chú cho nhân viên giao hàng"
              hint="Số nhà, toà nhà, hẻm, hoặc giờ bạn có thể nhận thuốc."
              className="max-w-xl"
            >
              <Input
                value={addressNote}
                onChange={(event) => onAddressNoteChange(event.target.value)}
                placeholder="Số nhà, toà nhà, hẻm…"
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={onLocateMe} disabled={busy}>
                <IconCrosshair className="size-4" />
                Dùng vị trí hiện tại
              </Button>
              <Button type="button" onClick={onCalculate} disabled={busy || !selectedStore}>
                Tính phí giao hàng
              </Button>
            </div>

            {canSaveDestination ? (
              <div className="rounded-lg border border-dashed border-line bg-surface-soft/60 px-3.5 py-3">
                <p className="text-sm font-medium text-ink">Lưu điểm giao này vào tài khoản</p>
                <p className="mt-0.5 text-xs text-muted">
                  Lần sau bạn chỉ cần bấm vào tên ở bước thanh toán, không phải tìm lại từ đầu.
                </p>
                <div className="mt-2">
                  <Button type="button" size="sm" onClick={onSaveDestination} disabled={savingDestination}>
                    <IconPin className="size-3.5" />
                    {savingDestination ? "Đang lưu…" : "Lưu điểm giao này"}
                  </Button>
                </div>
              </div>
            ) : null}

            {storePoint ? (
              <DeliveryMap
                key={mapKey}
                store={storePoint}
                destination={destination}
                onDestinationChange={onDestinationChange}
                {...(delivery ? { route: delivery.route.coordinates } : {})}
              />
            ) : (
              <div className="grid min-h-[280px] place-items-center rounded-lg border border-dashed border-line bg-surface-soft p-8 text-center">
                <p className="max-w-xs text-sm text-muted">
                  Nhà thuốc đang chọn chưa có toạ độ trên bản đồ. Dùng tìm kiếm địa chỉ hoặc vị trí hiện tại để chọn
                  điểm giao hàng.
                </p>
              </div>
            )}

            {delivery ? (
              <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary-soft/50 p-3.5">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <IconPin className="size-4 text-primary" />
                  <span className="min-w-0">{delivery.providerResolvedAddress}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Khoảng cách {formatDistance(delivery.distanceMeters)}</Badge>
                  <Badge variant="secondary">Dự kiến {Math.ceil(delivery.durationSeconds / 60)} phút</Badge>
                  <Badge>Phí giao {formatMoney(delivery.fee, delivery.currency)}</Badge>
                </div>
                {delivery.addressNote ? (
                  <p className="text-xs text-muted">Ghi chú gửi kèm: {delivery.addressNote}</p>
                ) : null}
              </div>
            ) : (
              <p className="rounded-md bg-surface-soft px-3.5 py-2.5 text-xs text-muted">
                Chưa tính phí giao hàng. Bấm “Tính phí giao hàng” để xem khoảng cách, thời gian dự kiến và phí trước khi
                đặt, hoặc để hệ thống tính khi bạn xác nhận đơn.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
