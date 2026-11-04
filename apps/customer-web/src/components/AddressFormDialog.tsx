import { useForm } from "@tanstack/react-form";
import { Button, Dialog, Field, Input, Textarea } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { resolveAddressSuggestion, reverseGeocode, type AddressSearchResult } from "../customer-api.ts";
import { useAddressSearch } from "../hooks/useAddressSearch.ts";
import { useMountEffect } from "../hooks/useMountEffect.ts";
import { IconCrosshair, IconPin, IconSearch } from "./storefront/icons.tsx";
import { AddressPickerMap, type Point } from "./AddressPickerMap.tsx";

/** The sales service caps an address note at 500 characters, so the form counts the same. */
const ADDRESS_NOTE_MAX = 500;

/**
 * A pin drag fires a continuous stream of positions, and the provider is a metered API. The label follows the
 * pin once the shopper pauses rather than on every frame, so a long drag costs one call instead of hundreds.
 */
const REVERSE_GEOCODE_DEBOUNCE_MS = 600;

const LABEL_SUGGESTIONS = ["Nhà", "Văn phòng", "Bố mẹ", "Người thân"];

export type AddressDraft = {
  label: string;
  providerResolvedAddress: string;
  addressNote: string;
  point: Point;
  isDefault: boolean;
};

type AddressFormDialogProps = {
  /** The address being edited, or undefined when the shopper is adding a new one. */
  address: AddressDraft | undefined;
  /** How many addresses the shopper already has, which decides whether the default checkbox is meaningful. */
  existingCount: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: AddressDraft) => void;
};

/** Where the pin opens for a brand-new address: central Hanoi, where every store delivers. */
const FALLBACK_POINT: Point = { latitude: 21.03, longitude: 105.81 };

/**
 * The one form for adding and editing a delivery address.
 *
 * Order is deliberate: the name comes first because it is what the shopper recognises later on the checkout
 * chips, and the address is a single free-text field rather than separate street/district fields. Vietnamese
 * addresses are written as one line ("ngõ 150 Xuân Thủy, phường Cầu Giấy") and forcing a structure on them
 * loses the alley and the tower, which is the part the rider actually needs.
 *
 * The pin is what gets saved, not the text: the delivery fee is computed from that coordinate, so the map is
 * part of the form rather than a preview of it. Submitting needs a chosen point, and moving the pin is how the
 * shopper corrects a geocoder that landed in the middle of the street.
 */
export const AddressFormDialog = ({
  address,
  existingCount,
  busy,
  onClose,
  onSubmit,
}: AddressFormDialogProps): React.JSX.Element => {
  const editing = address !== undefined;
  const [search, setSearch] = useState(address?.providerResolvedAddress ?? "");
  const addressSearch = useAddressSearch();
  const [error, setError] = useState<string>();
  /** True while the label is catching up with a dragged pin, so the form can say the point is still settling. */
  const [resolvingAddress, setResolvingAddress] = useState(false);
  /** True while the suggestion the shopper picked is being turned into a point the pin can move to. */
  const [resolvingSelection, setResolvingSelection] = useState(false);
  /**
   * The map reads its coordinates once, so a point that arrives from outside it has to rebuild it rather than
   * move a marker that already exists. This counter is that rebuild key; a drag never changes it.
   */
  const [mapRevision, setMapRevision] = useState(0);
  // A slow lookup for an abandoned point must not rename the pin the shopper is looking at now.
  const reverseToken = useRef(0);
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Closing the dialog inside the debounce window must not still fire a paid lookup into a form that is gone.
  useMountEffect(() => () => {
    reverseToken.current += 1;
    clearTimeout(reverseTimer.current);
  });

  const form = useForm({
    defaultValues: {
      label: address?.label ?? "",
      providerResolvedAddress: address?.providerResolvedAddress ?? "",
      addressNote: address?.addressNote ?? "",
      point: address?.point ?? FALLBACK_POINT,
      isDefault: address?.isDefault ?? existingCount === 0,
    },
    onSubmit: async ({ value }) => {
      const label = value.label.trim();
      if (!label) {
        setError("Đặt tên cho địa chỉ, ví dụ “Nhà” hoặc “Văn phòng”.");
        return;
      }
      if (!value.providerResolvedAddress.trim()) {
        setError("Chọn một địa chỉ từ danh sách gợi ý, hoặc dùng vị trí hiện tại, rồi chỉnh điểm đỏ trên bản đồ.");
        return;
      }
      setError(undefined);
      onSubmit({
        ...value,
        label,
        providerResolvedAddress: value.providerResolvedAddress.trim(),
        addressNote: value.addressNote.trim(),
      });
    },
  });

  /**
   * A dragged pin has no address text, so the label under the map would keep describing wherever the pin used
   * to be. Each move is stamped, and only the newest one may write: a slow provider answer for an abandoned
   * point would otherwise snap the label to a place the shopper already moved away from.
   */
  const labelPin = (point: Point): void => {
    const token = reverseToken.current + 1;
    reverseToken.current = token;
    clearTimeout(reverseTimer.current);
    setResolvingAddress(true);
    reverseTimer.current = setTimeout(() => {
      void reverseGeocode(point)
        .then((resolved) => {
          if (reverseToken.current !== token) return;
          const label = resolved.providerResolvedAddress.trim();
          if (!label) return;
          form.setFieldValue("providerResolvedAddress", label);
          setSearch(label);
        })
        .catch((reason: unknown) => {
          if (reverseToken.current !== token) return;
          // The pin and its coordinates are still correct, so a failed lookup leaves the last good label alone.
          setError(reason instanceof Error ? reason.message : "Chưa tìm được tên địa chỉ ở vị trí này.");
        })
        .finally(() => {
          if (reverseToken.current === token) setResolvingAddress(false);
        });
    }, REVERSE_GEOCODE_DEBOUNCE_MS);
  };

  /**
   * A dragged pin has no address text, so only its label has to be asked for. The map already moved its own
   * marker: rebuilding it here would throw away the shopper's zoom and pan and reload its tiles, and the tile
   * provider bills per load.
   */
  const dragPin = (point: Point): void => {
    form.setFieldValue("point", point);
    labelPin(point);
  };

  /**
   * A point that arrives from outside the map has to rebuild it, because the map reads its coordinates once. A
   * geocoded result already carries its address and names the pin directly; the browser's own position does
   * not, so it asks the provider the way a drag does.
   */
  const placePin = (point: Point, knownAddress?: string): void => {
    form.setFieldValue("point", point);
    setMapRevision((revision) => revision + 1);
    if (knownAddress === undefined) {
      labelPin(point);
      return;
    }
    // A fresh address supersedes any lookup still in flight for the previous point.
    reverseToken.current += 1;
    clearTimeout(reverseTimer.current);
    setResolvingAddress(false);
    form.setFieldValue("providerResolvedAddress", knownAddress);
    setSearch(knownAddress);
  };

  const applyResult = (result: AddressSearchResult): void => {
    addressSearch.clear();
    // A suggestion carries a label and a handle, not a point, so choosing one resolves it before the pin moves.
    setResolvingSelection(true);
    setError(undefined);
    void resolveAddressSuggestion(result.refId)
      .then((resolved) => {
        placePin(resolved.destination, resolved.displayName || result.displayName);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Không lấy được vị trí của địa chỉ đã chọn.");
      })
      .finally(() => setResolvingSelection(false));
  };

  const locateMe = (): void => {
    if (!navigator.geolocation) {
      setError("Trình duyệt này không chia sẻ vị trí. Hãy tìm địa chỉ rồi chỉnh điểm đỏ trên bản đồ.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        placePin({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setError(
          "Đã lấy vị trí hiện tại. Kéo điểm đỏ đến đúng lối vào, hoặc tìm địa chỉ ở trên để ghi tên cho dễ nhận.",
        );
      },
      () => setError("Bạn chưa cho phép truy cập vị trí. Hãy tìm địa chỉ ở trên thay thế."),
    );
  };

  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      title={editing ? "Sửa địa chỉ giao hàng" : "Thêm địa chỉ giao hàng"}
      className="max-w-3xl"
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid min-h-0 flex-1 auto-rows-min gap-4 overflow-y-auto overscroll-contain pr-1 pb-4">
          <div className="grid gap-1.5">
            <form.Field name="label">
              {(field) => (
                <Field label="Tên địa chỉ" hint="Đây là tên bạn sẽ thấy ở bước thanh toán. Ví dụ: Nhà, Văn phòng.">
                  <div className="flex flex-wrap gap-1.5">
                    {LABEL_SUGGESTIONS.map((suggestion) => (
                      <Button
                        key={suggestion}
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-pressed={field.state.value === suggestion}
                        onClick={() => field.handleChange(suggestion)}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                  <Input
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    maxLength={100}
                    placeholder="Nhà"
                    required
                  />
                </Field>
              )}
            </form.Field>
          </div>

          <div className="grid gap-2">
            <Field
              label="Địa chỉ"
              hint="Gõ số nhà, tên đường, phường. Chọn một gợi ý rồi chỉnh điểm đỏ cho đúng chỗ giao."
            >
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-soft" />
                <Input
                  className="pl-9"
                  aria-label="Tìm địa chỉ giao hàng"
                  value={search}
                  autoComplete="street-address"
                  placeholder="123 Nguyễn Trãi, Phường Bến Thành"
                  onChange={(event) => {
                    const query = event.target.value;
                    setSearch(query);
                    setError(undefined);
                    addressSearch.searchSoon(query);
                  }}
                />
              </div>
            </Field>
            {addressSearch.searching || resolvingSelection ? (
              <p className="text-xs text-muted">
                {resolvingSelection ? "Đang lấy vị trí địa chỉ đã chọn…" : "Đang tìm địa chỉ…"}
              </p>
            ) : null}
            {addressSearch.results.length > 0 ? (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {addressSearch.results.map((result) => (
                  <li key={result.refId}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-surface-soft"
                      onClick={() => applyResult(result)}
                    >
                      <IconPin className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0">{result.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={locateMe}>
                <IconCrosshair className="size-4" />
                Dùng vị trí hiện tại
              </Button>
            </div>
          </div>

          <form.Subscribe selector={(state) => state.values.point}>
            {(point) => (
              <AddressPickerMap
                key={mapRevision}
                point={point}
                onPointChange={dragPin}
                addressLabel={form.state.values.providerResolvedAddress || undefined}
                resolving={resolvingAddress}
              />
            )}
          </form.Subscribe>

          <form.Field name="addressNote">
            {(field) => (
              <Field
                label="Ghi chú cho nhân viên giao hàng"
                hint="Số nhà, hướng cổng, tầng, thông tin giúp tìm đúng điểm giao."
              >
                <Textarea
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  maxLength={ADDRESS_NOTE_MAX}
                  rows={2}
                  placeholder="Hẻm 150, cổng bên trái, tầng 4"
                />
              </Field>
            )}
          </form.Field>

          {existingCount > 0 ? (
            <form.Field name="isDefault">
              {(field) => (
                <label className="flex items-start gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={field.state.value}
                    onChange={(event) => field.handleChange(event.target.checked)}
                  />
                  <span>
                    Dùng làm địa chỉ mặc định
                    <span className="mt-0.5 block text-xs text-muted">
                      Được chọn trước ở bước thanh toán, và phí giao tính theo đúng vị trí này.
                    </span>
                  </span>
                </label>
              )}
            </form.Field>
          ) : null}

          {(error ?? addressSearch.error) ? (
            <p className="text-sm text-danger" role="alert">
              {error ?? addressSearch.error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 border-t border-line pt-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Đang lưu…" : editing ? "Lưu địa chỉ" : "Thêm địa chỉ"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
