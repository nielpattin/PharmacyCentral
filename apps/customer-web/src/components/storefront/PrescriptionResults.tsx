import { Alert, Badge, Button, Card, CardHeader, CardTitle, Dialog, Disclosure, cn } from "@pharmacy/ui";
import { useState } from "react";

import type {
  CatalogPrice,
  CatalogProduct,
  CatalogUnit,
  PrescriptionIntakeLine,
  PrescriptionIntakeMatch,
  PrescriptionIntakeResult,
} from "../../customer-api.ts";
import { activeUnit, priceFor, productMetadataLabel } from "../../storefront/catalog.ts";
import { formatMoney } from "../../storefront/format.ts";
import { Link } from "./Link.tsx";
import { ProductTile } from "./ProductTile.tsx";

type CatalogContext = {
  priceIndex: Map<string, CatalogPrice>;
  pricesPending: boolean;
  stockIndex: Map<string, boolean>;
  addingProductId: string | undefined;
  onAdd: (product: CatalogProduct, unit: CatalogUnit) => void;
};

type BestPick = { product: CatalogProduct; unit: CatalogUnit; price: CatalogPrice | undefined };

type PrescriptionResultsProps = CatalogContext & {
  result: PrescriptionIntakeResult;
  /** Adds one unit of every pick and resolves with how many the cart accepted. */
  onAddMany: (picks: Array<{ product: CatalogProduct; unit: CatalogUnit }>) => Promise<number>;
};

const SUMMARY_FIELDS = [
  ["Mã đơn", "code"],
  ["Bệnh nhân", "patientName"],
  ["Bác sĩ", "doctorName"],
  ["Ngày kê đơn", "issuedOn"],
] as const;

const SuggestionRow = ({
  match,
  highlighted,
  priceIndex,
  pricesPending,
  stockIndex,
  addingProductId,
  onAdd,
}: CatalogContext & { match: PrescriptionIntakeMatch; highlighted: boolean }): React.JSX.Element => {
  const { product } = match;
  const unit = activeUnit(product);
  const price = unit ? priceFor(priceIndex, product.id, unit.id) : undefined;
  const inStock = stockIndex.get(product.id);
  const unavailable = inStock === false;
  const details = [productMetadataLabel(product), product.manufacturer].filter(Boolean).join(" · ");

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center",
        highlighted ? "border-primary/30 bg-primary-soft/40" : "border-line bg-surface",
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <Link className="shrink-0" href={`/san-pham/${product.id}`}>
          <ProductTile
            name={product.name}
            seed={product.sku}
            imageUrl={product.imageUrl}
            className="size-14"
            monogramClassName="text-lg"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap gap-1">
            <Badge variant={match.matchType === "name" ? "primary" : "secondary"}>
              {match.matchType === "name" ? "Đúng tên" : "Cùng hoạt chất"}
            </Badge>
            {match.strengthMatch === true ? <Badge variant="primary">Đúng hàm lượng</Badge> : null}
            {match.strengthMatch === false ? <Badge variant="outline">Khác hàm lượng</Badge> : null}
            {product.prescriptionRequired ? <Badge variant="danger">Thuốc kê đơn</Badge> : null}
          </div>
          <h5 className="line-clamp-2 text-sm font-medium text-ink" title={product.name}>
            <Link className="hover:text-primary" href={`/san-pham/${product.id}`}>
              {product.name}
            </Link>
          </h5>
          {details ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted" title={details}>
              {details}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:w-36 sm:shrink-0 sm:flex-col sm:items-end sm:justify-center">
        <div className="sm:text-right">
          {price && unit ? (
            <p className={cn("text-base font-semibold", unavailable ? "text-muted" : "text-danger")}>
              {formatMoney(price.unitPrice, price.currency)}
              <span className="text-xs font-normal text-muted"> / {unit.unitName}</span>
            </p>
          ) : pricesPending ? (
            <span className="block h-6 w-20 animate-pulse rounded bg-surface-soft" aria-hidden="true" />
          ) : (
            <p className="text-sm font-medium text-muted">Liên hệ báo giá</p>
          )}
          <p className="mt-0.5">
            {unavailable ? (
              <Badge variant="danger">Hết hàng</Badge>
            ) : inStock === true ? (
              <Badge variant="secondary">Còn hàng</Badge>
            ) : (
              <Badge variant="outline">Đang cập nhật</Badge>
            )}
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 sm:w-full"
          variant={unavailable ? "secondary" : "primary"}
          disabled={addingProductId === product.id || !unit}
          onClick={() => unit && onAdd(product, unit)}
        >
          {addingProductId === product.id ? "Đang thêm..." : "Chọn mua"}
        </Button>
      </div>
    </div>
  );
};

const PrescribedMedicine = ({
  extracted,
  position,
}: {
  extracted: PrescriptionIntakeLine["extracted"];
  position: number;
}): React.JSX.Element => {
  const name = extracted.name ?? extracted.rawText;
  const form = [extracted.strength, extracted.dosageForm].filter(Boolean).join(" · ");
  const quantity =
    extracted.quantity !== null ? `${extracted.quantity}${extracted.unit ? ` ${extracted.unit}` : ""}` : undefined;
  return (
    <div className="flex min-w-0 gap-3">
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-soft text-xs font-semibold text-muted"
      >
        {position}
      </span>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-ink" title={extracted.rawText}>
          {name}
        </h4>
        {form ? <p className="mt-0.5 text-xs text-muted">{form}</p> : null}
        {extracted.activeIngredients.length > 0 ? (
          <p className="mt-0.5 text-xs text-muted">Hoạt chất: {extracted.activeIngredients.join(", ")}</p>
        ) : null}
        {quantity || extracted.usage ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink">
            {quantity ? <Badge variant="secondary">SL: {quantity}</Badge> : null}
            {extracted.usage ? <span>{extracted.usage}</span> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
};

const MedicineRow = ({
  line,
  position,
  ...catalog
}: CatalogContext & { line: PrescriptionIntakeLine; position: number }): React.JSX.Element => {
  const [best, ...alternatives] = line.matches;
  return (
    <li
      className={cn(
        "grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-5",
        !best && "bg-surface-soft/60",
      )}
    >
      <PrescribedMedicine extracted={line.extracted} position={position} />
      <div className="min-w-0">
        {best ? (
          <>
            <SuggestionRow match={best} highlighted {...catalog} />
            {alternatives.length > 0 ? (
              <Disclosure
                className="mt-1"
                closedLabel={`Xem ${alternatives.length} lựa chọn khác`}
                openLabel="Ẩn các lựa chọn khác"
              >
                <div className="space-y-2">
                  {alternatives.map((match) => (
                    <SuggestionRow key={match.product.id} match={match} highlighted={false} {...catalog} />
                  ))}
                </div>
              </Disclosure>
            ) : null}
          </>
        ) : (
          <p className="flex items-center gap-2 rounded-md border border-dashed border-line bg-surface px-3 py-3 text-sm text-muted">
            <Badge variant="outline">Chưa có gợi ý</Badge>
            Chưa tìm thấy thuốc tương ứng trong nhà thuốc
          </p>
        )}
      </div>
    </li>
  );
};

export const PrescriptionResults = ({ result, onAddMany, ...catalog }: PrescriptionResultsProps): React.JSX.Element => {
  const [bulkStep, setBulkStep] = useState<"closed" | "confirm" | "adding" | "done">("closed");
  const [addedCount, setAddedCount] = useState(0);

  const { prescription, lines } = result;
  const fields = SUMMARY_FIELDS.flatMap(([label, key]) => {
    const value = prescription[key];
    return value ? [{ label, value }] : [];
  });
  const context = [
    prescription.diagnosis ? `Chẩn đoán: ${prescription.diagnosis}` : null,
    prescription.facilityName ? `Cơ sở khám: ${prescription.facilityName}` : null,
  ].filter(Boolean);

  const matchedCount = lines.filter((line) => line.matches.length > 0).length;
  const unmatchedCount = lines.length - matchedCount;

  // The best suggestion of each line, minus duplicates and anything known to be out of stock.
  const picks: BestPick[] = [];
  for (const line of lines) {
    const product = line.matches[0]?.product;
    const unit = product ? activeUnit(product) : undefined;
    if (!product || !unit || catalog.stockIndex.get(product.id) === false) continue;
    if (picks.some((pick) => pick.product.id === product.id)) continue;
    picks.push({ product, unit, price: priceFor(catalog.priceIndex, product.id, unit.id) });
  }

  const addAll = async (): Promise<void> => {
    setBulkStep("adding");
    setAddedCount(await onAddMany(picks));
    setBulkStep("done");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle>Đơn thuốc đã đọc</CardTitle>
            <p className="mt-1 text-sm text-muted">
              <span className="font-medium text-ink">{lines.length} thuốc</span>
              {" · "}
              {matchedCount} có gợi ý{unmatchedCount > 0 ? ` · ${unmatchedCount} chưa tìm thấy` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={result.source === "qr" ? "primary" : "secondary"}>
              {result.source === "qr" ? "Đọc từ mã QR" : "Đọc từ ảnh bằng AI"}
            </Badge>
            {picks.length > 0 ? (
              <Button size="sm" onClick={() => setBulkStep("confirm")}>
                Thêm {picks.length} gợi ý tốt nhất vào giỏ
              </Button>
            ) : null}
          </div>
        </CardHeader>
        {fields.length > 0 || context.length > 0 ? (
          <div className="space-y-2 px-5 py-3">
            {fields.length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:grid-cols-4">
                {fields.map((field) => (
                  <div key={field.label} className="min-w-0">
                    <dt className="text-xs text-muted">{field.label}</dt>
                    <dd className="truncate font-medium text-ink" title={field.value}>
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {context.length > 0 ? <p className="text-xs text-muted">{context.join(" · ")}</p> : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <ol className="divide-y divide-line">
          {lines.map((line, index) => (
            <MedicineRow key={index} line={line} position={index + 1} {...catalog} />
          ))}
        </ol>
      </Card>

      <Alert>
        Gợi ý chỉ mang tính tham khảo. Với thuốc kê đơn, dược sĩ sẽ xác nhận đơn trước khi bán. Ảnh đơn thuốc bạn tải
        lên không được lưu lại.
      </Alert>

      <Dialog
        open={bulkStep !== "closed"}
        onClose={() => bulkStep !== "adding" && setBulkStep("closed")}
        title={bulkStep === "done" ? "Đã xử lý giỏ hàng" : "Thêm các gợi ý tốt nhất vào giỏ?"}
      >
        {bulkStep === "done" ? (
          <>
            <p className="text-sm text-ink" role="status">
              Đã thêm {addedCount}/{picks.length} sản phẩm vào giỏ hàng.
              {addedCount < picks.length ? " Một số sản phẩm chưa thêm được, bạn có thể thử lại từng sản phẩm." : ""}
            </p>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setBulkStep("closed")}>Đóng</Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              Mỗi sản phẩm được thêm 1 đơn vị, bạn có thể chỉnh số lượng trong giỏ hàng. Dược sĩ sẽ xác nhận trước khi
              bán.
            </p>
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {picks.map(({ product, unit, price }) => (
                <li key={product.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-ink" title={product.name}>
                    {product.name}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-muted">
                    {price ? `${formatMoney(price.unitPrice, price.currency)} / ${unit.unitName}` : "Liên hệ báo giá"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" disabled={bulkStep === "adding"} onClick={() => setBulkStep("closed")}>
                Hủy
              </Button>
              <Button disabled={bulkStep === "adding"} onClick={() => void addAll()}>
                {bulkStep === "adding" ? "Đang thêm..." : `Thêm ${picks.length} sản phẩm`}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
};
