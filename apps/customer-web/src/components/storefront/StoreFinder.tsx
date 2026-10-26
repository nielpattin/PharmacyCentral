import { Alert, Badge, Button, cn } from "@pharmacy/ui";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listNearestStores, type CatalogStore } from "../../customer-api.ts";
import { formatDistance } from "../../storefront/format.ts";
import { DeliveryMap } from "../DeliveryMap.tsx";
import { IconChevronRight, IconPin } from "./icons.tsx";
import { SectionHeading } from "./SectionHeading.tsx";

type Point = { latitude: number; longitude: number };

type FinderStatus = "idle" | "locating" | "loading" | "ready" | "error";

export const StoreFinder = ({
  stores,
  storesStatus,
  selectedStoreId,
  onSelectStore,
}: {
  stores: CatalogStore[];
  storesStatus: "loading" | "ready" | "error";
  selectedStoreId: string | undefined;
  onSelectStore: (storeId: string) => void;
}): React.JSX.Element => {
  const [point, setPoint] = useState<Point>();
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string>();
  const nearestQuery = useQuery({
    queryKey: ["nearest-stores", point],
    queryFn: () => listNearestStores(point?.latitude ?? 0, point?.longitude ?? 0, 5),
    enabled: Boolean(point),
  });

  const locate = (): void => {
    if (!navigator.geolocation) {
      setLocationMessage("Trình duyệt không hỗ trợ định vị");
      return;
    }
    setLocating(true);
    setLocationMessage(undefined);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setPoint({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        setLocating(false);
        setLocationMessage("Bạn chưa cho phép truy cập vị trí");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const status: FinderStatus = locating
    ? "locating"
    : nearestQuery.isPending && point
      ? "loading"
      : nearestQuery.isError
        ? "error"
        : point
          ? "ready"
          : "idle";
  const nearest = nearestQuery.data;
  const message =
    locationMessage ??
    (nearestQuery.error instanceof Error
      ? nearestQuery.error.message
      : nearestQuery.error
        ? "Không tải được danh sách nhà thuốc gần đây"
        : undefined);
  const visibleStores = nearest ?? stores;
  const selectedStore = stores.find((store) => store.id === selectedStoreId) ?? stores[0];
  const selectedStorePoint = selectedStore?.coordinates;

  return (
    <section id="nha-thuoc" className="scroll-mt-40 rounded-lg border border-line bg-surface p-5">
      <SectionHeading
        icon={<IconPin />}
        title="Hệ thống nhà thuốc"
        description="Chọn nhà thuốc để xem tồn kho và nhận hàng tại quầy"
        action={
          <Button variant="outline" onClick={locate} disabled={status === "locating" || status === "loading"}>
            {status === "locating" ? "Đang định vị..." : "Tìm nhà thuốc gần bạn"}
          </Button>
        }
      />

      {message ? (
        <Alert variant={status === "error" ? "danger" : "info"} className="mb-4">
          {message}
        </Alert>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-sm font-medium text-ink">
            {nearest ? "Nhà thuốc gần vị trí của bạn" : "Nhà thuốc đang hoạt động"}
          </p>
          {storesStatus === "loading" && !nearest ? (
            <ul className="space-y-2" aria-busy="true">
              {Array.from({ length: 2 }, (_, index) => (
                <li key={index} className="h-16 animate-pulse rounded-md bg-surface-soft" />
              ))}
            </ul>
          ) : null}
          {visibleStores.length === 0 && storesStatus === "ready" ? (
            <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
              Chưa có nhà thuốc nào đang hoạt động
            </p>
          ) : null}
          <ul className="space-y-2">
            {visibleStores.map((store) => {
              const active = store.id === selectedStoreId;
              return (
                <li key={store.id}>
                  <button
                    type="button"
                    onClick={() => onSelectStore(store.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left transition-colors",
                      active ? "border-primary bg-primary-soft/50" : "border-line hover:bg-surface-soft",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{store.name}</span>
                        {active ? <Badge>Đang chọn</Badge> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {store.address ?? "Chưa cập nhật địa chỉ"}
                      </span>
                    </span>
                    {store.straightLineMeters !== undefined ? (
                      <span className="shrink-0 text-xs font-medium text-primary">
                        {formatDistance(store.straightLineMeters)}
                      </span>
                    ) : (
                      <IconChevronRight className="mt-1 size-4 shrink-0 text-muted-soft" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {point ? (
            <p className="mt-3 text-xs text-muted-soft">
              Kéo điểm đỏ trên bản đồ để tìm nhà thuốc gần vị trí khác. Khoảng cách là đường chim bay.
            </p>
          ) : null}
        </div>

        {selectedStorePoint ? (
          <DeliveryMap
            key={`${selectedStore?.id ?? "none"}:${point?.latitude ?? ""}:${point?.longitude ?? ""}`}
            store={selectedStorePoint}
            {...(point ? { destination: point } : {})}
            onDestinationChange={(next) => {
              setPoint(next);
            }}
          />
        ) : (
          <div className="grid min-h-[360px] place-items-center rounded-md border border-dashed border-line bg-surface-soft p-8 text-center">
            <p className="max-w-xs text-sm text-muted">Nhà thuốc đang chọn chưa có toạ độ trên bản đồ.</p>
          </div>
        )}
      </div>
    </section>
  );
};
