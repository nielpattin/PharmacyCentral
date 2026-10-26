import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@pharmacy/ui";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  ApiError,
  listAvailability,
  listPublishedPrices,
  listStores,
  requestPrescriptionConsultation,
  resolveCustomerSession,
  submitPrescriptionImage,
  submitPrescriptionQr,
  type CatalogProduct,
  type CatalogUnit,
  type PrescriptionIntakeResult,
} from "../customer-api.ts";
import { useSession } from "../auth.ts";
import { useAddToCart } from "../hooks/useAddToCart.ts";
import { useMountEffect } from "../hooks/useMountEffect.ts";
import { CartFeedback } from "../components/storefront/CartFeedback.tsx";
import { Link } from "../components/storefront/Link.tsx";
import { StoreBreadcrumb } from "../components/storefront/StoreBreadcrumb.tsx";
import { ImageLightbox } from "../components/storefront/ImageLightbox.tsx";
import { PrescriptionResults } from "../components/storefront/PrescriptionResults.tsx";
import { SiteFooter } from "../components/storefront/SiteFooter.tsx";
import { SiteHeader } from "../components/storefront/SiteHeader.tsx";
import { buildPriceIndex, buildStockIndex } from "../storefront/catalog.ts";
import { decodeQrFromImage, prepareImageForUpload } from "../storefront/prescription-image.ts";

/** Vietnamese wording for the intake failures the shopper can act on; every other failure keeps the service detail. */
const intakeErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const wait = error.retryAfterSeconds;
      if (wait === undefined) return "Bạn đã gửi quá nhiều ảnh đơn thuốc. Vui lòng thử lại sau.";
      return wait >= 60
        ? `Bạn đã gửi quá nhiều ảnh đơn thuốc. Vui lòng thử lại sau ${Math.ceil(wait / 60)} phút.`
        : `Bạn đã gửi quá nhiều ảnh đơn thuốc. Vui lòng thử lại sau ${Math.max(1, Math.ceil(wait))} giây.`;
    }
    if (error.status === 413) {
      return "Ảnh quá lớn nên chưa gửi được. Vui lòng chọn ảnh nhỏ hơn hoặc chụp lại ở độ phân giải thấp hơn.";
    }
    if (error.status === 503 && error.code === "rate_limit_unavailable") {
      return "Tạm thời chưa kiểm tra được số lượt gửi ảnh. Vui lòng thử lại sau ít phút.";
    }
  }
  return error instanceof Error ? error.message : "Không đọc được đơn thuốc";
};

/** Intake reports back when the shopper has not agreed, so a photo never uploads without that agreement. */
type IntakeOutcome = { kind: "result"; result: PrescriptionIntakeResult } | { kind: "consent" };

export const PrescriptionIntakePage = (): React.JSX.Element => {
  const session = useSession();
  const navigate = useNavigate();
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const selectedFile = useRef<File | undefined>(undefined);
  const previewUrlRef = useRef<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [consented, setConsented] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: async ({ file, consent }: { file: File; consent: boolean }): Promise<IntakeOutcome> => {
      // The QR is read on the device, so that path costs the shopper no agreement and no upload.
      const qrText = await decodeQrFromImage(file);
      if (qrText) {
        try {
          return { kind: "result", result: await submitPrescriptionQr(qrText) };
        } catch {
          // A QR the server rejects (not a prescription code, say) must not block a legible photo.
        }
      }
      if (!consent) return { kind: "consent" };
      return { kind: "result", result: await submitPrescriptionImage(await prepareImageForUpload(file)) };
    },
  });
  const { add, pendingProductId, error: addError, notice } = useAddToCart();
  const queryClient = useQueryClient();

  // Leaving the page mid-intake used to leak the picked photo's blob URL, so unmount drops whatever URL is current.
  useMountEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  });

  useQuery({ queryKey: ["customer-session"], queryFn: resolveCustomerSession });
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: listStores });
  const stores = storesQuery.data ?? [];
  const selectedStoreId = stores[0]?.id;
  const pricesQuery = useQuery({ queryKey: ["published-prices"], queryFn: listPublishedPrices });
  const availabilityQuery = useQuery({
    queryKey: ["availability", selectedStoreId],
    queryFn: () => listAvailability(selectedStoreId),
    enabled: Boolean(selectedStoreId),
  });
  const prices = pricesQuery.data ?? [];
  const availability = availabilityQuery.data ?? [];
  const priceIndex = useMemo(() => buildPriceIndex(prices, new Date().toISOString().slice(0, 10)), [prices]);
  const stockIndex = useMemo(() => buildStockIndex(availability), [availability]);

  const chooseFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Clearing the value lets the shopper pick the same photo again after an error.
    event.target.value = "";
    if (!file) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    selectedFile.current = file;
    mutation.mutate({ file, consent: consented });
  };

  // Re-sends the photo already on screen once the shopper ticks the consent box, so it need not be picked again.
  const retryWithConsent = (): void => {
    const file = selectedFile.current;
    if (!file || !consented) return;
    mutation.mutate({ file, consent: true });
  };

  const addToCart = (product: CatalogProduct, unit: CatalogUnit): void => {
    void add({ productId: product.id, productUnitId: unit.id, quantity: 1, productName: product.name });
  };

  // Sequential, so each cart response lands in the cache in order.
  const addManyToCart = async (picks: Array<{ product: CatalogProduct; unit: CatalogUnit }>): Promise<number> => {
    let added = 0;
    for (const { product, unit } of picks) {
      if (await add({ productId: product.id, productUnitId: unit.id, quantity: 1, productName: product.name })) added++;
    }
    return added;
  };

  const outcome = mutation.data;
  const result = outcome?.kind === "result" ? outcome.result : undefined;
  const consentMissing = outcome?.kind === "consent";
  const errorMessage = intakeErrorMessage(mutation.error);

  const body = (): React.JSX.Element => {
    if (!session.resolved) {
      return (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted" role="status">
            Đang kiểm tra đăng nhập…
          </CardContent>
        </Card>
      );
    }
    if (!session.authenticated) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Đăng nhập để gửi đơn thuốc</CardTitle>
            <CardDescription>Bạn cần đăng nhập tài khoản khách hàng trước khi gửi ảnh đơn thuốc.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-dark"
              href="/tai-khoan"
            >
              Đăng nhập
            </Link>
          </CardContent>
        </Card>
      );
    }
    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Ảnh đơn thuốc in</CardTitle>
            <CardDescription>
              Chụp hoặc chọn ảnh rõ nét, đủ sáng. Nếu đơn có mã QR, hệ thống sẽ đọc mã trước.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 rounded-md border border-line p-3">
              <p className="text-xs leading-relaxed text-muted">
                Mã QR trên đơn được đọc ngay trên thiết bị của bạn. Nếu ảnh không có mã QR đọc được, ảnh đơn thuốc sẽ
                được gửi tới Pharmacy Central và xử lý bởi Google Gemini (dịch vụ của Google, có thể xử lý dữ liệu ngoài
                Việt Nam) chỉ để đọc danh sách thuốc. Pharmacy Central không lưu lại ảnh đơn thuốc.
              </p>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={consented}
                  onChange={(event) => setConsented(event.target.checked)}
                />
                <span>
                  Tôi đồng ý gửi ảnh đơn thuốc để hệ thống đọc danh sách thuốc.
                  <span className="mt-0.5 block text-xs text-muted">
                    Ảnh đơn thuốc là dữ liệu sức khỏe cá nhân. Không tích ô này thì chỉ đường mã QR được dùng.
                  </span>
                </span>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={mutation.isPending} onClick={() => galleryInput.current?.click()}>
                Chọn ảnh đơn thuốc
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => cameraInput.current?.click()}
              >
                Chụp bằng camera
              </Button>
              <input ref={galleryInput} type="file" accept="image/*" className="hidden" onChange={chooseFile} />
              <input
                ref={cameraInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={chooseFile}
              />
            </div>
            {previewUrl ? (
              <button
                type="button"
                className="group relative w-fit max-w-full cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                aria-label="Xem ảnh đơn thuốc toàn màn hình"
                onClick={() => setViewerOpen(true)}
              >
                <img
                  src={previewUrl}
                  alt="Ảnh đơn thuốc đã chọn"
                  className="h-40 w-auto max-w-full rounded-md border border-line object-contain"
                />
                <span className="absolute right-1.5 bottom-1.5 rounded bg-ink/70 px-1.5 py-0.5 text-xs text-white opacity-90 group-hover:opacity-100">
                  Bấm để phóng to
                </span>
              </button>
            ) : null}
            {previewUrl && viewerOpen ? (
              <ImageLightbox src={previewUrl} alt="Ảnh đơn thuốc đã chọn" onClose={() => setViewerOpen(false)} />
            ) : null}
            {mutation.isPending ? (
              <Alert role="status" aria-live="polite">
                Đang đọc đơn thuốc...
              </Alert>
            ) : null}
            {mutation.isError ? <Alert variant="danger">{errorMessage}</Alert> : null}
            {consentMissing ? (
              <>
                <Alert role="alert">
                  Ảnh này cần được gửi cho hệ thống đọc, nhưng bạn chưa đồng ý. Hãy tích vào ô đồng ý ở trên rồi bấm
                  "Gửi ảnh đã chọn".
                </Alert>
                <div>
                  <Button type="button" disabled={!consented || mutation.isPending} onClick={retryWithConsent}>
                    Gửi ảnh đã chọn
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {result ? (
          // Keyed by submission, so a newly read prescription starts with fresh dialogs and a fresh request key.
          <PrescriptionResults
            key={mutation.submittedAt}
            result={result}
            priceIndex={priceIndex}
            pricesPending={pricesQuery.isPending}
            stockIndex={stockIndex}
            addingProductId={pendingProductId}
            onAdd={addToCart}
            onAddMany={addManyToCart}
            onAskPharmacist={async (request) => {
              await requestPrescriptionConsultation({
                ...request,
                source: result.source,
                siteId: selectedStoreId ?? null,
                prescription: result.prescription,
              });
              void queryClient.invalidateQueries({ queryKey: ["customer-prescription-consultations"] });
            }}
          />
        ) : null}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-background text-ink">
      <SiteHeader
        storeCount={stores.length || undefined}
        onSearch={(term) => void navigate({ to: "/", search: { q: term } })}
      />

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <PageHeader
          className="mb-0"
          breadcrumb={<StoreBreadcrumb items={[{ label: "Trang chủ", href: "/" }, { label: "Gửi đơn thuốc" }]} />}
          title="Gửi đơn thuốc"
          subtitle="Tải ảnh đơn thuốc in để nhận gợi ý các sản phẩm tương ứng."
        />

        {body()}
      </main>

      <CartFeedback notice={notice} error={addError} />
      <SiteFooter />
    </div>
  );
};
